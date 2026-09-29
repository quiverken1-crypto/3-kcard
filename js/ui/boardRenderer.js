/**
 * boardRenderer.js — Battlefield Grid, Support Lines, Frontline Zones & HUD Renderer
 * Three Kingdoms KARDS (Milestone 4)
 *
 * Implements:
 * 1. renderBoard: Complete battlefield layout orchestrator (Support + 3 Frontline Zones).
 * 2. renderSupportLine: Support line slots (1 HQ Fortress + 4 Units).
 * 3. renderFrontlineZone: Dynamic terrain banners, occupant flags, capacity, and unit track.
 * 4. renderResourceHUD: Top Bar Opponent HUD and Bottom Player Dock Resource Gauge.
 * 5. FloatingCombatFX: Damage numbers, counter/immune floats, attack trajectories, fire splash.
 */

import { unitHasUsefulAction } from '../engine/unitOptions.js';
import {
  renderHandCard,
  renderHiddenCard,
  renderUnitOnBoard,
  escapeHtml
} from './cardRenderer.js';
import { KEYWORDS, hasKeyword } from '../engine/constants.js';
import { getAttackValue, getActionCost, qiMouDiscount } from '../engine/cardSkills.js';
import { kingdomOf, seatChar } from './seats.js';

export const TERRAIN_EFFECTS = Object.freeze({
  PLAIN: { short: '容纳3 · 无特殊效果', detail: '平原：容纳3个单位，无特殊效果。' },
  WATER: { short: '容纳4 · 水军如鱼得水', detail: '水域：容纳4个单位。只有水军（及可视为水军的关羽）能在此同时移动和攻击。' },
  FOREST: { short: '容纳2 · 先登 · 惧火', detail: '林地：容纳2个单位。此处单位获得【先登】；此处单位受到的火攻伤害翻倍（埋伏一手，但是怕火）。' },
  PASS: { short: '容纳2 · 坚阵+1 · 限击1次', detail: '险关：容纳2个单位。此处单位获得坚阵+1，每回合最多被攻击1次（易守难攻）。' },
  MOUNTAIN: { short: '容纳2 · 皆为步兵 · 矢石', detail: '山地：容纳2个单位。此处所有单位视为步兵，并获得【矢石】（行路艰难，但是居高临下）。另：无当飞军行动-1，黄忠战力+2并获先登。' }
});

/** 单位在当前地形获得的地利提示 */
function terrainTagFor(state, unit, zoneKey) {
  const terrain = zoneKey ? state?.battlefield?.frontline?.[zoneKey]?.terrain?.type : null;
  if (!terrain || unit.status?.inhibited) return '';
  const id = String(unit.cardId || '').replace(/_[0-9]+$/, '');
  if (terrain === 'MOUNTAIN') {
    if (id === 'shu_huang_zhong') return '⛰ 步兵·矢石·战力+2·先登';
    if (id === 'shu_wu_dang_fei_jun') return '⛰ 步兵·矢石·行动-1';
    return '⛰ 步兵·矢石';
  }
  if (terrain === 'FOREST') return '🌲 先登·惧火';
  if (terrain === 'PASS') return unit._attackedOnTurn === state.turnNumber ? '🏯 本回合已受击' : '🏯 险关';
  if (terrain === 'WATER' && (unit.troopType === 'NAVY' || id === 'shu_guan_yu')) return '🌊 如鱼得水';
  return '';
}

function liveStats(state, unit, zoneKey = null) {
  if (!state) return {};
  try {
    return { effectiveAtk: getAttackValue(state, unit), actionCost: getActionCost(state, unit), terrainTag: terrainTagFor(state, unit, zoneKey) };
  } catch (_) { return {}; }
}

export function getPrestigeDiscountStatus(player, isActiveTurn = true) {
  if (!player || player.prestige <= 0) return { state: 'inactive', text: '暂无声望减费' };
  if (player.prestigeDiscountUsed) return { state: 'used', text: '本回合减免已使用' };
  const amount = player.prestige;
  if (!isActiveTurn) return { state: 'pending', text: `下回合首单减免 -${amount}` };
  const units = (player.hand || []).filter(card => card.type === 'UNIT');
  if (!units.length) return { state: 'pending', text: `减免 -${amount} 待用·无单位手牌` };
  if (!units.some(card => Math.max(0, (card.cost ?? 0) - amount) <= player.provisions)) {
    return { state: 'pending', text: `减免 -${amount} 待用·粮草不足` };
  }
  return { state: 'ready', text: `首单减免 -${amount} 可用` };
}

