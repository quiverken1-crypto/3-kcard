import { createCard, createKingdomDeck } from '../engine/state.js';
import { ABILITY_TRIGGERS, EFFECT_TYPES, EFFECT_TARGETS } from '../engine/abilities.js';

export const CUSTOM_CARDS_KEY = 'sanguo-kards-custom-cards-v1';
const ID_RE = /^[a-z][a-z0-9_-]{2,48}$/;
const TROOPS = new Set(['INFANTRY', 'CAVALRY', 'ARCHER', 'NAVY', 'STRATEGIST']);
const TYPES = new Set(['UNIT', 'TACTIC', 'COUNTER']);
const FACTIONS = new Set(['WEI', 'SHU']);
const AUDIO_CUES = new Set(['auto', 'none', 'sword', 'fireball', 'footstep', 'cavalry', 'water', 'spell']);
const PLAYER_EFFECTS = new Set(['DRAW','STEAL_CARD','DISCARD_RANDOM','GAIN_PRESTIGE','REMOVE_PRESTIGE','GAIN_PROVISIONS','STEAL_PROVISIONS','GAIN_CAPACITY','DAMAGE_HQ','HEAL_HQ']);

const shortText = (value, label, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}必须为1至${max}字`);
  return value.trim();
};
const numberIn = (value, label, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}必须为${min}至${max}的整数`);
  return value;
};

