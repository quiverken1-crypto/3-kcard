/**
 * trainingGround.js — 演武场：测试卡牌效果用的沙盘
 *
 * 一局普通人机对局 + 一个可收起的工具面板：
 *   · 开关：无限粮草、主城不灭、对手行为（站桩不动 / AI 正常行动）、敌方回合跳过
 *   · 取牌：任意势力任意卡，加入我方手牌 / 放到我方或敌方战场（会结算进场效果）
 *   · 木桩：自定战力、生命、词条，放到敌方支援或前线
 *   · 快捷：刷新我方行动、全体回满、清场、摸牌、主城回满
 * 演武场不计回合时间，主城默认 999 血。
 */
import { CARDS_BY_KINGDOM, KINGDOMS } from '../data/cardDB.js';
import { allKingdomKeys, commonLibrary } from '../data/deckStore.js';
import { customCardsOf } from '../data/customContent.js';
import { createCard, drawCard, getAllUnits, findUnit, removeUnitFromBoard } from '../engine/state.js';
import { applyEnterKeywords, onUnitEnter, processDeaths, refreshAuras, putInHand } from '../engine/cardSkills.js';
import { STATUS_TYPES, PHASES, ACTION_TYPES } from '../engine/constants.js';
import { escapeHtml, showCardDetails } from './cardRenderer.js';
import { factionDropdown } from './factionPicker.js';
import FX from './fx.js';

const ZONES = [['SUPPORT', '支援阵线'], ['LEFT', '左路'], ['CENTER', '中路'], ['RIGHT', '右路']];
const DUMMY_KWS = ['守护', '伏击', '帷幄', '坚阵1', '坚阵2', '潜袭', '警戒', '游击', '聚众', '奋战', '矢石'];
const TROOPS = [['INFANTRY', '步兵'], ['CAVALRY', '骑兵'], ['NAVY', '水军'], ['STRATEGIST', '谋士'], ['ARCHER', '器械']];
let seq = 0;

export class TrainingGround {
  constructor(app) {
    this.app = app;
    this.opts = { infinite: true, immortal: true, ai: 'idle' };
    this.pick = { kingdom: 'wei', q: '', dest: 'HAND', side: 'me', zone: 'SUPPORT' };
    this.dummy = { atk: 0, hp: 20, troop: 'INFANTRY', kws: [], zone: 'SUPPORT' };
    this.el = null;
    this.open = false;
  }

  get active() { return Boolean(this.app.training); }
  get state() { return this.app.rulesEngine?.state || null; }
  get me() { return this.app.localPlayerId; }
  get foe() { return this.app.opponentPlayerId; }

  /** 对局开始时调用 */
  start() {
    this.app.training = this.opts;
    const s = this.state;
    if (s && this.opts.immortal) this._fullHq();
    this._mount();
    this._toast('演武场：已开启无限粮草、主城不灭，对手站桩不动。点左侧“演武”打开工具。');
  }

  stop() {
    this.app.training = null;
    this.el?.remove();
    this.el = null;
    this.fab?.remove();
    this.fab = null;
    this.open = false;
  }

  /** 每次重绘前：维持无限粮草等开关 */
  beforeRender(state) {
    if (!this.active || !state?.players) return;
    if (this.opts.infinite) {
      const p = state.players[this.me];
      if (p && p.provisions < 99) p.provisions = 99;
    }
    if (this.opts.immortal) {
      for (const pid of ['WEI', 'SHU']) {
        const p = state.players[pid];
        if (p && p.hp < 100) this._setHq(pid, 999);
      }
      if (state.phase === PHASES.GAME_OVER) { state.phase = PHASES.ACTION; state.winner = null; }
    }
  }

  // ------------------------------------------------------------ 面板
  _mount() {
    const doc = document;
    this.el?.remove();
    this.fab?.remove();
    this.open = false;
    this.fab = doc.createElement('button');
    this.fab.type = 'button';
    this.fab.className = 'tg-fab';
    this.fab.innerHTML = '<b>演</b><span>演武</span>';
    this.fab.onclick = () => this.toggle();
    doc.body.appendChild(this.fab);
    this.el = doc.createElement('aside');
    this.el.className = 'tg-panel hidden';
    this.el.setAttribute('aria-label', '演武场工具');
    doc.body.appendChild(this.el);
    this._render();
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el?.classList.toggle('hidden', !this.open);
    this.fab?.classList.toggle('on', this.open);
    if (this.open) this._renderCards();
  }