export function getTerrainIcon(terrainType) {
  const map = {
    'PLAIN': '🌾',
    'WATER': '🌊',
    'MOUNTAIN': '⛰️',
    'FOREST': '🌲',
    'PASS': '🏯'
  };
  return Object.hasOwn(map, terrainType) ? map[terrainType] : '🌾';
}

export function getZoneNameLabel(zoneKey) {
  const map = {
    'LEFT': '左前线',
    'CENTER': '中前线',
    'RIGHT': '右前线'
  };
  return Object.hasOwn(map, zoneKey) ? map[zoneKey] : zoneKey;
}

/**
 * Checks if a unit can legally take an action.
 */
function checkUnitCanAct(unit, player, activePlayer, viewerFaction, state = null) {
  if (!unit || unit.faction !== viewerFaction || activePlayer !== viewerFaction) return false;
  // 实时判定：还有有效的攻击目标或可移动的位置才亮起
  if (state) return unitHasUsefulAction(state, unit);
  if (unit.status?.suppressed) return false;
  if (unit.status?.deployedThisTurn && !hasKeyword(unit, KEYWORDS.TU_XI)) return false;
  if (player && player.provisions < (unit.actionCost ?? 1)) return false;
  const maxAttacks = hasKeyword(unit, KEYWORDS.FEN_ZHAN) ? 2 : 1;
  const canAttack = !unit.status?.attackedThisTurn || (unit.status?.attacksThisTurn || 0) < maxAttacks;
  const canMove = !unit.status?.movedThisTurn && (unit.status?.actionsUsed === 0 || unit.troopType === 'CAVALRY');
  return canAttack || canMove;
}

/**
 * Renders the entire battlefield board based on state.
 * @param {HTMLElement} container - Container element (#battlefield-main)
 * @param {object} state - GameState / MaskedGameState
 * @param {string} viewerFaction - 'WEI' | 'SHU'
 * @param {object} [options={}]
 */
export function renderBoard(container, state, viewerFaction = 'WEI', options = {}) {
  options = { ...options, state };
  if (!state || !container) return;

  const oppFaction = viewerFaction === 'WEI' ? 'SHU' : 'WEI';
  const bf = state.battlefield;
  if (!bf) return;

  // 1. Render Opponent Support Line (North)
  const oppSupportEl = container.querySelector('#line-support-opp');
  if (oppSupportEl && bf.support?.[oppFaction]) {
    renderSupportLine(oppSupportEl, bf.support[oppFaction], oppFaction, true, {
      ...options,
      activePlayer: state.activePlayer,
      viewerFaction
    });
  }

  // 2. Render Frontline 3 Parallel Zones (Left, Center, Right)
  const zoneLeftEl = container.querySelector('#zone-left');
  const zoneCenterEl = container.querySelector('#zone-center');
  const zoneRightEl = container.querySelector('#zone-right');

  if (zoneLeftEl && bf.frontline?.LEFT) {
    renderFrontlineZone(zoneLeftEl, 'LEFT', bf.frontline.LEFT, {
      ...options,
      activePlayer: state.activePlayer,
      viewerFaction
    });
  }
  if (zoneCenterEl && bf.frontline?.CENTER) {
    renderFrontlineZone(zoneCenterEl, 'CENTER', bf.frontline.CENTER, {
      ...options,
      activePlayer: state.activePlayer,
      viewerFaction
    });
  }
  if (zoneRightEl && bf.frontline?.RIGHT) {
    renderFrontlineZone(zoneRightEl, 'RIGHT', bf.frontline.RIGHT, {
      ...options,
      activePlayer: state.activePlayer,
      viewerFaction
    });
  }

  // 3. Render Friendly Support Line (South)
  const friendlySupportEl = container.querySelector('#line-support-friendly');
  if (friendlySupportEl && bf.support?.[viewerFaction]) {
    renderSupportLine(friendlySupportEl, bf.support[viewerFaction], viewerFaction, false, {
      ...options,
      activePlayer: state.activePlayer,
      viewerFaction
    });
  }

  // 4. Render Player Hand Cards
  const handContainer = document.getElementById('hand-container');
  if (handContainer && state.players?.[viewerFaction]?.hand) {
    renderHandFan(handContainer, state.players[viewerFaction], { ...options, tacticDiscount: qiMouDiscount(state, viewerFaction) });
  }
}

