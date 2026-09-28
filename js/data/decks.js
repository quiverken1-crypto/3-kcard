/**
 * decks.js — Authoritative 40-Card Preset Decks, Reserve Pool, and Deck Validation Engine
 * Conforms to rules_spec.md §10, cards_spec.md §6, and explorer_m1_3/analysis.md §5.
 */

import { CARD_MAP } from './cards.js';

// ==========================================
// 1. Deck Building Rules Constants
// ==========================================

export const DECK_RULES = Object.freeze({
  EXACT_MAIN_DECK_COUNT: 40,
  MAX_UNIQUE_COPIES: 1,
  MAX_REGULAR_COPIES: 3,
  MIN_MAIN_FACTION_CARDS: 20,
  MAX_ALLY_FACTION_CARDS: 12,
  MAX_RESERVE_CARDS: 10,
  HAND_LIMIT: 9,
  FIRST_PLAYER_START_HAND: 4,
  SECOND_PLAYER_START_HAND: 5
});

// ==========================================
// 2. Canonical Unique General / Strategist IDs (38 Characters)
// ==========================================

export const UNIQUE_GENERAL_IDS = Object.freeze(new Set([
  // Wei Kingdom (20 Unique Generals & Strategists)
  'wei_cao_cao', 'wei_cao_ren', 'wei_xia_hou_dun', 'wei_xia_hou_yuan', 'wei_zhang_liao',
  'wei_xu_chu', 'wei_xu_huang', 'wei_zhang_he', 'wei_pang_de', 'wei_li_dian',
  'wei_yu_jin', 'wei_xun_yu', 'wei_guo_jia', 'wei_cheng_yu', 'wei_man_chong',
  'wei_wen_pin', 'wei_jia_kui', 'wei_li_tong', 'wei_zang_ba', 'wei_cao_hong',

  // Shu Kingdom (18 Unique Generals & Strategists)
  'shu_liu_bei', 'shu_zhu_ge_liang', 'shu_guan_yu', 'shu_zhang_fei', 'shu_zhao_yun',
  'shu_ma_chao', 'shu_huang_zhong', 'shu_wei_yan', 'shu_fa_zheng', 'shu_deng_zhi',
  'shu_chen_dao', 'shu_ma_dai', 'shu_xu_shu', 'shu_liao_hua', 'shu_liu_feng',
  'shu_xu_jing', 'shu_mi_zhu', 'shu_mi_fang'
]));

/**
 * Checks if a card is a unique historical character/legendary general.
 * @param {string} cardId
 * @param {object|null} [cardDef=null]
 * @returns {boolean}
 */
export function isUniqueCard(cardId, cardDef = null) {
  if (typeof cardId !== 'string' || !cardId) return false;
  if (cardDef && (cardDef.isUnique === true || cardDef.maxCopies === 1)) {
    return true;
  }
  if (UNIQUE_GENERAL_IDS.has(cardId)) return true;
  const canonical = cardId.replace(/_[0-9]+$/, '');
  return UNIQUE_GENERAL_IDS.has(canonical);
}

// ==========================================
// 3. Wei 40-Card Preset Deck
// ==========================================

