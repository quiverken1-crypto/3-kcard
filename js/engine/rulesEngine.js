/**
 * rulesEngine.js — Master Rules Engine, Action Dispatcher & Simulation Orchestrator
 * Conforms to rules_spec.md, tech_architecture.md, and testHarness.js.
 */

import {
  FACTIONS,
  TROOP_TYPES,
  CARD_TYPES,
  PHASES,
  ACTION_TYPES,
  TERRAIN_TYPES,
  TERRAINS,
  ZONE_KEYS,
  ZONES,
  KEYWORDS,
  STATUS_TYPES,
  GAME_CONFIG,
  parseParametricKeyword,
  hasKeyword,
  getKeywordValue
} from './constants.js';
import { PRNG } from './prng.js';
import {
  createCard,
  createCardInstance,
  resetInstanceCounter,
  createInitialState,
  createWeiDeck,
  createShuDeck,
  setupGame,
  executeMulligan,
  startTurn,
  endTurn,
  drawCard,
  adjustPrestige,
  getAllUnits,
  findUnit,
  removeUnitFromBoard,
  serializeState,
  deserializeState,
  cloneState,
  projectStateForClient,
  GameState
} from './state.js';
import {
  validateAttack,
  getValidTargets,
  resolveCombat,
  applySuppression,
  applyInhibition
} from './combat.js';
import {
  actsLikeCavalryOnTerrain,
  getEffectiveActionCost
} from '../data/terrains.js';
import { runAbilityTrigger } from './abilities.js';
import {
  applyEnterKeywords, onUnitEnter, onUnitMoved, prepareTactic, resolveTactic, afterAttack, resolvePick, autoPickCards, randomPickCards, resolveChoice, autoChoiceTarget, activateSkill, canDeployToFrontline, isSiegeEngine,
  processDeaths, getActionCost, actsLikeCavalry as skillActsLikeCavalry, getTacticTargets, refreshAuras, baseId, targetSurcharge, qiMouDiscount, getCardPlayCost
} from './cardSkills.js';

/** 按指定位置插入（部署/移动时可放在区域内任意卡牌之间或两侧） */
function insertAt(arr, item, idx) {
  if (Number.isInteger(idx) && idx >= 0 && idx <= arr.length) arr.splice(idx, 0, item);
  else arr.push(item);
}

const hasConfiguredEffect = (card, trigger, effectType) => card.abilities?.some(ability =>
  ability.trigger === trigger && ability.effects?.some(effect => effect.type === effectType));

// Re-export core constants, PRNG, state & combat functions for unified engine access
export {
  FACTIONS,
  TROOP_TYPES,
  CARD_TYPES,
  PHASES,
  ACTION_TYPES,
  TERRAIN_TYPES,
  TERRAINS,
  ZONE_KEYS,
  ZONES,
  KEYWORDS,
  STATUS_TYPES,
  GAME_CONFIG,
  parseParametricKeyword,
  hasKeyword,
  getKeywordValue,
  PRNG,
  createCard,
  createCardInstance,
  resetInstanceCounter,
  createInitialState,
  createWeiDeck,
  createShuDeck,
  setupGame,
  executeMulligan,
  startTurn,
  endTurn,
  drawCard,
  adjustPrestige,
  getAllUnits,
  findUnit,
  removeUnitFromBoard,
  serializeState,
  deserializeState,
  cloneState,
  projectStateForClient,
  GameState,
  validateAttack,
  getValidTargets,
  resolveCombat,
  applySuppression,
  applyInhibition
};

// ==========================================
// 2. Master Action Dispatcher
// ==========================================

/**
 * Dispatches an action onto the game state.
 * @param {object} state
 * @param {object} action
 * @returns {object}
 */