/**
 * Renders a support line (North or South).
 * @param {HTMLElement} lineEl
 * @param {object} supportData - { hq, slots }
 * @param {string} faction - 'WEI' | 'SHU'
 * @param {boolean} isOpponent
 * @param {object} options
 */
export function renderSupportLine(lineEl, supportData, faction, isOpponent, options = {}) {
  const hq = supportData.hq;
  const slots = supportData.slots || [];

  // Update HQ Slot
  const hqSlotId = isOpponent ? 'slot-opp-hq' : 'slot-friendly-hq';
  const hqSlot = lineEl.querySelector(`#${hqSlotId}`) || lineEl.querySelector('.hq-slot');
  if (hqSlot && hq) {
    const isDanger = hq.hp <= 5;
    const isDamaged = hq.hp < hq.maxHp;
    hqSlot.className = `slot hq-slot ${isOpponent ? 'slot-opp-hq' : 'slot-friendly-hq'} ${isDanger ? 'fortress-danger' : ''}`;
    hqSlot.dataset.targetId = 'HQ';
    hqSlot.dataset.faction = faction;

    const hpText = `${hq.hp} / ${hq.maxHp}`;
    const hqName = escapeHtml(hq.name || (faction === 'WEI' ? '许昌大本营' : '成都大本营'));

    hqSlot.innerHTML = `
      <div class="hq-card-view ${isOpponent ? 'hq-opp-view' : 'hq-friendly-view'}">
        <div class="hq-crest">🏯</div>
        <div class="hq-info">
          <div class="hq-title">${hqName}</div>
          ${Array.isArray(hq.terrains) ? `<div class="hq-terrains">${hq.terrains.map(t => `<i class="terrain-chip chip-${String(t).toLowerCase()}">${({ PLAIN: '平原', WATER: '水域', FOREST: '林地', MOUNTAIN: '山地', PASS: '险关' })[t] || t}</i>`).join('')}</div>` : ''}
          <div class="hq-hp-chip ${isDamaged ? 'val-damaged' : ''}">HP ${hq.hp}</div>
        </div>
      </div>
    `;
  }

  // Update 4 Unit Slots
  for (let i = 0; i < 4; i++) {
    const slotSelector = isOpponent ? `#slot-opp-sup-${i}` : `#slot-friendly-sup-${i}`;
    const slotEl = lineEl.querySelector(slotSelector) || lineEl.querySelectorAll('.unit-slot')[i];
    if (!slotEl) continue;

    slotEl.innerHTML = '';
    const unit = slots[i];
    if (unit) {
      slotEl.className = 'slot unit-slot slot-occupied';
      const unitEl = renderUnitOnBoard(unit, {
        ...liveStats(options.state, unit),
        canAct: !isOpponent && checkUnitCanAct(unit, options.player, options.activePlayer, options.viewerFaction, options.state),
        isSelected: options.selectedUnitId === unit.instanceId,
        isValidTarget: options.validTargetIds?.includes(unit.instanceId),
        viewerFaction: options.viewerFaction
      });
      slotEl.appendChild(unitEl);
    } else {
      slotEl.className = 'slot unit-slot slot-empty';
    }
  }
}

/**
 * Renders a Frontline Zone (LEFT, CENTER, RIGHT).
 * @param {HTMLElement} zoneEl
 * @param {string} zoneKey - 'LEFT' | 'CENTER' | 'RIGHT'
 * @param {object} zoneData - { zone, occupant, terrain, capacity, units }
 * @param {object} options
 */