export function normalizeCardPack(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1 || !Array.isArray(input.cards)) {
    throw new Error('卡包必须包含 schemaVersion: 1 和 cards 数组');
  }
  if (input.cards.length > 40) throw new Error('一个卡包最多40张自定义牌');
  const ids = new Set();
  const cards = input.cards.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`第${index + 1}张卡格式错误`);
    const id = shortText(raw.id, 'id', 49);
    if (!ID_RE.test(id) || ids.has(id)) throw new Error(`无效或重复的卡牌 id: ${id}`);
    ids.add(id);
    const faction = shortText(raw.faction, '势力', 3).toUpperCase();
    const type = shortText(raw.type, '类别', 8).toUpperCase();
    const troopType = type === 'UNIT' ? shortText(raw.troopType || 'INFANTRY', '兵种', 12).toUpperCase() : 'NONE';
    if (!FACTIONS.has(faction) || !TYPES.has(type) || (type === 'UNIT' && !TROOPS.has(troopType))) throw new Error(`第${index + 1}张卡的势力、类别或兵种无效`);
    const keywords = raw.keywords ?? [];
    if (!Array.isArray(keywords) || keywords.length > 8) throw new Error('词条最多8个');
    const abilities = raw.abilities ?? [];
    if (!Array.isArray(abilities) || abilities.length > 8) throw new Error('技能最多8项');
    const audioCue = String(raw.audioCue || 'auto').toLowerCase();
    if (!AUDIO_CUES.has(audioCue)) throw new Error('不支持的卡牌音效');
    return {
      id, cardId: id, name: shortText(raw.name, '卡名', 32), faction, type, troopType,
      audioCue,
      cost: numberIn(raw.cost, '粮草费用', 0, 10),
      actionCost: numberIn(raw.actionCost ?? 1, '行动费用', 0, 10),
      atk: type === 'UNIT' ? numberIn(raw.atk, '战力', 0, 20) : 0,
      hp: type === 'UNIT' ? numberIn(raw.hp, '生命', 1, 30) : 0,
      maxHp: type === 'UNIT' ? raw.hp : 0,
      keywords: keywords.map(kw => shortText(kw, '词条', 24)),
      skill: { name: shortText(raw.skillName || raw.skill?.name || raw.name, '技能名', 32), description: shortText(raw.description || raw.skill?.description, '技能描述', 300) },
      abilities: abilities.map((ability, abilityIndex) => {
        const trigger = shortText(ability?.trigger, '触发时机', 24).toUpperCase();
        if (!ABILITY_TRIGGERS.includes(trigger)) throw new Error(`第${index + 1}张卡第${abilityIndex + 1}项触发时机无效`);
        if (!Array.isArray(ability.effects) || ability.effects.length === 0 || ability.effects.length > 8) throw new Error('每项技能须有1至8个效果');
        const conditions = ability.conditions ?? [];
        if (!Array.isArray(conditions) || conditions.length > 8) throw new Error('条件最多8项');
        return {
          trigger,
          conditions: conditions.map(condition => {
            const field = shortText(condition?.field, '条件字段', 24).toUpperCase();
            const op = shortText(condition?.op, '比较方式', 4).toUpperCase();
            if (!['OWNER_PROVISIONS','OWNER_PRESTIGE','ENEMY_PROVISIONS','SOURCE_HP','TARGET_HP','TURN_NUMBER','TARGET_DIED','SOURCE_SURVIVED'].includes(field) || !['EQ','GTE','LTE'].includes(op)) throw new Error('不支持的技能条件');
            return { field, op, value: numberIn(condition.value, '条件值', 0, 100) };
          }),
          effects: ability.effects.map(effect => {
            const effectType = shortText(effect?.type, '效果类型', 24).toUpperCase();
            const target = shortText(effect?.target || 'OWNER', '目标', 24).toUpperCase();
            if (!EFFECT_TYPES.includes(effectType)) throw new Error(`不支持的 effect: ${effectType}`);
            if (!EFFECT_TARGETS.includes(target)) throw new Error(`不支持的目标: ${target}`);
            if (PLAYER_EFFECTS.has(effectType) && !['OWNER','OPPONENT'].includes(target)) throw new Error(`${effectType} 只能选择 OWNER 或 OPPONENT`);
            if (!PLAYER_EFFECTS.has(effectType) && ['OWNER','OPPONENT'].includes(target)) throw new Error(`${effectType} 需要选择具体单位目标`);
            if (['STEAL_CARD','STEAL_PROVISIONS'].includes(effectType) && target !== 'OPPONENT') throw new Error(`${effectType} 的目标必须是 OPPONENT`);
            const result = { type: effectType, target, amount: numberIn(effect.amount ?? 1, '效果数值', 0, 20) };
            if (['GRANT_KEYWORD','REMOVE_KEYWORD'].includes(effectType)) result.keyword = shortText(effect.keyword, '词条', 24);
            return result;
          })
        };
      })
    };
  });
  for (const faction of FACTIONS) {
    if (cards.filter(card => card.faction === faction).length > 20) throw new Error('每个势力最多20张自定义牌');
  }
  return { schemaVersion: 1, cards };
}

export function buildDeckOptions(pack, kingdoms = {}) {
  const normalized = normalizeCardPack(pack);
  const out = {};
  for (const seat of ['WEI', 'SHU']) {
    const additions = normalized.cards.filter(card => card.faction === seat).map(card => createCard(card, { faction: seat }));
    if (!additions.length) continue; // 无自定义卡时使用所选势力的标准卡组
    const built = createKingdomDeck(kingdoms[seat] || seat.toLowerCase(), seat);
    out[seat === 'WEI' ? 'weiDeck' : 'shuDeck'] = [...built.mainDeck.slice(0, 40 - additions.length), ...additions];
    out[seat === 'WEI' ? 'weiReserve' : 'shuReserve'] = built.reservePool;
  }
  return out;
}

export function loadSavedCardPack(storage = globalThis.localStorage) {
  if (!storage) return { schemaVersion: 1, cards: [] };
  const raw = storage.getItem(CUSTOM_CARDS_KEY);
  return raw ? normalizeCardPack(JSON.parse(raw)) : { schemaVersion: 1, cards: [] };
}

export function saveCardPack(pack, storage = globalThis.localStorage) {
  const normalized = normalizeCardPack(pack);
  storage.setItem(CUSTOM_CARDS_KEY, JSON.stringify(normalized));
  return normalized;
}
