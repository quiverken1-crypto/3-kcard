/**
 * verifyMilestone1.js
 * Verification test suite for Milestone 1: Card Pool & Deck Data.
 * Validates 64 cards schema, terrain mechanics, preset decks, and deck validation engine.
 */

import assert from 'node:assert/strict';
import { WEI_CARDS, WEI_CARD_MAP } from '../js/data/cardsWei.js';
import { SHU_CARDS, SHU_CARD_MAP } from '../js/data/cardsShu.js';
import {
  ALL_CARDS,
  CARD_MAP,
  getCardById,
  getCardsByFaction,
  getCardsByKingdom,
  getCardsByType
} from '../js/data/cards.js';
import {
  TERRAINS,
  TERRAIN_TYPES,
  DEFAULT_TERRAIN_POOL,
  setupFrontlineTerrains,
  actsLikeCavalryOnTerrain,
  getEffectiveActionCost,
  getEffectiveAtk,
  getEffectiveKeywords,
  getZoneCapacity,
  isZoneAtCapacity,
  canUnitEnterZone
} from '../js/data/terrains.js';
import {
  DECK_RULES,
  UNIQUE_GENERAL_IDS,
  isUniqueCard,
  WEI_PRESET_DECK,
  SHU_PRESET_DECK,
  PRESET_DECKS,
  normalizeDeck,
  validateDeck,
  getDeckStats,
  instantiateDeck
} from '../js/data/decks.js';

console.log('='.repeat(80));
console.log('         MILESTONE 1 DATA LAYER COMPREHENSIVE VERIFICATION');
console.log('='.repeat(80));

let assertionsRun = 0;
function check(condition, message) {
  assert.ok(condition, message);
  assertionsRun++;
}

// ----------------------------------------------------
// 1. Card Pool Counts and Structure
// ----------------------------------------------------
console.log('\n[Suite 1] Card Pool Inventory & Schema Validation');

check(WEI_CARDS.length === 32, `Exactly 32 Wei cards expected, got ${WEI_CARDS.length}`);
check(SHU_CARDS.length === 32, `Exactly 32 Shu cards expected, got ${SHU_CARDS.length}`);
check(ALL_CARDS.length === 64, `Exactly 64 total cards expected, got ${ALL_CARDS.length}`);
check(Object.keys(WEI_CARD_MAP).length >= 32, 'WEI_CARD_MAP has at least 32 keys');
check(Object.keys(SHU_CARD_MAP).length >= 32, 'SHU_CARD_MAP has at least 32 keys');
check(Object.keys(CARD_MAP).length >= 64, 'Master CARD_MAP has at least 64 keys');

const allowedTypes = new Set(['unit', 'tactic', 'counter']);
const allowedTroopTypes = new Set(['cavalry', 'infantry', 'archer', 'navy', 'strategist', 'none']);

