/**
 * cards.js — Master Card Pool Aggregator & Registry
 * Aggregates all 64 cards from Wei (32) and Shu (32) factions.
 */

import { WEI_CARDS, WEI_CARD_MAP } from './cardsWei.js';
import { SHU_CARDS, SHU_CARD_MAP } from './cardsShu.js';

export { WEI_CARDS, WEI_CARD_MAP } from './cardsWei.js';
export { SHU_CARDS, SHU_CARD_MAP } from './cardsShu.js';

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

for (const card of WEI_CARDS) deepFreeze(card);
for (const card of SHU_CARDS) deepFreeze(card);
deepFreeze(WEI_CARD_MAP);
deepFreeze(SHU_CARD_MAP);

export const ALL_CARDS = Object.freeze([...WEI_CARDS, ...SHU_CARDS]);

import { DB_CARD_MAP } from './cardDB.js';

// 实体卡版数据优先；旧图鉴数据仅作兜底
export const CARD_MAP = Object.freeze({
  ...WEI_CARD_MAP,
  ...SHU_CARD_MAP,
  ...DB_CARD_MAP
});

function cloneCard(card) {
  if (!card) return null;
  return {
    ...card,
    keywords: Array.isArray(card.keywords) ? [...card.keywords] : [],
    badges: Array.isArray(card.badges) ? [...card.badges] : [],
    skill: card.skill ? { ...card.skill } : null
  };
}

/**
 * Retrieves a card definition by ID with fallback alias resolution.
 * @param {string} id
 * @returns {object|null}
 */
export function getCardById(id) {
  if (typeof id !== 'string' || !id) return null;
  let card = null;
  if (Object.prototype.hasOwnProperty.call(CARD_MAP, id)) {
    card = CARD_MAP[id];
  } else if (Object.prototype.hasOwnProperty.call(CARD_MAP, `${id}_1`)) {
    card = CARD_MAP[`${id}_1`];
  } else {
    const canonical = id.replace(/_[0-9]+$/, '');
    if (Object.prototype.hasOwnProperty.call(CARD_MAP, canonical)) {
      card = CARD_MAP[canonical];
    }
  }
  return cloneCard(card);
}

/**
 * Filters cards by faction (case-insensitive, e.g. 'WEI', 'SHU').
 * @param {string} faction
 * @returns {object[]}
 */
export function getCardsByFaction(faction) {
  if (!faction) return [];
  const target = String(faction).toUpperCase();
  return ALL_CARDS.filter(c => (c.faction || '').toUpperCase() === target || (c.kingdom || '').toUpperCase() === target);
}

/**
 * Filters cards by kingdom (case-insensitive, e.g. 'wei', 'shu').
 * @param {string} kingdom
 * @returns {object[]}
 */
export function getCardsByKingdom(kingdom) {
  if (!kingdom) return [];
  const target = String(kingdom).toLowerCase();
  return ALL_CARDS.filter(c => (c.kingdom || '').toLowerCase() === target || (c.faction || '').toLowerCase() === target);
}

/**
 * Filters cards by entity type (case-insensitive, e.g. 'unit', 'tactic', 'counter').
 * @param {string} type
 * @returns {object[]}
 */
export function getCardsByType(type) {
  if (!type) return [];
  const target = String(type).toLowerCase();
  return ALL_CARDS.filter(c => (c.type || '').toLowerCase() === target);
}

export default CARD_MAP;