export const WEI_PRESET_DECK = Object.freeze({
  id: 'wei_standard_preset',
  name: '魏国标准构筑',
  faction: 'WEI',
  description: '以阵线压制、高额防御、粮草阻遏与中后期名将重甲压场为核心体系',
  main: Object.freeze([
    // 20 Unique Generals (1 copy each = 20 cards)
    'wei_cao_cao', 'wei_cao_ren', 'wei_xia_hou_dun', 'wei_xia_hou_yuan', 'wei_zhang_liao',
    'wei_xu_chu', 'wei_xu_huang', 'wei_zhang_he', 'wei_pang_de', 'wei_li_dian',
    'wei_yu_jin', 'wei_xun_yu', 'wei_guo_jia', 'wei_cheng_yu', 'wei_man_chong',
    'wei_wen_pin', 'wei_jia_kui', 'wei_li_tong', 'wei_zang_ba', 'wei_cao_hong',

    // 10 Regular Units & Tactics (2 copies each = 20 cards)
    'wei_qing_qi_bing', 'wei_qing_qi_bing',
    'wei_hu_bao_qi', 'wei_hu_bao_qi',
    'wei_pi_li_che', 'wei_pi_li_che',
    'wei_tun_tian_zhi', 'wei_tun_tian_zhi',
    'wei_wei_kun', 'wei_wei_kun',
    'wei_you_di_shen_ru', 'wei_you_di_shen_ru',
    'wei_wang_mei_zhi_ke', 'wei_wang_mei_zhi_ke',
    'wei_hong_men_yan', 'wei_hong_men_yan',
    'wei_ce_fan', 'wei_ce_fan',
    'wei_tian_zi_zhao_ling', 'wei_tian_zi_zhao_ling'
  ]),
  reserve: Object.freeze([])
});

// ==========================================
// 4. Shu 40-Card Preset Deck
// ==========================================

export const SHU_PRESET_DECK = Object.freeze({
  id: 'shu_standard_preset',
  name: '蜀国标准构筑',
  faction: 'SHU',
  description: '以灵活机动、全图矢石点杀、战法联动、残局恢复与强力斩将突围为核心体系',
  main: Object.freeze([
    // 18 Unique Generals (1 copy each = 18 cards)
    'shu_liu_bei', 'shu_zhu_ge_liang', 'shu_guan_yu', 'shu_zhang_fei', 'shu_zhao_yun',
    'shu_ma_chao', 'shu_huang_zhong', 'shu_wei_yan', 'shu_fa_zheng', 'shu_deng_zhi',
    'shu_chen_dao', 'shu_ma_dai', 'shu_xu_shu', 'shu_liao_hua', 'shu_liu_feng',
    'shu_xu_jing', 'shu_mi_zhu', 'shu_mi_fang',

    // 9 Regular Pairs (2 copies each = 18 cards)
    'shu_bai_er_jun', 'shu_bai_er_jun',
    'shu_lian_nu_ying', 'shu_lian_nu_ying',
    'shu_fa_shi_che', 'shu_fa_shi_che',
    'shu_wu_dang_fei_jun', 'shu_wu_dang_fei_jun',
    'shu_zha_bai', 'shu_zha_bai',
    'shu_chong_zheng_qi_gu', 'shu_chong_zheng_qi_gu',
    'shu_lian_nu_lian_she', 'shu_lian_nu_lian_she',
    'shu_huo_gong', 'shu_huo_gong',
    'shu_hao_jie_gui_xin', 'shu_hao_jie_gui_xin',

    // 4 Regular Single Tactics (1 copy each = 4 cards)
    'shu_chuan_xi_zhi_ji',
    'shu_sheng_dong_ji_xi',
    'shu_long_zhong_dui',
    'shu_shu_si_yi_zhan'
  ]),
  reserve: Object.freeze([
    'shu_bai_er_jun' // Summoned by Chen Dao's onDeploy ability
  ])
});

export const PRESET_DECKS = Object.freeze({
  WEI: WEI_PRESET_DECK,
  SHU: SHU_PRESET_DECK
});

// ==========================================
// 5. Input Normalization & Helpers
// ==========================================

function getCardMap(cardDatabase) {
  const db = cardDatabase || CARD_MAP;
  const map = Object.create(null);
  if (!db) return map;
  if (db instanceof Map) {
    for (const [k, v] of db.entries()) {
      map[k] = v;
    }
    return map;
  }
  if (Array.isArray(db)) {
    for (const c of db) {
      if (c && (c.id || c.cardId)) map[c.id || c.cardId] = c;
    }
    return map;
  }
  if (typeof db === 'object') {
    if (Array.isArray(db.wei) || Array.isArray(db.shu)) {
      const all = (db.wei || []).concat(db.shu || []);
      for (const c of all) {
        if (c && (c.id || c.cardId)) map[c.id || c.cardId] = c;
      }
      return map;
    }
    for (const key of Object.keys(db)) {
      if (Object.prototype.hasOwnProperty.call(db, key)) {
        map[key] = db[key];
      }
    }
    return map;
  }
  return map;
}

