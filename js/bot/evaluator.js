/**
 * evaluator.js — Multi-Factor Board State Evaluation Engine
 * Three Kingdoms KARDS (Milestone 3)
 *
 * Implements mathematical evaluation of game state utility from perspective of botFaction:
 * 1. Terminal Win / Loss detection (+/- 1,000,000)
 * 2. HQ HP differential with lethal pressure and crisis scaling; Sun Qian HQ immunity bonus
 * 3. Frontline control (occupancy, center pivot, unit count, terrain affinity)
 * 4. Unit values (ATK * 1.5 + HP * 1.0 + 25+ keywords weighted + status/positioning)
 * 5. Card advantage & overdraw fatigue escalation penalties
 * 6. Resource & prestige efficiency
 */

import {
  FACTIONS,
  TROOP_TYPES,
  PHASES,
  KEYWORDS,
  STATUS_TYPES,
  hasKeyword
} from '../engine/constants.js';
import { getAllUnits, findUnit } from '../engine/state.js';
import { getEffectiveAttack } from '../engine/combat.js';

export const DEFAULT_EVALUATION_WEIGHTS = Object.freeze({
  // Terminal
  WIN_SCORE: 1_000_000,
  LOSS_SCORE: -1_000_000,

  // HQ Differential
  W_HQ: 3.5,
  W_HQ_LETHAL_SCALE: 6.0,
  W_HQ_CRISIS_SCALE: 5.0,
  SUN_QIAN_PROTECTION: 35.0,

  // Frontline Control
  W_FRONTLINE_OCCUPIED: 35.0,
  W_FRONTLINE_CENTER: 10.0,
  W_FRONTLINE_UNIT: 12.0,
  W_TERRAIN_AFFINITY: 15.0,

  // Board Units
  W_UNIT_BASE: 5.0,
  W_UNIT_ATK: 1.5,
  W_UNIT_HP: 1.0,

  // Keyword Weights
  KEYWORD_WEIGHTS: Object.freeze({
    '守护': 18.0,
    '坚阵1': 10.0,
    '坚阵2': 20.0,
    '坚阵3': 30.0,
    '奋战': 22.0,
    '先登': 16.0,
    '冲阵': 14.0,
    '矢石': 16.0,
    '攻心': 18.0,
    '火攻': 15.0,
    '伏击': 20.0,
    '突袭': 10.0,
    '帷幄': 14.0,
    '聚众': 14.0,
    '补给': 12.0,
    '声望1': 10.0,
    '声望2': 20.0,
    '奇谋1': 10.0,
    '奇谋2': 20.0,
    '督战': 16.0,
    '游击': 10.0,
    '奇袭': 8.0,
    '使节': 45.0,
    '归心': 25.0,
    '死战': 18.0,
    '溢出转移': 15.0,
    '掳掠': 12.0
  }),

  // Status & Position
  W_STATUS_SUPPRESSED: -18.0,
  W_STATUS_INHIBITED: -12.0,
  W_STATUS_STEALTH: 8.0,
  W_POS_STRATEGIST_PROTECTED: 15.0,
  W_POS_STRATEGIST_EXPOSED: -15.0,

  // Hand & Fatigue
  W_HAND: 8.0,
  W_FATIGUE_TICK: 12.0,
  W_DECK_LOW_PENALTY: 6.0,

  // Resources
  W_PRESTIGE: 18.0,
  W_GRANARY_CAP: 6.0,
  W_PROVISIONS: 1.5
});

/**
 * Evaluates board state utility from perspective of botFaction.
 * @param {object} state - GameState or MaskedGameState
 * @param {string} botFaction - 'WEI' or 'SHU'
 * @param {object} [weights=DEFAULT_EVALUATION_WEIGHTS]
 * @returns {number} Scalar utility score
 */
