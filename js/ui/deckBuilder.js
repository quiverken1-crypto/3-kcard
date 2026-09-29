/**
 * deckBuilder.js — 卡组列表 / 卡组编辑器 / 分享码导入导出
 *
 * 布局：
 *  - 列表：顶部模式页签（单阵营；双阵营后续加入），势力筛选，卡组卡片（名称、势力、张数、费用曲线、操作）。
 *  - 编辑：宽屏三栏（筛选 | 卡池 | 当前卡组），窄屏/竖屏改为“卡池 / 卡组”两个页签 + 底部常驻状态条。
 */
import { KINGDOMS, DB_CARD_MAP } from '../data/cardDB.js';
import {
  DECK_SIZE, KINGDOM_KEYS, libraryFor, cardLimit, listDecks, getDeck, saveDeck, deleteDeck, duplicateDeck,
  validateDeck, deckTotal, deckStats, encodeDeck, decodeDeck, shareLink
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

  open() {
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
  // 列表
  // ------------------------------------------------------------
  renderList() {
    this.deck = null;
    const kf = this.kingdomFilter;
    const decks = listDecks({ mode: 'single', kingdom: kf === 'all' ? null : kf });
    const root = this._ensureRoot();
    root.innerHTML = `
      <div class="db-shell db-list-view">
        <header class="db-head">
          <button class="db-btn db-back" data-act="close">← 返回</button>
          <h2 class="db-title">卡组</h2>
          <div class="db-head-actions">
            <button class="db-btn" data-act="import">导入分享码</button>
            <button class="db-btn db-primary" data-act="new">＋ 新建卡组</button>
          </div>
        </header>
        <div class="db-mode-tabs">
          <button class="db-tab active">单阵营（40张）</button>
          <button class="db-tab" disabled title="第4步加入">双阵营（测试）· 即将开放</button>
        </div>
        <div class="db-chips db-kfilter">
          ${[['all', '全部'], ...KINGDOM_KEYS.map(k => [k, KINGDOMS[k].army])].map(([k, l]) => `<button class="db-chip${kf === k ? ' active' : ''}" data-kf="${k}">${l}</button>`).join('')}
        </div>
        <div class="db-deck-grid">
          ${decks.map(d => this._deckCardHtml(d)).join('') || '<p class="db-empty">还没有卡组，点右上角“新建卡组”。</p>'}
        </div>
        <p class="db-foot-note">自组卡组保存在本机浏览器里；换设备或备份请用“分享码”。官方预设不可直接修改，可“复制后编辑”。</p>
      </div>`;
    root.querySelector('[data-act="close"]').onclick = () => this.close();
    root.querySelector('[data-act="new"]').onclick = () => this.renderNew();
    root.querySelector('[data-act="import"]').onclick = () => this.renderImport();
    root.querySelectorAll('[data-kf]').forEach(b => { b.onclick = () => { this.kingdomFilter = b.dataset.kf; this.renderList(); }; });
    root.querySelectorAll('.db-deck-card').forEach(el => {
      const d = getDeck(el.dataset.id);
      el.querySelectorAll('[data-deck-act]').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); this._deckAction(btn.dataset.deckAct, d); };
      });
    });
  }

  _deckCardHtml(d) {
    const v = validateDeck(d);
    const { byType, curve } = deckStats(d);
    const k = KINGDOMS[d.kingdom];
    return `
      <div class="db-deck-card deck-${d.kingdom}${d.official ? ' official' : ''}" data-id="${d.id}">
        <div class="db-deck-top">
          <span class="db-seal seal-${d.kingdom}">${k?.name || '?'}</span>
          <div class="db-deck-name">${d.official ? '🔒 ' : ''}${escapeHtml(d.name)}</div>
          <span class="db-count ${v.ok ? 'ok' : 'bad'}">${v.total}/${DECK_SIZE}</span>
        </div>
        <div class="db-deck-mid">
          <span>单位 ${byType.UNIT} · 战法 ${byType.TACTIC} · 反制 ${byType.COUNTER}</span>
          ${curveSvg(curve)}
        </div>
        ${v.ok ? '' : '<div class="db-deck-warn">未完成，不能用于开局</div>'}
        <div class="db-deck-actions">
          ${d.official ? '<button class="db-btn" data-deck-act="copy">复制后编辑</button>' : '<button class="db-btn db-primary" data-deck-act="edit">编辑</button><button class="db-btn" data-deck-act="copy">复制</button>'}
          <button class="db-btn" data-deck-act="share">分享码</button>
          ${d.official ? '' : '<button class="db-btn db-danger" data-deck-act="delete">删除</button>'}
        </div>
      </div>`;
  }

  _deckAction(act, d) {
    if (!d) return;
    if (act === 'edit') this.renderEditor({ ...d, cards: { ...d.cards } });
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
    root.innerHTML = `
      <div class="db-shell db-narrow">
        <header class="db-head"><button class="db-btn db-back" data-act="back">← 卡组</button><h2 class="db-title">新建卡组</h2></header>
        <p class="db-hint">选择势力：</p>
        <div class="db-chips db-kpick">${KINGDOM_KEYS.map(k => `<button class="db-chip db-chip-big deck-${k}" data-k="${k}">${KINGDOMS[k].army}</button>`).join('')}</div>
        <p class="db-hint">起点：</p>
        <div class="db-chips">
          <button class="db-chip active" data-start="preset">从标准预设开始改</button>
          <button class="db-chip" data-start="empty">空白卡组</button>
        </div>
        <div class="db-row"><button class="db-btn db-primary" data-act="go" disabled>开始编辑</button></div>
      </div>`;
    let k = null;
    let start = 'preset';
    const go = root.querySelector('[data-act="go"]');
    root.querySelector('[data-act="back"]').onclick = () => this.renderList();
    root.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => { k = b.dataset.k; root.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('active', x === b)); go.disabled = false; }; });
    root.querySelectorAll('[data-start]').forEach(b => { b.onclick = () => { start = b.dataset.start; root.querySelectorAll('[data-start]').forEach(x => x.classList.toggle('active', x === b)); }; });
    go.onclick = () => {
      const preset = getDeck(`preset_${k}_standard`);
      const deck = { id: null, name: `我的${KINGDOMS[k].army}`, mode: 'single', kingdom: k, cards: start === 'preset' ? { ...preset.cards } : {} };
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
            <div class="db-deck-top"><span class="db-seal seal-${deck.kingdom}">${KINGDOMS[deck.kingdom].name}</span><div class="db-deck-name">${escapeHtml(deck.name)}</div><span class="db-count ${v.ok ? 'ok' : 'bad'}">${v.total}/${DECK_SIZE}</span></div>
            ${v.errors.length ? `<div class="db-deck-warn">${v.errors.map(escapeHtml).join('<br>')}</div>` : ''}
            <div class="db-deck-actions"><button class="db-btn db-primary" data-act="save">保存到我的卡组</button><button class="db-btn" data-act="edit">打开编辑</button></div>
          </div>`;
        out.querySelector('[data-act="save"]').onclick = () => { const s = saveDeck(deck); this._toast(`已保存【${s.name}】`); this.onChange(); this.renderList(); };
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
    const chip = (group, val, label, cur) => `<button class="db-chip${cur === val ? ' active' : ''}" data-f="${group}" data-v="${val}">${label}</button>`;
    root.innerHTML = `
      <div class="db-shell db-editor deck-${k}" data-tab="pool">
        <header class="db-head">
          <button class="db-btn db-back" data-act="back">← 卡组</button>
          <span class="db-seal seal-${k}">${KINGDOMS[k].name}</span>
          <input class="db-name" maxlength="24" value="${escapeHtml(deck.name)}" aria-label="卡组名称">
          <div class="db-head-actions">
            <button class="db-btn" data-act="share">分享码</button>
            <button class="db-btn db-primary" data-act="save">保存</button>
          </div>
        </header>
        <div class="db-mobile-tabs">
          <button class="db-tab active" data-tab="pool">卡池</button>
          <button class="db-tab" data-tab="deck">卡组 <b class="db-tab-count">0/40</b></button>
        </div>
        <div class="db-body">
          <aside class="db-filters">
            <div class="db-fgroup"><span>类型</span>${chip('type', 'all', '全部', f.type)}${Object.entries(TYPE_LABEL).map(([v, l]) => chip('type', v, l, f.type)).join('')}</div>
            <div class="db-fgroup"><span>兵种</span>${chip('troop', 'all', '全部', f.troop)}${Object.entries(TROOP_LABEL).map(([v, l]) => chip('troop', v, l, f.troop)).join('')}</div>
            <div class="db-fgroup"><span>费用</span>${COST_BUCKETS.map(([v, l]) => chip('cost', v, l, f.cost)).join('')}</div>
            <div class="db-fgroup"><span>来源</span>${chip('src', 'all', '全部', f.src)}${chip('src', 'base', '实体卡', f.src)}${chip('src', 'extra', '旧图鉴', f.src)}</div>
            <input class="db-search" placeholder="搜索卡名 / 技能 / 词条" value="${escapeHtml(f.q)}">
          </aside>
          <section class="db-pool" aria-label="卡池"></section>
          <section class="db-deck" aria-label="当前卡组">
            <div class="db-summary"></div>
            <div class="db-rows"></div>
          </section>
        </div>
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
        this._renderPool();
      };
    });
    root.querySelector('.db-search').oninput = (e) => { this.filters.q = e.target.value.trim(); this._renderPool(); };
    root.querySelectorAll('.db-mobile-tabs .db-tab').forEach(b => {
      b.onclick = () => { this.tab = b.dataset.tab; shell.dataset.tab = this.tab; root.querySelectorAll('.db-mobile-tabs .db-tab').forEach(x => x.classList.toggle('active', x === b)); };
    });
    this._renderPool();
    this._renderDeck();
  }

  _matches(def) {
    const f = this.filters;
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
    const list = libraryFor(k).filter(d => this._matches(d));
    pool.replaceChildren();
    if (!list.length) { pool.innerHTML = '<p class="db-empty">没有符合筛选的卡牌</p>'; return; }
    for (const def of list) {
      const card = createCard(def, { faction: k.toUpperCase(), kingdom: k, instanceId: `lib_${def.id}` });
      const tile = h(`<div class="db-tile" data-id="${def.id}"><div class="db-tile-card"></div><span class="db-tile-badge"></span>${def.extra ? '<span class="db-tile-src">旧图鉴</span>' : ''}</div>`);
      const el = renderHandCard(card);
      tile.querySelector('.db-tile-card').appendChild(el);
      tile.addEventListener('click', (e) => {
        if (e.target.closest('.card-info-button')) return;
        this._add(def.id);
      });
      pool.appendChild(tile);
    }
    this._refreshBadges();
  }

  _refreshBadges() {
    this.root.querySelectorAll('.db-tile').forEach(t => {
      const id = t.dataset.id;
      const n = this.deck.cards[id] || 0;
      const lim = cardLimit(id);
      const badge = t.querySelector('.db-tile-badge');
      badge.textContent = `${n}/${lim}`;
      badge.classList.toggle('some', n > 0);
      t.classList.toggle('maxed', n >= lim);
    });
  }

  _add(id) {
    const n = this.deck.cards[id] || 0;
    if (n >= cardLimit(id)) { this._toast(`【${DB_CARD_MAP[id].name}】最多${cardLimit(id)}张`); return; }
    if (deckTotal(this.deck) >= DECK_SIZE) { this._toast(`卡组已满 ${DECK_SIZE} 张，先移除一些`); return; }
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
    summary.innerHTML = `
      <div class="db-sum-top"><span class="db-count big ${v.ok ? 'ok' : 'bad'}">${v.total}/${DECK_SIZE}</span>
        <span class="db-sum-types">单位 ${byType.UNIT}<br>战法 ${byType.TACTIC}<br>反制 ${byType.COUNTER}</span>${curveSvg(curve, 120, 30)}</div>`;
    const rows = this.root.querySelector('.db-rows');
    const entries = Object.entries(deck.cards).map(([id, n]) => [DB_CARD_MAP[id], n]).filter(([d]) => d)
      .sort(([a], [b]) => (a.cost - b.cost) || a.name.localeCompare(b.name, 'zh'));
    rows.innerHTML = entries.length ? entries.map(([d, n]) => `
      <div class="db-row-card type-${d.type.toLowerCase()}${d.id === flashId ? ' flash' : ''}" data-id="${d.id}">
        <span class="db-rc-cost">${d.cost}</span>
        <button class="db-rc-name" data-act="info">${escapeHtml(d.name)}<small>${d.type === 'UNIT' ? TROOP_LABEL[d.troopType] || '' : TYPE_LABEL[d.type]}</small></button>
        <span class="db-rc-n">×${n}</span>
        <button class="db-rc-btn" data-act="minus" aria-label="减少">−</button>
        <button class="db-rc-btn" data-act="plus" aria-label="增加"${n >= cardLimit(d.id) ? ' disabled' : ''}>＋</button>
      </div>`).join('') : '<p class="db-empty">从卡池点卡牌加入</p>';
    rows.querySelectorAll('.db-row-card').forEach(r => {
      const id = r.dataset.id;
      r.querySelector('[data-act="minus"]').onclick = () => this._remove(id);
      r.querySelector('[data-act="plus"]').onclick = () => this._add(id);
      r.querySelector('[data-act="info"]').onclick = () => showCardDetails(createCard(DB_CARD_MAP[id], { faction: deck.kingdom.toUpperCase(), kingdom: deck.kingdom }));
    });
    const bar = this.root.querySelector('.db-statusbar');
    const msg = v.errors[0] || v.warnings[0] || '卡组完整，可以保存并用于开局';
    bar.innerHTML = `<span class="db-count ${v.ok ? 'ok' : 'bad'}">${v.total}/${DECK_SIZE}</span><span class="db-status-msg ${v.ok ? (v.warnings.length ? 'warn' : 'ok') : 'bad'}">${escapeHtml(msg)}</span><button class="db-btn db-primary" data-act="save2">保存</button>`;
    bar.querySelector('[data-act="save2"]').onclick = () => this._save();
    const tc = this.root.querySelector('.db-tab-count');
    if (tc) tc.textContent = `${v.total}/${DECK_SIZE}`;
  }

  _save() {
    const v = validateDeck(this.deck);
    const saved = saveDeck(this.deck);
    this.deck = { ...saved, cards: { ...saved.cards } };
    this.dirty = false;
    this._toast(v.ok ? `已保存【${saved.name}】` : `已保存为未完成卡组（${v.total}/${DECK_SIZE}），补齐后才能用于开局`);
    this.onChange();
  }
}