function findCardDef(cardId, cardMap) {
  if (!cardId || typeof cardId !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(cardMap, cardId)) return cardMap[cardId];
  if (Object.prototype.hasOwnProperty.call(cardMap, `${cardId}_1`)) return cardMap[`${cardId}_1`];
  const canonical = cardId.replace(/_[0-9]+$/, '');
  if (Object.prototype.hasOwnProperty.call(cardMap, canonical)) return cardMap[canonical];
  return null;
}

function canonicalizeCardId(cardId, cardMap) {
  if (typeof cardId !== 'string' || !cardId) return cardId;
  const def = findCardDef(cardId, cardMap);
  if (!def) {
    return cardId;
  }
  return (def.id || cardId).replace(/_[0-9]+$/, '');
}

/**
 * Normalizes various deck input formats into a canonical Map of counts.
 * @param {Array|object} deckInput
 * @param {object|Array} [cardDatabase=CARD_MAP]
 * @returns {{ mainCounts: Map<string, number>, reserveList: string[], faction: string|null, invalidEntries: any[] }}
 */
export function normalizeDeck(deckInput, cardDatabase = CARD_MAP) {
  if (!deckInput || typeof deckInput !== 'object') {
    return { mainCounts: new Map(), reserveList: [], faction: null, invalidEntries: [deckInput] };
  }

  const cardMap = getCardMap(cardDatabase);
  let mainItems = [];
  let reserveItems = [];
  let faction = null;
  const invalidEntries = [];

  if (Array.isArray(deckInput)) {
    mainItems = deckInput;
  } else if (typeof deckInput === 'object') {
    if (deckInput.main && Array.isArray(deckInput.main)) {
      mainItems = deckInput.main;
      reserveItems = deckInput.reserve || [];
      faction = deckInput.faction || null;
    } else if (deckInput.main && typeof deckInput.main === 'object' && !Array.isArray(deckInput.main)) {
      mainItems = Object.entries(deckInput.main).map(([cardId, count]) => ({ cardId, count }));
      reserveItems = deckInput.reserve || [];
      faction = deckInput.faction || null;
    } else {
      mainItems = Object.entries(deckInput).map(([cardId, count]) => ({ cardId, count }));
    }
  }

  const mainMap = new Map();
  for (const item of mainItems) {
    if (item === null || item === undefined) {
      invalidEntries.push(item);
      continue;
    }
    if (typeof item === 'string') {
      if (!item.trim()) {
        invalidEntries.push(item);
        continue;
      }
      const canonical = canonicalizeCardId(item, cardMap);
      mainMap.set(canonical, (mainMap.get(canonical) || 0) + 1);
    } else if (typeof item === 'object') {
      const rawId = item.cardId || item.id;
      if (!rawId || typeof rawId !== 'string') {
        invalidEntries.push(item);
        continue;
      }
      const canonical = canonicalizeCardId(rawId, cardMap);
      const cnt = item.count !== undefined ? Number(item.count) : 1;
      mainMap.set(canonical, (mainMap.get(canonical) || 0) + cnt);
    } else {
      invalidEntries.push(item);
    }
  }

  const reserveList = [];
  for (const item of reserveItems) {
    if (item === null || item === undefined) {
      invalidEntries.push(item);
      continue;
    }
    const id = typeof item === 'string' ? item : (item && (item.cardId || item.id));
    if (id && typeof id === 'string') {
      reserveList.push(id);
    } else {
      invalidEntries.push(item);
    }
  }

  return {
    mainCounts: mainMap,
    reserveList,
    faction,
    invalidEntries
  };
}

