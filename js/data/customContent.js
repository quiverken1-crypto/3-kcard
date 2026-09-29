/**
 * customContent.js — 自定义内容 v2：自定义势力 + 自定义卡牌（本机保存、卡包码、批量导出）
 *
 * 卡包格式（schemaVersion: 2）：
 * {
 *   schemaVersion: 2,
 *   factions: [{ key:'c_jin', name:'晋', army:'晋军', color:'#5b6b8a', hqs:[{ id, name, terrains:['PLAIN','WATER'] }, …] }],
 *   cards: [{
 *     id, name, kingdom,            // kingdom：内置 wei/shu/wu/lb 或自定义势力 key
 *     type: UNIT|TACTIC|COUNTER, troopType: INFANTRY|CAVALRY|NAVY|STRATEGIST|ARCHER,
 *     cost, actionCost, atk, hp, copies(1-3),
 *     keywords:[…], badges:[性格…], customKeywords:[{ name, description }],
 *     skill:{ name, description }, abilities:[积木技能…], pending:true/false（文字技能待开发者实现）
 *   }]
 * }
 * 兼容旧版 schemaVersion: 1（faction: WEI/SHU）。
 * 保存在浏览器 localStorage（sgk_custom_v2）；导出文件 / 卡包码（SGKP1-…）用于分享和提交给开发者并入官方卡牌库。
 */
import { KINGDOMS, BUILTIN_KINGDOMS, DB_CARD_MAP, registerKingdom, unregisterKingdom } from './cardDB.js';
import { registerHqs, unregisterHqs } from './terrains.js';
import { ABILITY_TRIGGERS, EFFECT_TYPES, EFFECT_TARGETS } from '../engine/abilities.js';
import { CUSTOM_CARDS_KEY } from './customCards.js';

export const CUSTOM_V2_KEY = 'sgk_custom_v2';
export const TROOP_OPTIONS = ['INFANTRY', 'CAVALRY', 'NAVY', 'STRATEGIST', 'ARCHER'];
export const TERRAIN_OPTIONS = ['PLAIN', 'WATER', 'FOREST', 'MOUNTAIN', 'PASS'];
const TYPES = ['UNIT', 'TACTIC', 'COUNTER'];
const PLAYER_EFFECTS = new Set(['DRAW', 'STEAL_CARD', 'DISCARD_RANDOM', 'GAIN_PRESTIGE', 'REMOVE_PRESTIGE', 'GAIN_PROVISIONS', 'STEAL_PROVISIONS', 'GAIN_CAPACITY', 'DAMAGE_HQ', 'HEAL_HQ']);
const CONDITION_FIELDS = ['OWNER_PROVISIONS', 'OWNER_PRESTIGE', 'ENEMY_PROVISIONS', 'SOURCE_HP', 'TARGET_HP', 'TURN_NUMBER', 'TARGET_DIED', 'SOURCE_SURVIVED'];

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const text = (v, label, max, { optional = false } = {}) => {
  if ((v === undefined || v === null || v === '') && optional) return '';
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new Error(`${label}需为1至${max}字`);
  return v.trim();
};
const int = (v, label, min, max, dflt = undefined) => {
  if ((v === undefined || v === null || v === '') && dflt !== undefined) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}需为${min}至${max}的整数`);
  return n;
};
const ID_RE = /^[a-z][a-z0-9_]{2,40}$/;

export const newCustomId = (prefix = 'c') => `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

function normalizeAbilities(list, where) {
  if (!Array.isArray(list)) return [];
  if (list.length > 8) throw new Error(`${where}：积木技能最多8条`);
  return list.map((ab, i) => {
    const trigger = String(ab?.trigger || '').toUpperCase();
    if (!ABILITY_TRIGGERS.includes(trigger)) throw new Error(`${where} 第${i + 1}条技能：触发时机无效`);
    const effects = (ab.effects || []).map(ef => {
      const type = String(ef?.type || '').toUpperCase();
      const target = String(ef?.target || 'OWNER').toUpperCase();
      if (!EFFECT_TYPES.includes(type)) throw new Error(`${where}：不支持的效果 ${type}`);
      if (!EFFECT_TARGETS.includes(target)) throw new Error(`${where}：不支持的目标 ${target}`);
      if (PLAYER_EFFECTS.has(type) !== ['OWNER', 'OPPONENT'].includes(target)) throw new Error(`${where}：效果 ${type} 与目标 ${target} 不匹配`);
      const out = { type, target, amount: int(ef.amount, '效果数值', 0, 20, 1) };
      if (['GRANT_KEYWORD', 'REMOVE_KEYWORD'].includes(type)) out.keyword = text(ef.keyword, '词条', 24);
      return out;
    });
    if (!effects.length || effects.length > 8) throw new Error(`${where} 第${i + 1}条技能需要1至8个效果`);
    const conditions = (ab.conditions || []).map(c => {
      const field = String(c?.field || '').toUpperCase();
      const op = String(c?.op || '').toUpperCase();
      if (!CONDITION_FIELDS.includes(field) || !['EQ', 'GTE', 'LTE'].includes(op)) throw new Error(`${where}：不支持的条件`);
      return { field, op, value: int(c.value, '条件值', 0, 100) };
    });
    return { trigger, conditions, effects };
  });
}

