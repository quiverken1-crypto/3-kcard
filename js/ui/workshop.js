/**
 * workshop.js — 自定义工坊 v2：卡牌 / 势力 / 导入导出
 *  - 卡牌：完整参数、词条（内置 + 自定义词条及释义）、性格、技能名与描述；
 *          技能实现方式二选一：积木效果（保存即生效）或文字描述（标“待实现”，交给开发者写进游戏）。
 *  - 势力：新建势力（简称、军名、颜色、1–2 座主城及地形）。
 *  - 导入导出：勾选多项 → 下载文件 / 生成卡包码；导入文件或卡包码（冲突可选另存副本、覆盖、跳过）。
 */
import { KINGDOMS, BUILTIN_KINGDOMS } from '../data/cardDB.js';
import {
  customPack, upsertCard, deleteCard, upsertFaction, deleteFaction, pickSubset, mergePack, encodePack, decodePack,
  downloadPack, newCustomId, normalizePack, TROOP_OPTIONS, TERRAIN_OPTIONS
} from '../data/customContent.js';
import { TRIGGER_CATALOG, EFFECT_CATALOG, TARGET_CATALOG, FILTER_CATALOG, CONDITION_CATALOG, PLAYER_EFFECTS, DECK_EFFECTS, KEYWORD_EFFECTS, AURA_EFFECTS, ACTIVE_COST_CATALOG, ACTIVE_LIMIT_CATALOG } from '../engine/abilities.js';
import { renderHandCard, escapeHtml, builtinKeywords } from './cardRenderer.js';
import { createCard } from '../engine/state.js';

const TROOP_LABEL = { INFANTRY: '步兵', CAVALRY: '骑兵', NAVY: '水军', STRATEGIST: '谋士', ARCHER: '器械' };
const TYPE_LABEL = { UNIT: '单位', TACTIC: '战法', COUNTER: '反制' };
const TERRAIN_LABEL = { PLAIN: '平原', WATER: '水域', FOREST: '林地', MOUNTAIN: '山地', PASS: '险关' };
const TRIGGER_LABEL = Object.fromEntries(TRIGGER_CATALOG.map(t => [t.id, t.label]));
const EFFECT_LABEL = Object.fromEntries(EFFECT_CATALOG.map(t => [t.id, t.label]));
const TARGET_LABEL = Object.fromEntries(TARGET_CATALOG.map(t => [t.id, t.label]));
const AURA_TARGETS = ['SELF', 'ALL_FRIENDLIES', 'OTHER_FRIENDLIES', 'ALL_ENEMIES'];
/** 按分组输出 <optgroup> */
const grouped = (catalog, cur, keep = () => true) => {
  const groups = [];
  for (const it of catalog) {
    if (!keep(it)) continue;
    let g = groups.find(x => x.name === it.group);
    if (!g) groups.push(g = { name: it.group, items: [] });
    g.items.push(it);
  }
  return groups.map(g => `<optgroup label="${g.name}">${g.items.map(it => `<option value="${it.id}"${it.id === cur ? ' selected' : ''}>${escapeHtml(it.label)}</option>`).join('')}</optgroup>`).join('');
};
const pairOpts = (pairs, cur) => pairs.map(([v, l]) => `<option value="${v}"${v === (cur || '') ? ' selected' : ''}>${l}</option>`).join('');
/** 积木 → 一句中文说明（可一键填入技能描述） */
export function describeAbility(ab) {
  const t = TRIGGER_LABEL[ab.trigger] || '';
  const cond = (ab.conditions || []).map(c => `若${CONDITION_CATALOG.find(x => x.id === c.field)?.label || c.field}${c.op === 'GTE' ? '≥' : c.op === 'LTE' ? '≤' : '='}${c.value}，`).join('');
  const parts = (ab.effects || []).map(ef => {
    const f = ef.filter || {};
    const fl = [f.line && (f.line === 'FRONTLINE' ? '前线' : '支援阵线'), f.badge && `${f.badge}`, f.keyword && `有【${f.keyword}】的`, f.troop && FILTER_CATALOG.troop.find(([v]) => v === f.troop)?.[1], f.cardType && FILTER_CATALOG.cardType.find(([v]) => v === f.cardType)?.[1]].filter(Boolean).join('');
    const who = DECK_EFFECTS.has(ef.type) ? '' : (TARGET_LABEL[ef.target] || '').replace('所有友军', `所有${fl || ''}友军`).replace('所有敌军', `所有${fl || ''}敌军`);
    const who2 = who.replace('玩家选择1个', '你选择的1个').replace('随机1个', '随机1个').replace('（不含自身）', '');
    const whoF = /所有/.test(who2) || !fl ? who2 : `${who2}（${fl}）`;
    const amt = ef.amount ?? 1;
    const name = (EFFECT_LABEL[ef.type] || ef.type).replace(/（.*）/, '');
    switch (ef.type) {
      case 'DRAW': return `${whoF}抽${amt}张牌`;
      case 'SEARCH_DECK': return `从牌库检索${amt}张${fl || ''}牌`;
      case 'GRANT_KEYWORD': case 'TURN_KEYWORD': return `${whoF}${ef.type === 'TURN_KEYWORD' ? '本回合' : ''}获得【${ef.keyword}】`;
      case 'REMOVE_KEYWORD': return `${whoF}失去【${ef.keyword}】`;
      case 'APPLY_SUPPRESSION': return `压制${whoF}`;
      case 'APPLY_INHIBITION': return `抑制${whoF}`;
      case 'DESTROY': return `消灭${whoF}`;
      case 'RETREAT': return `使${whoF}撤退`;
      case 'RETURN_HAND': return `将${whoF}返回手牌`;
      case 'RESTORE_ACTION': return `${whoF}恢复行动`;
      case 'REVEAL_UNIT': return `翻开${whoF}`;
      case 'TURN_ATTACK': return `${whoF}本回合战力+${amt}`;
      case 'DAMAGE_UNIT': return `对${whoF}造成${amt}点伤害`;
      case 'HEAL_UNIT': return `${whoF}恢复${amt}点生命`;
      case 'DAMAGE_HQ': return `对${whoF}主城造成${amt}点伤害`;
      case 'HEAL_HQ': return `${whoF}主城恢复${amt}点`;
      default: return `${whoF}${name}${amt}`;
    }
  });
  if (ab.trigger === 'ACTIVE') {
    const c = ab.cost || {};
    const pay = { NONE: '', PROVISIONS: `消耗${c.amount}粮草`, DISCARD: '弃置1张手牌', SELF_DAMAGE: `自身受到${c.amount}点伤害`, HQ_HP: `己方主城失去${c.amount}点生命`, PRESTIGE: `消耗${c.amount}点声望`, ACTION: '消耗本单位行动' }[c.type] || '';
    const judge = (ab.chance ?? 100) < 100 ? `进行判定（${ab.chance}%成功），成功则` : '';
    return `主动（${ab.limit === 'GAME' ? '每局1次' : '每回合1次'}）：${pay ? `${pay}，` : ''}${cond}${judge}${parts.join('，')}。`;
  }
  return `${ab.trigger === 'AURA' ? '在场时：' : `${t}，`}${cond}${parts.join('，')}。`;
}
const COMMON_BADGES = ['鲁莽', '狂傲', '名士', '二心', '皇亲', '暴虐'];

