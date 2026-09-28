/**
 * constants.js — Canonical Enums, Keywords, Status Types & Game Constants
 * Conforms to rules_spec.md, tech_architecture.md, and testHarness.js.
 */

// ==========================================
// 1. Core Enums
// ==========================================

export const FACTIONS = Object.freeze({
  WEI: 'WEI',
  SHU: 'SHU'
});

export const TROOP_TYPES = Object.freeze({
  INFANTRY: 'INFANTRY',
  CAVALRY: 'CAVALRY',
  ARCHER: 'ARCHER',
  NAVY: 'NAVY',
  STRATEGIST: 'STRATEGIST',
  NONE: 'NONE'
});

export const CARD_TYPES = Object.freeze({
  UNIT: 'UNIT',
  TACTIC: 'TACTIC',
  COUNTER: 'COUNTER'
});

export const PHASES = Object.freeze({
  SETUP: 'SETUP',
  MULLIGAN: 'MULLIGAN',
  TURN_START: 'TURN_START',
  DRAW: 'DRAW',
  ACTION: 'ACTION',
  TURN_END: 'TURN_END',
  END: 'TURN_END', // Semantic alias
  GAME_OVER: 'GAME_OVER'
});

export const ACTION_TYPES = Object.freeze({
  DEPLOY: 'DEPLOY',
  MOVE: 'MOVE',
  ATTACK: 'ATTACK',
  PLAY_TACTIC: 'PLAY_TACTIC',
  TACTIC: 'PLAY_TACTIC', // Semantic alias
  SET_COUNTER: 'SET_COUNTER',
  COUNTER: 'SET_COUNTER', // Semantic alias
  COUNTER_TACTIC: 'SET_COUNTER', // Semantic alias
  END_TURN: 'END_TURN',
  MULLIGAN: 'MULLIGAN',
  PICK_CARDS: 'PICK_CARDS',
  CHOOSE_TARGET: 'CHOOSE_TARGET',
  SURRENDER: 'SURRENDER'
});

export const TERRAIN_TYPES = Object.freeze({
  PLAIN: 'PLAIN',
  WATER: 'WATER',
  MOUNTAIN: 'MOUNTAIN',
  FOREST: 'FOREST',
  PASS: 'PASS'
});

export const TERRAINS = Object.freeze({
  PLAIN: Object.freeze({ id: 'PLAIN', type: 'PLAIN', name: '平原', capacity: 3 }),
  WATER: Object.freeze({ id: 'WATER', type: 'WATER', name: '水域', capacity: 4 }),
  MOUNTAIN: Object.freeze({ id: 'MOUNTAIN', type: 'MOUNTAIN', name: '山地', capacity: 2 }),
  FOREST: Object.freeze({ id: 'FOREST', type: 'FOREST', name: '林地', capacity: 2 }),
  PASS: Object.freeze({ id: 'PASS', type: 'PASS', name: '险关', capacity: 2 })
});

// ==========================================
// 2. Zone Identifiers
// ==========================================

export const ZONE_KEYS = Object.freeze({
  LEFT: 'LEFT',
  CENTER: 'CENTER',
  RIGHT: 'RIGHT'
});

export const ZONES = Object.freeze({
  SUPPORT_WEI: 'SUPPORT_WEI',
  SUPPORT_SHU: 'SUPPORT_SHU',
  FRONTLINE_LEFT: 'FRONTLINE_LEFT',
  FRONTLINE_CENTER: 'FRONTLINE_CENTER',
  FRONTLINE_RIGHT: 'FRONTLINE_RIGHT'
});

// ==========================================
// 3. Keywords Dictionary (25+ Canonical Traits)
// ==========================================

export const KEYWORDS = Object.freeze({
  // Attack Keywords
  FEN_ZHAN: '奋战',         // Double strike per turn (requires action cost each)
  ZHAN_JIANG: '斩将',       // Banish target if attacker ATK > defender ATK (ineffective vs Ambush/Infiltrate)
  CHONG_ZHEN: '冲阵',       // First attack immune to counter, lost after attack (ineffective vs Ambush)
  XIAN_DENG: '先登',         // First strike; immune to counter if kill (ineffective vs Ambush/Infiltrate)
  SHI_SHI: '矢石',           // Archery: only countered by units that also possess 矢石
  GONG_XIN: '攻心',         // Bypasses all defensive keywords (坚阵, 守护, 帷幄)
  LU_LVE: '掳掠',           // Pillage: choose draw 1 or restore provisions equal to 2x action cost
  HUO_GONG: '火攻',         // Fire Attack: on kill, splashes equal damage to adjacent enemy/HQ, bypassing 坚阵

  // Defense Keywords
  JIAN_ZHEN_PREFIX: '坚阵',   // Fortify prefix (坚阵1, 坚阵2, 坚阵3)
  SHOU_HU: '守护',           // Guardian: blocks attacks on adjacent friendly non-guard units and HQ
  WEI_WO: '帷幄',           // Curtain: immune to targeting before unit's first action
  JING_JIE: '警戒',         // Vigilance: immune to targeted tactics and counter-tactics
  FU_JI: '伏击',             // Ambush: first strike counter when attacked; if attacker dies, takes 0 damage

  // Mobility Keywords
  TU_XI: '突袭',             // Rush: can move or attack on the turn it is deployed
  QIAN_XI: '潜袭',           // Infiltrate: deployed face-down, immune to tactics, revealed upon combat/action
  YOU_JI: '游击',           // Guerilla: can retreat to support line; negate first attack received in enemy turn
  QI_XI: '奇袭',             // Surprise: can deploy directly from hand into empty frontline zone

  // Support & Special Keywords
  BU_JI: '补给',             // Supply: +1 extra granary capacity while on battlefield
  SHENG_WANG_PREFIX: '声望', // Prestige gain upon entry (声望1, 声望2)
  QI_MOU_PREFIX: '奇谋',     // Tactic cost reduction (奇谋1, 奇谋2)
  ZHI_JUN: '治军',           // Discipline: same troop type friendly units action cost -1
  DU_ZHAN: '督战',           // Inspire: adjacent friendly military units ATK +1 (excludes Strategists)
  JIANG_JIANG: '降将',       // Defector: goes to opponent's discard upon death
  JU_ZHONG: '聚众',         // Gathering: +1/+1 at turn start while undamaged; lost upon taking damage
  WANG_JI: '亡计',           // Deathrattle: triggers ability when defeated
  SHI_JIE: '使节',           // Envoy (Sun Qian): provides HQ damage immunity aura while alive
  GUI_XIN: '归心',           // Return of Hearts (Cao Cao): draw card on kill if survived
  SI_ZHAN: '死战',           // Battle to Death (Fu Tong): ends enemy turn when killed during enemy turn
  YI_CHU_ZHUAN_YI: '溢出转移' // Overflow transfer to HQ (Catapult)
});