// ==========================================
// 6. Validation Engine
// ==========================================

/**
 * Validates a deck configuration against standard 40-card deck building rules.
 * @param {Array|object} deckInput
 * @param {object|Array} [cardDatabase=CARD_MAP]
 * @param {object} [options={}]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDeck(deckInput, cardDatabase = CARD_MAP, options = {}) {
  const errors = [];
  if (!deckInput || (typeof deckInput !== 'object' && !Array.isArray(deckInput))) {
    return { valid: false, errors: ['卡组数据不能为空'] };
  }

  const cardMap = getCardMap(cardDatabase);
  const { mainCounts, reserveList, faction, invalidEntries } = normalizeDeck(deckInput, cardDatabase);
  const targetFaction = options.faction || faction || null;

  if (invalidEntries && invalidEntries.length > 0) {
    errors.push(`卡组包含 ${invalidEntries.length} 个无效的空卡牌或格式错误条目`);
  }

  let totalCards = 0;
  for (const count of mainCounts.values()) {
    if (Number.isInteger(count) && count > 0) {
      totalCards += count;
    }
  }

  const exactCount = options.exactCount ?? DECK_RULES.EXACT_MAIN_DECK_COUNT;
  if (totalCards !== exactCount) {
    errors.push(`卡组总牌数必须恰好为 ${exactCount} 张，当前为 ${totalCards} 张`);
  }

  let mainFactionCount = 0;
  let allyFactionCount = 0;

  for (const [cardId, count] of mainCounts.entries()) {
    if (!Number.isInteger(count) || count <= 0) {
      errors.push(`卡牌【${cardId}】数量无效: 数量必须为正整数，当前为 ${count}`);
      continue;
    }

    const cardDef = findCardDef(cardId, cardMap);
    if (!cardDef) {
      errors.push(`未知的卡牌ID: ${cardId}`);
      continue;
    }

    const cardName = cardDef.name || cardId;
    const unique = isUniqueCard(cardId, cardDef);
    const maxAllowed = unique ? DECK_RULES.MAX_UNIQUE_COPIES : (cardDef.maxCopies || DECK_RULES.MAX_REGULAR_COPIES);

    if (count > maxAllowed) {
      if (unique) {
        errors.push(`唯一名将/名士【${cardName}】(${cardId})限编 ${maxAllowed} 张，当前编入 ${count} 张`);
      } else {
        errors.push(`常规卡牌【${cardName}】(${cardId})最多允许编入 ${maxAllowed} 张，当前编入 ${count} 张`);
      }
    }

    if (targetFaction) {
      const tf = targetFaction.toUpperCase();
      const cardFaction = (cardDef.kingdom || cardDef.faction || '').toUpperCase();
      const isDefector = (cardDef.keywords && cardDef.keywords.includes('降将')) || cardDef.type === 'defector';

      if (cardFaction) {
        if (cardFaction === tf) {
          mainFactionCount += count;
        } else if (!isDefector) {
          allyFactionCount += count;
        }
      }
    }
  }

  if (targetFaction && options.checkFaction !== false) {
    if (mainFactionCount < DECK_RULES.MIN_MAIN_FACTION_CARDS) {
      errors.push(`主势力卡牌数量不足: 主势力(${targetFaction})卡牌至少需要 ${DECK_RULES.MIN_MAIN_FACTION_CARDS} 张，当前仅有 ${mainFactionCount} 张`);
    }
    if (allyFactionCount > DECK_RULES.MAX_ALLY_FACTION_CARDS) {
      errors.push(`联盟势力卡牌超标: 联盟势力卡牌最多允许 ${DECK_RULES.MAX_ALLY_FACTION_CARDS} 张，当前有 ${allyFactionCount} 张`);
    }
  }

  if (reserveList.length > DECK_RULES.MAX_RESERVE_CARDS) {
    errors.push(`备用区卡牌数量超标: 最大允许 ${DECK_RULES.MAX_RESERVE_CARDS} 张，当前为 ${reserveList.length} 张`);
  }

  for (const reserveId of reserveList) {
    if (!findCardDef(reserveId, cardMap)) {
      errors.push(`备用区存在未知的卡牌ID: ${reserveId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ==========================================
// 7. Deck Statistics & Instantiation
// ==========================================

/**
 * Calculates statistical breakdown (cost curve, troop breakdown, card types) for a deck.
 * @param {Array|object} deckInput
 * @param {object|Array} [cardDatabase=CARD_MAP]
 * @returns {object}
 */