export function renderFrontlineZone(zoneEl, zoneKey, zoneData, options = {}) {
  const occupant = zoneData.occupant;
  const terrain = zoneData.terrain || { name: '平原', type: 'PLAIN', capacity: 3 };
  const capacity = zoneData.capacity || terrain.capacity || 3;
  const units = zoneData.units || [];

  const occupantClass = occupant ? `occupant-${occupant.toLowerCase()}` : 'occupant-neutral';
  const terrainTypeClass = `terrain-${terrain.type ? terrain.type.toLowerCase() : 'plain'}`;

  // Keep frontline-zone and zone classes, update terrain and occupant
  zoneEl.className = `frontline-zone ${terrainTypeClass} ${occupantClass}`;
  zoneEl.dataset.zone = `FRONTLINE_${zoneKey}`;

  // Update Banner
  const occupantText = occupant ? `${seatChar(occupant)}军占领` : '中立空置';
  const banner = zoneEl.querySelector('.zone-terrain-banner');
  if (banner) {
    banner.innerHTML = `
      <div class="terrain-identity">
        <span class="terrain-icon">${getTerrainIcon(terrain.type)}</span>
        <span class="terrain-name">${escapeHtml(terrain.name)}</span>
      </div>
      <div class="zone-occupant-badge ${occupant ? `badge-${occupant.toLowerCase()}` : 'occupant-neutral'}" title="区域占领状态">
        <span class="occupant-text">${occupantText}</span>
      </div>
      <div class="zone-capacity-tag" title="区域容量上限">
        <span class="cap-current">${units.length}</span>/<span class="cap-max">${capacity}</span>
      </div>
      <div class="terrain-effect-line">${escapeHtml((TERRAIN_EFFECTS[terrain.type] || TERRAIN_EFFECTS.PLAIN).short)}</div>
    `;
    banner.title = (TERRAIN_EFFECTS[terrain.type] || TERRAIN_EFFECTS.PLAIN).detail;
  }

  // Update Slots Container
  const slotsContainer = zoneEl.querySelector('.zone-slots-container') || zoneEl.querySelector('.zone-units-track');
  if (slotsContainer) {
    slotsContainer.innerHTML = '';
    for (let i = 0; i < capacity; i++) {
      const slotDiv = document.createElement('div');
      slotDiv.className = `slot unit-slot frontline-slot ${units[i] ? 'slot-occupied' : 'slot-empty'}`;
      slotDiv.dataset.zone = `FRONTLINE_${zoneKey}`;
      slotDiv.dataset.slot = String(i);

      if (units[i]) {
        const isFriendly = units[i].faction === options.viewerFaction;
        const unitEl = renderUnitOnBoard(units[i], {
          ...liveStats(options.state, units[i], zoneKey),
          canAct: isFriendly && checkUnitCanAct(units[i], options.player, options.activePlayer, options.viewerFaction, options.state),
          isSelected: options.selectedUnitId === units[i].instanceId,
          isValidTarget: options.validTargetIds?.includes(units[i].instanceId),
          viewerFaction: options.viewerFaction
        });
        slotDiv.appendChild(unitEl);
      }
      slotsContainer.appendChild(slotDiv);
    }
  }
}

/**
 * Renders player hand cards fan into #hand-container.
 */
export function renderHandFan(container, playerData, options = {}) {
  container.innerHTML = '';
  const hand = playerData.hand || [];

  const prestigeDiscount = (!playerData.prestigeDiscountUsed && playerData.prestige > 0)
    ? playerData.prestige
    : 0;
  const tacticDiscount = options.tacticDiscount || 0;

  const cardEls = [];
  hand.forEach((card) => {
    const cardEl = renderHandCard(card, {
      ...options,
      prestigeDiscount,
      tacticDiscount
    });
    container.appendChild(cardEl);
    cardEls.push(cardEl);
  });

  // A readable row gives every card its own full-size pointer target.
  fitHandStrip(container);
}

/**
 * 手机：手牌放不下时才叠压，且只叠压刚好需要的量（按实际渲染尺寸计算，兼容 iOS 的 zoom 差异）。
 */
export function fitHandStrip(container = document.getElementById('hand-container')) {
  if (!container) return;
  const cards = [...container.querySelectorAll('.card-hand')];
  cards.forEach(c => { c.style.marginLeft = ''; c.style.zoom = ''; });
  container.classList.remove('hand-dense', 'hand-scroll');
  container.parentElement?.classList.remove('hand-tray-scroll');
  if (!document.body.classList.contains('m-land') || cards.length < 2) return;
  // 手牌不再互相叠压：放不下时按比例缩小每张牌（选中的牌会放大显示）
  const tray = container.parentElement || container;
  const avail = tray.clientWidth - 12;
  const first = cards[0].getBoundingClientRect();
  const last = cards[cards.length - 1].getBoundingClientRect();
  const total = last.right - first.left;
  if (!(total > avail)) return;
  const z0 = parseFloat(getComputedStyle(cards[0]).zoom) || 1;
  const gap = cards.length > 1 ? (cards[1].getBoundingClientRect().left - first.right) : 0;
  const widths = total - gap * (cards.length - 1);
  const fit = (avail - gap * (cards.length - 1)) / widths;
  // 缩到 80% 仍放不下：保持 80%，改为左右滑动查看（仍然不叠压）
  const f = Math.max(0.8, fit);
  const z = +(z0 * f).toFixed(3);
  cards.forEach(c => { c.style.zoom = String(z); });
  container.classList.toggle('hand-scroll', fit < 0.8);
  tray.classList.toggle('hand-tray-scroll', fit < 0.8);
  if (fit < 0.8 && !tray._handScrolled) tray.scrollLeft = 0;
  if (!tray._handScrollBound) { tray._handScrollBound = true; tray.addEventListener('scroll', () => { tray._handScrolled = tray.scrollLeft > 0; }, { passive: true }); }
}