function normalizeFaction(f, i) {
  const key = text(f?.key, `第${i + 1}个势力的标识`, 40);
  if (!ID_RE.test(key) || BUILTIN_KINGDOMS.includes(key)) throw new Error(`势力标识无效：${key}`);
  const name = text(f.name, '势力简称', 2);
  const hqs = (f.hqs || []).slice(0, 4).map((h, j) => {
    const terrains = (h?.terrains || []).map(t => String(t).toUpperCase());
    if (terrains.length !== 2 || terrains.some(t => !TERRAIN_OPTIONS.includes(t))) throw new Error(`势力【${name}】第${j + 1}座主城需要2个有效地形`);
    return { id: text(h.id || `${key}_hq${j + 1}`, '主城标识', 40), name: text(h.name, '主城名称', 6), terrains };
  });
  if (!hqs.length) throw new Error(`势力【${name}】至少需要1座主城`);
  const color = /^#[0-9a-fA-F]{6}$/.test(f.color || '') ? f.color : '#8a6a3a';
  return { key, name, army: text(f.army || `${name}军`, '军名', 8), color, hqs };
}

function normalizeCard(raw, i, kingdomsOk) {
  const where = `第${i + 1}张卡`;
  const id = text(raw?.id, `${where}的标识`, 41);
  if (!ID_RE.test(id)) throw new Error(`${where}：标识只能用小写字母、数字、下划线，且以字母开头`);
  if (DB_CARD_MAP[id]) throw new Error(`${where}：标识 ${id} 与官方卡牌重复`);
  const kingdom = String(raw.kingdom || raw.faction || '').toLowerCase();
  if (!kingdomsOk.has(kingdom)) throw new Error(`${where}（${raw.name || id}）：未知势力 ${kingdom}`);
  const type = String(raw.type || 'UNIT').toUpperCase();
  if (!TYPES.includes(type)) throw new Error(`${where}：类型无效`);
  const troopType = type === 'UNIT' ? String(raw.troopType || 'INFANTRY').toUpperCase() : 'NONE';
  if (type === 'UNIT' && !TROOP_OPTIONS.includes(troopType)) throw new Error(`${where}：兵种无效`);
  const list = (v, label, max, each) => {
    const arr = Array.isArray(v) ? v : String(v || '').split(/[,，\s]+/).filter(Boolean);
    if (arr.length > max) throw new Error(`${where}：${label}最多${max}个`);
    return arr.map(x => text(String(x), label, each));
  };
  const customKeywords = (raw.customKeywords || []).slice(0, 6).map(k => ({ name: text(k?.name, '自定义词条名', 8), description: text(k?.description, '词条释义', 120) }));
  const name = text(raw.name, `${where}的名称`, 12);
  const hp = type === 'UNIT' ? int(raw.hp, `${name}的生命`, 1, 30) : 0;
  return {
    id, cardId: id, name, kingdom, type, troopType,
    cost: int(raw.cost, `${name}的部署费用`, 0, 12),
    actionCost: type === 'UNIT' ? int(raw.actionCost, `${name}的行动费用`, 0, 6, 1) : 0,
    atk: type === 'UNIT' ? int(raw.atk, `${name}的战力`, 0, 20) : 0,
    hp, maxHp: hp,
    copies: int(raw.copies, `${name}的张数上限`, 1, 3, 1),
    keywords: list(raw.keywords, '词条', 8, 12),
    badges: list(raw.badges, '性格', 4, 6),
    customKeywords,
    skill: { name: text(raw.skill?.name || raw.skillName, '技能名', 12, { optional: true }), description: text(raw.skill?.description || raw.description, '技能描述', 300, { optional: true }) },
    abilities: normalizeAbilities(raw.abilities, `${name}`),
    pending: Boolean(raw.pending),
    custom: true,
    updatedAt: Number(raw.updatedAt) || Date.now()
  };
}

