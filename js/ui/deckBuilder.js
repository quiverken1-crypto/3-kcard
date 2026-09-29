/**
 * deckBuilder.js — 卡组列表 / 卡组编辑器 / 分享码导入导出
 *
 * 布局：
 *  - 主页三个页签：图鉴（按势力浏览全部卡牌）、系统预设（按势力分组）、我的卡组（按势力分组）；卡组可只读查看。
 *  - 编辑：宽屏三栏（筛选 | 卡池 | 当前卡组），窄屏/竖屏改为“卡池 / 卡组”两个页签 + 底部常驻状态条。
 */
import { KINGDOMS, DB_CARD_MAP } from '../data/cardDB.js';
import {
  DECK_SIZE, DUAL, KINGDOM_KEYS, libraryFor, cardLimit, listDecks, getDeck, saveDeck, deleteDeck, duplicateDeck,
  validateDeck, deckTotal, deckStats, encodeDeck, decodeDeck, shareLink, deckSize, kingdomCounts, generateDualDeck, getCardDef, allKingdomKeys
} from '../data/deckStore.js';
import { renderHandCard, escapeHtml, showCardDetails } from './cardRenderer.js';
import { createCard } from '../engine/state.js';
import { qrSvg } from './qrcode.js';

const TROOP_LABEL = { INFANTRY: '步兵', CAVALRY: '骑兵', NAVY: '水军', STRATEGIST: '谋士', ARCHER: '器械' };
const TYPE_LABEL = { UNIT: '单位', TACTIC: '战法', COUNTER: '反制' };
const COST_BUCKETS = [['all', '全部'], ['0-1', '0–1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6+', '6+']];