export function evaluateBoard(state, botFaction, weights = DEFAULT_EVALUATION_WEIGHTS) {
  if (!state || !state.players) return 0;

  const oppFaction = botFaction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
  const selfPlayer = state.players[botFaction];
  const oppPlayer = state.players[oppFaction];

  if (!selfPlayer || !oppPlayer) return 0;

  // 1. Immediate Win / Loss Detection
  if (state.winner === botFaction || oppPlayer.hp <= 0) return weights.WIN_SCORE;
  if (state.winner === oppFaction || selfPlayer.hp <= 0) return weights.LOSS_SCORE;

  // 2. HQ HP Differential
  let scoreHq = (selfPlayer.hp - oppPlayer.hp) * weights.W_HQ;

  const oppUnits = getAllUnits(state, oppFaction);
  const selfUnits = getAllUnits(state, botFaction);
  const oppHasSunQian = oppUnits.some(u => hasKeyword(u, KEYWORDS.SHI_JIE));
  const selfHasSunQian = selfUnits.some(u => hasKeyword(u, KEYWORDS.SHI_JIE));

  if (!oppHasSunQian && oppPlayer.hp <= 8) {
    scoreHq += (9 - oppPlayer.hp) * weights.W_HQ_LETHAL_SCALE;
  }
  if (!selfHasSunQian && selfPlayer.hp <= 8) {
    scoreHq -= (9 - selfPlayer.hp) * weights.W_HQ_CRISIS_SCALE;
  }
  if (selfHasSunQian) {
    scoreHq += weights.SUN_QIAN_PROTECTION;
  }

  // 3. Frontline Control
  let scoreFrontline = 0;
  for (const zk of ['LEFT', 'CENTER', 'RIGHT']) {
    const zone = state.battlefield?.frontline?.[zk];
    if (!zone) continue;

    if (zone.occupant === botFaction) {
      scoreFrontline += weights.W_FRONTLINE_OCCUPIED;
      if (zk === 'CENTER') scoreFrontline += weights.W_FRONTLINE_CENTER;
      scoreFrontline += zone.units.length * weights.W_FRONTLINE_UNIT;

      // Terrain affinity
      for (const u of zone.units) {
        if (zone.terrain?.type === 'WATER' && u.troopType === TROOP_TYPES.NAVY) {
          scoreFrontline += weights.W_TERRAIN_AFFINITY;
        }
      }
    } else if (zone.occupant === oppFaction) {
      scoreFrontline -= weights.W_FRONTLINE_OCCUPIED;
      if (zk === 'CENTER') scoreFrontline -= weights.W_FRONTLINE_CENTER;
      scoreFrontline -= zone.units.length * weights.W_FRONTLINE_UNIT;

      for (const u of zone.units) {
        if (zone.terrain?.type === 'WATER' && u.troopType === TROOP_TYPES.NAVY) {
          scoreFrontline -= weights.W_TERRAIN_AFFINITY;
        }
      }
    }
  }

  // 4. Board Unit Values
  const evaluateUnit = (u) => {
    let val = weights.W_UNIT_BASE;
    val += (u.atk ?? 0) * weights.W_UNIT_ATK;
    val += (u.hp ?? 0) * weights.W_UNIT_HP;

    // Keywords
    if (Array.isArray(u.keywords)) {
      for (const k of u.keywords) {
        let kwVal = weights.KEYWORD_WEIGHTS[k] || 0;
        if (k === KEYWORDS.FU_JI && u.status?.ambushUsedThisTurn) {
          kwVal *= 0.5;
        }
        if (k === KEYWORDS.CHONG_ZHEN && u.status?.chargeUsed) {
          kwVal = 0;
        }
        val += kwVal;
      }
    }

    // Status
    if (u.status?.[STATUS_TYPES.SUPPRESSED]) val += weights.W_STATUS_SUPPRESSED;
    if (u.status?.[STATUS_TYPES.INHIBITED]) val += weights.W_STATUS_INHIBITED;
    if (u.status?.[STATUS_TYPES.IS_FACE_DOWN]) val += weights.W_STATUS_STEALTH;

    // Tactical Positioning
    const loc = findUnit(state, u.instanceId);
    if (loc) {
      if (u.troopType === TROOP_TYPES.STRATEGIST) {
        if (loc.zoneType === 'SUPPORT') {
          const supportSlots = state.battlefield?.support?.[u.faction]?.slots || [];
          const hasGuardian = supportSlots.some(su => hasKeyword(su, KEYWORDS.SHOU_HU));
          if (hasGuardian) val += weights.W_POS_STRATEGIST_PROTECTED;
        } else if (loc.zoneType === 'FRONTLINE') {
          val += weights.W_POS_STRATEGIST_EXPOSED;
        }
      }
    }

    return val;
  };

  let scoreUnits = 0;
  for (const u of selfUnits) scoreUnits += evaluateUnit(u);
  for (const u of oppUnits) scoreUnits -= evaluateUnit(u);

  // 5. Card Advantage & Fatigue
  const selfHandLen = selfPlayer.hand?.length || 0;
  const oppHandLen = oppPlayer.hand?.length || 0;
  let scoreHand = (selfHandLen - oppHandLen) * weights.W_HAND;

  const selfDeckCount = Array.isArray(selfPlayer.deck)
    ? selfPlayer.deck.length
    : (selfPlayer.deck?.count ?? 0);
  const oppDeckCount = Array.isArray(oppPlayer.deck)
    ? oppPlayer.deck.length
    : (oppPlayer.deck?.count ?? 0);

  if (selfDeckCount === 0) {
    scoreHand -= ((selfPlayer.fatigueCount || 0) + 1) * weights.W_FATIGUE_TICK;
  } else if (selfDeckCount <= 3) {
    scoreHand -= (4 - selfDeckCount) * weights.W_DECK_LOW_PENALTY;
  }

  if (oppDeckCount === 0) {
    scoreHand += ((oppPlayer.fatigueCount || 0) + 1) * weights.W_FATIGUE_TICK;
  }

  // 6. Resources & Prestige Efficiency
  const selfCap = (selfPlayer.provisionsCap ?? 10) + (selfPlayer.extraGranaryCap ?? 0);
  const oppCap = (oppPlayer.provisionsCap ?? 10) + (oppPlayer.extraGranaryCap ?? 0);

  const scoreResource =
    ((selfPlayer.prestige ?? 0) - (oppPlayer.prestige ?? 0)) * weights.W_PRESTIGE +
    (selfCap - oppCap) * weights.W_GRANARY_CAP +
    (selfPlayer.provisions ?? 0) * weights.W_PROVISIONS;

  return scoreHq + scoreFrontline + scoreUnits + scoreHand + scoreResource;
}

export default {
  DEFAULT_EVALUATION_WEIGHTS,
  evaluateBoard
};