/** 校验并规范化卡包（支持 v1 / v2） */
export function normalizePack(input, { extraKingdoms = [] } = {}) {
  if (!input || typeof input !== 'object') throw new Error('卡包格式错误');
  if (input.schemaVersion === 1 && Array.isArray(input.cards)) {
    input = { schemaVersion: 2, factions: [], cards: input.cards.map(c => ({ ...c, kingdom: String(c.faction || 'wei').toLowerCase(), skill: c.skill || { name: c.skillName || c.name, description: c.description } })) };
  }
  if (input.schemaVersion !== 2 || !Array.isArray(input.cards)) throw new Error('卡包需要 schemaVersion: 2 和 cards 数组');
  const factions = (input.factions || []).map(normalizeFaction);
  const fkeys = new Set();
  for (const f of factions) { if (fkeys.has(f.key)) throw new Error(`势力标识重复：${f.key}`); fkeys.add(f.key); }
  const kingdomsOk = new Set([...BUILTIN_KINGDOMS, ...fkeys, ...extraKingdoms]);
  if (input.cards.length > 200) throw new Error('一个卡包最多200张卡');
  const ids = new Set();
  const cards = input.cards.map((c, i) => {
    const card = normalizeCard(c, i, kingdomsOk);
    if (ids.has(card.id)) throw new Error(`卡牌标识重复：${card.id}`);
    ids.add(card.id);
    return card;
  });
  return { schemaVersion: 2, factions, cards };
}

// ==========================================
// 本机保存 + 注册到卡牌库
// ==========================================
let current = { schemaVersion: 2, factions: [], cards: [] };
let guest = { factions: [], cards: [] };
let registeredFactions = [];
const listeners = new Set();

export const customPack = () => current;
export const customCardMap = () => Object.fromEntries(current.cards.map(c => [c.id, c]));
export const getCustomCard = id => current.cards.find(c => c.id === id) || guest.cards.find(c => c.id === id) || null;
export const customCardsOf = kingdom => current.cards.filter(c => c.kingdom === kingdom);
export const customFactions = () => current.factions;
/** 联机对手带来的自定义卡（仅本局内存，不写入本机） */
export const guestCardsOf = kingdom => guest.cards.filter(c => c.kingdom === kingdom);
export function onCustomChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let keywordHook = null;
/** 由界面层注入：把自定义词条释义登记到词条表 */
export function setKeywordRegistrar(fn) { keywordHook = fn; applyRegistry(); }

function applyRegistry() {
  for (const k of registeredFactions) { unregisterKingdom(k); unregisterHqs(k); }
  registeredFactions = [];
  for (const f of current.factions) {
    registerKingdom({ key: f.key, name: f.name, army: f.army, color: f.color });
    registerHqs(f.key, f.hqs);
    registeredFactions.push(f.key);
  }
  if (keywordHook) for (const c of current.cards) for (const k of c.customKeywords || []) keywordHook(k.name, k.description);
}

function migrateV1() {
  try {
    const raw = storage()?.getItem(CUSTOM_CARDS_KEY);
    if (!raw) return null;
    return normalizePack(JSON.parse(raw));
  } catch { return null; }
}

export function loadCustom() {
  try {
    const raw = storage()?.getItem(CUSTOM_V2_KEY);
    current = raw ? normalizePack(JSON.parse(raw)) : (migrateV1() || { schemaVersion: 2, factions: [], cards: [] });
  } catch (err) {
    console.warn('自定义内容读取失败：', err);
    current = { schemaVersion: 2, factions: [], cards: [] };
  }
  applyRegistry();
  return current;
}

export function saveCustom(pack) {
  current = normalizePack(pack);
  storage()?.setItem(CUSTOM_V2_KEY, JSON.stringify(current));
  try { globalThis.navigator?.storage?.persist?.().catch(() => {}); } catch { /* ignore */ }
  applyRegistry();
  for (const fn of listeners) { try { fn(current); } catch { /* ignore */ } }
  return current;
}

export function upsertCard(card) {
  const cards = current.cards.filter(c => c.id !== card.id);
  cards.push({ ...card, updatedAt: Date.now() });
  return saveCustom({ ...current, cards });
}
export function deleteCard(id) { return saveCustom({ ...current, cards: current.cards.filter(c => c.id !== id) }); }
export function upsertFaction(f) {
  const factions = current.factions.filter(x => x.key !== f.key);
  factions.push(f);
  return saveCustom({ ...current, factions });
}
export function deleteFaction(key) {
  if (current.cards.some(c => c.kingdom === key)) throw new Error('该势力下还有卡牌，请先删除或改到其他势力');
  return saveCustom({ ...current, factions: current.factions.filter(f => f.key !== key) });
}