  _render() {
    const o = this.opts, d = this.dummy, pk = this.pick;
    const seg = (name, items, cur) => `<span class="tg-seg">${items.map(([v, l]) => `<button type="button" data-${name}="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    this.el.innerHTML = `
      <header class="tg-head"><b>演武场</b><span>测试卡牌效果</span><button type="button" class="tg-x" aria-label="收起">✕</button></header>
      <section class="tg-sec">
        <h4>规则开关</h4>
        <label class="tg-sw"><input type="checkbox" data-opt="infinite" ${o.infinite ? 'checked' : ''}> 无限粮草（我方）</label>
        <label class="tg-sw"><input type="checkbox" data-opt="immortal" ${o.immortal ? 'checked' : ''}> 主城不灭（999 血，不会分胜负）</label>
        <div class="tg-row"><span>对手</span>${seg('ai', [['idle', '站桩不动'], ['auto', 'AI 正常行动']], o.ai)}</div>
      </section>
      <section class="tg-sec">
        <h4>取牌</h4>
        <div class="tg-row"><span class="tg-kp"></span><input class="tg-q" type="search" placeholder="搜卡名 / 技能 / 词条" value="${escapeHtml(pk.q)}"></div>
        <div class="tg-row"><span>放到</span>${seg('dest', [['HAND', '我方手牌'], ['ME', '我方战场'], ['FOE', '敌方战场']], pk.dest)}</div>
        <div class="tg-row tg-zone-row ${pk.dest === 'HAND' ? 'dim' : ''}"><span>位置</span>${seg('zone', ZONES, pk.zone)}</div>
        <div class="tg-cards"></div>
        <p class="tg-hint">点卡名加入；长按或右键看详情。放上战场会结算进场效果，我方单位可立即行动。</p>
      </section>
      <section class="tg-sec">
        <h4>木桩</h4>
        <div class="tg-row"><span>战力</span><input type="number" class="tg-num" data-d="atk" min="0" max="99" value="${d.atk}"><span>生命</span><input type="number" class="tg-num" data-d="hp" min="1" max="999" value="${d.hp}"></div>
        <div class="tg-row"><span>兵种</span>${seg('troop', TROOPS, d.troop)}</div>
        <div class="tg-kws">${DUMMY_KWS.map(k => `<button type="button" data-kw="${k}" class="${d.kws.includes(k) ? 'on' : ''}">${k}</button>`).join('')}</div>
        <div class="tg-row"><span>位置</span>${seg('dzone', ZONES, d.zone)}</div>
        <div class="tg-row"><button type="button" class="tg-btn primary" data-act="dummy">放一个敌方木桩</button><button type="button" class="tg-btn" data-act="dummy-me">放到我方</button></div>
      </section>
      <section class="tg-sec">
        <h4>快捷</h4>
        <div class="tg-grid">
          <button type="button" class="tg-btn" data-act="refresh">刷新我方行动</button>
          <button type="button" class="tg-btn" data-act="heal">全体回满</button>
          <button type="button" class="tg-btn" data-act="draw">我方摸 1 张</button>
          <button type="button" class="tg-btn" data-act="hq">双方主城回满</button>
          <button type="button" class="tg-btn" data-act="clear-foe">清空敌方战场</button>
          <button type="button" class="tg-btn" data-act="clear-me">清空我方战场</button>
          <button type="button" class="tg-btn" data-act="clear-counter">移除所有反制</button>
          <button type="button" class="tg-btn" data-act="foe-turn">让对手行动一回合</button>
        </div>
      </section>`;
    const root = this.el;
    root.querySelector('.tg-x').onclick = () => this.toggle(false);
    root.querySelectorAll('[data-opt]').forEach(i => { i.onchange = () => { this.opts[i.dataset.opt] = i.checked; if (i.dataset.opt === 'immortal' && i.checked) this._fullHq(); this._refresh(); }; });
    root.querySelectorAll('[data-ai]').forEach(b => { b.onclick = () => { this.opts.ai = b.dataset.ai; this._render(); }; });
    root.querySelectorAll('[data-dest]').forEach(b => { b.onclick = () => { pk.dest = b.dataset.dest; this._render(); }; });
    root.querySelectorAll('[data-zone]').forEach(b => { b.onclick = () => { pk.zone = b.dataset.zone; this._render(); }; });
    root.querySelectorAll('[data-dzone]').forEach(b => { b.onclick = () => { d.zone = b.dataset.dzone; this._render(); }; });
    root.querySelectorAll('[data-troop]').forEach(b => { b.onclick = () => { d.troop = b.dataset.troop; this._render(); }; });
    root.querySelectorAll('[data-kw]').forEach(b => { b.onclick = () => { const k = b.dataset.kw; d.kws = d.kws.includes(k) ? d.kws.filter(x => x !== k) : [...d.kws.filter(x => !(k.startsWith('坚阵') && x.startsWith('坚阵'))), k]; this._render(); }; });
    root.querySelectorAll('[data-d]').forEach(i => { i.onchange = () => { d[i.dataset.d] = Math.max(i.dataset.d === 'hp' ? 1 : 0, Number(i.value) || 0); }; });
    root.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => this._act(b.dataset.act); });
    const q = root.querySelector('.tg-q');
    q.oninput = () => { pk.q = q.value.trim(); this._renderCards(); };
    const keys = [...allKingdomKeys(), 'common'];
    root.querySelector('.tg-kp').replaceWith(factionDropdown(document, {
      label: '势力', current: pk.kingdom,
      options: keys.map(k => [k, KINGDOMS[k]?.name || '?', KINGDOMS[k]?.army || k]),
      onSelect: k => { pk.kingdom = k; this._render(); }
    }));
    this._renderCards();
  }

  _cardPool() {
    const k = this.pick.kingdom;
    const base = k === 'common' ? commonLibrary() : [...(CARDS_BY_KINGDOM[k] || []), ...customCardsOf(k)];
    const q = this.pick.q;
    const list = q
      ? Object.values(CARDS_BY_KINGDOM).flat().concat(allKingdomKeys().flatMap(x => customCardsOf(x)))
        .filter(d => `${d.name}${d.skill?.name || ''}${d.skill?.description || ''}${(d.keywords || []).join('')}`.includes(q))
      : base;
    const seen = new Set();
    return list.filter(d => !seen.has(d.id) && seen.add(d.id)).sort((a, b) => (a.type > b.type ? -1 : a.type < b.type ? 1 : 0) || (a.cost - b.cost));
  }

  _renderCards() {
    const box = this.el?.querySelector('.tg-cards');
    if (!box) return;
    const list = this._cardPool().slice(0, 120);
    const T = { UNIT: '', TACTIC: '战法', COUNTER: '反制' };
    box.innerHTML = list.length ? list.map(d => `<button type="button" class="tg-card t-${d.type}" data-id="${escapeHtml(d.id)}" title="${escapeHtml(d.skill?.description || '')}"><i>${d.cost ?? 0}</i>${escapeHtml(d.name)}${T[d.type] ? `<em>${T[d.type]}</em>` : ''}${this.pick.q ? `<small>${escapeHtml(KINGDOMS[d.kingdom]?.name || '')}</small>` : ''}</button>`).join('') : '<p class="tg-hint">没有找到卡牌</p>';
    const defOf = id => list.find(d => d.id === id);
    box.querySelectorAll('.tg-card').forEach(b => {
      b.onclick = () => this._spawnCard(defOf(b.dataset.id));
      b.oncontextmenu = e => { e.preventDefault(); this._peek(defOf(b.dataset.id)); };
      let t = null;
      b.onpointerdown = () => { t = setTimeout(() => { t = 'done'; this._peek(defOf(b.dataset.id)); }, 480); };
      b.onpointerup = b.onpointerleave = () => { if (t && t !== 'done') clearTimeout(t); };
    });
  }

  _peek(def) { if (def) showCardDetails(createCard(def, { faction: this.me, kingdom: def.kingdom, instanceId: `tgpeek_${def.id}` })); }

  // ------------------------------------------------------------ 动作
  _newId() { seq += 1; return `tg_${Date.now().toString(36)}_${seq}`; }

  _spawnCard(def) {
    const s = this.state;
    if (!def || !s) return;
    const dest = this.pick.dest;
    if (dest === 'HAND' || def.type !== 'UNIT') {
      if (dest !== 'HAND' && def.type !== 'UNIT') this._toast('战法/反制只能加入手牌，已放进我方手牌');
      const c = createCard(def, { faction: this.me, kingdom: def.kingdom, instanceId: this._newId() });
      if (s.players[this.me].hand.length >= 9) { this._toast('手牌已满（9 张）'); return; }
      putInHand(s, this.me, c);
      delete c._known;
      this._refresh(`加入手牌：【${def.name}】`);
      return;
    }
    const side = dest === 'ME' ? this.me : this.foe;
    const c = createCard(def, { faction: side, kingdom: def.kingdom, instanceId: this._newId() });
    if (this._place(side, c, this.pick.zone)) this._refresh(`${side === this.me ? '我方' : '敌方'}【${def.name}】上场`);
  }

  _place(side, card, zone) {
    const s = this.state;
    if (zone === 'SUPPORT') {
      const slots = s.battlefield.support[side].slots;
      if (slots.length >= 4) { this._toast('支援阵线已满（4 个）'); return false; }
      slots.push(card);
    } else {
      const z = s.battlefield.frontline[zone];
      if (!z) return false;
      if (z.occupant && z.occupant !== side) { this._toast('这条前线被另一方占着，先清掉或换一条'); return false; }
      if (z.units.length >= z.capacity) { this._toast('这条前线已满'); return false; }
      z.units.push(card);
      z.occupant = side;
    }
    card.faction = side;
    const ready = side === this.me;
    Object.assign(card.status, { [STATUS_TYPES.DEPLOYED_THIS_TURN]: !ready, [STATUS_TYPES.ACTIONS_USED]: ready ? 0 : 1 });
    if ((card.keywords || []).includes('潜袭')) card.status[STATUS_TYPES.IS_FACE_DOWN] = true;
    try {
      applyEnterKeywords(s, card, side);
      onUnitEnter(s, card);
      if (ready) Object.assign(card.status, { [STATUS_TYPES.DEPLOYED_THIS_TURN]: false, [STATUS_TYPES.ACTIONS_USED]: 0 });
      processDeaths(s);
      refreshAuras(s);
    } catch (err) { console.warn('演武场：进场效果出错', err); }
    return true;
  }

  _act(kind) {
    const s = this.state;
    if (!s) return;
    const me = this.me, foe = this.foe;
    if (kind === 'dummy' || kind === 'dummy-me') {
      const d = this.dummy;
      const side = kind === 'dummy' ? foe : me;
      const c = createCard({ cardId: 'train_dummy', name: '木桩', type: 'UNIT', troopType: d.troop, cost: 0, actionCost: 1, atk: d.atk, hp: d.hp, keywords: [...d.kws], skill: { name: '木桩', description: '演武场木桩' } }, { faction: side, kingdom: side === me ? s.players[me].kingdom : s.players[foe].kingdom, instanceId: this._newId() });
      if (this._place(side, c, d.zone)) this._refresh(`${side === me ? '我方' : '敌方'}放置木桩 ${d.atk}/${d.hp}${d.kws.length ? ` ${d.kws.join('·')}` : ''}`);
      return;
    }
    if (kind === 'refresh') {
      for (const u of getAllUnits(s, me)) {
        Object.assign(u.status, { actionsUsed: 0, movedThisTurn: false, attackedThisTurn: false, attacksThisTurn: 0, deployedThisTurn: false, suppressed: false, suppressedTurnsLeft: 0, chargeUsed: false });
      }
      for (const k of Object.keys(s.players[me])) if (k === 'prestigeDiscountUsed') s.players[me][k] = false;
      return this._refresh('我方单位行动已刷新');
    }
    if (kind === 'heal') {
      for (const u of [...getAllUnits(s, me), ...getAllUnits(s, foe)]) u.hp = u.maxHp;
      return this._refresh('双方单位已回满');
    }
    if (kind === 'draw') { drawCard(s, me); return this._refresh('我方摸 1 张'); }
    if (kind === 'hq') { this._fullHq(); return this._refresh('双方主城已回满'); }
    if (kind === 'clear-foe' || kind === 'clear-me') {
      const side = kind === 'clear-foe' ? foe : me;
      for (const u of [...getAllUnits(s, side)]) removeUnitFromBoard(s, u.instanceId, true, { silent: true });
      refreshAuras(s);
      return this._refresh(`${side === me ? '我方' : '敌方'}战场已清空`);
    }
    if (kind === 'clear-counter') { s.activeCounters = []; return this._refresh('已移除所有反制'); }
    if (kind === 'foe-turn') {
      if (s.activePlayer !== me) { this._toast('现在已经是对手回合'); return; }
      const prev = this.opts.ai;
      this.opts.ai = 'auto';
      this._onceAuto = prev;
      this.app.handleUserAction({ type: ACTION_TYPES.END_TURN, playerId: me, payload: {} });
    }
  }

  /** 对手回合：站桩时直接结束；“让对手行动一回合”只放开这一回合 */
  takeOpponentTurn() {
    if (this.opts.ai === 'auto') {
      if (this._onceAuto) { this.opts.ai = this._onceAuto; this._onceAuto = null; this._render(); }
      return false; // 交给正常 AI
    }
    setTimeout(() => {
      const s = this.state;
      if (!s || s.activePlayer !== this.foe || s.phase !== PHASES.ACTION) return;
      try { this.app.rulesEngine.dispatch({ type: ACTION_TYPES.END_TURN, playerId: this.foe, payload: {} }); } catch (err) { console.warn(err); }
      this.app._updateCombatLog();
      this.app.render();
      this.app._checkTurnState();
    }, 350);
    return true;
  }

  _fullHq() { for (const pid of ['WEI', 'SHU']) this._setHq(pid, this.opts.immortal ? 999 : 20); }
  _setHq(pid, hp) {
    const s = this.state;
    const p = s?.players?.[pid];
    if (!p) return;
    p.hp = hp; p.maxHp = Math.max(p.maxHp || 0, hp);
    const hq = s.battlefield.support[pid]?.hq;
    if (hq) { hq.hp = p.hp; hq.maxHp = p.maxHp; }
  }

  _refresh(msg) {
    if (msg) this._toast(msg);
    this.app._updateCombatLog?.();
    this.app.render();
    this.app._checkTurnState?.();
  }

  _toast(msg) { FX.showTriggerHint(`🎯 ${escapeHtml(msg)}`); }
}