/**
 * Renders Top Bar Opponent HUD and Bottom Player Dock Resource Bar.
 * @param {object} state - GameState
 * @param {string} viewerFaction - 'WEI' | 'SHU'
 */
export function renderResourceHUD(state, viewerFaction = 'WEI') {
  if (!state || !state.players) return;

  const oppFaction = viewerFaction === 'WEI' ? 'SHU' : 'WEI';
  const player = state.players[viewerFaction];
  const opp = state.players[oppFaction];
  const oppHq = state.battlefield?.support?.[oppFaction]?.hq;
  const friendlyHq = state.battlefield?.support?.[viewerFaction]?.hq;

  // 1. Opponent Status (Top Bar)
  if (opp) {
    // Faction Badge
    const oppBadge = document.getElementById('opp-faction-badge');
    if (oppBadge) {
      oppBadge.className = `faction-emblem faction-${kingdomOf(oppFaction)}`;
      oppBadge.title = `${seatChar(oppFaction)}阵营`;
      const charEl = oppBadge.querySelector('.faction-char');
      if (charEl) charEl.textContent = seatChar(oppFaction);
    }

    // HQ HP
    if (oppHq) {
      const oppHqName = document.getElementById('opp-hq-name');
      if (oppHqName) oppHqName.textContent = oppHq.name || (oppFaction === 'WEI' ? '许昌' : '成都');

      const oppHpText = document.getElementById('opp-hq-hp-text');
      if (oppHpText) oppHpText.textContent = `${oppHq.hp} / ${oppHq.maxHp}`;

      const oppHpFill = document.getElementById('opp-hp-fill');
      if (oppHpFill) {
        const pct = Math.max(0, Math.min(100, (oppHq.hp / oppHq.maxHp) * 100));
        oppHpFill.style.width = `${pct}%`;
      }
    }

    // Provisions & Prestige
    const oppProvText = document.getElementById('opp-provisions-text');
    if (oppProvText) oppProvText.textContent = `${opp.provisions} / ${opp.provisionsCap}`;

    const oppPrestigeText = document.getElementById('opp-prestige-text');
    if (oppPrestigeText) oppPrestigeText.textContent = String(opp.prestige);

    const oppPrestigePips = document.getElementById('opp-prestige-pips');
    if (oppPrestigePips) {
      oppPrestigePips.innerHTML = `
        <span class="pip ${opp.prestige >= 1 ? 'pip-lit' : ''}">${opp.prestige >= 1 ? '★' : '☆'}</span>
        <span class="pip ${opp.prestige >= 2 ? 'pip-lit' : ''}">${opp.prestige >= 2 ? '★' : '☆'}</span>
      `;
    }

    // Counts
    const oppHandCount = document.getElementById('opp-hand-count');
    if (oppHandCount) oppHandCount.textContent = `${opp.hand?.length ?? 0} / 9`;

    const oppDeckCount = document.getElementById('opp-deck-count');
    if (oppDeckCount) oppDeckCount.textContent = String(Array.isArray(opp.deck) ? opp.deck.length : (opp.deck?.count ?? 0));

    const oppDiscardCount = document.getElementById('opp-discard-count');
    if (oppDiscardCount) oppDiscardCount.textContent = String(opp.discard?.length ?? 0);
  }

  // 2. Turn & Phase Indicator (Center Header)
  const turnNumText = document.getElementById('turn-number-text');
  if (turnNumText) turnNumText.textContent = `第 ${state.turnNumber || 1} 回合`;

  const phaseNameText = document.getElementById('phase-name-text');
  const phaseIndicator = document.getElementById('turn-phase-indicator');
  const isFriendlyTurn = state.activePlayer === viewerFaction;

  if (phaseNameText) {
    if (state.phase === 'GAME_OVER') {
      phaseNameText.textContent = '对局结束';
    } else {
      phaseNameText.textContent = isFriendlyTurn ? '己方行动' : '敌方行动';
    }
  }
  if (phaseIndicator) {
    phaseIndicator.className = `phase-badge ${isFriendlyTurn ? 'phase-friendly' : 'phase-opponent'}`;
  }

  // 3. Friendly Status (Player Dock)
  if (player) {
    // Faction Badge
    const friendlyBadge = document.getElementById('friendly-faction-badge');
    if (friendlyBadge) {
      friendlyBadge.className = `faction-emblem faction-${kingdomOf(viewerFaction)}`;
      friendlyBadge.title = `${seatChar(viewerFaction)}阵营`;
      const charEl = friendlyBadge.querySelector('.faction-char');
      if (charEl) charEl.textContent = seatChar(viewerFaction);
    }

    // Friendly HQ HP
    if (friendlyHq) {
      const friendlyHpText = document.getElementById('friendly-hq-hp-text');
      if (friendlyHpText) friendlyHpText.textContent = `${friendlyHq.hp} / ${friendlyHq.maxHp}`;

      const friendlyHpFill = document.getElementById('friendly-hp-fill');
      if (friendlyHpFill) {
        const pct = Math.max(0, Math.min(100, (friendlyHq.hp / friendlyHq.maxHp) * 100));
        friendlyHpFill.style.width = `${pct}%`;
      }
    }

    // Double Granary Display
    const granaryText = document.getElementById('granary-numeric-text');
    if (granaryText) {
      const extraTxt = player.extraGranaryCap > 0 ? ` (+${player.extraGranaryCap})` : '';
      granaryText.textContent = `${player.provisions} / ${player.provisionsCap}${extraTxt}`;
    }

    // Granary 10-Pips
    const pipsContainer = document.getElementById('main-granary-pips');
    if (pipsContainer) {
      let pipsHtml = '';
      for (let i = 0; i < 10; i++) {
        const isCap = i < player.mainGranaryCap;
        const isActive = i < player.provisions;
        pipsHtml += `<div class="grain-pip ${isActive ? 'active' : ''} ${!isCap ? 'pip-locked' : ''}"></div>`;
      }
      pipsContainer.innerHTML = pipsHtml;
    }

    // Extra Granary Chip
    const extraChip = document.getElementById('extra-granary-chip');
    const extraVal = document.getElementById('extra-granary-val');
    if (extraChip && extraVal) {
      if (player.extraGranaryCap > 0) {
        extraChip.classList.remove('hidden');
        extraVal.textContent = String(player.extraGranaryCap);
      } else {
        extraChip.classList.add('hidden');
      }
    }

    // Prestige Cluster
    const prestigeNum = document.getElementById('prestige-numeric-text');
    if (prestigeNum) prestigeNum.textContent = `${player.prestige} / 2`;

    const prestigePips = document.getElementById('player-prestige-pips');
    if (prestigePips) {
      prestigePips.innerHTML = `
        <span class="medal-pip ${player.prestige >= 1 ? 'pip-lit' : ''}">${player.prestige >= 1 ? '★' : '☆'}</span>
        <span class="medal-pip ${player.prestige >= 2 ? 'pip-lit' : ''}">${player.prestige >= 2 ? '★' : '☆'}</span>
      `;
    }

    const discountBadge = document.getElementById('prestige-discount-badge');
    if (discountBadge) {
      const status = getPrestigeDiscountStatus(player, state.activePlayer === viewerFaction && state.phase === 'ACTION');
      discountBadge.className = `prestige-discount-chip ${status.state}`;
      discountBadge.textContent = status.text;
      discountBadge.title = status.text;
    }

    // Deck & Discard
    const deckCount = document.getElementById('friendly-deck-count');
    if (deckCount) deckCount.textContent = String(Array.isArray(player.deck) ? player.deck.length : (player.deck?.count ?? 0));

    const discardCount = document.getElementById('friendly-discard-count');
    if (discardCount) discardCount.textContent = String(player.discard?.length ?? 0);
  }
}