// ==========================================
// 4. Status Types
// ==========================================

export const STATUS_TYPES = Object.freeze({
  SUPPRESSED: 'suppressed',                 // Unit cannot move or actively attack, but can counterattack
  INHIBITED: 'inhibited',                   // Stripped of all traits, reset to vanilla printed stats
  IS_FACE_DOWN: 'isFaceDown',               // Submerged / stealth state (潜袭)
  BUFFED_AFTER_INHIBIT: 'buffedAfterInhibit', // Allows re-inhibition after receiving a new buff
  DAMAGED: 'damaged',                       // Unit has suffered combat or ability damage
  ACTIONS_USED: 'actionsUsed',              // Actions consumed this turn
  MOVED_THIS_TURN: 'movedThisTurn',         // Movement consumed this turn
  ATTACKED_THIS_TURN: 'attackedThisTurn',   // Attack consumed this turn
  AMBUSH_USED_THIS_TURN: 'ambushUsedThisTurn', // Ambush consumed this turn (resets at turn end)
  CHARGE_USED: 'chargeUsed',                // Charge consumed permanently
  DEPLOYED_THIS_TURN: 'deployedThisTurn'    // Deployed this turn (deploy sickness if no 突袭)
});

// ==========================================
// 5. Game Configuration Constants
// ==========================================

export const GAME_CONFIG = Object.freeze({
  DEFAULT_HQ_HP: 30,             // Canonical initial HQ HP
  COMPAT_HQ_HP: 20,              // Backward compatible HP for legacy test suites
  MAX_MAIN_GRANARY: 10,          // Natural main granary cap
  MAX_PRESTIGE: 2,               // Maximum dynamic prestige
  HAND_LIMIT: 9,                 // Maximum hand size before overflow burn
  MAX_SUPPORT_UNITS: 4,          // Maximum units in support line
  MAX_SUPPORT_CARDS: 5,          // 1 HQ + 4 units
  DECK_SIZE: 40,                 // Standard main deck card count
  FIRST_PLAYER_START_HAND: 4,    // P1 opening hand count
  SECOND_PLAYER_START_HAND: 5,   // P2 opening hand count
  MAX_MULLIGAN_COUNT: 1,         // Maximum mulligan per player
  MAX_TURNS_SAFETY_CAP: 60       // Stalemate cutoff turn
});

// ==========================================
// 6. Keyword Helper Functions
// ==========================================

/**
 * Extracts numerical parameter from parametric keywords (e.g. '坚阵2' -> 2, '声望1' -> 1).
 * @param {string} keyword
 * @param {string} prefix
 * @returns {number}
 */
export function parseParametricKeyword(keyword, prefix) {
  if (typeof keyword !== 'string' || !keyword.startsWith(prefix)) return 0;
  const numStr = keyword.slice(prefix.length).trim();
  const val = parseInt(numStr, 10);
  return Number.isNaN(val) ? 1 : val;
}

/**
 * Checks whether a card definition or instance has a specific keyword.
 * @param {object} card
 * @param {string} keywordOrPrefix
 * @returns {boolean}
 */
export function hasKeyword(card, keywordOrPrefix) {
  if (!card || !Array.isArray(card.keywords)) return false;
  return card.keywords.some(k => k === keywordOrPrefix || k.startsWith(keywordOrPrefix));
}

/**
 * Returns the highest value of a parametric keyword on a unit (e.g. 坚阵X).
 * @param {object} card
 * @param {string} prefix
 * @returns {number}
 */
export function getKeywordValue(card, prefix) {
  if (!card || !Array.isArray(card.keywords)) return 0;
  let maxVal = 0;
  for (const k of card.keywords) {
    if (k.startsWith(prefix)) {
      maxVal = Math.max(maxVal, parseParametricKeyword(k, prefix));
    }
  }
  return maxVal;
}

export default {
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
};