function dispatchBase(state, action) {
  if (state.phase === PHASES.GAME_OVER) {
    throw new Error('Game is already over');
  }

  const actionType = action.type;

  switch (actionType) {
    case ACTION_TYPES.DEPLOY: {
      const player = state.players[action.playerId];
      const handIdx = player.hand.findIndex(c => c.instanceId === action.payload.cardInstanceId);
      if (handIdx === -1) throw new Error('Card not in hand');

      const card = player.hand[handIdx];
      let cost = card.cost;
      if (card.type === 'UNIT' && player.noDeployNextTurn && player._noDeployActive) throw new Error('辕门射戟：本回合不能部署单位');

      // Dynamic Prestige discount on first unit deployment each turn
      let discountApplied = 0;
      let shouldMarkPrestigeUsed = false;
      if (card.type === 'UNIT' && !player.prestigeDiscountUsed && player.prestige > 0) {
        discountApplied = Math.min(cost, player.prestige);
        cost = Math.max(0, cost - discountApplied);
        shouldMarkPrestigeUsed = true;
      }

      if (player.provisions < cost) {
        throw new Error(`Insufficient provisions (need ${cost}, have ${player.provisions})`);
      }

      const rawTarget = action.payload.targetZone || 'SUPPORT';
      const targetZone = rawTarget.replace('FRONTLINE_', '');

      if (targetZone === 'SUPPORT') {
        const supportSlots = state.battlefield.support[action.playerId].slots;
        if (supportSlots.length >= 4) {
          throw new Error('Support line unit slots are full (max 4 units)');
        }
        player.provisions -= cost;
        player.hand.splice(handIdx, 1);
        insertAt(supportSlots, card, action.payload.slotIndex);
      } else {
        // 直接部署到前线：需要【奇袭】（空置/己方区域），或器械（己方已占领区域）
        if (!canDeployToFrontline(state, card, action.playerId, targetZone)) {
          throw new Error(isSiegeEngine(card) ? '器械只能直接部署到己方已占领且未满的前线区域' : 'Only units with 奇袭 can deploy directly to frontline');
        }
        const zone = state.battlefield.frontline[targetZone];
        if (!zone) throw new Error(`Invalid frontline zone: ${targetZone}`);
        if (zone.occupant !== null && zone.occupant !== action.playerId) {
          throw new Error('Cannot deploy into frontline zone occupied by enemy');
        }
        if (zone.units.length >= zone.capacity) {
          throw new Error('Frontline zone reached capacity');
        }
        player.provisions -= cost;
        player.hand.splice(handIdx, 1);
        zone.occupant = action.playerId;
        insertAt(zone.units, card, action.payload.slotIndex);
      }

      if (shouldMarkPrestigeUsed) {
        player.prestigeDiscountUsed = true;
      }

      // Non-突袭 Deploy Sickness
      card.status[STATUS_TYPES.DEPLOYED_THIS_TURN] = true;
      if (!hasKeyword(card, KEYWORDS.TU_XI)) {
        card.status[STATUS_TYPES.ACTIONS_USED] = 1;
      }

      // Keyword: 潜袭 face down entry
      if (hasKeyword(card, KEYWORDS.QIAN_XI)) {
        card.status[STATUS_TYPES.IS_FACE_DOWN] = true;
      }

      // 进场词条：补给 / 声望X（先加声望再结算卡面效果）
      if (!hasConfiguredEffect(card, 'ON_DEPLOY', 'GAIN_CAPACITY') && !hasConfiguredEffect(card, 'ON_DEPLOY', 'GAIN_PRESTIGE')) {
        applyEnterKeywords(state, card, action.playerId);
      }

      state.combatLog.push({ type: 'DEPLOY', playerId: action.playerId, card, cost, discountApplied, targetZone: targetZone === 'SUPPORT' ? 'SUPPORT' : `FRONTLINE_${targetZone}` });
      onUnitEnter(state, card, { skillTargetId: action.payload?.skillTargetId });
      return { success: true, card, cost, discountApplied };
    }

    case ACTION_TYPES.MOVE: {
      const player = state.players[action.playerId];
      const loc = findUnit(state, action.payload.cardInstanceId);
      if (!loc) throw new Error('Unit not found on battlefield');
      const unit = loc.unit;

      if (unit.faction !== action.playerId) throw new Error('Cannot move opponent unit');
      if (unit.status[STATUS_TYPES.SUPPRESSED]) throw new Error('Suppressed unit cannot move');

      // Check actions/mobility based on troop type & terrain
      const actsLikeCavalry = skillActsLikeCavalry(state, unit, loc);

      if (actsLikeCavalry) {
        if (unit.status[STATUS_TYPES.MOVED_THIS_TURN]) throw new Error('Cavalry can only move once per turn');
        if (unit.status[STATUS_TYPES.DEPLOYED_THIS_TURN] && !hasKeyword(unit, KEYWORDS.TU_XI)) {
          throw new Error('Unit without 突袭 cannot move on the turn it is deployed');
        }
      } else {
        if (unit.status[STATUS_TYPES.ACTIONS_USED] > 0) throw new Error('Infantry can only move or attack once per turn');
      }

      const moveCost = getActionCost(state, unit, loc);
      // 白毦军·断后：目标区域己方已满时，可与其中1名友军换位
      const canSwap = baseId(unit.cardId) === 'shu_bai_er_jun' && !unit.status?.[STATUS_TYPES.INHIBITED];
      let swapped = null;
      const trySwap = (zoneObj) => {
        if (!canSwap || zoneObj.units.length < zoneObj.capacity || zoneObj.occupant !== action.playerId) return false;
        swapped = zoneObj.units[zoneObj.units.length - 1];
        return true;
      };
      if (player.provisions < moveCost) throw new Error(`Insufficient provisions for move (need ${moveCost})`);

      const targetZoneRaw = action.payload.targetZone;
      const targetZone = targetZoneRaw.replace('FRONTLINE_', '');

      // Path A: Advance from Support to Frontline
      if (loc.zoneType === 'SUPPORT' && targetZoneRaw.startsWith('FRONTLINE_')) {
        const flZone = state.battlefield.frontline[targetZone];
        if (!flZone) throw new Error('Invalid frontline zone');
        if (flZone.occupant !== null && flZone.occupant !== action.playerId) {
          throw new Error('Frontline zone occupied by enemy');
        }
        if (flZone.units.length >= flZone.capacity && !trySwap(flZone)) throw new Error('Frontline zone at capacity');

        const supportSlots = state.battlefield.support[action.playerId].slots;
        supportSlots.splice(loc.slotIndex, 1);
        flZone.occupant = action.playerId;
        if (swapped) {
          flZone.units.splice(flZone.units.indexOf(swapped), 1, unit);
          supportSlots.splice(loc.slotIndex, 0, swapped);
        } else {
          insertAt(flZone.units, unit, action.payload.slotIndex);
        }
      }
      // Path B: Lateral movement on Frontline (Left <-> Center, Center <-> Right)
      else if (loc.zoneType === 'FRONTLINE' && targetZoneRaw.startsWith('FRONTLINE_')) {
        const currentKey = loc.zoneKey;
        const validAdjacency =
          (currentKey === 'LEFT' && targetZone === 'CENTER') ||
          (currentKey === 'CENTER' && (targetZone === 'LEFT' || targetZone === 'RIGHT')) ||
          (currentKey === 'RIGHT' && targetZone === 'CENTER');
        if (!validAdjacency) throw new Error(`Invalid lateral move from ${currentKey} to ${targetZone}`);

        const targetFl = state.battlefield.frontline[targetZone];
        if (targetFl.occupant !== null && targetFl.occupant !== action.playerId) {
          throw new Error('Target zone occupied by enemy');
        }
        if (targetFl.units.length >= targetFl.capacity && !trySwap(targetFl)) throw new Error('Target zone at capacity');

        const currentFl = state.battlefield.frontline[currentKey];
        currentFl.units.splice(loc.slotIndex, 1);
        targetFl.occupant = action.playerId;
        if (swapped) {
          targetFl.units.splice(targetFl.units.indexOf(swapped), 1, unit);
          currentFl.units.splice(loc.slotIndex, 0, swapped);
        } else {
          insertAt(targetFl.units, unit, action.payload.slotIndex);
        }
        if (currentFl.units.length === 0) currentFl.occupant = null;
      }
      // Path C: Retreat from Frontline back to Support (requires 游击)
      else if (loc.zoneType === 'FRONTLINE' && (targetZoneRaw === 'SUPPORT' || targetZone === 'SUPPORT')) {
        if (!hasKeyword(unit, KEYWORDS.YOU_JI)) {
          throw new Error('Only units with 游击 can retreat back to support line');
        }
        const currentFl = state.battlefield.frontline[loc.zoneKey];
        const supportSlots = state.battlefield.support[action.playerId].slots;
        currentFl.units.splice(loc.slotIndex, 1);
        if (currentFl.units.length === 0) currentFl.occupant = null;

        if (supportSlots.length < 4) {
          insertAt(supportSlots, unit, action.payload.slotIndex);
        } else {
          // Hand cap 9 check
          if (player.hand.length < 9) {
            player.hand.push(unit);
          } else {
            player.discard.push(unit);
          }
        }
      } else {
        throw new Error('Invalid move path');
      }

      player.provisions -= moveCost;
      unit.status[STATUS_TYPES.MOVED_THIS_TURN] = true;
      unit.status[STATUS_TYPES.ACTIONS_USED] += 1;

      if (swapped) state.combatLog.push({ type: 'SKILL', playerId: action.playerId, message: `白毦军·断后：与【${swapped.name}】换位` });
      state.combatLog.push({
        type: 'MOVE',
        playerId: action.playerId,
        unitName: unit.name,
        unitId: unit.instanceId,
        troopType: unit.troopType,
        audioCue: unit.audioCue,
        toTerrain: state.battlefield.frontline[targetZone]?.terrain?.type || 'LAND',
        fromZone: loc.zoneKey || loc.zoneType,
        toZone: targetZoneRaw
      });

      return { success: true, fromZoneType: loc.zoneType, toZoneType: targetZoneRaw.startsWith('FRONTLINE_') ? 'FRONTLINE' : 'SUPPORT' };
    }

    case ACTION_TYPES.ATTACK: {
      return resolveCombat(state, { ...action, allowSupportCombat: false });
    }

    case 'PLAY_TACTIC':
    case ACTION_TYPES.TACTIC: {
      const player = state.players[action.playerId];
      const handIdx = player.hand.findIndex(c => c.instanceId === action.payload.cardInstanceId);
      if (handIdx === -1) throw new Error('Tactic card not in hand');
      const card = player.hand[handIdx];

      // 奇谋X：未被抑制的己方单位使战法费用降低
      let cost = Math.max(0, card.cost - qiMouDiscount(state, action.playerId));

      if (player.provisions < cost) throw new Error(`Insufficient provisions for tactic (need ${cost})`);
      const prepared = prepareTactic(state, action.playerId, card, action.payload || {});
      // 吕范·威仪：指向该单位花费+2
      if (prepared.target && prepared.target.faction !== action.playerId) cost += targetSurcharge(prepared.target);
      if (player.provisions < cost) throw new Error(`粮草不足（需 ${cost}）`);
      player.provisions -= cost;
      player.hand.splice(handIdx, 1);
      player.discard.push(card);

      state.combatLog.push({ type: 'TACTIC_PLAYED', playerId: action.playerId, cardName: card.name, card, targetName: prepared.target?.name, targetId: prepared.target?.instanceId });
      // 声望X：先加声望再结算卡面效果
      const pk = card.keywords.find(k => k.startsWith(KEYWORDS.SHENG_WANG_PREFIX));
      if (pk && !hasConfiguredEffect(card, 'ON_PLAY', 'GAIN_PRESTIGE')) {
        adjustPrestige(state, action.playerId, parseInt(pk.replace(KEYWORDS.SHENG_WANG_PREFIX, '') || '1', 10) || 1);
      }
      resolveTactic(state, action.playerId, card, prepared, action.payload || {});
      return { success: true, card };
    }

    case ACTION_TYPES.SET_COUNTER:
    case 'COUNTER_TACTIC': {
      const player = state.players[action.playerId];
      const handIdx = player.hand.findIndex(c => c.instanceId === action.payload.cardInstanceId);
      if (handIdx === -1) throw new Error('Counter card not in hand');
      const card = player.hand[handIdx];

      let cost = Math.max(0, card.cost - qiMouDiscount(state, action.playerId));

      if (player.provisions < cost) throw new Error(`Insufficient provisions for counter (need ${cost})`);
      player.provisions -= cost;
      player.hand.splice(handIdx, 1);

      state.activeCounters.push({
        id: `counter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        owner: action.playerId,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        name: card.name,
        cost,
        triggerCondition: card.triggerCondition || 'ON_ENEMY_ACTION',
        cardDef: card,
        isRevealed: false
      });

      state.combatLog.push({ type: 'COUNTER_SET', playerId: action.playerId });

      return { success: true, card };
    }

    case 'REPOSITION': {
      // 回合内调整己方单位在所在阵线/区域中的站位（不消耗粮草与行动）
      if (state.phase !== PHASES.ACTION || state.activePlayer !== action.playerId) throw new Error('只能在己方行动阶段调整站位');
      const loc = findUnit(state, action.payload?.cardInstanceId);
      if (!loc || loc.unit.faction !== action.playerId) throw new Error('只能调整己方单位');
      const arr = loc.zoneType === 'SUPPORT' ? state.battlefield.support[action.playerId].slots : state.battlefield.frontline[loc.zoneKey].units;
      const from = arr.indexOf(loc.unit);
      let to = Number(action.payload?.toIndex);
      if (!Number.isInteger(to)) throw new Error('站位参数无效');
      arr.splice(from, 1);
      to = Math.max(0, Math.min(arr.length, to));
      arr.splice(to, 0, loc.unit);
      if (to !== from) state.combatLog.push({ type: 'REPOSITION', playerId: action.playerId, unitName: loc.unit.name, unitId: loc.unit.instanceId, toIndex: to });
      return { success: true, moved: to !== from };
    }

    case ACTION_TYPES.END_TURN: {
      return endTurn(state);
    }

    case ACTION_TYPES.MULLIGAN: {
      const cardIndices = action.payload?.cardIndices || [];
      executeMulligan(state, action.playerId, cardIndices);
      state.combatLog.push({
        type: 'SYSTEM_MESSAGE',
        playerId: action.playerId,
        message: `${action.playerId === 'WEI' ? '魏武军' : '蜀汉军'} 调度了 ${cardIndices.length} 张手牌。`
      });
      if (state.phase === PHASES.MULLIGAN) {
        startTurn(state, state.firstPlayer);
      }
      return { success: true, count: cardIndices.length };
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

/** Applies declarative card skills around the existing battle rules. */
export function dispatch(state, action) {
  if (state.phase === PHASES.GAME_OVER) throw new Error('Game is already over');
  const player = state.players[action.playerId];
  // 选牌（豪杰归心等）：先完成选择；结束回合/超时则自动挑选
  if (action.type === ACTION_TYPES.PICK_CARDS) {
    if (!player?.pendingPick) throw new Error('当前没有待选择的牌');
    const ids = action.payload?.random ? randomPickCards(state, player.pendingPick) : (action.payload?.cardIds || []);
    const kept = resolvePick(state, action.playerId, ids);
    return { success: true, kept: kept.map(c => c.instanceId) };
  }
  if (action.type === ACTION_TYPES.CHOOSE_TARGET) {
    const t = resolveChoice(state, action.playerId, { choiceId: action.payload?.choiceId, targetId: action.payload?.targetId, mode: action.payload?.random ? 'random' : (action.payload?.targetId ? null : 'auto') });
    return { success: true, targetId: t?.instanceId || null };
  }
  if (player?.pendingPick || player?.pendingChoices?.length) {
    if (action.type === ACTION_TYPES.END_TURN || action.type === ACTION_TYPES.SURRENDER) {
      if (player.pendingPick) resolvePick(state, action.playerId, randomPickCards(state, player.pendingPick));
      while (player.pendingChoices?.length && state.phase !== PHASES.GAME_OVER) resolveChoice(state, action.playerId, { mode: 'random' });
      if (state.phase === PHASES.GAME_OVER) return { success: true, winner: state.winner };
    } else throw new Error(player.pendingPick ? '请先完成选牌' : '请先选择技能目标');
  }
  if (action.type === ACTION_TYPES.ACTIVATE_SKILL) {
    if (state.activePlayer !== action.playerId) throw new Error('只能在己方回合发动');
    return activateSkill(state, action.playerId, action.payload || {});
  }
  const handId = action.payload?.cardInstanceId;
  const source = action.type === ACTION_TYPES.ATTACK
    ? findUnit(state, action.payload?.attackerId)?.unit
    : (action.type === ACTION_TYPES.MOVE
      ? findUnit(state, handId)?.unit
      : player?.hand?.find(card => card.instanceId === handId));
  const defender = action.type === ACTION_TYPES.ATTACK && action.payload?.targetId !== 'HQ'
    ? findUnit(state, action.payload?.targetId)?.unit : null;

  if (action.type === ACTION_TYPES.END_TURN) {
    for (const unit of [...getAllUnits(state, action.playerId)]) runAbilityTrigger(state, 'ON_TURN_END', unit);
    if (state.phase === PHASES.GAME_OVER) return { success: true, winner: state.winner };
  }

  const previousPlayer = state.activePlayer;
  const result = dispatchBase(state, action);
  const context = { action, result, attacker: action.type === ACTION_TYPES.ATTACK ? source : null, defender };
  processDeaths(state);
  if (action.type === ACTION_TYPES.MOVE && source && state.phase !== PHASES.GAME_OVER) {
    onUnitMoved(state, source, result.fromZoneType, result.toZoneType);
  }
  if (action.type === ACTION_TYPES.ATTACK && source && state.phase !== PHASES.GAME_OVER) {
    afterAttack(state, source, result.defenderRef || defender, result, Boolean(result.targetIsHq));
    delete result.defenderRef;
  }
  if (action.type === ACTION_TYPES.DEPLOY) runAbilityTrigger(state, 'ON_DEPLOY', source, context);
  else if (action.type === ACTION_TYPES.PLAY_TACTIC) runAbilityTrigger(state, 'ON_PLAY', source, context);
  else if (action.type === ACTION_TYPES.MOVE) runAbilityTrigger(state, 'ON_MOVE', source, context);
  else if (action.type === ACTION_TYPES.ATTACK) {
    runAbilityTrigger(state, 'ON_ATTACK', source, context);
    runAbilityTrigger(state, 'ON_DEFEND', defender, context);
    if (result.damageDealt > 0) runAbilityTrigger(state, 'ON_DAMAGED', defender, context);
    if (result.counterDealt > 0) runAbilityTrigger(state, 'ON_DAMAGED', source, context);
    if (result.defenderDied) {
      runAbilityTrigger(state, 'ON_KILL', source, context);
      runAbilityTrigger(state, 'ON_DEATH', defender, context);
    }
    if (result.attackerDied) {
      runAbilityTrigger(state, 'ON_KILL', defender, context);
      runAbilityTrigger(state, 'ON_DEATH', source, context);
    }
  }

  if (state.phase !== PHASES.GAME_OVER && [ACTION_TYPES.DEPLOY, ACTION_TYPES.MOVE, ACTION_TYPES.ATTACK, ACTION_TYPES.PLAY_TACTIC, ACTION_TYPES.SET_COUNTER].includes(action.type)) {
    for (const counter of [...state.activeCounters]) {
      if (counter.owner === action.playerId || !counter.cardDef?.abilities?.some(ability => ability.trigger === 'ON_ENEMY_ACTION')) continue;
      const triggered = runAbilityTrigger(state, 'ON_ENEMY_ACTION', counter.cardDef, context);
      if (triggered.length) {
        state.activeCounters = state.activeCounters.filter(active => active.id !== counter.id);
        state.players[counter.owner].discard.push(counter.cardDef);
        state.combatLog.push({ type: 'COUNTER_TRIGGERED', playerId: counter.owner, counterName: counter.name });
      }
    }
  }
  if ([ACTION_TYPES.END_TURN, ACTION_TYPES.MULLIGAN].includes(action.type) && state.activePlayer !== previousPlayer && state.phase === PHASES.ACTION) {
    for (const unit of [...getAllUnits(state, state.activePlayer)]) runAbilityTrigger(state, 'ON_TURN_START', unit);
  }
  processDeaths(state);
  refreshAuras(state);
  // 死战：敌方回合被击败，立即结束当前回合
  if (state.forceEndTurn) {
    state.forceEndTurn = false;
    if (state.phase === PHASES.ACTION && action.type !== ACTION_TYPES.END_TURN) {
      for (const unit of [...getAllUnits(state, state.activePlayer)]) runAbilityTrigger(state, 'ON_TURN_END', unit);
      endTurn(state);
    }
  }
  return result;
}

// ==========================================
// 3. Action Legality Evaluation (For Bot AI & UI)
// ==========================================

/**
 * Returns all currently legal actions for a player.
 * @param {object} state
 * @param {string} playerId
 * @returns {object[]}
 */
export function getLegalActions(state, playerId) {
  if (state.phase !== PHASES.ACTION || state.activePlayer !== playerId) return [];
  const actions = [];
  const player = state.players[playerId];
  if (player?.pendingPick) return [{ type: ACTION_TYPES.PICK_CARDS, playerId, payload: { cardIds: autoPickCards(player.pendingPick) } }];
  if (player?.pendingChoices?.length) return [{ type: ACTION_TYPES.CHOOSE_TARGET, playerId, payload: { choiceId: player.pendingChoices[0].id, targetId: autoChoiceTarget(state, playerId) } }];

  // 1. Legal Deploys
  const noDeploy = player.noDeployNextTurn && player._noDeployActive;
  for (const card of player.hand) {
    if (card.type === 'UNIT' && !noDeploy) {
      let cost = card.cost;
      if (!player.prestigeDiscountUsed && player.prestige > 0) {
        cost = Math.max(0, cost - player.prestige);
      }
      if (player.provisions >= cost) {
        if (state.battlefield.support[playerId].slots.length < 4) {
          actions.push({ type: ACTION_TYPES.DEPLOY, playerId, payload: { cardInstanceId: card.instanceId, targetZone: 'SUPPORT' } });
        }
        for (const zk of ['LEFT', 'CENTER', 'RIGHT']) {
          if (canDeployToFrontline(state, card, playerId, zk)) {
            actions.push({ type: ACTION_TYPES.DEPLOY, playerId, payload: { cardInstanceId: card.instanceId, targetZone: zk } });
          }
        }
      }
    }
  }

  // 2. Legal Moves
  const units = getAllUnits(state, playerId);
  for (const u of units) {
    if (!u.status[STATUS_TYPES.SUPPRESSED] && player.provisions >= getActionCost(state, u)) {
      const loc = findUnit(state, u.instanceId);
      if (loc && loc.zoneType === 'SUPPORT' && u.status[STATUS_TYPES.ACTIONS_USED] === 0) {
        for (const zk of ['LEFT', 'CENTER', 'RIGHT']) {
          const z = state.battlefield.frontline[zk];
          if ((z.occupant === null || z.occupant === playerId) && z.units.length < z.capacity) {
            actions.push({ type: ACTION_TYPES.MOVE, playerId, payload: { cardInstanceId: u.instanceId, targetZone: `FRONTLINE_${zk}` } });
          }
        }
      }
    }
  }

  // 3. Legal Attacks
  for (const u of units) {
    if (!u.status[STATUS_TYPES.SUPPRESSED] && player.provisions >= getActionCost(state, u)) {
      const targets = getValidTargets(state, u.instanceId);
      for (const tid of targets) {
        actions.push({ type: ACTION_TYPES.ATTACK, playerId, payload: { attackerId: u.instanceId, targetId: tid } });
      }
    }
  }

  // 4. Tactics / Counters
  const qiMou = qiMouDiscount(state, playerId);
  for (const card of player.hand) {
    if (card.type !== 'TACTIC' && card.type !== 'COUNTER') continue;
    if (player.provisions < Math.max(0, card.cost - qiMou)) continue;
    if (card.type === 'COUNTER') {
      actions.push({ type: ACTION_TYPES.SET_COUNTER, playerId, payload: { cardInstanceId: card.instanceId } });
      continue;
    }
    const targets = getTacticTargets(state, playerId, card);
    if (targets === null) actions.push({ type: ACTION_TYPES.PLAY_TACTIC, playerId, payload: { cardInstanceId: card.instanceId } });
    else for (const t of targets) actions.push({ type: ACTION_TYPES.PLAY_TACTIC, playerId, payload: { cardInstanceId: card.instanceId, targetId: t.instanceId } });
  }

  // 5. End Turn
  actions.push({ type: ACTION_TYPES.END_TURN, playerId, payload: {} });
  return actions;
}

/**
 * Validates whether an action is legal without mutating state.
 * @param {object} state
 * @param {object} action
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAction(state, action) {
  try {
    const cloned = cloneState(state);
    dispatch(cloned, action);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ==========================================
// 4. RulesEngine Class Wrapper
// ==========================================

export class RulesEngine {
  constructor(options = {}) {
    this.listeners = [];
    this.state = null;
    if (options.autoInit !== false) {
      this.initMatch(options);
    }
  }

  subscribe(listener) {
    if (typeof listener === 'function') this.listeners.push(listener);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (e) {
        console.error('RulesEngine listener error:', e);
      }
    }
  }

  initMatch(options = {}) {
    this.state = createInitialState(options);
    setupGame(this.state);
    return this.state;
  }

  dispatch(action) {
    const result = dispatch(this.state, action);
    this.emit({ type: 'ACTION_RESOLVED', action, result, state: this.state });
    return result;
  }

  getLegalActions(playerId) {
    return getLegalActions(this.state, playerId);
  }

  getVisibleState(playerId) {
    return projectStateForClient(this.state, playerId);
  }
}

export default RulesEngine;