/**
 * Floating Combat Text & Dynamic FX
 */
export class FloatingCombatFX {
  /**
   * Spawns floating combat text above a target element.
   * @param {HTMLElement} targetEl
   * @param {string|number} text
   * @param {'normal'|'counter'|'immune'|'banish'|'ambush'|'overflow'|'fire'} type
   */
  static showDamageNumber(targetEl, text, type = 'normal') {
    if (!targetEl || typeof document === 'undefined') return;
    const rect = typeof targetEl.getBoundingClientRect === 'function'
      ? targetEl.getBoundingClientRect()
      : { left: 100, top: 100, width: 80, height: 80 };

    const floatEl = document.createElement('div');
    floatEl.className = `floating-combat-text fx-${type}`;

    let prefix = '';
    if (type === 'counter') prefix = '反击 ';
    else if (type === 'immune') prefix = '免疫 ';
    else if (type === 'banish') prefix = '斩将 斩首!';
    else if (type === 'ambush') prefix = '伏击 先制!';
    else if (type === 'overflow') prefix = '溢出 ';
    else if (type === 'fire') prefix = '火攻 ';

    floatEl.innerText = `${prefix}${text}`;

    const jitterX = (Math.random() - 0.5) * 20;
    floatEl.style.left = `${Math.round(rect.left + rect.width / 2 + jitterX)}px`;
    floatEl.style.top = `${Math.round(rect.top + 10)}px`;

    document.body.appendChild(floatEl);

    if (typeof floatEl.addEventListener === 'function') {
      floatEl.addEventListener('animationend', () => floatEl.remove());
    }
    setTimeout(() => floatEl.remove(), 1300);
  }