/** 取出一组卡/势力（导出用）；自动带上卡牌所属的自定义势力 */
export function pickSubset({ cardIds = [], factionKeys = [] } = {}) {
  const cards = current.cards.filter(c => cardIds.includes(c.id));
  const keys = new Set([...factionKeys, ...cards.map(c => c.kingdom).filter(k => !BUILTIN_KINGDOMS.includes(k))]);
  return { schemaVersion: 2, factions: current.factions.filter(f => keys.has(f.key)), cards };
}

/**
 * 合并导入：返回 { added, updated, conflicts }。
 * mode: 'overwrite' 同标识覆盖；'copy' 同标识且内容不同时另存为新标识；'skip' 跳过冲突。
 */
export function mergePack(incoming, mode = 'copy') {
  const pack = normalizePack(incoming, { extraKingdoms: current.factions.map(f => f.key) });
  const factions = [...current.factions];
  for (const f of pack.factions) {
    const i = factions.findIndex(x => x.key === f.key);
    if (i === -1) factions.push(f); else if (mode === 'overwrite') factions[i] = f;
  }
  const cards = [...current.cards];
  const remap = {};
  const report = { added: [], updated: [], copied: [], skipped: [] };
  const same = (a, b) => JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
  for (const c of pack.cards) {
    const i = cards.findIndex(x => x.id === c.id);
    if (i === -1) { cards.push(c); report.added.push(c.name); continue; }
    if (same(cards[i], c)) continue;
    if (mode === 'overwrite') { cards[i] = c; report.updated.push(c.name); }
    else if (mode === 'copy') {
      const nid = newCustomId(c.id.slice(0, 20));
      remap[c.id] = nid;
      cards.push({ ...c, id: nid, cardId: nid, name: c.name });
      report.copied.push(c.name);
    } else report.skipped.push(c.name);
  }
  saveCustom({ schemaVersion: 2, factions, cards });
  return { report, remap };
}

// ==========================================
// 导出文件 / 卡包码
// ==========================================
const b64url = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function pipe(bytes, Stream, fmt) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(fmt))).arrayBuffer());
}
const slim = pack => ({
  schemaVersion: 2,
  factions: pack.factions,
  cards: pack.cards.map(({ cardId, maxHp, custom, updatedAt, ...rest }) => rest)
});

export async function encodePack(pack) {
  const raw = new TextEncoder().encode(JSON.stringify(slim(pack)));
  if (typeof CompressionStream !== 'undefined') {
    try { return `SGKP1-${b64url(await pipe(raw, CompressionStream, 'deflate-raw'))}`; } catch { /* fall through */ }
  }
  return `SGKP0-${b64url(raw)}`;
}

export async function decodePack(input) {
  const m = String(input || '').match(/SGKP([01])-([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('不是有效的卡包码');
  let bytes = unb64url(m[2]);
  if (m[1] === '1') {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解析该卡包码，请更新浏览器');
    bytes = await pipe(bytes, DecompressionStream, 'deflate-raw');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** 下载为本地文件 */
export function downloadPack(pack, filename = null) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = filename || `三国KARDS-自定义-${stamp}.json`;
  const blob = new Blob([JSON.stringify({ ...slim(pack), exportedAt: new Date().toISOString(), note: '三国KARDS 自定义内容：可在「自定义工坊 → 导入」载入，或发给开发者并入官方卡牌库' }, null, 2)], { type: 'application/json' });
  const a = globalThis.document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  globalThis.document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return name;
}

export const kingdomLabel = k => KINGDOMS[k]?.name || '?';

/**
 * 联机：登记对手卡组里的自定义势力/卡牌（只在内存里，不污染本机工坊）。
 * 与本机同标识但内容不同的卡会换成新标识，返回 { remap }。
 */
export function registerGuest(input) {
  const remap = {};
  if (!input) return { remap };
  let pack;
  try { pack = normalizePack({ schemaVersion: 2, factions: input.factions || [], cards: input.cards || [] }, { extraKingdoms: Object.keys(KINGDOMS) }); }
  catch (err) { console.warn('对手自定义内容无效：', err); return { remap }; }
  for (const f of pack.factions) {
    if (KINGDOMS[f.key]) continue;
    registerKingdom({ key: f.key, name: f.name, army: f.army, color: f.color });
    registerHqs(f.key, f.hqs);
    guest.factions.push(f);
  }
  const same = (a, b) => JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
  for (const c of pack.cards) {
    const have = getCustomCard(c.id);
    if (have && same(have, c)) continue;
    if (have) {
      const nid = newCustomId('g');
      remap[c.id] = nid;
      guest.cards.push({ ...c, id: nid, cardId: nid });
    } else guest.cards.push(c);
    if (keywordHook) for (const k of c.customKeywords || []) keywordHook(k.name, k.description);
  }
  return { remap };
}
