/**
 * interaction.js — User Interaction Controller, Drag-and-Drop & Targeting State Machine
 * Three Kingdoms KARDS (Milestone 4)
 *
 * Implements:
 * 1. FSM: IDLE -> CARD_SELECTED -> TARGETING -> ACTION_CONFIRMED -> DISABLED.
 * 2. PointerEvents Drag-and-Drop & Click-to-Action dual interaction.
 * 3. Dynamic SVG Bezier Targeting Curve with laser glow.
 * 4. Keyword-compliant Move & Attack highlighting via combat.getValidTargets.
 * 5. High-Impact Unused Action End Turn warning prompt.
 */

import { ACTION_TYPES, KEYWORDS, STATUS_TYPES, hasKeyword } from '../engine/constants.js';
import { getValidTargets, validateAttack } from '../engine/combat.js';
import { findUnit, getAllUnits } from '../engine/state.js';
import { getTacticTargets, getDeployTargets, tacticBlockReason, getActiveSkill, activeSkillBlockReason, canDeployToFrontline, getActionCost, actsLikeCavalry as skillActsLikeCavalry, getCardPlayCost } from '../engine/cardSkills.js';
import { CardInspector } from './cardRenderer.js';
import { getUnitMoveZones, unitHasUsefulAction } from '../engine/unitOptions.js';
import { previewAction, estimateAttack } from '../engine/preview.js';

export const INTERACTION_STATE = Object.freeze({
  IDLE: 'IDLE',
  CARD_SELECTED: 'CARD_SELECTED',
  TARGETING: 'TARGETING',
  ACTION_CONFIRMED: 'ACTION_CONFIRMED',
  DISABLED: 'DISABLED'
});

/** 把引擎的英文校验信息翻译成玩家看得懂的原因 */
const ATTACK_REASON_CN = [
  [/protected by adjacent 守护/, '目标旁边有【守护】单位，必须先打掉守护（谋士、攻心可无视）'],
  [/HQ while protected by 守护/, '敌方支援阵线第1个单位有【守护】，挡住了主城，需先击败它（谋士、攻心可无视）'],
  [/HQ while enemy frontline zone is occupied/, '你所在前线区域对面有敌军，需先清掉该区域敌军才能打主城'],
  [/support line cannot attack enemy HQ/, '支援阵线的军事单位不能直接打主城，需先移动到前线（谋士、抛射器械除外）'],
  [/support line cannot attack opposing support/, '支援阵线的军事单位打不到敌方支援阵线，需先移动到前线'],
  [/只能攻击相邻前线区域/, '射程不够：前线只能打本区域和左右相邻区域（左↔中↔右，左右两端不相邻）'],
  [/Strategist must prioritize/, '谋士须优先攻击该区域的敌方谋士'],
  [/帷幄/, '目标有【帷幄】：它行动前不能被攻击（攻心可无视）'],
  [/险关/, '险关：该单位本回合已被攻击过'],
  [/already attacked/, '该单位本回合已攻击过'],
  [/cannot attack after moving/, '步兵移动后不能再攻击（骑兵可以先移后打）'],
  [/deployed/, '刚部署的单位本回合不能攻击（【突袭】除外）'],
  [/Suppressed/, '该单位被【压制】，无法攻击'],
  [/Insufficient provisions for attack \(need (\d+)\)/, m => `粮草不足，攻击需要 ${m[1]} 粮草`],
  [/Cannot attack friendly/, '不能攻击己方单位'],
  [/鲁肃·结盟/, '鲁肃·结盟：战力大于3的单位无法攻击']
];
export function explainAttackError(msg = '') {
  for (const [re, text] of ATTACK_REASON_CN) {
    const m = String(msg).match(re);
    if (m) return typeof text === 'function' ? text(m) : text;
  }
  return String(msg || '无法攻击该目标');
}

export class InteractionController {
  /**
   * @param {object} options
   * @param {HTMLElement} [options.rootContainer] - #battlefield-main
   * @param {SVGSVGElement} [options.svgOverlay] - #targeting-svg-layer
   * @param {SVGPathElement} [options.targetingCurve] - #targeting-curve
   * @param {Function} [options.onAction] - (actionIntent) => void
   */
  constructor(options = {}) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;

    this.root = options.rootContainer || (doc?.getElementById('battlefield-main'));
    this.svgOverlay = options.svgOverlay || (doc?.getElementById('targeting-svg-layer'));
    this.targetingCurve = options.targetingCurve || (doc?.getElementById('targeting-curve'));
    this.onAction = options.onAction || (() => {});
    // The battlefield scroll container clips descendants, including fixed SVGs.
    // Keep targeting arrows on the page layer so hand-to-board paths stay visible.
    if (this.svgOverlay && doc?.body && this.svgOverlay.parentElement !== doc.body) {
      doc.body.appendChild(this.svgOverlay);
    }

    this.state = INTERACTION_STATE.IDLE;
    this.localPlayerId = 'WEI';
    this.gameState = null;

    // Selection contexts
    this.selectedCard = null; // { instanceId, cardDef, cost }
    this.selectedUnit = null; // { instanceId, unit, loc }
    this.legalDropZones = new Set();
    this.legalMoveTargets = [];
    this.legalAttackTargets = [];

    // Drag tracking via PointerEvents
    this.dragPointerId = null;
    this.dragStartPos = { x: 0, y: 0 };
    this.isDragging = false;
    this.dragGhostEl = null;

    // End turn warning suppression flag
    this.suppressEndTurnWarning = false;