export function getDeckStats(deckInput, cardDatabase = CARD_MAP) {
  const { mainCounts, reserveList } = normalizeDeck(deckInput, cardDatabase);
  const cardMap = getCardMap(cardDatabase);

  let totalCards = 0;
  let totalCost = 0;
  let unitsCount = 0;
  let tacticsCount = 0;
  let countersCount = 0;
  let uniqueCount = 0;

  const costCurve = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8+': 0 };
  const troopBreakdown = { infantry: 0, cavalry: 0, navy: 0, strategist: 0, archer: 0, none: 0 };

  for (const [cardId, count] of mainCounts.entries()) {
    totalCards += count;
    const def = findCardDef(cardId, cardMap);
    if (!def) continue;

    const cost = def.cost || 0;
    totalCost += cost * count;

    const curveKey = cost >= 8 ? '8+' : String(cost);
    if (costCurve[curveKey] !== undefined) {
      costCurve[curveKey] += count;
    }

    if (def.type === 'unit') unitsCount += count;
    else if (def.type === 'tactic') tacticsCount += count;
    else if (def.type === 'counter') countersCount += count;

    if (isUniqueCard(cardId, def)) uniqueCount += count;

    const troop = (def.troopType || def.troop_type || 'none').toLowerCase();
    if (troopBreakdown[troop] !== undefined) {
      troopBreakdown[troop] += count;
    }
  }

  return {
    totalCards,
    reserveCount: reserveList.length,
    avgCost: totalCards > 0 ? Number((totalCost / totalCards).toFixed(2)) : 0,
    unitsCount,
    tacticsCount,
    countersCount,
    uniqueCount,
    regularCount: totalCards - uniqueCount,
    costCurve,
    troopBreakdown
  };
}

/**
 * Instantiates runtime card objects for a deck using an instance factory function.
 * @param {Array|object} deckInput
 * @param {object|Array} cardDatabase
 * @param {Function} createCardFn
 * @returns {{ mainDeck: object[], reservePool: object[] }}
 */
export function instantiateDeck(deckInput, cardDatabase = CARD_MAP, createCardFn) {
  if (typeof createCardFn !== 'function') {
    throw new TypeError('instantiateDeck requires a valid createCardFn factory function');
  }
  const { mainCounts, reserveList } = normalizeDeck(deckInput, cardDatabase);
  const cardMap = getCardMap(cardDatabase);

  const mainDeck = [];
  for (const [cardId, count] of mainCounts.entries()) {
    if (!Number.isInteger(count) || count <= 0) continue;
    const def = findCardDef(cardId, cardMap);
    if (!def) {
      throw new Error(`Cannot instantiate unknown card: ${cardId}`);
    }
    for (let i = 0; i < count; i++) {
      mainDeck.push(createCardFn(def));
    }
  }

  const reservePool = [];
  for (const reserveId of reserveList) {
    const def = findCardDef(reserveId, cardMap);
    if (!def) {
      throw new Error(`Cannot instantiate unknown reserve card: ${reserveId}`);
    }
    reservePool.push(createCardFn(def));
  }

  return {
    mainDeck,
    reservePool
  };
}

export default PRESET_DECKS;