  /**
   * Draws an attack trajectory arc between attacker and target.
   * @param {HTMLElement} sourceEl
   * @param {HTMLElement} targetEl
   */
  static showAttackTrajectory(sourceEl, targetEl) {
    if (!sourceEl || !targetEl || typeof document === 'undefined') return;
    const srcRect = typeof sourceEl.getBoundingClientRect === 'function' ? sourceEl.getBoundingClientRect() : { left: 50, top: 50, width: 50, height: 50 };
    const dstRect = typeof targetEl.getBoundingClientRect === 'function' ? targetEl.getBoundingClientRect() : { left: 200, top: 200, width: 50, height: 50 };

    const x1 = srcRect.left + srcRect.width / 2;
    const y1 = srcRect.top + srcRect.height / 2;
    const x2 = dstRect.left + dstRect.width / 2;
    const y2 = dstRect.top + dstRect.height / 2;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'attack-trajectory-overlay');
    svg.style.position = 'fixed';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100vw';
    svg.style.height = '100vh';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '9999';

    const dx = x2 - x1;
    const dy = y2 - y1;
    const cx = (x1 + x2) / 2 - dy * 0.15;
    const cy = (y1 + y2) / 2 + dx * 0.15;

    svg.innerHTML = `
      <defs>
        <linearGradient id="slashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFD700" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#FF4500" stop-opacity="1"/>
        </linearGradient>
      </defs>
      <path class="slash-path" d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" stroke="url(#slashGrad)" stroke-width="4" fill="none" stroke-dasharray="12 6"/>
    `;

    document.body.appendChild(svg);

    if (targetEl.classList) {
      targetEl.classList.add('anim-impact-shake');
    }
    setTimeout(() => {
      svg.remove();
      if (targetEl.classList) targetEl.classList.remove('anim-impact-shake');
    }, 450);
  }

  /**
   * Displays expanding flame shockwave for 火攻 (Fire Attack).
   * @param {HTMLElement} originEl
   * @param {HTMLElement[]} affectedEls
   */
  static showFireSplash(originEl, affectedEls = []) {
    if (!originEl || typeof document === 'undefined') return;
    const rect = typeof originEl.getBoundingClientRect === 'function' ? originEl.getBoundingClientRect() : { left: 100, top: 100, width: 60, height: 60 };

    const fireRing = document.createElement('div');
    fireRing.className = 'fx-fire-shockwave';
    fireRing.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    fireRing.style.top = `${Math.round(rect.top + rect.height / 2)}px`;

    document.body.appendChild(fireRing);
    setTimeout(() => fireRing.remove(), 600);

    affectedEls.forEach(el => {
      if (el && el.classList) {
        el.classList.add('anim-burn');
        setTimeout(() => el.classList.remove('anim-burn'), 800);
      }
    });
  }
}