    if (doc) {
      this._bindGlobalEvents();
    }
  }

  setContext(gameState, localPlayerId) {
    this.gameState = gameState;
    this.localPlayerId = localPlayerId || 'WEI';

    // Auto-disable if not local player's turn or game over
    const isLocalTurn = gameState && gameState.activePlayer === this.localPlayerId && gameState.phase === 'ACTION';
    if (!isLocalTurn && this.state !== INTERACTION_STATE.DISABLED) {
      if (this.pendingTactic) this._endTacticTargeting();
      this.cancelSelection();
      this.state = INTERACTION_STATE.DISABLED;
    } else if (isLocalTurn && this.state === INTERACTION_STATE.DISABLED) {
      this.state = INTERACTION_STATE.IDLE;
    }
  }

  _bindGlobalEvents() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const win = typeof window !== 'undefined' ? window : globalThis.window;
    if (!doc) return;

    doc.addEventListener('contextmenu', e => this._handleContextMenu(e), true);
    // 触屏：每次点按先收起上一张卡牌说明
    doc.addEventListener('pointerdown', e => { if (e.pointerType && e.pointerType !== 'mouse') CardInspector.hide(); }, true);

    // 1. Hand Card Pointer Events (Delegated)
    const handContainer = doc.getElementById('hand-container');
    if (handContainer) {
      handContainer.addEventListener('pointerdown', (e) => this._handleHandPointerDown(e));
    }

    // 2. Battlefield Unit Pointer Events (Delegated)
    if (this.root) {
      this.root.addEventListener('pointerdown', (e) => this._handleBoardPointerDown(e));
    }

    // 3. Document/Window Pointer Move & Up
    if (win) {
      win.addEventListener('pointermove', (e) => this._handlePointerMove(e));
      win.addEventListener('pointerup', (e) => this._handlePointerUp(e));
      win.addEventListener('pointercancel', (e) => this._handlePointerCancel(e));

      // 4. Keyboard Shortcuts
      win.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.pendingTactic) this._endTacticTargeting();
          this.cancelSelection();
        } else if (e.code === 'Space' && !e.repeat && this.state !== INTERACTION_STATE.DISABLED) {
          e.preventDefault();
          this.handleEndTurnClick();
        }
      });
    }

    // 5. End Turn Button Click
    const endTurnBtn = doc.getElementById('btn-end-turn');
    if (endTurnBtn) {
      endTurnBtn.addEventListener('click', () => this.handleEndTurnClick());
    }
  }

  // ==========================================
  // Hand Card Interaction
  // ==========================================
  _handleContextMenu(e) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const inGame = e.target?.closest?.('#game-app');
    // 游戏界面内一律屏蔽浏览器右键菜单（输入框除外）
    if (inGame && !e.target?.closest?.('input, textarea, select')) e.preventDefault();
    if (this._suppressNextContextOpen) {
      this._suppressNextContextOpen = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (this._isBusySelecting()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this._cancelAll();
    }
    void doc;
  }

  _isTouch(e) { return Boolean(e?.pointerType) && e.pointerType !== 'mouse'; }

  /** 非己方回合：不能操作，但仍可点按查看卡牌/单位说明 */
  _peekInfo(e, fromHand) {
    if (!this._isTouch(e) || !this.gameState) return;
    if (fromHand) {
      const el = e.target?.closest?.('.card-hand');
      const card = el && this.gameState.players?.[this.localPlayerId]?.hand?.find(c => c.instanceId === el.dataset?.instanceId);
      if (card) this._showTouchInfo(card, el);
      return;
    }
    const unitEl = e.target?.closest?.('.board-unit');
    if (!unitEl || unitEl.dataset?.isFaceDown === 'true') return;
    const loc = findUnit(this.gameState, unitEl.dataset.instanceId);
    if (!loc?.unit) return;
    const u = loc.unit.faction === this.localPlayerId && loc.unit.status?.isFaceDown ? { ...loc.unit, status: { ...loc.unit.status, isFaceDown: false } } : loc.unit;
    this._showTouchInfo(u, unitEl);
  }

  _showTouchInfo(card, el) {
    try { CardInspector.show(card, el.getBoundingClientRect()); } catch { /* ignore */ }
    clearTimeout(this._infoTimer);
    this._infoTimer = setTimeout(() => CardInspector.hide(), 9000);
  }

  /** 供“取消”按钮调用 */
  cancelAll() { this._cancelAll(); CardInspector.hide(); }

  _isBusySelecting() {
    return Boolean(this.pendingTactic) || Boolean(this.pendingSkill) || this.state === INTERACTION_STATE.CARD_SELECTED || this.state === INTERACTION_STATE.TARGETING;
  }

  _cancelAll() {
    this.repositionOnly = null;
    this._endSkillMode?.();
    this._hideInsertMarker?.();
    if (this.pendingTactic) this._endTacticTargeting();
    this.dragPointerId = null;
    this.isDragging = false;
    this._removeCardGhost?.();
    this.cancelSelection();
  }

  /** 右键 / 中键：仅用于取消，不触发任何部署或行动 */
  _isNonPrimary(e) {
    if (e.button === undefined || e.button === 0) return false;
    if (e.button === 2 && this._isBusySelecting()) {
      this._suppressNextContextOpen = true;
      this._cancelAll();
    }
    return true;
  }

  _handleHandPointerDown(e) {
    if (this._isNonPrimary(e)) return;
    if (this.pendingTactic) this._endTacticTargeting();
    this._hideSkillButton();
    if (this.state === INTERACTION_STATE.DISABLED) { this._peekInfo(e, true); return; }
    if (this.state === INTERACTION_STATE.TARGETING) {
      this.cancelSelection();
    }
    const cardEl = e.target?.closest?.('.card-hand');
    if (!cardEl || cardEl.dataset?.isHidden === 'true') return;

    // 主动技能（程昱·捕粮）：选要弃置的手牌
    if (this.pendingSkill) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const ps = this.pendingSkill;
      this._endSkillMode();
      this.onAction({ type: ACTION_TYPES.ACTIVATE_SKILL, playerId: this.localPlayerId, payload: { unitId: ps.unitId, cardId: cardEl.dataset?.instanceId } });
      return;
    }

    const instanceId = cardEl.dataset?.instanceId;
    if (!instanceId || !this.gameState) return;

    const player = this.gameState.players?.[this.localPlayerId];
    if (!player) return;
    const card = player.hand?.find(c => c.instanceId === instanceId);
    if (!card) return;
    if (this._isTouch(e)) this._showTouchInfo(card, cardEl);

    // Check provision affordability
    const cost = getCardPlayCost(this.gameState, this.localPlayerId, card);
    if (player.provisions < cost) {
      this._triggerShake(cardEl);
      this._showToast(`粮草不足 (需 ${cost} 粮草，当前仅存 ${player.provisions})`);
      return;
    }

    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (this.selectedCard) this.cancelSelection();
    this.dragPointerId = e.pointerId ?? 1;
    this.dragStartPos = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    this.isDragging = false;

    this.selectedCard = { instanceId, cardDef: card, cost };
    this.state = INTERACTION_STATE.CARD_SELECTED;

    this._computeLegalDropZones(card);
    this._highlightLegalDropZones(true);
    cardEl.classList?.add('selected');
    try { this._cardTargetIds = card.type === 'TACTIC' ? (getTacticTargets(this.gameState, this.localPlayerId, card) || []).map(t => t.instanceId) : null; } catch { this._cardTargetIds = null; }
    this._touchSel = this._isTouch(e);
    if (!this._touchSel) this._updateCardTargetingCurve(e.clientX ?? 0, (e.clientY ?? 0) - 120);
  }

  _computeLegalDropZones(card) {
    this.legalDropZones.clear();
    const bf = this.gameState?.battlefield;
    if (!bf) return;

    if (card.type === 'UNIT') {
      // Support line capacity check (max 4 units)
      const supportUnits = bf.support?.[this.localPlayerId]?.slots || [];
      if (supportUnits.length < 4) {
        this.legalDropZones.add('SUPPORT');
      }

      // Frontline deployment (requires 奇袭)
      for (const zk of ['LEFT', 'CENTER', 'RIGHT']) {
        if (canDeployToFrontline(this.gameState, card, this.localPlayerId, zk)) this.legalDropZones.add(zk);
      }
    } else if (card.type === 'TACTIC' || card.type === 'COUNTER') {
      this.legalDropZones.add('BATTLEFIELD');
      this.legalDropZones.add('COUNTER');
    }
  }

  _highlightLegalDropZones(active) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    const selectorMap = {
      'SUPPORT': '#line-support-friendly, .line-friendly .line-slots-row',
      'LEFT': '#zone-left',
      'CENTER': '#zone-center',
      'RIGHT': '#zone-right',
      'BATTLEFIELD': '#line-frontline, .battlefield-viewport',
      'COUNTER': '#counter-zone, #player-dock'
    };

    for (const [zoneKey, selector] of Object.entries(selectorMap)) {
      const els = doc.querySelectorAll(selector);
      els.forEach(el => {
        if (active && this.legalDropZones.has(zoneKey)) {
          el.classList?.add('legal-drop-highlight');
        } else {
          el.classList?.remove('legal-drop-highlight');
        }
      });
    }
  }

  // ==========================================
  // Battlefield Unit Interaction
  // ==========================================
  _handleBoardPointerDown(e) {
    if (this._isNonPrimary(e)) return;
    this._hideSkillButton();
    this._lastPointer = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    if (this.state === INTERACTION_STATE.DISABLED) { this._peekInfo(e, false); return; }

    if (this.pendingSkill) {
      this._endSkillMode();
      this._showToast('已取消发动');
      return;
    }

    // 战法选择目标
    if (this.pendingTactic) {
      const unitEl = e.target?.closest?.('.board-unit');
      const targetId = unitEl?.dataset?.instanceId;
      const pending = this.pendingTactic;
      const armKey = `${pending.instanceId}>${targetId}`;
      if (this._isTouch(e) && targetId && pending.targetIds.includes(targetId) && this._armedTarget !== armKey) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        this._previewPendingAt(e.clientX ?? 0, e.clientY ?? 0);
        this._appendConfirmHint('再点一次确认');
        this._armedTarget = armKey;
        return;
      }
      this._armedTarget = null;
      this._endTacticTargeting();
      if (targetId && pending.targetIds.includes(targetId)) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (pending.kind === 'DEPLOY') {
          this.onAction({
            type: ACTION_TYPES.DEPLOY,
            playerId: this.localPlayerId,
            payload: { cardInstanceId: pending.instanceId, targetZone: pending.targetZone, slotIndex: pending.slotIndex, skillTargetId: targetId }
          });
        } else {
          this.onAction({
            type: ACTION_TYPES.PLAY_TACTIC,
            playerId: this.localPlayerId,
            payload: { cardInstanceId: pending.instanceId, targetId }
          });
        }
      } else {
        this._showToast(pending.kind === 'DEPLOY' ? '已取消部署' : '已取消战法');
      }
      return;
    }

    // Click-to-Deploy while in CARD_SELECTED mode
    if (this.state === INTERACTION_STATE.CARD_SELECTED && this.selectedCard) {
      const dropZone = this._resolveDropZone(e.target);
      if (dropZone && this.legalDropZones.has(dropZone)) {
        this._dispatchDeploy(this.selectedCard.instanceId, dropZone);
        return;
      } else {
        this.cancelSelection();
        return;
      }
    }

    // Check if clicked an existing targeting goal while in TARGETING mode
    if (this.state === INTERACTION_STATE.TARGETING) {
      const targetId = this._attackTargetAt(e.clientX ?? 0, e.clientY ?? 0, e.target);
      if (targetId) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        // 手机没有悬停：第一次点目标先显示预演，再点一次确认
        const armKey = `${this.selectedUnit.instanceId}>${targetId}`;
        if (this._isTouch(e) && this._armedTarget !== armKey) {
          const tEl = targetId === 'HQ' ? globalThis.document.getElementById('slot-opp-hq') : globalThis.document.querySelector(`.board-unit[data-instance-id="${targetId}"]`);
          this._previewFor({ type: ACTION_TYPES.ATTACK, playerId: this.localPlayerId, payload: { attackerId: this.selectedUnit.instanceId, targetId } }, tEl, tEl?.dataset?.isFaceDown === 'true');
          this._appendConfirmHint('再点一次确认攻击');
          this._armedTarget = armKey;
          return;
        }
        this._armedTarget = null;
        this._dispatchAttack(targetId);
        return;
      }
      if (this._explainIllegalTarget(e.target)) {
        if (this._isTouch(e) && e.target?.closest?.('.board-unit')) {
          const l = findUnit(this.gameState, e.target.closest('.board-unit').dataset.instanceId);
          if (l?.unit && e.target.closest('.board-unit').dataset?.isFaceDown !== 'true') this._showTouchInfo(l.unit, e.target.closest('.board-unit'));
        }
        return; // 保留选中，玩家可以换一个目标
      }

      const targetZoneEl = e.target?.closest?.('.legal-move-target, .frontline-zone, .line-support');
      if (targetZoneEl && targetZoneEl.classList?.contains('legal-move-target')) {
        const zoneKey = targetZoneEl.dataset?.zoneKey ||
          (targetZoneEl.dataset?.zone ? targetZoneEl.dataset.zone.replace('FRONTLINE_', '') : null) ||
          (targetZoneEl.classList?.contains('line-support') ? 'SUPPORT' : null);
        if (zoneKey) {
          this._dispatchMove(zoneKey);
          return;
        }
      }
    }

    // Select friendly unit
    const unitEl = e.target?.closest?.('.board-unit');
    if (!unitEl) {
      if (this.state !== INTERACTION_STATE.IDLE) {
        this.cancelSelection();
      }
      return;
    }

    const instanceId = unitEl.dataset?.instanceId;
    if (!instanceId || !this.gameState) return;

    const loc = findUnit(this.gameState, instanceId);
    // 触屏点按任意单位显示说明（翻面的敌方单位除外）
    if (this._isTouch(e) && loc?.unit && unitEl.dataset?.isFaceDown !== 'true') {
      const shown = loc.unit.faction === this.localPlayerId && loc.unit.status?.isFaceDown ? { ...loc.unit, status: { ...loc.unit.status, isFaceDown: false } } : loc.unit;
      this._showTouchInfo(shown, unitEl);
    }
    if (!loc || loc.unit?.faction !== this.localPlayerId) return;

    const unit = loc.unit;
    const player = this.gameState.players?.[this.localPlayerId];

    // 无法行动的单位仍可拖动调整站位；单击时才提示原因
    const blockReason = this._unitBlockReason(unit, loc, player);
    if (typeof e.preventDefault === 'function') e.preventDefault();
    this._showSkillButton(unit, unitEl);
    if (blockReason) {
      this.dragPointerId = e.pointerId ?? 1;
      this.dragStartPos = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
      this.isDragging = false;
      this.repositionOnly = { instanceId, loc, reason: blockReason, el: unitEl };
      return;
    }

    this.dragPointerId = e.pointerId ?? 1;
    this.dragStartPos = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    this.isDragging = false;

    this.selectedUnit = { instanceId, unit, loc };
    this.state = INTERACTION_STATE.TARGETING;

    this._computeUnitLegalTargets(unit, loc);
    this._highlightUnitTargets(true);
    unitEl.classList?.add('unit-acting-active');
    this._touchSel = this._isTouch(e);
    if (!this.legalMoveTargets.length) this._hintNoTargets(unit);
    else if (!this.legalAttackTargets.length && this._isTouch(e)) this._hintNoTargets(unit);
    if (!this._touchSel) this._updateTargetingCurve(e.clientX ?? 0, (e.clientY ?? 0) - 100);
  }

  /** 手指落点附近最近的合法攻击目标（手指比卡牌缝隙粗，放宽 22px 判定） */
  _attackTargetAt(x, y, elemBelow = null) {
    const doc = globalThis.document;
    const direct = elemBelow?.closest?.('.legal-attack-target');
    if (direct) return this._targetIdOf(direct);
    if (!doc || !this.legalAttackTargets?.length) return null;
    const pad = 22;
    let best = null; let bestD = Infinity;
    for (const id of this.legalAttackTargets) {
      const el = id === 'HQ' ? doc.getElementById('slot-opp-hq') : doc.querySelector(`.board-unit[data-instance-id="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  _targetIdOf(el) {
    if (!el) return null;
    if (el.id === 'slot-opp-hq' || el.classList?.contains('slot-opp-hq') || el.dataset?.targetId === 'HQ' || el.closest?.('#slot-opp-hq')) return 'HQ';
    return el.dataset?.instanceId || el.querySelector?.('.board-unit')?.dataset?.instanceId || null;
  }

  /** 点到不能打的敌军/敌方主城时，说明原因 */
  _explainIllegalTarget(elemBelow) {
    if (!this.selectedUnit || !this.gameState || !elemBelow?.closest) return false;
    let targetId = null;
    if (elemBelow.closest('#slot-opp-hq')) targetId = 'HQ';
    else {
      const uEl = elemBelow.closest('.board-unit');
      const id = uEl?.dataset?.instanceId;
      const loc = id ? findUnit(this.gameState, id) : null;
      if (loc && loc.unit.faction !== this.localPlayerId) targetId = id;
    }
    if (!targetId) return false;
    let reason = '';
    try {
      validateAttack(this.gameState, this.selectedUnit.instanceId, targetId);
      reason = '该目标暂时无法攻击';
    } catch (err) { reason = explainAttackError(err.message); }
    this._showToast(`无法攻击：${reason}`);
    return true;
  }

  /** 选中单位后，如果一个目标都没有，提示原因（取第一个敌人的原因作代表） */
  _hintNoTargets(unit) {
    if (this.legalAttackTargets.length || !this.gameState) return;
    const opp = this.localPlayerId === 'WEI' ? 'SHU' : 'WEI';
    const ids = ['HQ', ...getAllUnits(this.gameState, opp).map(u => u.instanceId)];
    const reasons = new Set();
    for (const id of ids) {
      try { validateAttack(this.gameState, unit.instanceId, id); } catch (err) { reasons.add(explainAttackError(err.message)); }
    }
    if (reasons.size) this._showToast(`当前没有可攻击目标：${[...reasons].slice(0, 2).join('；')}`);
  }

  /** 重绘战场后把选中/高亮状态补回去（否则高亮丢失，点目标会没反应） */
  refreshSelection() {
    if (this.pendingTactic) this._applyTacticHighlight();
    if (this.state !== INTERACTION_STATE.TARGETING || !this.selectedUnit || !this.gameState) return;
    const loc = findUnit(this.gameState, this.selectedUnit.instanceId);
    if (!loc || loc.unit.faction !== this.localPlayerId) { this.cancelSelection(); return; }
    this.selectedUnit = { ...this.selectedUnit, unit: loc.unit, loc };
    this._computeUnitLegalTargets(loc.unit, loc);
    this._highlightUnitTargets(true);
    globalThis.document?.querySelector(`.board-unit[data-instance-id="${loc.unit.instanceId}"]`)?.classList.add('unit-acting-active');
  }

  // ------------------------------------------------------------
  // 行动预演：指向目标时显示将造成的伤害、反击、剩余血量或击败
  // ------------------------------------------------------------
  _previewFor(action, anchorEl, faceDown = false) {
    const doc = globalThis.document;
    if (!doc || !anchorEl || !this.gameState) { this._hidePreview(); return; }
    const key = JSON.stringify(action.payload) + action.type;
    if (key !== this._previewKey) {
      this._previewKey = key;
      if (faceDown) this._previewData = { hidden: true };
      else {
        this._previewData = previewAction(this.gameState, action)
          || (action.type === ACTION_TYPES.ATTACK ? estimateAttack(this.gameState, action.payload.attackerId, action.payload.targetId) : null);
      }
    }
    const data = this._previewData;
    if (!data) { this._hidePreview(); return; }
    if (!this.previewEl) {
      this.previewEl = doc.createElement('div');
      this.previewEl.className = 'action-preview';
      doc.body.appendChild(this.previewEl);
    }
    const me = this.localPlayerId;
    const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const lines = [];
    if (data.hidden) lines.push('<div class="pv-line">🌫️ 潜伏单位：伤害未知</div>');
    const targetId = action.payload?.targetId || action.payload?.skillTargetId;
    if (!data.hidden && targetId && targetId !== 'HQ' && !(data.units || []).some(u => u.id === targetId)) {
      const t = findUnit(this.gameState, targetId)?.unit;
      if (t && action.type === ACTION_TYPES.ATTACK) lines.push(`<div class="pv-line pv-foe"><span class="pv-tag">敌方</span>${esc(t.name)} 无伤害（格挡）→ 剩 <b>${t.hp}</b></div>`);
    }
    const order = [...(data.units || [])].sort((a, b) => (b.id === targetId) - (a.id === targetId) || (a.faction === me) - (b.faction === me));
    for (const u of order) {
      const mine = u.faction === me;
      const dmg = u.before - u.after;
      const tag = mine ? (u.id === action.payload?.attackerId ? '反击' : '我方') : '敌方';
      let res;
      if (u.returned) res = '<b>返回手牌</b>';
      else if (u.dead) res = `<b class="pv-kill">${mine ? '阵亡' : '击败'}</b>`;
      else if (dmg > 0) res = `-${dmg} → 剩 <b>${u.after}</b>`;
      else res = `+${-dmg} → <b>${u.after}</b>`;
      lines.push(`<div class="pv-line ${mine ? 'pv-mine' : 'pv-foe'}"><span class="pv-tag">${tag}</span>${esc(u.name)} ${res}</div>`);
    }
    for (const h of data.hq || []) {
      const mine = h.pid === me;
      lines.push(`<div class="pv-line ${mine ? 'pv-mine' : 'pv-foe'}"><span class="pv-tag">${mine ? '我方' : '敌方'}</span>主城 -${h.before - h.after} → 剩 <b>${h.after}</b></div>`);
    }
    if (data.gameOver) lines.push(`<div class="pv-line pv-kill">${data.gameOver === me ? '🏆 直接获胜' : '⚠️ 此举会导致落败'}</div>`);
    if (!lines.length) lines.push('<div class="pv-line">无伤害变化</div>');
    if (data.estimate) lines.push('<div class="pv-note">估算（未计技能）</div>');
    this.previewEl.innerHTML = lines.join('');
    this.previewEl.style.display = 'block';
    const r = anchorEl.getBoundingClientRect();
    const w = this.previewEl.offsetWidth, h = this.previewEl.offsetHeight;
    const vw = globalThis.innerWidth || 800;
    let left = Math.min(Math.max(6, r.left + r.width / 2 - w / 2), vw - w - 6);
    let top = r.top - h - 8;
    if (top < 4) top = r.bottom + 8;
    Object.assign(this.previewEl.style, { left: `${left}px`, top: `${top}px` });
  }

  _appendConfirmHint(text) {
    if (!this.previewEl || this.previewEl.style.display === 'none') {
      this._showToast(text);
      return;
    }
    const d = globalThis.document.createElement('div');
    d.className = 'pv-confirm';
    d.textContent = `👆 ${text}`;
    this.previewEl.appendChild(d);
    // 追加一行后重新定位，避免盖住目标
    const top = parseFloat(this.previewEl.style.top) || 0;
    if (top > 0) this.previewEl.style.top = `${Math.max(4, top - d.offsetHeight)}px`;
  }

  _hidePreview() {
    this._armedTarget = null;
    this._previewKey = null;
    if (this.previewEl) this.previewEl.style.display = 'none';
  }

  /** 指着（悬停/拖动经过）战法或进场技能目标时预演 */
  _previewPendingAt(x, y) {
    const pending = this.pendingTactic;
    const el = globalThis.document?.elementFromPoint?.(x, y)?.closest?.('.board-unit');
    const id = el?.dataset?.instanceId;
    if (!pending || !id || !pending.targetIds.includes(id)) { this._hidePreview(); return; }
    const action = pending.kind === 'DEPLOY'
      ? { type: ACTION_TYPES.DEPLOY, playerId: this.localPlayerId, payload: { cardInstanceId: pending.instanceId, targetZone: pending.targetZone, slotIndex: pending.slotIndex, skillTargetId: id } }
      : { type: ACTION_TYPES.PLAY_TACTIC, playerId: this.localPlayerId, payload: { cardInstanceId: pending.instanceId, targetId: id } };
    this._previewFor(action, el);
  }

  /** 选中有主动技能的己方单位时，在其上方显示“发动”按钮 */
  _showSkillButton(unit, unitEl) {
    const doc = globalThis.document;
    this._hideSkillButton();
    const spec = getActiveSkill(unit);
    if (!spec || !doc || !this.gameState) return;
    const reason = activeSkillBlockReason(this.gameState, unit);
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `skill-activate-btn${reason ? ' disabled' : ''}`;
    btn.textContent = reason ? (reason.includes(spec.name) ? reason : `【${spec.name}】${reason}`) : `⚡ 发动【${spec.name}】`;
    btn.title = spec.desc;
    const r = unitEl.getBoundingClientRect();
    doc.body.appendChild(btn);
    const w = btn.offsetWidth;
    Object.assign(btn.style, { left: `${Math.max(6, Math.min(r.left + r.width / 2 - w / 2, (globalThis.innerWidth || 800) - w - 6))}px`, top: `${Math.max(4, r.top - btn.offsetHeight - 6)}px` });
    btn.addEventListener('pointerdown', ev => ev.stopPropagation());
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (reason) { this._showToast(reason); return; }
      this._hideSkillButton();
      this.cancelSelection();
      this._beginSkillMode(unit, spec);
    });
    this.skillBtn = btn;
  }

  _hideSkillButton() {
    this.skillBtn?.remove();
    this.skillBtn = null;
  }

  _beginSkillMode(unit, spec) {
    const doc = globalThis.document;
    // 不需要选手牌的主动技：直接发动
    if (!spec.needsHandCard) { this.onAction({ type: ACTION_TYPES.ACTIVATE_SKILL, playerId: this.localPlayerId, payload: { unitId: unit.instanceId } }); return; }
    this.pendingSkill = { unitId: unit.instanceId, name: spec.name };
    doc?.body?.classList.add('skill-hand-select');
    this._showToast(`【${spec.name}】${spec.handPrompt || '点一张手牌弃置，额外获得2粮草'}（点战场取消）`);
  }

  _endSkillMode() {
    this.pendingSkill = null;
    globalThis.document?.body?.classList.remove('skill-hand-select');
  }

  _unitBlockReason(unit, loc, player) {
    if (unit.status?.[STATUS_TYPES.SUPPRESSED]) return '该单位受到【压制】，无法主动移动或攻击（可拖动调整站位）';
    if (unit.status?.[STATUS_TYPES.DEPLOYED_THIS_TURN] && !hasKeyword(unit, KEYWORDS.TU_XI)) return '该单位本回合刚部署，尚在休整（可拖动调整站位）';
    const liveCost = getActionCost(this.gameState, unit, loc);
    if (player && player.provisions < liveCost) return `行动粮草不足（需 ${liveCost}，当前 ${player.provisions}；可拖动调整站位）`;
    const cav = skillActsLikeCavalry(this.gameState, unit, loc);
    const fen = hasKeyword(unit, KEYWORDS.FEN_ZHAN);
    if (cav) {
      if (unit.status?.[STATUS_TYPES.MOVED_THIS_TURN] && unit.status?.[STATUS_TYPES.ATTACKED_THIS_TURN] && (!fen || (unit.status?.attacksThisTurn || 0) >= 2)) return '该骑兵本回合行动力已耗尽（可拖动调整站位）';
    } else if (unit.status?.[STATUS_TYPES.ACTIONS_USED] > 0 && (!fen || (unit.status?.attacksThisTurn || 0) >= 2)) {
      return '步兵每回合仅能移动或攻击一次（可拖动调整站位）';
    }
    return '';
  }

  _zoneKeyOfElement(el) {
    if (!el?.closest) return null;
    if (el.closest('#line-support-friendly')) return 'SUPPORT';
    if (el.closest('#zone-left')) return 'LEFT';
    if (el.closest('#zone-center')) return 'CENTER';
    if (el.closest('#zone-right')) return 'RIGHT';
    return null;
  }

  _zoneContainer(zoneKey) {
    const doc = globalThis.document;
    if (zoneKey === 'SUPPORT') return doc?.querySelector('#line-support-friendly .line-slots-row');
    const k = String(zoneKey).toLowerCase();
    return doc?.querySelector(`#zone-${k} .zone-slots-container, #zone-${k} .zone-units-track`);
  }

  _zoneUnitEls(zoneKey, excludeId = null) {
    const c = this._zoneContainer(zoneKey);
    return c ? [...c.querySelectorAll('.board-unit')].filter(el => el.dataset.instanceId !== excludeId) : [];
  }

  /** 竖屏时前线区域的单位上下排列：按纵坐标计算插入位置 */
  _isVerticalZone(zoneKey) {
    const c = zoneKey ? this._zoneContainer(zoneKey) : null;
    if (!c) return false;
    try { return getComputedStyle(c).flexDirection.startsWith('column'); } catch { return false; }
  }

  _insertIndex(zoneKey, x, excludeId = null) {
    const vertical = this._isVerticalZone(zoneKey);
    const y = this._lastPointer?.y ?? 0;
    return this._zoneUnitEls(zoneKey, excludeId).filter(el => {
      const r = el.getBoundingClientRect();
      return vertical ? r.top + r.height / 2 < y : r.left + r.width / 2 < x;
    }).length;
  }

  _showInsertMarker(zoneKey, x, excludeId = null) {
    const doc = globalThis.document;
    const container = zoneKey ? this._zoneContainer(zoneKey) : null;
    if (!doc || !container) { this._hideInsertMarker(); return; }
    const els = this._zoneUnitEls(zoneKey, excludeId);
    const idx = this._insertIndex(zoneKey, x, excludeId);
    const vertical = this._isVerticalZone(zoneKey);
    if (!this.insertMarkerEl) {
      this.insertMarkerEl = doc.createElement('div');
      this.insertMarkerEl.className = 'insert-marker';
      doc.body.appendChild(this.insertMarkerEl);
    }
    if (vertical) {
      let py, left, w;
      if (els.length) {
        const rects = els.map(el => el.getBoundingClientRect());
        left = rects[0].left; w = rects[0].width;
        if (idx === 0) py = rects[0].top - 4;
        else if (idx >= rects.length) py = rects[rects.length - 1].bottom + 4;
        else py = (rects[idx - 1].bottom + rects[idx].top) / 2;
      } else {
        const r = (container.querySelector('.unit-slot') || container).getBoundingClientRect();
        py = r.top + r.height / 2; left = r.left; w = r.width;
      }
      this.insertMarkerEl.classList.add('horizontal');
      Object.assign(this.insertMarkerEl.style, { left: `${left}px`, top: `${py - 2}px`, width: `${w}px`, height: '4px', display: 'block' });
      return;
    }
    let px, top, h;
    if (els.length) {
      const rects = els.map(el => el.getBoundingClientRect());
      top = rects[0].top; h = rects[0].height;
      if (idx === 0) px = rects[0].left - 5;
      else if (idx >= rects.length) px = rects[rects.length - 1].right + 5;
      else px = (rects[idx - 1].right + rects[idx].left) / 2;
    } else {
      const slot = container.querySelector('.unit-slot') || container;
      const r = slot.getBoundingClientRect();
      px = r.left + r.width / 2; top = r.top; h = r.height;
    }
    this.insertMarkerEl.classList.remove('horizontal');
    Object.assign(this.insertMarkerEl.style, { left: `${px - 2}px`, top: `${top}px`, width: '', height: `${h}px`, display: 'block' });
  }

  _hideInsertMarker() {
    if (this.insertMarkerEl) this.insertMarkerEl.style.display = 'none';
  }

  _tryReposition(instanceId, loc, elemBelow, x) {
    const own = loc.zoneType === 'SUPPORT' ? 'SUPPORT' : loc.zoneKey;
    const dropZone = this._zoneKeyOfElement(elemBelow);
    if (!dropZone || dropZone !== own) return false;
    const toIndex = this._insertIndex(own, x, instanceId);
    this.onAction({ type: 'REPOSITION', playerId: this.localPlayerId, payload: { cardInstanceId: instanceId, toIndex } });
    return true;
  }

  _computeUnitLegalTargets(unit, loc) {
    this.legalMoveTargets = [];
    this.legalAttackTargets = [];
    const bf = this.gameState?.battlefield;
    if (!bf) return;

    // 1. Legal Move Destinations（与规则引擎一致：粮草、刚部署、白毦军换位等）
    this.legalMoveTargets = getUnitMoveZones(this.gameState, unit, loc);

    // 2. Legal Attack Targets via Authoritative combat.getValidTargets
    const hasDoubleStrike = hasKeyword(unit, KEYWORDS.FEN_ZHAN);
    const maxAttacks = hasDoubleStrike ? 2 : 1;
    const canAttack = !unit.status?.[STATUS_TYPES.ATTACKED_THIS_TURN] || (unit.status?.attacksThisTurn || 0) < maxAttacks;

    if (canAttack) {
      this.legalAttackTargets = getValidTargets(this.gameState, unit.instanceId);
    }
  }

  _highlightUnitTargets(active) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    doc.querySelectorAll('.legal-move-target, .legal-attack-target').forEach(el => {
      el.classList?.remove('legal-move-target', 'legal-attack-target');
    });

    if (!active) return;

    // Highlight moves
    for (const targetZone of this.legalMoveTargets) {
      if (targetZone === 'SUPPORT') {
        const sup = doc.getElementById('line-support-friendly');
        if (sup) sup.classList.add('legal-move-target');
      } else {
        const zk = targetZone.replace('FRONTLINE_', '').toLowerCase();
        const zoneEl = doc.getElementById(`zone-${zk}`) || doc.querySelector(`[data-zone="FRONTLINE_${targetZone.replace('FRONTLINE_', '')}"]`);
        if (zoneEl) zoneEl.classList.add('legal-move-target');
      }
    }

    // Highlight attacks
    for (const targetId of this.legalAttackTargets) {
      if (targetId === 'HQ') {
        const oppHq = doc.getElementById('slot-opp-hq') || doc.querySelector('.line-opp .hq-slot, .slot-opp-hq');
        if (oppHq) oppHq.classList.add('legal-attack-target');
      } else {
        const uEl = doc.querySelector(`.board-unit[data-instance-id="${targetId}"]`);
        if (uEl) {
          uEl.classList?.add('legal-attack-target');
          const parentSlot = uEl.closest('.unit-slot');
          if (parentSlot) parentSlot.classList?.add('legal-attack-target');
        }
      }
    }
  }

  // ==========================================
  // Pointer Movement & SVG Targeting Curve
  // ==========================================
  _handlePointerMove(e) {
    if (this.dragPointerId !== null && (e.pointerId === undefined || e.pointerId === this.dragPointerId)) {
      const dx = (e.clientX ?? 0) - this.dragStartPos.x;
      const dy = (e.clientY ?? 0) - this.dragStartPos.y;
      const dist = Math.hypot(dx, dy);

      const threshold = (e.pointerType && e.pointerType !== 'mouse') ? 14 : 6;
      if (!this.isDragging && dist > threshold) {
        this.isDragging = true;
        CardInspector.hide();
        globalThis.document?.body?.classList.add('is-dragging');
        if (this.state === INTERACTION_STATE.CARD_SELECTED && this.selectedCard) {
          this._createCardGhost(this.selectedCard.instanceId, e.clientX ?? 0, e.clientY ?? 0);
        }
      }

      if (this.isDragging && this.dragGhostEl) {
        const small = globalThis.document?.body?.classList.contains('m-land');
        this.dragGhostEl.style.transform = small
          ? `translate(${(e.clientX ?? 0) - 35}px, ${(e.clientY ?? 0) - 95}px) scale(0.6)`
          : `translate(${(e.clientX ?? 0) - 45}px, ${(e.clientY ?? 0) - 60}px) scale(0.9)`;
        this.dragGhostEl.style.transformOrigin = 'top left';
      }
    }

    this._lastPointer = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    if (this.isDragging) {
      const doc = globalThis.document;
      const below = doc?.elementFromPoint?.(e.clientX ?? 0, e.clientY ?? 0);
      const zk = this._zoneKeyOfElement(below);
      if (this.repositionOnly || (this.state === INTERACTION_STATE.TARGETING && this.selectedUnit)) {
        const u = this.repositionOnly || this.selectedUnit;
        const own = u.loc.zoneType === 'SUPPORT' ? 'SUPPORT' : u.loc.zoneKey;
        const moveOk = zk && zk !== own && this.legalMoveTargets?.some(t => t === `FRONTLINE_${zk}` || t === zk);
        if (zk === own || moveOk) this._showInsertMarker(zk, e.clientX ?? 0, u.instanceId); else this._hideInsertMarker();
      } else if (this.state === INTERACTION_STATE.CARD_SELECTED && this.selectedCard?.cardDef?.type === 'UNIT') {
        if (zk && this.legalDropZones.has(zk)) this._showInsertMarker(zk, e.clientX ?? 0); else this._hideInsertMarker();
      }
    }
    if (this.repositionOnly) return;
    if (this.pendingTactic) { this._previewPendingAt(e.clientX ?? 0, e.clientY ?? 0); return; }
    // 手机：点按只选中，不出箭头；真正拖动时才画箭头
    if (e.pointerType && e.pointerType !== 'mouse' && !this.isDragging) return;
    if (this.state === INTERACTION_STATE.CARD_SELECTED && this.selectedCard) this._updateCardTargetingCurve(e.clientX ?? 0, e.clientY ?? 0);
    else if (this.state === INTERACTION_STATE.TARGETING && this.selectedUnit) this._updateTargetingCurve(e.clientX ?? 0, e.clientY ?? 0);
  }

  _updateCardTargetingCurve(pointerX, pointerY) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const cardEl = doc?.querySelector(`.card-hand[data-instance-id="${this.selectedCard?.instanceId}"]`);
    this._drawPointerCurve(cardEl, pointerX, pointerY, true);
  }

  _updateTargetingCurve(pointerX, pointerY) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const unitEl = doc?.querySelector(`.board-unit[data-instance-id="${this.selectedUnit?.instanceId}"]`);
    this._drawPointerCurve(unitEl, pointerX, pointerY, false);
  }

  _drawPointerCurve(sourceEl, pointerX, pointerY, isHandCard) {
    if (!this.svgOverlay || !this.targetingCurve) return;
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc || !sourceEl) return;

    const sourceRect = typeof sourceEl.getBoundingClientRect === 'function'
      ? sourceEl.getBoundingClientRect()
      : { left: 100, top: 400, width: 90, height: 130 };
    const svgRect = typeof this.svgOverlay.getBoundingClientRect === 'function'
      ? this.svgOverlay.getBoundingClientRect()
      : { left: 0, top: 0 };

    const startX = sourceRect.left + sourceRect.width / 2 - svgRect.left;
    const startY = sourceRect.top + sourceRect.height / 2 - svgRect.top;
    const endX = pointerX - svgRect.left;
    const endY = pointerY - svgRect.top;

    const dx = endX - startX;
    const dy = endY - startY;

    // Cubic Bezier curve control points
    const c1x = startX + dx * 0.25;
    const c1y = startY + dy * 0.75 - Math.min(60, Math.abs(dx) * 0.3);
    const c2x = startX + dx * 0.75;
    const c2y = startY + dy * 0.9 - Math.min(30, Math.abs(dx) * 0.15);

    const d = `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    this.targetingCurve.setAttribute('d', d);

    // Identify hover element under pointer
    const elemBelow = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(pointerX, pointerY) : null;
    const attackTarget = !isHandCard && this._attackTargetAt(pointerX, pointerY, elemBelow);
    const moveTarget = elemBelow?.closest?.(isHandCard ? '.legal-drop-highlight' : '.legal-move-target');

    this.targetingCurve.classList?.remove('curve-attack', 'curve-move', 'curve-neutral');
    if (!isHandCard && attackTarget && this.selectedUnit) {
      const tEl = attackTarget === 'HQ' ? doc.getElementById('slot-opp-hq') : doc.querySelector(`.board-unit[data-instance-id="${attackTarget}"]`);
      const fd = attackTarget !== 'HQ' && tEl?.dataset?.isFaceDown === 'true';
      this._previewFor({ type: ACTION_TYPES.ATTACK, playerId: this.localPlayerId, payload: { attackerId: this.selectedUnit.instanceId, targetId: attackTarget } }, tEl, fd);
    } else if (isHandCard && this.selectedCard?.cardDef?.type === 'TACTIC') {
      const uEl = elemBelow?.closest?.('.board-unit');
      const ids = this._cardTargetIds;
      if (uEl && ids?.includes(uEl.dataset.instanceId)) {
        this._previewFor({ type: ACTION_TYPES.PLAY_TACTIC, playerId: this.localPlayerId, payload: { cardInstanceId: this.selectedCard.instanceId, targetId: uEl.dataset.instanceId } }, uEl);
      } else this._hidePreview();
    } else this._hidePreview();
    if (attackTarget) {
      this.targetingCurve.classList?.add('curve-attack');
      this.targetingCurve.setAttribute('marker-end', 'url(#arrowhead-attack)');
    } else if (moveTarget) {
      this.targetingCurve.classList?.add('curve-move');
      this.targetingCurve.setAttribute('marker-end', 'url(#arrowhead-legal)');
    } else {
      this.targetingCurve.classList?.add('curve-neutral');
      this.targetingCurve.removeAttribute('marker-end');
    }
  }

  _clearTargetingCurve() {
    if (this.targetingCurve) {
      this.targetingCurve.setAttribute('d', '');
      this.targetingCurve.removeAttribute('marker-end');
      if (this.targetingCurve.className?.baseVal !== undefined) {
        this.targetingCurve.className.baseVal = 'targeting-curve';
      } else if (this.targetingCurve.classList) {
        this.targetingCurve.className = 'targeting-curve';
      }
    }
  }

  // ==========================================
  // Pointer Up & Action Execution
  // ==========================================
  _handlePointerUp(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (this.dragPointerId === null || (e.pointerId !== undefined && e.pointerId !== this.dragPointerId)) return;

    this.dragPointerId = null;
    this._removeCardGhost();
    this._hideInsertMarker();
    this._lastPointer = { x: e.clientX ?? 0, y: e.clientY ?? 0 };

    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const elemBelow = typeof doc?.elementFromPoint === 'function' ? doc.elementFromPoint(e.clientX ?? 0, e.clientY ?? 0) : null;

    if (this.repositionOnly) {
      const r = this.repositionOnly;
      this.repositionOnly = null;
      const dragged = this.isDragging;
      this.isDragging = false;
      doc?.body?.classList.remove('is-dragging');
      if (!dragged) { this._showToast(r.reason); this._triggerShake(r.el); }
      else this._tryReposition(r.instanceId, r.loc, elemBelow, e.clientX ?? 0);
      return;
    }

    // Case A: Hand Card Drop
    if (this.state === INTERACTION_STATE.CARD_SELECTED && this.selectedCard) {
      if (this.isDragging) {
        const dropZone = this._resolveDropZone(elemBelow);
        if (dropZone && this.legalDropZones.has(dropZone)) {
          this._dragged = true;
          this._dispatchDeploy(this.selectedCard.instanceId, dropZone);
          this._dragged = false;
        } else {
          this.cancelSelection();
        }
      }
      return;
    }

    // Case B: Unit Target Drop
    if (this.state === INTERACTION_STATE.TARGETING && this.selectedUnit) {
      if (this.isDragging) {
        const targetId = this._attackTargetAt(e.clientX ?? 0, e.clientY ?? 0, elemBelow);
        const moveTarget = elemBelow?.closest?.('.legal-move-target');

        if (targetId) {
          this._dispatchAttack(targetId);
          return;
        }

        if (moveTarget) {
          const zoneKey = moveTarget.dataset?.zoneKey ||
            (moveTarget.dataset?.zone ? moveTarget.dataset.zone.replace('FRONTLINE_', '') : null) ||
            (moveTarget.classList?.contains('line-support') ? 'SUPPORT' : null);
          if (zoneKey) {
            this._dispatchMove(zoneKey);
            return;
          }
        }
        const sel = this.selectedUnit;
        // 手指抖动/拖回自己身上：保持选中，而不是悄悄取消
        const selfEl = elemBelow?.closest?.('.board-unit');
        if (sel && selfEl?.dataset?.instanceId === sel.instanceId) {
          this.isDragging = false;
          globalThis.document?.body?.classList.remove('is-dragging');
          if (e.pointerType && e.pointerType !== 'mouse') this._clearTargetingCurve();
          return;
        }
        if (this._explainIllegalTarget(elemBelow)) {
          this.isDragging = false;
          globalThis.document?.body?.classList.remove('is-dragging');
          if (e.pointerType && e.pointerType !== 'mouse') this._clearTargetingCurve();
          return;
        }
        this.cancelSelection();
        if (sel) this._tryReposition(sel.instanceId, sel.loc, elemBelow, e.clientX ?? 0);
      }
    }
  }

  _handlePointerCancel() {
    this.cancelSelection();
  }

  _resolveDropZone(elem) {
    if (!elem) return null;
    if (elem.closest?.('#hand-tray')) return null; // 拖回手牌区 = 取消
    const isOnGameSurface = elem.closest?.('#battlefield-main') || elem.closest?.('#player-dock');
    if (this.selectedCard?.cardDef?.type === 'TACTIC' && isOnGameSurface) return 'BATTLEFIELD';
    if (this.selectedCard?.cardDef?.type === 'COUNTER' && isOnGameSurface) return 'COUNTER';
    if (elem.closest?.('#line-support-friendly, .line-friendly')) return 'SUPPORT';
    if (elem.closest?.('#zone-left')) return 'LEFT';
    if (elem.closest?.('#zone-center')) return 'CENTER';
    if (elem.closest?.('#zone-right')) return 'RIGHT';
    if (elem.closest?.('#battlefield-main, .battlefield-viewport')) return 'BATTLEFIELD';
    if (elem.closest?.('#counter-zone, #player-dock')) return 'COUNTER';
    return null;
  }

  // ==========================================
  // Dispatch Actions
  // ==========================================
  _dispatchDeploy(cardInstanceId, targetZone) {
    const card = this.selectedCard?.cardDef;
    this.state = INTERACTION_STATE.ACTION_CONFIRMED;

    if (card && card.type === 'TACTIC') {
      const targets = this.gameState ? getTacticTargets(this.gameState, this.localPlayerId, card) : null;
      if (Array.isArray(targets)) {
        this.cancelSelection();
        if (!targets.length) {
          this._showToast(`【${card.name}】${tacticBlockReason(this.gameState, this.localPlayerId, card) || '当前没有合法目标'}`);
          return;
        }
        const ids = targets.map(t => t.instanceId);
        // 直接把战法拖到某个合法目标上：立即对它释放
        const p = this._lastPointer;
        const dropEl = p && this._dragged ? globalThis.document?.elementFromPoint?.(p.x, p.y)?.closest?.('.board-unit') : null;
        if (dropEl && ids.includes(dropEl.dataset.instanceId)) {
          this.onAction({ type: ACTION_TYPES.PLAY_TACTIC, playerId: this.localPlayerId, payload: { cardInstanceId, targetId: dropEl.dataset.instanceId } });
          return;
        }
        this._beginTacticTargeting(card, ids);
        return;
      }
      this.onAction({
        type: ACTION_TYPES.PLAY_TACTIC,
        playerId: this.localPlayerId,
        payload: { cardInstanceId }
      });
    } else if (card && card.type === 'COUNTER') {
      this.onAction({
        type: ACTION_TYPES.SET_COUNTER,
        playerId: this.localPlayerId,
        payload: { cardInstanceId }
      });
    } else {
      const slotIndex = this._lastPointer ? this._insertIndex(targetZone, this._lastPointer.x) : undefined;
      const skill = card && this.gameState ? getDeployTargets(this.gameState, this.localPlayerId, card) : null;
      if (skill && skill.targets.length) {
        // 进场技能需要选目标：先选目标，再一起部署
        this.cancelSelection();
        this._beginTacticTargeting(card, skill.targets.map(t => t.instanceId), { kind: 'DEPLOY', targetZone, slotIndex, prompt: skill.prompt });
        return;
      }
      this.onAction({
        type: ACTION_TYPES.DEPLOY,
        playerId: this.localPlayerId,
        payload: { cardInstanceId, targetZone, slotIndex }
      });
    }
    this.cancelSelection();
  }

  _beginTacticTargeting(card, targetIds, extra = {}) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    this.pendingTactic = { instanceId: card.instanceId, name: card.name, targetIds, card, kind: 'TACTIC', ...extra };
    this._applyTacticHighlight();
    doc?.querySelector?.(`.card-hand[data-instance-id="${card.instanceId}"]`)?.classList.add('selected');
    this._showToast(extra.prompt ? `【${card.name}】${extra.prompt}（点空白处取消）` : `选择【${card.name}】的目标（点击空白处取消）`);
  }

  _applyTacticHighlight() {
    const doc = globalThis.document;
    if (!this.pendingTactic || !doc) return;
    doc.body?.classList?.add('tactic-targeting');
    for (const id of this.pendingTactic.targetIds) {
      doc.querySelectorAll?.(`.board-unit[data-instance-id="${id}"]`).forEach(el => el.classList.add('legal-tactic-target'));
    }
  }

  _endTacticTargeting() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    this.pendingTactic = null;
    this._hidePreview();
    doc?.body?.classList?.remove('tactic-targeting');
    doc?.querySelectorAll?.('.legal-tactic-target').forEach(el => el.classList.remove('legal-tactic-target'));
  }

  _dispatchMove(targetZoneKey) {
    if (!this.selectedUnit) return;
    this.state = INTERACTION_STATE.ACTION_CONFIRMED;

    const targetZone = targetZoneKey === 'SUPPORT' ? 'SUPPORT' : `FRONTLINE_${targetZoneKey.toUpperCase()}`;
    const slotIndex = this._lastPointer ? this._insertIndex(targetZoneKey.toUpperCase(), this._lastPointer.x, this.selectedUnit.instanceId) : undefined;
    this.onAction({
      type: ACTION_TYPES.MOVE,
      playerId: this.localPlayerId,
      payload: {
        cardInstanceId: this.selectedUnit.instanceId,
        targetZone,
        slotIndex
      }
    });
    this.cancelSelection();
  }

  _dispatchAttack(targetId) {
    if (!this.selectedUnit) return;
    this.state = INTERACTION_STATE.ACTION_CONFIRMED;

    this.onAction({
      type: ACTION_TYPES.ATTACK,
      playerId: this.localPlayerId,
      payload: {
        attackerId: this.selectedUnit.instanceId,
        targetId
      }
    });
    this.cancelSelection();
  }

  // ==========================================
  // End Turn Action with Smart Warnings
  // ==========================================
  handleEndTurnClick() {
    if (this.state === INTERACTION_STATE.DISABLED) return;
    if (!this.gameState || this.gameState.activePlayer !== this.localPlayerId || this.gameState.phase !== 'ACTION') {
      return;
    }

    if (this.suppressEndTurnWarning) {
      this._confirmEndTurn();
      return;
    }

    const warnings = this._checkHighImpactActionsRemaining();
    if (warnings.length > 0) {
      this._showEndTurnWarningModal(warnings);
    } else {
      this._confirmEndTurn();
    }
  }

  _checkHighImpactActionsRemaining() {
    const warnings = [];
    if (!this.gameState) return warnings;

    const player = this.gameState.players?.[this.localPlayerId];
    if (!player) return warnings;

    const units = getAllUnits(this.gameState, this.localPlayerId);

    // 1. Can Attack Check
    const canAttackUnits = units.filter(u => {
      if (u.status?.[STATUS_TYPES.SUPPRESSED] || player.provisions < (u.actionCost ?? 1)) return false;
      const targets = getValidTargets(this.gameState, u.instanceId);
      return targets.length > 0;
    });

    if (canAttackUnits.length > 0) {
      warnings.push(`尚有 ${canAttackUnits.length} 个单位具备进攻能力 (可对敌军或主城发起攻击)`);
    }

    // 2. Prestige Discount Check
    if (!player.prestigeDiscountUsed && player.prestige > 0) {
      const hasUnitInHand = player.hand?.some(c => c.type === 'UNIT');
      if (hasUnitInHand) {
        warnings.push(`本回合【声望减免】尚未利用 (首单部署可减免 ${player.prestige} 粮草)`);
      }
    }

    // 3. Excess Provisions Check
    if (player.provisions >= 3) {
      const playableCards = player.hand?.filter(c => (c.cost ?? 0) <= player.provisions) || [];
      if (playableCards.length > 0) {
        warnings.push(`剩余粮草充沛 (余粮 ${player.provisions}，手牌尚有可打出卡牌)`);
      }
    }

    return warnings;
  }

  _showEndTurnWarningModal(warnings) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc || !doc.body) {
      this._confirmEndTurn();
      return;
    }

    const modal = doc.createElement('div');
    modal.className = 'modal-overlay warning-overlay';
    modal.innerHTML = `
      <div class="modal-box warning-box">
        <h3 class="modal-title">军师谏言</h3>
        <p class="modal-subtitle">战机稍纵即逝，确认此刻鸣金休整吗？</p>
        <ul class="warning-list">
          ${warnings.map(w => `<li>⚠️ ${w}</li>`).join('')}
        </ul>
        <label class="warning-checkbox-row">
          <input type="checkbox" id="chk-suppress-turn-warn">
          <span>本次对局不再提示</span>
        </label>
        <div class="modal-actions">
          <button id="btn-warn-confirm" class="modal-btn btn-danger">坚决结束回合</button>
          <button id="btn-warn-cancel" class="modal-btn btn-secondary">继续思考行动</button>
        </div>
      </div>
    `;

    doc.body.appendChild(modal);

    modal.querySelector('#btn-warn-confirm')?.addEventListener('click', () => {
      const chk = modal.querySelector('#chk-suppress-turn-warn');
      if (chk && chk.checked) this.suppressEndTurnWarning = true;
      modal.remove();
      this._confirmEndTurn();
    });

    modal.querySelector('#btn-warn-cancel')?.addEventListener('click', () => {
      modal.remove();
    });
  }

  _confirmEndTurn() {
    this.cancelSelection();
    this.state = INTERACTION_STATE.DISABLED;
    this.onAction({
      type: ACTION_TYPES.END_TURN,
      playerId: this.localPlayerId,
      payload: {}
    });
  }

  // ==========================================
  // Cleanup & Ghost Card Helpers
  // ==========================================
  cancelSelection() {
    globalThis.document?.body?.classList.remove('is-dragging');
    this._hideSkillButton?.();
    this._hidePreview?.();
    this.selectedCard = null;
    this.selectedUnit = null;
    this.legalDropZones.clear();
    this.legalMoveTargets = [];
    this.legalAttackTargets = [];

    this._highlightLegalDropZones(false);
    this._highlightUnitTargets(false);
    this._clearTargetingCurve();
    this._removeCardGhost();

    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (doc) {
      doc.querySelectorAll('.card-hand.selected, .board-unit.unit-acting-active').forEach(el => {
        el.classList?.remove('selected', 'unit-acting-active');
      });
    }

    if (this.state !== INTERACTION_STATE.DISABLED) {
      this.state = INTERACTION_STATE.IDLE;
    }
  }

  _createCardGhost(instanceId, x, y) {
    this._removeCardGhost();
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc || !doc.body) return;

    const orig = doc.querySelector(`.card-hand[data-instance-id="${instanceId}"]`);
    if (!orig || typeof orig.cloneNode !== 'function') return;

    this.dragGhostEl = orig.cloneNode(true);
    this.dragGhostEl.classList?.add('card-drag-ghost');
    this.dragGhostEl.style.position = 'fixed';
    this.dragGhostEl.style.left = '0px';
    this.dragGhostEl.style.top = '0px';
    this.dragGhostEl.style.margin = '0';
    this.dragGhostEl.style.pointerEvents = 'none';
    this.dragGhostEl.style.zIndex = '9999';
    this.dragGhostEl.style.transform = `translate(${x - 45}px, ${y - 60}px) scale(0.9)`;
    doc.body.appendChild(this.dragGhostEl);
  }

  _removeCardGhost() {
    globalThis.document?.body?.classList.remove('is-dragging');
    if (this.dragGhostEl) {
      this.dragGhostEl.remove();
      this.dragGhostEl = null;
    }
  }

  _triggerShake(el) {
    if (!el || !el.classList) return;
    el.classList.remove('anim-shake');
    if (typeof el.offsetWidth !== 'undefined') void el.offsetWidth;
    el.classList.add('anim-shake');
    setTimeout(() => el.classList.remove('anim-shake'), 400);
  }

  _showToast(msg) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc || !doc.body) return;

    const toast = doc.createElement('div');
    toast.className = 'toast-alert';
    toast.textContent = msg;
    (doc.getElementById('game-app') || doc.body).appendChild(toast);
    setTimeout(() => toast.classList?.add('toast-show'), 10);
    setTimeout(() => {
      toast.classList?.remove('toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }
}

export default InteractionController;