for (const card of ALL_CARDS) {
  const prefix = `[Card ${card.id}]`;

  // 15 Standard Schema Properties
  check(typeof card.id === 'string' && card.id.length > 0, `${prefix} id is non-empty string`);
  check(typeof card.name === 'string' && card.name.length > 0, `${prefix} name is non-empty string`);
  check(typeof card.pinyin === 'string' && card.pinyin.length > 0, `${prefix} pinyin is non-empty string`);
  check(card.kingdom === 'wei' || card.kingdom === 'shu', `${prefix} kingdom is 'wei' or 'shu'`);
  check(allowedTypes.has(card.type), `${prefix} type '${card.type}' is valid`);
  check(allowedTroopTypes.has(card.troop_type), `${prefix} troop_type '${card.troop_type}' is valid`);
  check(typeof card.cost === 'number' && card.cost >= 0 && Number.isInteger(card.cost), `${prefix} cost is non-negative int`);
  check(typeof card.action_cost === 'number' && card.action_cost >= 0 && Number.isInteger(card.action_cost), `${prefix} action_cost is non-negative int`);
  check(typeof card.attack === 'number' && card.attack >= 0 && Number.isInteger(card.attack), `${prefix} attack is non-negative int`);
  check(typeof card.hp === 'number' && card.hp >= 0 && Number.isInteger(card.hp), `${prefix} hp is non-negative int`);
  check(typeof card.max_hp === 'number' && card.max_hp >= 0 && Number.isInteger(card.max_hp), `${prefix} max_hp is non-negative int`);
  check(Array.isArray(card.keywords), `${prefix} keywords is array`);
  check(Array.isArray(card.badges), `${prefix} badges is array`);
  check(typeof card.skill === 'object' && card.skill !== null, `${prefix} skill is object`);
  check(typeof card.skill.name === 'string', `${prefix} skill.name is string`);
  check(typeof card.skill.trigger === 'string', `${prefix} skill.trigger is string`);
  check(typeof card.skill.description === 'string', `${prefix} skill.description is string`);
  check(typeof card.skill.logic === 'string', `${prefix} skill.logic is string`);
  check(typeof card.flavor === 'string', `${prefix} flavor is string`);

  // Max HP derivation rule
  if (card.type === 'unit') {
    check(card.max_hp === card.hp, `${prefix} unit max_hp equals initial hp`);
  } else {
    check(card.max_hp === 0 && card.hp === 0 && card.attack === 0, `${prefix} non-unit has 0 atk/hp/max_hp`);
  }

  // Dual-compatibility Aliases
  check(card.cardId === card.id, `${prefix} cardId alias matches id`);
  check(card.faction === card.kingdom.toUpperCase(), `${prefix} faction alias is uppercase kingdom`);
  check(card.troopType === card.troop_type.toUpperCase(), `${prefix} troopType alias is uppercase troop_type`);
  check(card.actionCost === card.action_cost, `${prefix} actionCost alias matches action_cost`);
  check(card.atk === card.attack, `${prefix} atk alias matches attack`);
  check(card.maxHp === card.max_hp, `${prefix} maxHp alias matches max_hp`);
}
console.log(`  ✔ All 64 cards strictly adhere to the 15-field schema + 6 compatibility aliases.`);

// ----------------------------------------------------
// 2. Query Methods in cards.js
// ----------------------------------------------------
console.log('\n[Suite 2] Card Query Aggregator Functions');

check(getCardById('wei_qing_qi_bing')?.name === '轻骑兵', 'getCardById resolves exact id');
check(getCardById('wei_pi_li_che')?.name === '霹雳车', 'getCardById resolves base alias id');
check(getCardById('wei_pi_li_che_1')?.name === '霹雳车', 'getCardById resolves disambiguated id');
check(getCardById('shu_wu_dang_fei_jun')?.name === '无当飞军', 'getCardById resolves Shu alias id');
check(getCardById('non_existent') === null, 'getCardById returns null for missing id');

check(getCardsByFaction('WEI').length === 32, 'getCardsByFaction(WEI) returns 32');
check(getCardsByFaction('shu').length === 32, 'getCardsByFaction(shu) case-insensitive returns 32');
check(getCardsByKingdom('wei').length === 32, 'getCardsByKingdom(wei) returns 32');
check(getCardsByType('unit').length === 47, 'getCardsByType(unit) returns exactly 47 units');
check(getCardsByType('tactic').length === 16, 'getCardsByType(tactic) returns exactly 16 tactics');
check(getCardsByType('counter').length === 1, 'getCardsByType(counter) returns exactly 1 counter');
console.log('  ✔ All cards.js lookup and filtering queries operate correctly.');

// ----------------------------------------------------
// 3. Terrain System & Interactions
// ----------------------------------------------------
console.log('\n[Suite 3] Terrain Types & Interaction Mechanics');

check(TERRAINS.PLAIN.capacity === 3, 'PLAIN capacity is 3');
check(TERRAINS.WATER.capacity === 3, 'WATER capacity is 3');
check(TERRAINS.MOUNTAIN.capacity === 2, 'MOUNTAIN capacity is 2');
check(TERRAINS.PASS.capacity === 2, 'PASS capacity is 2');
check(DEFAULT_TERRAIN_POOL.length === 4, 'DEFAULT_TERRAIN_POOL has 4 cards');

const setup = setupFrontlineTerrains();
check(setup.frontline && setup.frontline.LEFT && setup.frontline.CENTER && setup.frontline.RIGHT, 'Frontline has 3 zones');
check(setup.reserve && setup.reserve.id, 'Reserve terrain exists');

// Mobility test
const cavalryUnit = { troopType: 'CAVALRY' };
const navyUnit = { troopType: 'NAVY' };
const infantryUnit = { troopType: 'INFANTRY' };
const guanYuUnit = { troopType: 'CAVALRY', cardId: 'shu_guan_yu', name: '关羽' };