const doc = () => globalThis.document;
const h = html => { const t = doc().createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const opts = (list, labels, cur) => list.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${escapeHtml(labels?.[v] || v)}</option>`).join('');
const kLabel = k => KINGDOMS[k]?.army || k;
/** 本机可编辑的势力：内置 + 本机自定义（不含联机对手临时带来的） */
const ownKingdoms = () => [...BUILTIN_KINGDOMS, ...customPack().factions.map(f => f.key)].filter(k => KINGDOMS[k]);

export class Workshop {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.tab = 'cards';
    this.cardFilter = 'all';
  }

  _root() {
    if (this.root?.isConnected) return this.root;
    this.root = h('<div id="workshop" class="deck-builder workshop hidden" role="dialog" aria-modal="true" aria-label="自定义工坊"></div>');
    doc().body.appendChild(this.root);
    return this.root;
  }

  open(tab = 'cards') {
    this.tab = tab;
    this._root().classList.remove('hidden');
    doc().body.classList.add('deck-builder-open');
    this.render();
  }

  close() {
    if (this.dirty && globalThis.confirm && !globalThis.confirm('有未保存的修改，确定离开吗？')) return;
    this.dirty = false;
    this.root?.classList.add('hidden');
    doc().body.classList.remove('deck-builder-open');
    this.onChange();
  }

  _toast(msg, bad = false) {
    const t = h(`<div class="db-toast${bad ? ' bad' : ''}">${escapeHtml(msg)}</div>`);
    this.root.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, bad ? 3600 : 2200);
  }

  render() {
    const root = this._root();
    root.innerHTML = `
      <div class="db-shell">
        <header class="db-head">
          <button class="db-btn db-back" data-act="close">← 返回</button>
          <h2 class="db-title">自定义工坊</h2>
          <div class="db-mode-tabs ws-tabs">
            <button class="db-tab${this.tab === 'cards' ? ' active' : ''}" data-tab="cards">卡牌</button>
            <button class="db-tab${this.tab === 'factions' ? ' active' : ''}" data-tab="factions">势力</button>
            <button class="db-tab${this.tab === 'io' ? ' active' : ''}" data-tab="io">导入 · 导出</button>
          </div>
        </header>
        <div class="ws-body"></div>
      </div>`;
    root.querySelector('[data-act="close"]').onclick = () => this.close();
    root.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { if (this.dirty && globalThis.confirm && !globalThis.confirm('有未保存的修改，确定切换吗？')) return; this.dirty = false; this.tab = b.dataset.tab; this.render(); }; });
    const body = root.querySelector('.ws-body');
    if (this.tab === 'cards') this._renderCards(body);
    else if (this.tab === 'factions') this._renderFactions(body);
    else this._renderIO(body);
  }

  // ------------------------------------------------------------
  // 卡牌
  // ------------------------------------------------------------
  _renderCards(body, editId = null) {
    const pack = customPack();
    const kf = this.cardFilter;
    const cards = pack.cards.filter(c => kf === 'all' || c.kingdom === kf).sort((a, b) => a.kingdom.localeCompare(b.kingdom) || a.cost - b.cost);
    body.innerHTML = `
      <div class="ws-split">
        <aside class="ws-list">
          <button class="db-btn db-primary" data-act="new">＋ 新建卡牌</button>
          <div class="db-chips">${[['all', '全部'], ...ownKingdoms().map(k => [k, KINGDOMS[k].name])].map(([k, l]) => `<button class="db-chip${kf === k ? ' active' : ''}" data-kf="${k}">${l}</button>`).join('')}</div>
          <div class="ws-items">${cards.map(c => `
            <button class="ws-item${c.id === editId ? ' active' : ''}" data-id="${c.id}">
              <span class="db-seal seal-${c.kingdom}">${escapeHtml(KINGDOMS[c.kingdom]?.name || '?')}</span>
              <span class="ws-item-name">${escapeHtml(c.name)}<small>${c.cost}费 · ${c.type === 'UNIT' ? `${TROOP_LABEL[c.troopType]} ${c.atk}/${c.hp}` : TYPE_LABEL[c.type]} · ×${c.copies}</small></span>
              ${c.pending ? '<span class="ws-tag pending">待实现</span>' : (c.abilities?.length ? '<span class="ws-tag">积木</span>' : '')}
            </button>`).join('') || '<p class="db-empty">还没有自定义卡牌</p>'}</div>
        </aside>
        <section class="ws-editor"></section>
      </div>`;
    body.querySelector('[data-act="new"]').onclick = () => this._editCard(body, null);
    body.querySelectorAll('[data-kf]').forEach(b => { b.onclick = () => { this.cardFilter = b.dataset.kf; this._renderCards(body); }; });
    body.querySelectorAll('.ws-item').forEach(b => { b.onclick = () => this._renderCards(body, b.dataset.id); });
    const target = editId ? pack.cards.find(c => c.id === editId) : null;
    if (target || editId === null) this._editCard(body, target);
  }

  _blankCard() {
    const k = this.cardFilter !== 'all' ? this.cardFilter : 'wei';
    return { id: newCustomId('c'), name: '新卡牌', kingdom: k, type: 'UNIT', troopType: 'INFANTRY', cost: 3, actionCost: 1, atk: 3, hp: 3, copies: 1, keywords: [], badges: [], customKeywords: [], skill: { name: '', description: '' }, abilities: [], pending: false };
  }

  _editCard(body, card) {
    const isNew = !card;
    const c = structuredClone(card || this._blankCard());
    const pane = body.querySelector('.ws-editor');
    const kws = builtinKeywords();
    pane.innerHTML = `
      <div class="ws-form-wrap">
        <form class="ws-form" autocomplete="off">
          <div class="ws-grid">
            <label>名称<input name="name" maxlength="12" value="${escapeHtml(c.name)}"></label>
            <label>势力<select name="kingdom">${opts(ownKingdoms(), Object.fromEntries(ownKingdoms().map(k => [k, kLabel(k)])), c.kingdom)}</select></label>
            <label>类型<select name="type">${opts(['UNIT', 'TACTIC', 'COUNTER'], TYPE_LABEL, c.type)}</select></label>
            <label class="unit-only">兵种<select name="troopType">${opts(TROOP_OPTIONS, TROOP_LABEL, c.troopType === 'NONE' ? 'INFANTRY' : c.troopType)}</select></label>
            <label>部署费用<input name="cost" type="number" min="0" max="12" value="${c.cost}"></label>
            <label class="unit-only">行动费用<input name="actionCost" type="number" min="0" max="6" value="${c.actionCost}"></label>
            <label class="unit-only">战力<input name="atk" type="number" min="0" max="20" value="${c.atk}"></label>
            <label class="unit-only">生命<input name="hp" type="number" min="1" max="30" value="${Math.max(1, c.hp || 1)}"></label>
            <label>张数上限<select name="copies">${opts(['1', '2', '3'], null, String(c.copies))}</select></label>
          </div>
          <label class="ws-wide">词条（逗号分隔，带数值的写成“坚阵1”）<input name="keywords" value="${escapeHtml(c.keywords.join('，'))}"></label>
          <div class="db-chips ws-kw-chips">${kws.map(k => `<button type="button" class="db-chip" data-kw="${k}">${k}</button>`).join('')}</div>
          <label class="ws-wide">性格（逗号分隔）<input name="badges" value="${escapeHtml(c.badges.join('，'))}"></label>
          <div class="db-chips">${COMMON_BADGES.map(b => `<button type="button" class="db-chip" data-badge="${b}">${b}</button>`).join('')}</div>
          <div class="ws-sub"><span>自定义词条（新词条需写释义）</span><button type="button" class="db-btn" data-act="add-ckw">＋ 添加</button></div>
          <div class="ws-ckw"></div>
          <div class="ws-grid">
            <label>技能名<input name="skillName" maxlength="12" value="${escapeHtml(c.skill?.name || '')}"></label>
          </div>
          <label class="ws-wide">技能描述（卡面文字）<textarea name="skillDesc" rows="3" maxlength="300">${escapeHtml(c.skill?.description || '')}</textarea></label>
          <div class="ws-impl">
            <span>技能实现方式：</span>
            <label><input type="radio" name="impl" value="blocks"${!c.pending ? ' checked' : ''}> 积木效果（保存后立即在对局生效）</label>
            <label><input type="radio" name="impl" value="pending"${c.pending ? ' checked' : ''}> 文字描述，交给开发者实现（标“待实现”，对局中暂无效果）</label>
          </div>
          <div class="ws-blocks">
            <div class="ws-sub"><span>积木效果（时机 → 效果 → 目标 → 数值；可加筛选与条件）<br><small class="db-hint">主动技 = 消耗 → 判定 → 获得；同一张卡的多条主动技会合并成一个技能，消耗和判定以第一条为准。</small></span><span><button type="button" class="db-btn" data-act="fill-desc">用积木生成描述</button> <button type="button" class="db-btn" data-act="add-ab">＋ 添加效果</button></span></div>
            <div class="ws-abs"></div>
          </div>
          <div class="ws-err"></div>
          <div class="db-row ws-actions">
            <button type="submit" class="db-btn db-primary">保存卡牌</button>
            ${isNew ? '' : '<button type="button" class="db-btn" data-act="dup">复制为新卡</button><button type="button" class="db-btn db-danger" data-act="del">删除</button>'}
          </div>
        </form>
        <div class="ws-preview"><div class="ws-preview-card"></div><p class="db-hint">卡面预览（暂不支持自定义卡面图片）</p></div>
      </div>`;
    const form = pane.querySelector('form');
    const ckwBox = pane.querySelector('.ws-ckw');
    const absBox = pane.querySelector('.ws-abs');
    const addCkw = (k = { name: '', description: '' }) => {
      const row = h(`<div class="ws-row"><input class="ckw-name" maxlength="8" placeholder="词条名" value="${escapeHtml(k.name)}"><input class="ckw-desc" maxlength="120" placeholder="释义：这个词条做什么" value="${escapeHtml(k.description)}"><button type="button" class="db-rc-btn" aria-label="删除">×</button></div>`);
      row.querySelector('button').onclick = () => { row.remove(); sync(); };
      ckwBox.appendChild(row);
    };
    const addAb = (ab = { trigger: 'ON_DEPLOY', effects: [{ type: 'DRAW', target: 'OWNER', amount: 1 }] }) => {
      const ef = ab.effects?.[0] || { type: 'DRAW', target: 'OWNER', amount: 1 };
      const f = ef.filter || {};
      const cd = ab.conditions?.[0] || {};
      const row = h(`<div class="ws-ab">
        <div class="ws-row">
          <select class="ab-trigger" title="时机">${grouped(TRIGGER_CATALOG, ab.trigger)}</select>
          <select class="ab-effect" title="效果">${grouped(EFFECT_CATALOG, ef.type)}</select>
          <select class="ab-target" title="目标">${grouped(TARGET_CATALOG, ef.target)}</select>
          <input class="ab-amount" type="number" min="0" max="20" value="${ef.amount ?? 1}" title="数值">
          <input class="ab-keyword" maxlength="8" placeholder="词条" value="${escapeHtml(ef.keyword || '')}">
          <button type="button" class="db-rc-btn" aria-label="删除">×</button>
        </div>
        <div class="ws-row ws-ab-more">
          <span class="ws-ab-lbl">筛选</span>
          <select class="ab-f-troop">${pairOpts(FILTER_CATALOG.troop, f.troop)}</select>
          <select class="ab-f-line">${pairOpts(FILTER_CATALOG.line, f.line)}</select>
          <select class="ab-f-type">${pairOpts(FILTER_CATALOG.cardType, f.cardType)}</select>
          <input class="ab-f-badge" maxlength="6" placeholder="性格" value="${escapeHtml(f.badge || '')}">
          <input class="ab-f-kw" maxlength="8" placeholder="有词条" value="${escapeHtml(f.keyword || '')}">
          <span class="ws-ab-lbl">条件</span>
          <select class="ab-c-field"><option value="">无</option>${CONDITION_CATALOG.map(c => `<option value="${c.id}"${c.id === cd.field ? ' selected' : ''}>${c.label}</option>`).join('')}</select>
          <select class="ab-c-op">${pairOpts([['GTE', '≥'], ['LTE', '≤'], ['EQ', '=']], cd.op || 'GTE')}</select>
          <input class="ab-c-val" type="number" min="0" max="100" value="${cd.value ?? 1}">
        </div>
        <div class="ws-row ws-ab-more ws-ab-active">
          <span class="ws-ab-lbl">消耗</span>
          <select class="ab-cost">${pairOpts(ACTIVE_COST_CATALOG, ab.cost?.type || 'NONE')}</select>
          <input class="ab-cost-n" type="number" min="0" max="20" value="${ab.cost?.amount ?? 1}" title="消耗数值">
          <span class="ws-ab-lbl">判定成功率%</span>
          <input class="ab-chance" type="number" min="1" max="100" value="${ab.chance ?? 100}">
          <select class="ab-limit">${pairOpts(ACTIVE_LIMIT_CATALOG, ab.limit || 'TURN')}</select>
        </div>
        <div class="ws-ab-desc"></div>
      </div>`);
      const fix = () => {
        const trig = row.querySelector('.ab-trigger').value;
        const effSel = row.querySelector('.ab-effect');
        // 光环只支持战力±、行动花费±
        [...effSel.querySelectorAll('option')].forEach(o => { o.hidden = trig === 'AURA' && !AURA_EFFECTS.has(o.value); });
        if (effSel.selectedOptions[0]?.hidden) effSel.value = 'BUFF_ATTACK';
        const eff = effSel.value;
        const player = PLAYER_EFFECTS.has(eff), deck = DECK_EFFECTS.has(eff);
        const sel = row.querySelector('.ab-target');
        [...sel.querySelectorAll('option')].forEach(o => {
          const isPlayer = ['OWNER', 'OPPONENT'].includes(o.value);
          o.hidden = deck ? o.value !== 'OWNER' : trig === 'AURA' ? !AURA_TARGETS.includes(o.value) : player !== isPlayer;
        });
        if (sel.selectedOptions[0]?.hidden) sel.value = deck || player ? 'OWNER' : trig === 'AURA' ? 'ALL_FRIENDLIES' : 'SELF';
        sel.style.display = deck ? 'none' : '';
        row.querySelector('.ab-keyword').style.display = KEYWORD_EFFECTS.has(eff) ? '' : 'none';
        const unitish = !player && !deck;
        row.querySelector('.ab-f-troop').style.display = unitish || deck ? '' : 'none';
        row.querySelector('.ab-f-line').style.display = unitish ? '' : 'none';
        row.querySelector('.ab-f-type').style.display = deck ? '' : 'none';
        row.querySelector('.ab-f-badge').style.display = unitish ? '' : 'none';
        row.querySelector('.ab-f-kw').style.display = unitish ? '' : 'none';
        const isActive = trig === 'ACTIVE';
        row.querySelector('.ws-ab-active').style.display = isActive ? '' : 'none';
        row.querySelector('.ab-cost-n').style.display = ['NONE', 'DISCARD', 'ACTION'].includes(row.querySelector('.ab-cost').value) ? 'none' : '';
        const noCond = !row.querySelector('.ab-c-field').value;
        row.querySelector('.ab-c-op').style.display = noCond ? 'none' : '';
        row.querySelector('.ab-c-val').style.display = noCond ? 'none' : '';
      };
      row.addEventListener('change', () => { fix(); sync(); });
      row.querySelector('button').onclick = () => { row.remove(); sync(); };
      fix();
      absBox.appendChild(row);
    };
    for (const k of c.customKeywords || []) addCkw(k);
    for (const ab of c.abilities || []) for (const ef of ab.effects) addAb({ ...ab, effects: [ef] });
    const splitList = v => String(v || '').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
    const read = () => {
      const f = form.elements;
      const type = f.type.value;
      return {
        ...c,
        name: f.name.value.trim(), kingdom: f.kingdom.value, type,
        troopType: type === 'UNIT' ? f.troopType.value : 'NONE',
        cost: Number(f.cost.value), actionCost: type === 'UNIT' ? Number(f.actionCost.value) : 0,
        atk: type === 'UNIT' ? Number(f.atk.value) : 0, hp: type === 'UNIT' ? Number(f.hp.value) : 0,
        copies: Number(f.copies.value),
        keywords: splitList(f.keywords.value), badges: splitList(f.badges.value),
        customKeywords: [...ckwBox.querySelectorAll('.ws-row')].map(r => ({ name: r.querySelector('.ckw-name').value.trim(), description: r.querySelector('.ckw-desc').value.trim() })).filter(k => k.name),
        skill: { name: f.skillName.value.trim(), description: f.skillDesc.value.trim() },
        pending: f.impl.value === 'pending',
        abilities: f.impl.value === 'pending' ? [] : [...absBox.querySelectorAll('.ws-ab')].map(r => readAb(r))
      };
    };
    const readAb = r => {
      const q = sel => r.querySelector(sel);
      const effect = { type: q('.ab-effect').value, target: q('.ab-target').value, amount: Number(q('.ab-amount').value || 0) };
      if (KEYWORD_EFFECTS.has(effect.type)) effect.keyword = q('.ab-keyword').value.trim();
      const vis = el => el.style.display !== 'none';
      const filter = {};
      if (vis(q('.ab-f-troop')) && q('.ab-f-troop').value) filter.troop = q('.ab-f-troop').value;
      if (vis(q('.ab-f-line')) && q('.ab-f-line').value) filter.line = q('.ab-f-line').value;
      if (vis(q('.ab-f-type')) && q('.ab-f-type').value) filter.cardType = q('.ab-f-type').value;
      if (vis(q('.ab-f-badge')) && q('.ab-f-badge').value.trim()) filter.badge = q('.ab-f-badge').value.trim();
      if (vis(q('.ab-f-kw')) && q('.ab-f-kw').value.trim()) filter.keyword = q('.ab-f-kw').value.trim();
      if (Object.keys(filter).length) effect.filter = filter;
      const field = q('.ab-c-field').value;
      const conditions = field ? [{ field, op: q('.ab-c-op').value, value: Number(q('.ab-c-val').value || 0) }] : [];
      const trigger = q('.ab-trigger').value;
      if (trigger === 'ACTIVE') return { trigger, conditions, effects: [effect], cost: { type: q('.ab-cost').value, amount: Number(q('.ab-cost-n').value || 0) }, chance: Number(q('.ab-chance').value || 100), limit: q('.ab-limit').value };
      return { trigger, conditions, effects: [effect] };
    };
    const errBox = pane.querySelector('.ws-err');
    const sync = () => {
      this.dirty = true;
      const cur = read();
      form.classList.toggle('not-unit', cur.type !== 'UNIT');
      pane.querySelector('.ws-blocks').style.display = cur.pending ? 'none' : '';
      absBox.querySelectorAll('.ws-ab').forEach((r, i) => { const d = r.querySelector('.ws-ab-desc'); if (d && cur.abilities[i]) d.textContent = describeAbility(cur.abilities[i]); });
      // 自动补全：自定义词条名加入词条列表
      let checked;
      try {
        checked = normalizePack({ schemaVersion: 2, factions: customPack().factions, cards: [cur] }).cards[0];
        errBox.textContent = '';
      } catch (err) { errBox.textContent = err.message; checked = null; }
      const box = pane.querySelector('.ws-preview-card');
      box.replaceChildren();
      const def = checked || cur;
      const el = renderHandCard(createCard({ ...def, cardId: def.id }, { faction: 'WEI', kingdom: def.kingdom, instanceId: `ws_${def.id}` }));
      if (el) box.appendChild(el);
      return checked;
    };
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    pane.querySelectorAll('[data-kw]').forEach(b => { b.onclick = () => { const i = form.elements.keywords; const list = splitList(i.value); if (!list.some(x => x.replace(/\d+$/, '') === b.dataset.kw)) list.push(['坚阵', '声望', '奇谋', '侦查'].includes(b.dataset.kw) ? `${b.dataset.kw}1` : b.dataset.kw); i.value = list.join('，'); sync(); }; });
    pane.querySelectorAll('[data-badge]').forEach(b => { b.onclick = () => { const i = form.elements.badges; const list = splitList(i.value); if (!list.includes(b.dataset.badge)) list.push(b.dataset.badge); i.value = list.join('，'); sync(); }; });
    pane.querySelector('[data-act="add-ckw"]').onclick = () => { addCkw(); sync(); };
    pane.querySelector('[data-act="add-ab"]').onclick = () => { addAb(); sync(); };
    pane.querySelector('[data-act="fill-desc"]').onclick = () => {
      const abs = [...absBox.querySelectorAll('.ws-ab')].map(r => readAb(r));
      if (!abs.length) { this._toast('先添加积木效果', true); return; }
      form.elements.skillDesc.value = abs.map(describeAbility).join('');
      sync();
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const checked = sync();
      if (!checked) { this._toast(errBox.textContent || '请检查填写内容', true); return; }
      // 自定义词条自动加入该卡词条
      const names = checked.customKeywords.map(k => k.name);
      const card = { ...checked, keywords: [...new Set([...checked.keywords, ...names])] };
      if (!card.pending && !card.abilities.length && card.skill.description && !(card.keywords.length && !card.skill.name)) {
        if (globalThis.confirm && !globalThis.confirm('这张卡写了技能描述，但没有积木效果，对局中技能不会生效。\n要改为“文字描述，交给开发者实现”吗？\n（确定 = 标为待实现；取消 = 按原样保存）')) { /* keep */ } else card.pending = true;
      }
      try { upsertCard(card); } catch (err) { this._toast(err.message, true); return; }
      this.dirty = false;
      this._toast(`已保存【${card.name}】${card.pending ? '（待实现，记得导出发给开发者）' : ''}`);
      this.onChange();
      this._renderCards(body, card.id);
    };
    pane.querySelector('[data-act="del"]')?.addEventListener('click', () => {
      if (globalThis.confirm && !globalThis.confirm(`删除【${c.name}】？用到它的卡组会变为未完成。`)) return;
      deleteCard(c.id); this.dirty = false; this.onChange(); this._renderCards(body);
    });
    pane.querySelector('[data-act="dup"]')?.addEventListener('click', () => {
      const copy = { ...read(), id: newCustomId('c'), name: `${form.elements.name.value.trim()}·副本`.slice(0, 12) };
      this._editCard(body, null);
      this._editCard(body, copy);
      this.dirty = true;
    });
    sync();
    this.dirty = false;
  }

  // ------------------------------------------------------------
  // 势力
  // ------------------------------------------------------------
  _renderFactions(body, editKey = null) {
    const list = customPack().factions;
    body.innerHTML = `
      <div class="ws-split">
        <aside class="ws-list">
          <button class="db-btn db-primary" data-act="new">＋ 新建势力</button>
          <p class="db-hint">内置：${BUILTIN_KINGDOMS.map(k => KINGDOMS[k].army).join('、')}（可直接给它们加新卡）</p>
          <div class="ws-items">${list.map(f => `<button class="ws-item${f.key === editKey ? ' active' : ''}" data-key="${f.key}"><span class="db-seal" style="background:${f.color}">${escapeHtml(f.name)}</span><span class="ws-item-name">${escapeHtml(f.army)}<small>${f.hqs.map(hq => escapeHtml(hq.name)).join('、')}</small></span></button>`).join('') || '<p class="db-empty">还没有自定义势力</p>'}</div>
        </aside>
        <section class="ws-editor"></section>
      </div>`;
    body.querySelector('[data-act="new"]').onclick = () => this._editFaction(body, null);
    body.querySelectorAll('[data-key]').forEach(b => { b.onclick = () => this._renderFactions(body, b.dataset.key); });
    this._editFaction(body, list.find(f => f.key === editKey) || null);
  }

  _editFaction(body, f) {
    const isNew = !f;
    const x = f ? structuredClone(f) : { key: newCustomId('f'), name: '', army: '', color: '#5b6b8a', hqs: [{ id: '', name: '', terrains: ['PLAIN', 'PLAIN'] }, { id: '', name: '', terrains: ['PLAIN', 'WATER'] }] };
    while (x.hqs.length < 2) x.hqs.push({ id: '', name: '', terrains: ['PLAIN', 'PLAIN'] });
    const pane = body.querySelector('.ws-editor');
    const tsel = (v, cls) => `<select class="${cls}">${opts(TERRAIN_OPTIONS, TERRAIN_LABEL, v)}</select>`;
    pane.innerHTML = `
      <form class="ws-form ws-narrow" autocomplete="off">
        <div class="ws-grid">
          <label>简称（1–2字）<input name="name" maxlength="2" value="${escapeHtml(x.name)}" placeholder="晋"></label>
          <label>军名<input name="army" maxlength="8" value="${escapeHtml(x.army)}" placeholder="晋军"></label>
          <label>颜色<input name="color" type="color" value="${x.color}"></label>
        </div>
        <p class="db-hint">主城（至少1座；各带2张地形，开局与对手主城的地形洗混后随机3张做前线）：</p>
        ${x.hqs.map((hq, i) => `<div class="ws-row ws-hq" data-i="${i}"><input class="hq-name" maxlength="6" placeholder="主城${i + 1}名称${i ? '（可空）' : ''}" value="${escapeHtml(hq.name)}">${tsel(hq.terrains[0], 't0')}${tsel(hq.terrains[1], 't1')}</div>`).join('')}
        <p class="db-hint">新势力没有标准卡组：先在“卡牌”里给它做卡，再去“卡组”组 40 张；也可以在双阵营里做副阵营（20 张）。</p>
        <div class="ws-err"></div>
        <div class="db-row"><button type="submit" class="db-btn db-primary">保存势力</button>${isNew ? '' : '<button type="button" class="db-btn db-danger" data-act="del">删除势力</button>'}</div>
      </form>`;
    const form = pane.querySelector('form');
    form.oninput = () => { this.dirty = true; };
    form.onsubmit = (e) => {
      e.preventDefault();
      const el = form.elements;
      const hqs = [...pane.querySelectorAll('.ws-hq')].map((r, i) => ({ id: `${x.key}_hq${i + 1}`, name: r.querySelector('.hq-name').value.trim(), terrains: [r.querySelector('.t0').value, r.querySelector('.t1').value] })).filter(hq => hq.name);
      const fac = { key: x.key, name: el.name.value.trim(), army: el.army.value.trim() || `${el.name.value.trim()}军`, color: el.color.value, hqs };
      try { upsertFaction(fac); } catch (err) { pane.querySelector('.ws-err').textContent = err.message; return; }
      this.dirty = false;
      this._toast(`已保存势力【${fac.army}】`);
      this.onChange();
      this._renderFactions(body, fac.key);
    };
    pane.querySelector('[data-act="del"]')?.addEventListener('click', () => {
      try { deleteFaction(x.key); this.onChange(); this._renderFactions(body); } catch (err) { this._toast(err.message, true); }
    });
  }

  // ------------------------------------------------------------
  // 导入 / 导出
  // ------------------------------------------------------------
  _renderIO(body) {
    const pack = customPack();
    body.innerHTML = `
      <div class="ws-io">
        <section class="ws-card">
          <h3>导出（可多选）</h3>
          <div class="db-row">
            <button type="button" class="db-btn" data-sel="all">全选</button>
            <button type="button" class="db-btn" data-sel="pending">只选待实现</button>
            <button type="button" class="db-btn" data-sel="none">清空</button>
          </div>
          <div class="ws-checklist">
            ${pack.factions.length ? `<div class="ws-group">势力</div>${pack.factions.map(f => `<label class="ws-check"><input type="checkbox" data-f="${f.key}"> <span class="db-seal" style="background:${f.color}">${escapeHtml(f.name)}</span> ${escapeHtml(f.army)}</label>`).join('')}` : ''}
            <div class="ws-group">卡牌</div>
            ${pack.cards.map(c => `<label class="ws-check"><input type="checkbox" data-c="${c.id}"${c.pending ? ' data-pending="1"' : ''}> <span class="db-seal seal-${c.kingdom}">${escapeHtml(KINGDOMS[c.kingdom]?.name || '?')}</span> ${escapeHtml(c.name)} ${c.pending ? '<span class="ws-tag pending">待实现</span>' : ''}</label>`).join('') || '<p class="db-empty">还没有自定义卡牌</p>'}
          </div>
          <div class="db-row">
            <button type="button" class="db-btn db-primary" data-act="download">下载文件</button>
            <button type="button" class="db-btn" data-act="code">生成卡包码</button>
          </div>
          <textarea class="db-code ws-out" rows="3" readonly placeholder="卡包码会显示在这里"></textarea>
          <p class="db-hint">想并入官方卡牌库：勾选后“下载文件”，把文件发给开发者（或贴到 GitHub 议题）。卡包码适合直接发给朋友导入（不含图片）。</p>
        </section>
        <section class="ws-card">
          <h3>导入</h3>
          <label class="db-btn">选择文件…<input type="file" accept=".json,application/json" class="ws-file" hidden></label>
          <textarea class="db-code ws-in" rows="4" placeholder="或粘贴卡包码（SGKP1-…）/ JSON"></textarea>
          <div class="ws-impl">
            <span>同名标识但内容不同时：</span>
            <label><input type="radio" name="mode" value="copy" checked> 另存副本</label>
            <label><input type="radio" name="mode" value="overwrite"> 覆盖本机</label>
            <label><input type="radio" name="mode" value="skip"> 跳过</label>
          </div>
          <div class="db-row"><button type="button" class="db-btn db-primary" data-act="import">导入</button></div>
          <div class="ws-import-result"></div>
        </section>
      </div>`;
    const boxes = () => [...body.querySelectorAll('.ws-checklist input')];
    body.querySelectorAll('[data-sel]').forEach(b => {
      b.onclick = () => boxes().forEach(i => { i.checked = b.dataset.sel === 'all' || (b.dataset.sel === 'pending' && i.dataset.pending === '1'); });
    });
    const subset = () => {
      const cardIds = boxes().filter(i => i.checked && i.dataset.c).map(i => i.dataset.c);
      const factionKeys = boxes().filter(i => i.checked && i.dataset.f).map(i => i.dataset.f);
      return pickSubset({ cardIds, factionKeys });
    };
    body.querySelector('[data-act="download"]').onclick = () => {
      const s = subset();
      if (!s.cards.length && !s.factions.length) { this._toast('先勾选要导出的内容', true); return; }
      const name = downloadPack(s);
      this._toast(`已下载 ${name}（${s.factions.length} 个势力，${s.cards.length} 张卡）`);
    };
    body.querySelector('[data-act="code"]').onclick = async () => {
      const s = subset();
      if (!s.cards.length && !s.factions.length) { this._toast('先勾选要导出的内容', true); return; }
      const code = await encodePack(s);
      const out = body.querySelector('.ws-out');
      out.value = code;
      try { await globalThis.navigator.clipboard.writeText(code); this._toast('卡包码已复制'); } catch { out.select(); this._toast('请手动复制卡包码'); }
    };
    const inBox = body.querySelector('.ws-in');
    body.querySelector('.ws-file').onchange = async (e) => { const file = e.target.files?.[0]; if (file) inBox.value = await file.text(); };
    body.querySelector('[data-act="import"]').onclick = async () => {
      const res = body.querySelector('.ws-import-result');
      try {
        const raw = inBox.value.trim();
        if (!raw) throw new Error('请先选择文件或粘贴内容');
        const data = raw.startsWith('SGKP') || /SGKP[01]-/.test(raw) ? await decodePack(raw) : JSON.parse(raw);
        const mode = body.querySelector('input[name="mode"]:checked').value;
        const { report } = mergePack(data, mode);
        res.innerHTML = `<p class="db-status-msg ok">导入完成：新增 ${report.added.length}，覆盖 ${report.updated.length}，另存副本 ${report.copied.length}，跳过 ${report.skipped.length}</p>`;
        this.onChange();
      } catch (err) {
        res.innerHTML = `<p class="db-error">${escapeHtml(err.message || '导入失败')}</p>`;
      }
    };
  }
}