const doc = () => globalThis.document;
const h = (html) => { const t = doc().createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

function curveSvg(curve, w = 96, hgt = 26) {
  const max = Math.max(1, ...curve);
  const bw = w / curve.length;
  return `<svg class="db-curve" viewBox="0 0 ${w} ${hgt + 10}" width="${w}" height="${hgt + 10}" aria-hidden="true">${curve.map((n, i) => {
    const bh = Math.round((n / max) * hgt);
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${hgt - bh}" width="${(bw - 2).toFixed(1)}" height="${bh}" rx="1.5"></rect><text x="${(i * bw + bw / 2).toFixed(1)}" y="${hgt + 9}">${i === 7 ? '7+' : i}</text>`;
  }).join('')}</svg>`;
}

export class DeckBuilder {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.kingdomFilter = 'all';
    this.filters = { type: 'all', troop: 'all', cost: 'all', src: 'all', q: '' };
    this.tab = 'pool';
    this.mode = 'single';
  }

  // ------------------------------------------------------------
  // 外壳
  // ------------------------------------------------------------
  _ensureRoot() {
    if (this.root?.isConnected) return this.root;
    this.root = h(`<div id="deck-builder" class="deck-builder hidden" role="dialog" aria-modal="true" aria-label="卡组"></div>`);
    doc().body.appendChild(this.root);
    return this.root;
  }

  open(section = null) {
    if (section) this.section = section;
    this._ensureRoot().classList.remove('hidden');
    doc().body.classList.add('deck-builder-open');
    this.renderList();
  }

  close() {
    if (this.deck && this.dirty && !this._confirmLeave()) return;
    this.root?.classList.add('hidden');
    doc().body.classList.remove('deck-builder-open');
    this.deck = null;
    this.onChange();
  }

  _confirmLeave() {
    return globalThis.confirm ? globalThis.confirm('卡组有未保存的修改，确定放弃吗？') : true;
  }

  _toast(msg) {
    const t = h(`<div class="db-toast">${escapeHtml(msg)}</div>`);
    this.root.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
  }

  // ------------------------------------------------------------
  // 主页：图鉴 / 系统预设 / 我的卡组
  // ------------------------------------------------------------
  renderList() {
    this.deck = null;
    this.section ||= 'codex';
    const root = this._ensureRoot();
    const sec = this.section;
    root.innerHTML = `
      <div class="db-shell db-hub">
        <header class="db-head">
          <button class="db-btn db-back" data-act="close">← 返回</button>
          <h2 class="db-title">卡组</h2>
          <div class="db-head-actions">
            <button class="db-btn" data-act="import">导入分享码</button>
            <button class="db-btn db-primary" data-act="new">＋ 新建卡组</button>
          </div>
        </header>
        <nav class="db-hub-tabs" role="tablist">
          ${[['codex', '图鉴'], ['presets', '系统预设'], ['mine', '我的卡组']].map(([k, l]) => `<button role="tab" class="db-hub-tab${sec === k ? ' active' : ''}" data-sec="${k}">${l}</button>`).join('')}
        </nav>
        <div class="db-hub-body"></div>
      </div>`;
    root.querySelector('[data-act="close"]').onclick = () => this.close();
    root.querySelector('[data-act="new"]').onclick = () => this.renderNew();
    root.querySelector('[data-act="import"]').onclick = () => this.renderImport();
    root.querySelectorAll('[data-sec]').forEach(b => { b.onclick = () => { this.section = b.dataset.sec; this.renderList(); }; });
    const body = root.querySelector('.db-hub-body');
    if (sec === 'codex') this._renderCodex(body);
    else this._renderDeckLists(body, sec === 'presets');
  }

  /** 图鉴：按势力浏览全部卡牌 */
  _renderCodex(body) {
    const keys = allKingdomKeys();
    if (!keys.includes(this.codexKingdom)) this.codexKingdom = keys[0];
    const k = this.codexKingdom;
    const f = (this.codexFilters ||= { type: 'all', troop: 'all', cost: 'all', src: 'all', q: '' });
    const sel = (group, opts, cur) => `<select data-cf="${group}" class="${cur && cur !== 'all' ? 'set' : ''}">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const lib = libraryFor(k);
    body.innerHTML = `
      <div class="db-codex-bar">
        <div class="db-chips db-kfilter">${keys.map(x => `<button class="db-chip db-kchip${x === k ? ' active' : ''}" data-ck="${x}"><span class="db-seal seal-${x}">${escapeHtml(KINGDOMS[x]?.name || '?')}</span>${escapeHtml(KINGDOMS[x]?.army || x)}</button>`).join('')}</div>
        <div class="db-fselects db-codex-filters">
          ${sel('type', [['all', '全部类型'], ...Object.entries(TYPE_LABEL)], f.type)}
          ${sel('troop', [['all', '全部兵种'], ...Object.entries(TROOP_LABEL)], f.troop)}
          ${sel('cost', [['all', '全部费用'], ...COST_BUCKETS.slice(1).map(([v, l]) => [v, `${l}费`])], f.cost)}
          ${sel('src', [['all', '全部来源'], ['base', '实体卡'], ['extra', '旧图鉴']], f.src)}
          <input class="db-search2" type="search" placeholder="🔍 卡名 / 技能 / 词条" value="${escapeHtml(f.q)}">
        </div>
      </div>
      <p class="db-codex-count"></p>
      <section class="db-pool db-codex-grid" aria-label="图鉴"></section>`;
    const grid = body.querySelector('.db-codex-grid');
    const draw = () => {
      const list = lib.filter(d => this._matchesWith(d, f));
      body.querySelector('.db-codex-count').textContent = `${KINGDOMS[k]?.army || k}：共 ${lib.length} 种卡，${lib.reduce((a, d) => a + (d.copies || 1), 0)} 张实体张数；当前显示 ${list.length} 种。点卡牌看详情。`;
      grid.replaceChildren();
      if (!list.length) { grid.innerHTML = '<p class="db-empty">没有符合筛选的卡牌</p>'; return; }
      for (const def of list) {
        const card = createCard(def, { faction: 'WEI', kingdom: def.kingdom || k, instanceId: `cx_${def.id}` });
        const tag = def.extra ? '<span class="db-tile-src">旧图鉴</span>' : /通用战法补足/.test(def.inferred || '') ? '<span class="db-tile-src fill">通用补足</span>' : def.custom ? '<span class="db-tile-src">自定义</span>' : '';
        const tile = h(`<div class="db-tile db-codex-tile" data-id="${def.id}"><div class="db-tile-card"></div><span class="db-tile-badge some">×${def.copies || 1}</span>${tag}</div>`);
        tile.querySelector('.db-tile-card').appendChild(renderHandCard(card));
        tile.addEventListener('click', (e) => { if (e.target.closest('.card-info-button')) return; showCardDetails(card); });
        grid.appendChild(tile);
      }
    };
    body.querySelectorAll('[data-ck]').forEach(b => { b.onclick = () => { this.codexKingdom = b.dataset.ck; this._renderCodex(body); }; });
    body.querySelectorAll('[data-cf]').forEach(sl => { sl.onchange = () => { f[sl.dataset.cf] = sl.value; sl.classList.toggle('set', sl.value !== 'all'); draw(); }; });
    body.querySelector('.db-search2').oninput = (e) => { f.q = e.target.value.trim(); draw(); };
    draw();
  }

  _matchesWith(def, f) {
    if (f.type !== 'all' && def.type !== f.type) return false;
    if (f.troop !== 'all' && def.troopType !== f.troop) return false;
    if (f.src === 'base' && def.extra) return false;
    if (f.src === 'extra' && !def.extra) return false;
    if (f.cost !== 'all') {
      const c = def.cost ?? 0;
      if (f.cost === '0-1' ? c > 1 : f.cost === '6+' ? c < 6 : c !== Number(f.cost)) return false;
    }
    if (f.q) {
      const hay = `${def.name}${def.skill?.name || ''}${def.skill?.description || ''}${(def.keywords || []).join('')}${(def.badges || []).join('')}`;
      if (!hay.includes(f.q)) return false;
    }
    return true;
  }

  /** 系统预设 / 我的卡组：按势力分组 */
  _renderDeckLists(body, official) {
    const decks = listDecks({ mode: this.mode }).filter(d => Boolean(d.official) === official);
    const groups = allKingdomKeys().map(k => [k, decks.filter(d => d.kingdom === k)]).filter(([, l]) => l.length);
    body.innerHTML = `
      <div class="db-listbar">
        <div class="db-seg">
          <button class="db-tab${this.mode === 'single' ? ' active' : ''}" data-mode="single">单阵营 · 40</button>
          <button class="db-tab${this.mode === 'dual' ? ' active' : ''}" data-mode="dual">双阵营 · 30+20</button>
        </div>
        ${groups.length > 1 ? `<div class="db-chips db-kfilter">${groups.map(([k]) => `<button class="db-chip" data-jump="${k}">${escapeHtml(KINGDOMS[k]?.name || k)}</button>`).join('')}</div>` : ''}
      </div>
      ${this.mode === 'dual' ? '<p class="db-hint">测试模式：主阵营 30 张 + 副阵营 20 张，主城 30 血，主城从主阵营选。按主阵营分组。</p>' : ''}
      <div class="db-groups">
        ${groups.map(([k, list]) => `
          <section class="db-group" id="dbg-${k}">
            <h3 class="db-group-title"><span class="db-seal seal-${k}">${escapeHtml(KINGDOMS[k]?.name || '?')}</span>${escapeHtml(KINGDOMS[k]?.army || k)}<small>${list.length} 套</small></h3>
            <div class="db-deck-grid">${list.map(d => this._deckCardHtml(d)).join('')}</div>
          </section>`).join('') || (official ? '<p class="db-empty">暂无系统预设</p>' : '<div class="db-empty">还没有自己的卡组。<br>可以在“系统预设”里“复制后编辑”，或点右上角“新建卡组”。</div>')}
      </div>
      <p class="db-foot-note">${official ? '系统预设不可直接修改，可“复制后编辑”，复制出的卡组会出现在“我的卡组”。' : '我的卡组保存在本机浏览器里；换设备或备份请用“分享码”。'}</p>`;
    body.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { this.mode = b.dataset.mode; this.renderList(); }; });
    body.querySelectorAll('[data-jump]').forEach(b => { b.onclick = () => body.querySelector(`#dbg-${b.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    body.querySelectorAll('.db-deck-card').forEach(el => {
      const d = getDeck(el.dataset.id);
      el.querySelectorAll('[data-deck-act]').forEach(btn => { btn.onclick = (e) => { e.stopPropagation(); this._deckAction(btn.dataset.deckAct, d); }; });
    });
  }

  _deckCardHtml(d) {
    const v = validateDeck(d);
    const { byType, curve } = deckStats(d);
    const sub = d.mode === 'dual' && d.subKingdom ? `<span class="db-seal db-seal-sub seal-${d.subKingdom}" title="副阵营">${KINGDOMS[d.subKingdom]?.name || '?'}</span>` : '';
    return `
      <div class="db-deck-card deck-${d.kingdom}${d.official ? ' official' : ''}" data-id="${d.id}">
        <div class="db-deck-top">
          <span class="db-seal seal-${d.kingdom}">${KINGDOMS[d.kingdom]?.name || '?'}</span>${sub}
          <div class="db-deck-name">${escapeHtml(d.name)}</div>
          <span class="db-count ${v.ok ? 'ok' : 'bad'}">${v.total}/${deckSize(d)}</span>
        </div>
        ${d.note ? `<div class="db-deck-note">${escapeHtml(d.note)}</div>` : ''}
        <div class="db-deck-mid">
          <span>单位 ${byType.UNIT} · 战法 ${byType.TACTIC} · 反制 ${byType.COUNTER}</span>
          ${curveSvg(curve)}
        </div>
        ${v.ok ? '' : '<div class="db-deck-warn">未完成，不能用于开局</div>'}
        <div class="db-deck-actions">
          <button class="db-btn" data-deck-act="view">查看</button>
          ${d.official ? '<button class="db-btn db-primary" data-deck-act="copy">复制后编辑</button>' : '<button class="db-btn db-primary" data-deck-act="edit">编辑</button><button class="db-btn" data-deck-act="copy">复制</button>'}
          <button class="db-btn" data-deck-act="share">分享码</button>
          ${d.official ? '' : '<button class="db-btn db-danger" data-deck-act="delete">删除</button>'}
        </div>
      </div>`;
  }

  /** 只读查看卡组：按类型分组的卡面 */
  renderPreview(d) {
    const root = this.root;
    const v = validateDeck(d);
    const entries = Object.entries(d.cards).map(([id, n]) => [getCardDef(id), n]).filter(([x]) => x)
      .sort(([a], [b]) => (a.cost - b.cost) || a.name.localeCompare(b.name, 'zh'));
    const byType = t => entries.filter(([x]) => x.type === t);
    root.innerHTML = `
      <div class="db-shell">
        <header class="db-head">
          <button class="db-btn db-back" data-act="back">← 卡组</button>
          <span class="db-seal seal-${d.kingdom}">${KINGDOMS[d.kingdom]?.name || '?'}</span>
          <h2 class="db-title">${escapeHtml(d.name)}</h2>
          <span class="db-count ${v.ok ? 'ok' : 'bad'}">${v.total}/${deckSize(d)}</span>
          <div class="db-head-actions">
            <button class="db-btn" data-act="share">分享码</button>
            <button class="db-btn db-primary" data-act="edit">${d.official ? '复制后编辑' : '编辑'}</button>
          </div>
        </header>
        ${[['UNIT', '单位'], ['TACTIC', '战法'], ['COUNTER', '反制']].map(([t, l]) => byType(t).length ? `
          <h3 class="db-group-title">${l}<small>${byType(t).reduce((a, [, n]) => a + n, 0)} 张</small></h3>
          <section class="db-pool db-codex-grid" data-t="${t}"></section>` : '').join('')}
      </div>`;
    for (const [t] of [['UNIT'], ['TACTIC'], ['COUNTER']]) {
      const grid = root.querySelector(`[data-t="${t}"]`);
      if (!grid) continue;
      for (const [def, n] of byType(t)) {
        const card = createCard(def, { faction: 'WEI', kingdom: def.kingdom || d.kingdom, instanceId: `pv_${def.id}` });
        const tile = h(`<div class="db-tile db-codex-tile"><div class="db-tile-card"></div><span class="db-tile-badge some">×${n}</span></div>`);
        tile.querySelector('.db-tile-card').appendChild(renderHandCard(card));
        tile.addEventListener('click', (e) => { if (e.target.closest('.card-info-button')) return; showCardDetails(card); });
        grid.appendChild(tile);
      }
    }
    root.querySelector('[data-act="back"]').onclick = () => this.renderList();
    root.querySelector('[data-act="share"]').onclick = () => this.renderShare(d);
    root.querySelector('[data-act="edit"]').onclick = () => this._deckAction(d.official ? 'copy' : 'edit', d);
  }

  _deckAction(act, d) {
    if (!d) return;
    if (act === 'view') this.renderPreview(d);
    else if (act === 'edit') this.renderEditor({ ...d, cards: { ...d.cards } });
    else if (act === 'copy') { const c = duplicateDeck(d); this.renderEditor(c); }
    else if (act === 'delete') {
      if (!globalThis.confirm || globalThis.confirm(`删除卡组【${d.name}】？此操作不能撤销（可先生成分享码备份）。`)) { deleteDeck(d.id); this.renderList(); this.onChange(); }
    } else if (act === 'share') this.renderShare(d);
  }

  // ------------------------------------------------------------
  // 新建
  // ------------------------------------------------------------
  renderNew() {
    const root = this.root;
    const dual = this.mode === 'dual';
    root.innerHTML = `
      <div class="db-shell db-narrow">
        <header class="db-head"><button class="db-btn db-back" data-act="back">← 卡组</button><h2 class="db-title">新建${dual ? '双阵营（测试）' : ''}卡组</h2></header>
        <p class="db-hint">${dual ? `主阵营（${DUAL.MAIN}张，主城从这里选）：` : '选择势力：'}</p>
        <div class="db-chips db-kpick">${allKingdomKeys().map(k => `<button class="db-chip db-chip-big deck-${k}" data-k="${k}">${KINGDOMS[k].army}</button>`).join('')}</div>
        ${dual ? `<p class="db-hint">副阵营（${DUAL.SUB}张）：</p>
        <div class="db-chips db-spick">${allKingdomKeys().map(k => `<button class="db-chip db-chip-big deck-${k}" data-s="${k}">${KINGDOMS[k].army}</button>`).join('')}</div>` : ''}
        <p class="db-hint">起点：</p>
        <div class="db-chips">
          <button class="db-chip active" data-start="preset">${dual ? '一键生成（按费用曲线从两家标准卡组均衡抽取）' : '从标准预设开始改'}</button>
          <button class="db-chip" data-start="empty">空白卡组</button>
        </div>
        <div class="db-row"><button class="db-btn db-primary" data-act="go" disabled>开始编辑</button></div>
      </div>`;
    let k = null;
    let sub = null;
    let start = 'preset';
    const go = root.querySelector('[data-act="go"]');
    const refresh = () => {
      root.querySelectorAll('[data-s]').forEach(x => { x.disabled = x.dataset.s === k; if (x.dataset.s === k && sub === k) { sub = null; } x.classList.toggle('active', x.dataset.s === sub); });
      go.disabled = !k || (dual && !sub);
    };
    root.querySelector('[data-act="back"]').onclick = () => this.renderList();
    root.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => { k = b.dataset.k; root.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('active', x === b)); refresh(); }; });
    root.querySelectorAll('[data-s]').forEach(b => { b.onclick = () => { sub = b.dataset.s; refresh(); }; });
    root.querySelectorAll('[data-start]').forEach(b => { b.onclick = () => { start = b.dataset.start; root.querySelectorAll('[data-start]').forEach(x => x.classList.toggle('active', x === b)); }; });
    go.onclick = () => {
      let deck;
      if (dual) {
        deck = start === 'preset' && getDeck(`preset_${k}_standard`) && getDeck(`preset_${sub}_standard`) ? generateDualDeck(k, sub, `我的${KINGDOMS[k].name}主·${KINGDOMS[sub].name}副`)
          : { id: null, name: `我的${KINGDOMS[k].name}主·${KINGDOMS[sub].name}副`, mode: 'dual', kingdom: k, subKingdom: sub, cards: {} };
      } else {
        const preset = getDeck(`preset_${k}_standard`);
        deck = { id: null, name: `我的${KINGDOMS[k].army}`, mode: 'single', kingdom: k, cards: start === 'preset' && preset ? { ...preset.cards } : {} };
      }
      this.renderEditor(deck, true);
    };
  }

  // ------------------------------------------------------------
  // 分享 / 导入
  // ------------------------------------------------------------
  async renderShare(d) {
    const code = await encodeDeck(d);
    const link = shareLink(code);
    const root = this.root;
    root.innerHTML = `
      <div class="db-shell db-narrow">
        <header class="db-head"><button class="db-btn db-back" data-act="back">← 卡组</button><h2 class="db-title">分享【${escapeHtml(d.name)}】</h2></header>
        <p class="db-hint">把分享码或链接发给朋友；对方在“卡组 → 导入分享码”粘贴，或直接打开链接即可导入。分享码也可以当作备份保存。</p>
        <label class="db-label">分享码</label>
        <textarea class="db-code" readonly rows="3">${code}</textarea>
        <div class="db-row"><button class="db-btn db-primary" data-copy="code">复制分享码</button><button class="db-btn" data-copy="link">复制链接</button></div>
        <div class="db-qr">${qrSvg(link, 180)}</div>
      </div>`;
    root.querySelector('[data-act="back"]').onclick = () => this.renderList();
    root.querySelectorAll('[data-copy]').forEach(b => {
      b.onclick = async () => {
        const text = b.dataset.copy === 'code' ? code : link;
        try { await globalThis.navigator.clipboard.writeText(text); this._toast('已复制'); } catch { root.querySelector('.db-code').select(); this._toast('请长按选择后手动复制'); }
      };
    });
  }

  renderImport(prefill = '') {
    const root = this._ensureRoot();
    root.classList.remove('hidden');
    doc().body.classList.add('deck-builder-open');
    root.innerHTML = `
      <div class="db-shell db-narrow">
        <header class="db-head"><button class="db-btn db-back" data-act="back">← 卡组</button><h2 class="db-title">导入分享码</h2></header>
        <textarea class="db-code" rows="4" placeholder="粘贴 SGK1-… 分享码或分享链接">${escapeHtml(prefill)}</textarea>
        <div class="db-row"><button class="db-btn db-primary" data-act="parse">解析</button></div>
        <div class="db-import-result"></div>
      </div>`;
    const out = root.querySelector('.db-import-result');
    root.querySelector('[data-act="back"]').onclick = () => this.renderList();
    const parse = async () => {
      try {
        const deck = await decodeDeck(root.querySelector('.db-code').value);
        const v = validateDeck(deck);
        out.innerHTML = `
          <div class="db-deck-card deck-${deck.kingdom}">
            <div class="db-deck-top"><span class="db-seal seal-${deck.kingdom}">${KINGDOMS[deck.kingdom].name}</span>${deck.subKingdom ? `<span class="db-seal db-seal-sub seal-${deck.subKingdom}">${KINGDOMS[deck.subKingdom].name}</span>` : ''}<div class="db-deck-name">${escapeHtml(deck.name)}${deck.mode === 'dual' ? '（双阵营）' : ''}</div><span class="db-count ${v.ok ? 'ok' : 'bad'}">${v.total}/${deckSize(deck)}</span></div>
            ${v.errors.length ? `<div class="db-deck-warn">${v.errors.map(escapeHtml).join('<br>')}</div>` : ''}
            <div class="db-deck-actions"><button class="db-btn db-primary" data-act="save">保存到我的卡组</button><button class="db-btn" data-act="edit">打开编辑</button></div>
          </div>`;
        out.querySelector('[data-act="save"]').onclick = () => { const s = saveDeck(deck); this.mode = s.mode || 'single'; this.section = 'mine'; this._toast(`已保存【${s.name}】`); this.onChange(); this.renderList(); };
        out.querySelector('[data-act="edit"]').onclick = () => this.renderEditor(deck, true);
      } catch (err) {
        out.innerHTML = `<p class="db-error">${escapeHtml(err.message || '解析失败')}</p>`;
      }
    };
    root.querySelector('[data-act="parse"]').onclick = parse;
    if (prefill) parse();
  }

  // ------------------------------------------------------------
  // 编辑器
  // ------------------------------------------------------------
  renderEditor(deck, dirty = false) {
    this.deck = deck;
    this.dirty = dirty;
    this.tab = 'pool';
    const k = deck.kingdom;
    const root = this.root;
    const f = this.filters;
    const sel = (group, opts, cur) => `<select data-fs="${group}" class="${cur && cur !== 'all' ? 'set' : ''}" aria-label="${opts[0][1]}">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const chip = (group, val, label, cur) => `<button class="db-chip${cur === val ? ' active' : ''}" data-f="${group}" data-v="${val}">${label}</button>`;
    root.innerHTML = `
      <div class="db-shell db-editor deck-${k}" data-tab="pool">
        <header class="db-head">
          <button class="db-btn db-back" data-act="back">← 卡组</button>
          <span class="db-seal seal-${k}">${KINGDOMS[k].name}</span>${deck.mode === 'dual' ? `<span class="db-seal db-seal-sub seal-${deck.subKingdom}" title="副阵营">${KINGDOMS[deck.subKingdom].name}</span>` : ''}
          <input class="db-name" maxlength="24" value="${escapeHtml(deck.name)}" aria-label="卡组名称">
          <div class="db-head-actions">
            <button class="db-btn" data-act="share">分享码</button>
            <button class="db-btn db-primary" data-act="save">保存</button>
          </div>
        </header>
        <div class="db-mobile-tabs">
          <button class="db-tab active" data-tab="pool">卡池</button>
          <button class="db-tab" data-tab="deck">卡组 <b class="db-tab-count">0/${deckSize(deck)}</b></button>
        </div>
        <div class="db-body">
          <aside class="db-filters">
            ${deck.mode === 'dual' ? `<div class="db-fgroup"><span>阵营</span>${chip('side', 'all', '全部', f.side || 'all')}${chip('side', 'main', `主·${KINGDOMS[k].name}`, f.side || 'all')}${chip('side', 'sub', `副·${KINGDOMS[deck.subKingdom].name}`, f.side || 'all')}</div>` : ''}
            <div class="db-fgroup"><span>类型</span>${chip('type', 'all', '全部', f.type)}${Object.entries(TYPE_LABEL).map(([v, l]) => chip('type', v, l, f.type)).join('')}</div>
            <div class="db-fgroup"><span>兵种</span>${chip('troop', 'all', '全部', f.troop)}${Object.entries(TROOP_LABEL).map(([v, l]) => chip('troop', v, l, f.troop)).join('')}</div>
            <div class="db-fgroup"><span>费用</span>${COST_BUCKETS.map(([v, l]) => chip('cost', v, l, f.cost)).join('')}</div>
            <div class="db-fgroup"><span>来源</span>${chip('src', 'all', '全部', f.src)}${chip('src', 'base', '实体卡', f.src)}${chip('src', 'extra', '旧图鉴', f.src)}</div>
            <input class="db-search" placeholder="搜索卡名 / 技能 / 词条" value="${escapeHtml(f.q)}">
            <div class="db-fselects">
              ${deck.mode === 'dual' ? sel('side', [['all', '阵营'], ['main', `主·${KINGDOMS[k].name}`], ['sub', `副·${KINGDOMS[deck.subKingdom].name}`]], f.side || 'all') : ''}
              ${sel('type', [['all', '类型'], ...Object.entries(TYPE_LABEL)], f.type)}
              ${sel('troop', [['all', '兵种'], ...Object.entries(TROOP_LABEL)], f.troop)}
              ${sel('cost', [['all', '费用'], ...COST_BUCKETS.slice(1).map(([v, l]) => [v, `${l}费`])], f.cost)}
              ${deck.mode === 'dual' ? '' : sel('src', [['all', '来源'], ['base', '实体卡'], ['extra', '旧图鉴']], f.src)}
              <input class="db-search2" type="search" placeholder="🔍 搜索" value="${escapeHtml(f.q)}">
            </div>
          </aside>
          <section class="db-pool" aria-label="卡池"></section>
          <section class="db-deck" aria-label="当前卡组">
            <div class="db-summary"></div>
            <div class="db-rows"></div>
          </section>
        </div>
        <div class="db-selbar" aria-live="polite"></div>
        <footer class="db-statusbar"></footer>
      </div>`;
    const shell = root.querySelector('.db-editor');
    root.querySelector('[data-act="back"]').onclick = () => { if (!this.dirty || this._confirmLeave()) this.renderList(); };
    root.querySelector('[data-act="save"]').onclick = () => this._save();
    root.querySelector('[data-act="share"]').onclick = () => { const v = validateDeck(this.deck); if (!v.ok) this._toast('卡组未完成，分享码仍可生成'); this.renderShare(this.deck); };
    root.querySelector('.db-name').oninput = (e) => { this.deck.name = e.target.value.trim() || '未命名卡组'; this.dirty = true; };
    root.querySelectorAll('[data-f]').forEach(b => {
      b.onclick = () => {
        this.filters[b.dataset.f] = b.dataset.v;
        root.querySelectorAll(`[data-f="${b.dataset.f}"]`).forEach(x => x.classList.toggle('active', x === b));
        const sl = root.querySelector(`[data-fs="${b.dataset.f}"]`);
        if (sl) { sl.value = b.dataset.v; sl.classList.toggle('set', b.dataset.v !== 'all'); }
        this._renderPool();
      };
    });
    root.querySelector('.db-search').oninput = (e) => { this.filters.q = e.target.value.trim(); this._renderPool(); };
    root.querySelector('.db-search2').oninput = (e) => { this.filters.q = e.target.value.trim(); this._renderPool(); };
    root.querySelectorAll('[data-fs]').forEach(sl => {
      sl.onchange = () => {
        this.filters[sl.dataset.fs] = sl.value;
        sl.classList.toggle('set', sl.value !== 'all');
        root.querySelectorAll(`[data-f="${sl.dataset.fs}"]`).forEach(x => x.classList.toggle('active', x.dataset.v === sl.value));
        this._renderPool();
      };
    });
    this.selectedId = null;
    root.querySelectorAll('.db-mobile-tabs .db-tab').forEach(b => {
      b.onclick = () => { this.tab = b.dataset.tab; shell.dataset.tab = this.tab; root.querySelectorAll('.db-mobile-tabs .db-tab').forEach(x => x.classList.toggle('active', x === b)); };
    });
    this._renderPool();
    this._renderDeck();
  }

  _matches(def) {
    const f = this.filters;
    if (this.deck.mode === 'dual' && f.side && f.side !== 'all') {
      if (f.side === 'main' && def.kingdom !== this.deck.kingdom) return false;
      if (f.side === 'sub' && def.kingdom !== this.deck.subKingdom) return false;
    }
    if (f.type !== 'all' && def.type !== f.type) return false;
    if (f.troop !== 'all' && def.troopType !== f.troop) return false;
    if (f.src === 'base' && def.extra) return false;
    if (f.src === 'extra' && !def.extra) return false;
    if (f.cost !== 'all') {
      const c = def.cost ?? 0;
      if (f.cost === '0-1' ? c > 1 : f.cost === '6+' ? c < 6 : c !== Number(f.cost)) return false;
    }
    if (f.q) {
      const hay = `${def.name}${def.skill?.name || ''}${def.skill?.description || ''}${(def.keywords || []).join('')}${(def.badges || []).join('')}`;
      if (!hay.includes(f.q)) return false;
    }
    return true;
  }

  _renderPool() {
    const pool = this.root.querySelector('.db-pool');
    if (!pool) return;
    const k = this.deck.kingdom;
    const kingdoms = this.deck.mode === 'dual' ? [k, this.deck.subKingdom] : [k];
    const list = kingdoms.flatMap(x => libraryFor(x)).filter(d => this._matches(d));
    pool.replaceChildren();
    if (!list.length) { pool.innerHTML = '<p class="db-empty">没有符合筛选的卡牌</p>'; return; }
    for (const def of list) {
      const card = createCard(def, { faction: 'WEI', kingdom: def.kingdom || k, instanceId: `lib_${def.id}` });
      const tile = h(`<div class="db-tile" data-id="${def.id}"><div class="db-tile-card"></div><span class="db-tile-badge"></span>${def.extra ? '<span class="db-tile-src">旧图鉴</span>' : ''}</div>`);
      const el = renderHandCard(card);
      tile.querySelector('.db-tile-card').appendChild(el);
      tile.addEventListener('click', (e) => {
        if (e.target.closest('.card-info-button')) return;
        // 点卡：选中，在下方用 −/＋ 调数量；再点一次同一张 = ＋1
        if (this.selectedId === def.id) this._add(def.id);
        else this._select(def.id);
      });
      pool.appendChild(tile);
    }
    this._refreshBadges();
  }

  _select(id) {
    this.selectedId = id;
    this._refreshBadges();
  }

  _renderSelBar() {
    const bar = this.root.querySelector('.db-selbar');
    if (!bar) return;
    const id = this.selectedId;
    const def = id && getCardDef(id);
    if (!def) { bar.classList.remove('show'); bar.replaceChildren(); return; }
    const n = this.deck.cards[id] || 0;
    const lim = cardLimit(id);
    const sub = def.type === 'UNIT' ? `${def.cost}费 · ${TROOP_LABEL[def.troopType] || ''} ${def.atk}/${def.hp}` : `${def.cost}费 · ${TYPE_LABEL[def.type]}`;
    bar.innerHTML = `
      <span class="db-sb-name">${escapeHtml(def.name)}<small>${sub}${def.skill?.description ? ` · ${escapeHtml(def.skill.description)}` : ''}</small></span>
      <button class="db-btn db-sb-info" data-sb="info">详情</button>
      <div class="db-sb-step">
        <button data-sb="minus" aria-label="减少"${n ? '' : ' disabled'}>−</button>
        <span class="db-sb-n">${n}<small>/${lim}</small></span>
        <button data-sb="plus" aria-label="增加"${n >= lim ? ' disabled' : ''}>＋</button>
      </div>
      <button class="db-sb-x" data-sb="close" aria-label="取消选中">×</button>`;
    bar.classList.add('show');
    bar.querySelector('[data-sb="minus"]').onclick = () => this._remove(id);
    bar.querySelector('[data-sb="plus"]').onclick = () => this._add(id);
    bar.querySelector('[data-sb="close"]').onclick = () => this._select(null);
    bar.querySelector('[data-sb="info"]').onclick = () => showCardDetails(createCard(def, { faction: 'WEI', kingdom: def.kingdom || this.deck.kingdom }));
  }

  _refreshBadges() {
    this._renderSelBar();
    this.root.querySelectorAll('.db-tile').forEach(t => {
      const id = t.dataset.id;
      const n = this.deck.cards[id] || 0;
      const lim = cardLimit(id);
      const badge = t.querySelector('.db-tile-badge');
      badge.textContent = `${n}/${lim}`;
      badge.classList.toggle('some', n > 0);
      t.classList.toggle('maxed', n >= lim);
      t.classList.toggle('has', n > 0);
      t.classList.toggle('selected', id === this.selectedId);
    });
  }

  _add(id) {
    const n = this.deck.cards[id] || 0;
    if (n >= cardLimit(id)) { this._toast(`【${getCardDef(id).name}】最多${cardLimit(id)}张`); return; }
    if (this.deck.mode === 'dual') {
      const kc = kingdomCounts(this.deck);
      const kd = getCardDef(id).kingdom;
      const cap = kd === this.deck.kingdom ? DUAL.MAIN : DUAL.SUB;
      if ((kc[kd] || 0) >= cap) { this._toast(`${kd === this.deck.kingdom ? '主' : '副'}阵营已满 ${cap} 张，先移除一些`); return; }
    } else if (deckTotal(this.deck) >= DECK_SIZE) { this._toast(`卡组已满 ${DECK_SIZE} 张，先移除一些`); return; }
    this.deck.cards[id] = n + 1;
    this.dirty = true;
    this._renderDeck(id);
    this._refreshBadges();
  }

  _remove(id) {
    const n = this.deck.cards[id] || 0;
    if (n <= 1) delete this.deck.cards[id]; else this.deck.cards[id] = n - 1;
    this.dirty = true;
    this._renderDeck();
    this._refreshBadges();
  }

  _renderDeck(flashId = null) {
    const deck = this.deck;
    const v = validateDeck(deck);
    const { byType, curve } = deckStats(deck);
    const summary = this.root.querySelector('.db-summary');
    const size = deckSize(deck);
    const dualLine = deck.mode === 'dual'
      ? `<div class="db-sum-dual"><span class="db-seal seal-${deck.kingdom}">${KINGDOMS[deck.kingdom].name}</span> ${v.perKingdom[deck.kingdom] || 0}/${DUAL.MAIN}　<span class="db-seal db-seal-sub seal-${deck.subKingdom}">${KINGDOMS[deck.subKingdom].name}</span> ${v.perKingdom[deck.subKingdom] || 0}/${DUAL.SUB}</div>` : '';
    summary.innerHTML = `${dualLine}
      <div class="db-sum-top"><span class="db-count big ${v.ok ? 'ok' : 'bad'}">${v.total}/${size}</span>
        <span class="db-sum-types">单位 ${byType.UNIT}<br>战法 ${byType.TACTIC}<br>反制 ${byType.COUNTER}</span>${curveSvg(curve, 120, 30)}</div>`;
    const rows = this.root.querySelector('.db-rows');
    const entries = Object.entries(deck.cards).map(([id, n]) => [getCardDef(id), n]).filter(([d]) => d)
      .sort(([a], [b]) => (a.cost - b.cost) || a.name.localeCompare(b.name, 'zh'));
    rows.innerHTML = entries.length ? entries.map(([d, n]) => `
      <div class="db-row-card type-${d.type.toLowerCase()}${d.id === flashId ? ' flash' : ''}" data-id="${d.id}">
        <span class="db-rc-cost">${d.cost}</span>
        ${deck.mode === 'dual' ? `<span class="db-rc-k seal-${d.kingdom}">${KINGDOMS[d.kingdom]?.name || ''}</span>` : ''}<button class="db-rc-name" data-act="info">${escapeHtml(d.name)}<small>${d.type === 'UNIT' ? TROOP_LABEL[d.troopType] || '' : TYPE_LABEL[d.type]}</small></button>
        <span class="db-rc-n">×${n}</span>
        <button class="db-rc-btn" data-act="minus" aria-label="减少">−</button>
        <button class="db-rc-btn" data-act="plus" aria-label="增加"${n >= cardLimit(d.id) ? ' disabled' : ''}>＋</button>
      </div>`).join('') : '<p class="db-empty">在卡池点选卡牌，用下方 ＋ 加入</p>';
    rows.querySelectorAll('.db-row-card').forEach(r => {
      const id = r.dataset.id;
      r.querySelector('[data-act="minus"]').onclick = () => this._remove(id);
      r.querySelector('[data-act="plus"]').onclick = () => this._add(id);
      r.querySelector('[data-act="info"]').onclick = () => showCardDetails(createCard(getCardDef(id), { faction: 'WEI', kingdom: getCardDef(id).kingdom || deck.kingdom }));
    });
    const bar = this.root.querySelector('.db-statusbar');
    const msg = v.errors[0] || v.warnings[0] || '卡组完整，可以保存并用于开局';
    bar.innerHTML = `<span class="db-count ${v.ok ? 'ok' : 'bad'}">${v.total}/${size}</span><span class="db-status-msg ${v.ok ? (v.warnings.length ? 'warn' : 'ok') : 'bad'}">${escapeHtml(msg)}</span><button class="db-btn db-primary" data-act="save2">保存</button>`;
    bar.querySelector('[data-act="save2"]').onclick = () => this._save();
    const tc = this.root.querySelector('.db-tab-count');
    if (tc) tc.textContent = `${v.total}/${size}`;
  }

  _save() {
    const v = validateDeck(this.deck);
    const saved = saveDeck(this.deck);
    this.deck = { ...saved, cards: { ...saved.cards } };
    this.section = 'mine';
    this.dirty = false;
    this._toast(v.ok ? `已保存【${saved.name}】` : `已保存为未完成卡组（${v.total}/${deckSize(saved)}），补齐后才能用于开局`);
    this.onChange();
  }
}