check(actsLikeCavalryOnTerrain(cavalryUnit, TERRAINS.PLAIN) === true, 'Cavalry acts like cavalry on Plain');
check(actsLikeCavalryOnTerrain(cavalryUnit, TERRAINS.WATER) === true, 'Cavalry acts like cavalry on Water');
check(actsLikeCavalryOnTerrain(navyUnit, TERRAINS.WATER) === true, 'Navy gains cavalry mobility on Water');
check(actsLikeCavalryOnTerrain(navyUnit, TERRAINS.PLAIN) === false, 'Navy lacks cavalry mobility on Plain');
check(actsLikeCavalryOnTerrain(infantryUnit, TERRAINS.WATER) === false, 'Infantry lacks cavalry mobility on Water');
check(actsLikeCavalryOnTerrain(guanYuUnit, TERRAINS.WATER) === true, 'Guan Yu gains Navy water mobility');

// Terrain synergies
const wuDang = { cardId: 'shu_wu_dang_fei_jun_1', name: '无当飞军', actionCost: 1 };
check(getEffectiveActionCost(wuDang, TERRAINS.MOUNTAIN) === 0, 'Wu Dang in Mountain actionCost is 0');
check(getEffectiveActionCost(wuDang, TERRAINS.PLAIN) === 1, 'Wu Dang in Plain actionCost is 1');

const huangZhong = { cardId: 'shu_huang_zhong', name: '黄忠', atk: 5, keywords: ['突袭', '矢石'] };
check(getEffectiveAtk(huangZhong, TERRAINS.MOUNTAIN) === 7, 'Huang Zhong in Mountain gains +2 ATK (7)');
check(getEffectiveAtk(huangZhong, TERRAINS.PLAIN) === 5, 'Huang Zhong in Plain keeps base ATK (5)');
check(getEffectiveKeywords(huangZhong, TERRAINS.MOUNTAIN).includes('先登'), 'Huang Zhong in Mountain gains 先登');
check(!getEffectiveKeywords(huangZhong, TERRAINS.PLAIN).includes('先登'), 'Huang Zhong in Plain does not have 先登');

// Spatial rules
check(isZoneAtCapacity({ units: [1, 2] }, TERRAINS.MOUNTAIN) === true, 'Mountain at 2 units is at capacity');
check(isZoneAtCapacity({ units: [1] }, TERRAINS.MOUNTAIN) === false, 'Mountain at 1 unit is not at capacity');
check(isZoneAtCapacity({ units: [1, 2] }, TERRAINS.PLAIN) === false, 'Plain at 2 units is not at capacity');
check(isZoneAtCapacity({ units: [1, 2, 3] }, TERRAINS.PLAIN) === true, 'Plain at 3 units is at capacity');

check(canUnitEnterZone({}, { occupant: null, units: [] }, 'WEI', TERRAINS.PLAIN) === true, 'Can enter empty zone');
check(canUnitEnterZone({}, { occupant: 'WEI', units: [1] }, 'WEI', TERRAINS.PLAIN) === true, 'Can enter friendly zone');
check(canUnitEnterZone({}, { occupant: 'SHU', units: [1] }, 'WEI', TERRAINS.PLAIN) === false, 'Cannot enter enemy zone');
check(canUnitEnterZone({}, { occupant: 'WEI', units: [1, 2] }, 'WEI', TERRAINS.MOUNTAIN) === false, 'Cannot enter full friendly zone');
console.log('  ✔ Terrain rules, capacity checks, and card synergies function as specified.');

// ----------------------------------------------------
// 4. Deck Presets and Validation Engine
// ----------------------------------------------------
console.log('\n[Suite 4] Preset Decks & Validation Engine');

check(WEI_PRESET_DECK.main.length === 40, `Wei preset main has 40 cards, got ${WEI_PRESET_DECK.main.length}`);
check(SHU_PRESET_DECK.main.length === 40, `Shu preset main has 40 cards, got ${SHU_PRESET_DECK.main.length}`);
check(SHU_PRESET_DECK.reserve.length === 1, `Shu preset reserve has 1 card, got ${SHU_PRESET_DECK.reserve.length}`);
check(SHU_PRESET_DECK.reserve[0] === 'shu_bai_er_jun', 'Shu preset reserve is shu_bai_er_jun');

const weiVal = validateDeck(WEI_PRESET_DECK);
check(weiVal.valid === true, `Wei preset deck is valid: ${JSON.stringify(weiVal.errors)}`);

const shuVal = validateDeck(SHU_PRESET_DECK);
check(shuVal.valid === true, `Shu preset deck is valid: ${JSON.stringify(shuVal.errors)}`);

// Boundary tests for validateDeck
// 1. Under-capacity (39 cards)
const deck39 = { ...WEI_PRESET_DECK, main: WEI_PRESET_DECK.main.slice(0, 39) };
const val39 = validateDeck(deck39);
check(val39.valid === false && val39.errors.some(e => e.includes('40')), 'Rejects 39-card deck');

// 2. Over-capacity (41 cards)
const deck41 = { ...WEI_PRESET_DECK, main: [...WEI_PRESET_DECK.main, 'wei_qing_qi_bing'] };
const val41 = validateDeck(deck41);
check(val41.valid === false && val41.errors.some(e => e.includes('40')), 'Rejects 41-card deck');

// 3. Unique general duplicate (2x Cao Cao)
const deckDupCaoCao = {
  ...WEI_PRESET_DECK,
  main: ['wei_cao_cao', 'wei_cao_cao', ...WEI_PRESET_DECK.main.slice(2)]
};
const valDup = validateDeck(deckDupCaoCao);
check(valDup.valid === false && valDup.errors.some(e => e.includes('曹操')), 'Rejects 2 copies of unique general Cao Cao');

// 4. Regular card over limit (4x Qing Qi Bing)
const deck4Qing = {
  faction: 'WEI',
  main: [
    'wei_qing_qi_bing', 'wei_qing_qi_bing', 'wei_qing_qi_bing', 'wei_qing_qi_bing',
    ...WEI_PRESET_DECK.main.slice(4)
  ]
};
const val4Qing = validateDeck(deck4Qing);
check(val4Qing.valid === false && val4Qing.errors.some(e => e.includes('轻骑兵')), 'Rejects 4 copies of regular card');

// 5. Unknown card ID
const deckUnknown = {
  ...WEI_PRESET_DECK,
  main: ['unknown_card_xyz', ...WEI_PRESET_DECK.main.slice(1)]
};
const valUnknown = validateDeck(deckUnknown);
check(valUnknown.valid === false && valUnknown.errors.some(e => e.includes('未知的卡牌ID')), 'Rejects unknown card ID');

// 6. Defector cross-faction integration
const deckWithDefector = {
  id: 'wei_with_defector',
  faction: 'WEI',
  main: [
    'shu_mi_fang', // Defector card from Shu in Wei deck
    ...WEI_PRESET_DECK.main.slice(1)
  ]
};
const valDefector = validateDeck(deckWithDefector);
check(valDefector.valid === true, `Defector card Mi Fang allowed in Wei deck without ally penalty: ${JSON.stringify(valDefector.errors)}`);

// Deck stats & instantiation
const weiStats = getDeckStats(WEI_PRESET_DECK);
check(weiStats.totalCards === 40, 'Wei stats totalCards is 40');
check(weiStats.avgCost === 3.8, `Wei stats avgCost is 3.8, got ${weiStats.avgCost}`);
check(weiStats.uniqueCount === 20, 'Wei stats uniqueCount is 20');

const shuStats = getDeckStats(SHU_PRESET_DECK);
check(shuStats.totalCards === 40, 'Shu stats totalCards is 40');
check(shuStats.avgCost === 3.45, `Shu stats avgCost is 3.45, got ${shuStats.avgCost}`);
check(shuStats.uniqueCount === 18, 'Shu stats uniqueCount is 18');

const instShu = instantiateDeck(SHU_PRESET_DECK, undefined, def => ({
  instId: 'inst_' + Math.random(),
  ...def
}));
check(instShu.mainDeck.length === 40, 'Instantiated Shu deck has 40 card objects');
check(instShu.reservePool.length === 1, 'Instantiated Shu reserve pool has 1 card object');

console.log('  ✔ Preset decks, boundary rules, statistics, and instantiation all pass.');

console.log('\n' + '='.repeat(80));
console.log(`MILESTONE 1 VERIFICATION COMPLETE: ALL ${assertionsRun} ASSERTIONS PASSED [SUCCESS]`);
console.log('='.repeat(80));
