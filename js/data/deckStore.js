/**
 * deckStore.js — 卡组：官方预设 + 玩家自组（本机保存）+ 分享码
 *
 * 卡组结构：{ id, name, mode:'single', kingdom, cards: { cardId: 张数 }, official?, updatedAt }
 * 玩家卡组保存在浏览器 localStorage（键 sgk_decks_v1）；官方预设来自卡牌库，不可直接修改。
 * 分享码：SGK1-<base64url(deflate(JSON))>，不支持压缩的浏览器用 SGK0-<base64url(JSON)>。
 */
import { CARDS_BY_KINGDOM, DB_DECKS, DB_CARD_MAP, KINGDOMS } from './cardDB.js';
import { EXTRA_PRESETS } from './presetDecks.js';
import { getCustomCard, customCardsOf, customFactions, guestCardsOf, pickSubset, mergePack } from './customContent.js';

/** 卡牌定义：官方卡牌库 + 本机自定义卡 */
export const getCardDef = id => DB_CARD_MAP[id] || getCustomCard(id);
/** 所有势力（内置 + 已注册的自定义势力） */
export const allKingdomKeys = () => [...KINGDOM_KEYS, ...customFactions().map(f => f.key).filter(k => KINGDOMS[k])];

export const DECK_SIZE = 40;
/** 双阵营（测试）：主阵营 30 张 + 副阵营 20 张，主城 30 血 */
export const DUAL = Object.freeze({ MAIN: 30, SUB: 20, TOTAL: 50, HQ_HP: 30 });
export const deckSize = deck => (deck?.mode === 'dual' ? DUAL.TOTAL : DECK_SIZE);
export const MIN_UNITS_HINT = 15;
const STORE_KEY = 'sgk_decks_v1';
const LAST_KEY = 'sgk_last_deck_v1';
export const KINGDOM_KEYS = ['wei', 'shu', 'wu', 'lb', 'gsz'];

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** 某势力可用的卡牌（按类型、费用排序） */
export function libraryFor(kingdom) {
  const order = { UNIT: 0, TACTIC: 1, COUNTER: 2 };
  return [...(CARDS_BY_KINGDOM[kingdom] || []), ...customCardsOf(kingdom)].sort((a, b) => (order[a.type] - order[b.type]) || (a.cost - b.cost) || a.name.localeCompare(b.name, 'zh'));
}

/** 单张卡在卡组中的上限：实体卡张数 */
export const cardLimit = id => getCardDef(id)?.copies ?? 1;

const countsFromList = ids => ids.reduce((m, id) => { m[id] = (m[id] || 0) + 1; return m; }, {});

/** 官方预设（单阵营） */
export function officialPresets() {
  const standard = KINGDOM_KEYS.map(k => ({
    id: `preset_${k}_standard`,
    name: `${KINGDOMS[k].army}·标准`,
    mode: 'single', kingdom: k, official: true,
    cards: countsFromList(DB_DECKS[k].main)
  }));
  const extra = EXTRA_PRESETS.filter(d => d.mode !== 'dual').map(d => ({ ...d, official: true, cards: { ...d.cards } }));
  return [...standard, ...extra, ...dualPresets()];
}

export function loadUserDecks() {
  try {
    const raw = storage()?.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(d => d && d.id && d.cards) : [];
  } catch { return []; }
}

function writeUserDecks(list) {
  storage()?.setItem(STORE_KEY, JSON.stringify(list));
}

export function listDecks({ mode = 'single', kingdom = null } = {}) {
  return [...officialPresets(), ...loadUserDecks()]
    .filter(d => (d.mode || 'single') === mode && (!kingdom || d.kingdom === kingdom));
}

export function getDeck(id) {
  return [...officialPresets(), ...loadUserDecks()].find(d => d.id === id) || null;
}

export function newDeckId() {
  return `deck_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 保存（新建或覆盖）玩家卡组；官方预设会另存为副本 */
export function saveDeck(deck) {
  const list = loadUserDecks();
  const copy = { ...deck, cards: { ...deck.cards }, mode: deck.mode || 'single', official: false, updatedAt: Date.now() };
  if (deck.official || !copy.id) copy.id = newDeckId();
  const i = list.findIndex(d => d.id === copy.id);
  if (i >= 0) list[i] = copy; else list.push(copy);
  writeUserDecks(list);
  requestPersist();
  return copy;
}

export function deleteDeck(id) {
  writeUserDecks(loadUserDecks().filter(d => d.id !== id));
}

export function duplicateDeck(deck, name = null) {
  return saveDeck({ ...deck, id: null, official: false, name: name || `${deck.name}（副本）` });
}

/** 记住每个势力上次选择的卡组 */
export function rememberDeck(kingdom, id) {
  try {
    const m = JSON.parse(storage()?.getItem(LAST_KEY) || '{}');
    m[kingdom] = id;
    storage()?.setItem(LAST_KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}
export function lastDeckId(kingdom, mode = 'single') {
  const fallback = mode === 'dual' ? (dualPresets().find(d => d.kingdom === kingdom)?.id || null) : `preset_${kingdom}_standard`;
  const key = mode === 'dual' ? `dual:${kingdom}` : kingdom;
  try { return JSON.parse(storage()?.getItem(LAST_KEY) || '{}')[key] || fallback; } catch { return fallback; }
}
export function rememberDeckFor(kingdom, mode, id) { rememberDeck(mode === 'dual' ? `dual:${kingdom}` : kingdom, id); }

export const deckTotal = deck => Object.values(deck?.cards || {}).reduce((a, n) => a + n, 0);

/** 校验：张数、单卡上限、所属势力 */
export function validateDeck(deck) {
  const errors = [];
  const warnings = [];
  const total = deckTotal(deck);
  const dual = deck?.mode === 'dual';
  const kingdoms = dual ? [deck.kingdom, deck.subKingdom] : [deck?.kingdom];
  const lib = new Set(kingdoms.flatMap(k => [...libraryFor(k), ...guestCardsOf(k)].map(c => c.id)));
  let units = 0;
  const perKingdom = {};
  for (const [id, n] of Object.entries(deck?.cards || {})) {
    const def = getCardDef(id);
    if (!def) { errors.push(`未知卡牌：${id}`); continue; }
    if (!lib.has(id)) errors.push(`【${def.name}】不属于${kingdoms.map(k => KINGDOMS[k]?.name || '').join('、')}势力`);
    if (n > cardLimit(id)) errors.push(`【${def.name}】最多${cardLimit(id)}张（当前${n}张）`);
    if (def.type === 'UNIT') units += n;
    perKingdom[def.kingdom] = (perKingdom[def.kingdom] || 0) + n;
  }
  const size = deckSize(deck);
  if (dual) {
    if (!deck.subKingdom || deck.subKingdom === deck.kingdom) errors.push('双阵营需要选择一个不同的副阵营');
    const m = perKingdom[deck.kingdom] || 0;
    const sb = perKingdom[deck.subKingdom] || 0;
    if (m !== DUAL.MAIN) errors.push(`主阵营（${KINGDOMS[deck.kingdom]?.name}）需要正好${DUAL.MAIN}张（当前${m}张）`);
    if (sb !== DUAL.SUB) errors.push(`副阵营（${KINGDOMS[deck.subKingdom]?.name || '?'}）需要正好${DUAL.SUB}张（当前${sb}张）`);
  } else if (total !== DECK_SIZE) errors.push(`卡组需要正好${DECK_SIZE}张（当前${total}张）`);
  const minUnits = Math.round(MIN_UNITS_HINT * size / DECK_SIZE);
  if (total && units < minUnits) warnings.push(`单位只有${units}张，建议至少${minUnits}张`);
  return { ok: errors.length === 0, total, size, units, perKingdom, errors, warnings };
}

/** 各势力在卡组中的张数 */
export function kingdomCounts(deck) {
  const out = {};
  for (const [id, n] of Object.entries(deck?.cards || {})) {
    const k = getCardDef(id)?.kingdom;
    if (k) out[k] = (out[k] || 0) + n;
  }
  return out;
}

// ==========================================
// 双阵营：一键生成与推荐预设
// ==========================================
/** 从某势力标准卡组里按费用曲线均匀抽掉若干张，保留 n 张（保持曲线与单位/战法比例） */
function thinStandard(kingdom, n) {
  const order = { UNIT: 0, TACTIC: 1, COUNTER: 2 };
  const list = [...DB_DECKS[kingdom].main].map(id => DB_CARD_MAP[id])
    .sort((a, b) => (order[a.type] - order[b.type]) || (a.cost - b.cost) || a.id.localeCompare(b.id));
  const drop = list.length - n;
  const removeIdx = new Set();
  for (let i = 0; i < drop; i++) removeIdx.add(Math.min(list.length - 1, Math.floor((i + 0.5) * list.length / drop)));
  let i = list.length - 1;
  while (removeIdx.size < drop && i >= 0) { removeIdx.add(i); i -= 2; }
  return countsFromList(list.filter((_, idx) => !removeIdx.has(idx)).map(c => c.id));
}

export function generateDualDeck(main, sub, name = null) {
  const cards = { ...thinStandard(main, DUAL.MAIN) };
  for (const [id, n] of Object.entries(thinStandard(sub, DUAL.SUB))) cards[id] = (cards[id] || 0) + n;
  return { id: null, name: name || `${KINGDOMS[main].name}主·${KINGDOMS[sub].name}副`, mode: 'dual', kingdom: main, subKingdom: sub, cards };
}

/** 推荐组合（主→副）：每个势力做主阵营各一套 */
export const DUAL_RECOMMENDED = [['wei', 'lb'], ['shu', 'wei'], ['wu', 'shu'], ['lb', 'wei']];
export function dualPresets() {
  return DUAL_RECOMMENDED.map(([m, sb]) => {
    const fixed = EXTRA_PRESETS.find(d => d.mode === 'dual' && d.kingdom === m && d.subKingdom === sb);
    const base = fixed ? { ...fixed, cards: { ...fixed.cards } } : generateDualDeck(m, sb, `${KINGDOMS[m].army}·${KINGDOMS[sb].name}援（推荐）`);
    return { ...base, id: `preset_dual_${m}_${sb}`, official: true };
  });
}

/** 卡组 → 卡牌定义列表（交给对局创建实例） */
export function deckCardDefs(deck) {
  const out = [];
  for (const [id, n] of Object.entries(deck.cards)) {
    const def = getCardDef(id);
    if (def) for (let i = 0; i < n; i++) out.push(def);
  }
  return out;
}

/** 统计：类型张数与费用曲线（0..7+） */
export function deckStats(deck) {
  const byType = { UNIT: 0, TACTIC: 0, COUNTER: 0 };
  const curve = Array(8).fill(0);
  for (const [id, n] of Object.entries(deck?.cards || {})) {
    const def = getCardDef(id);
    if (!def) continue;
    byType[def.type] = (byType[def.type] || 0) + n;
    curve[Math.min(7, def.cost ?? 0)] += n;
  }
  return { byType, curve };
}

// ==========================================
// 分享码
// ==========================================
const b64url = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
async function pipe(bytes, Stream, fmt) {
  const out = new Blob([bytes]).stream().pipeThrough(new Stream(fmt));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** 卡组 → 分享码（卡牌 id 去掉本势力前缀以缩短） */
export async function encodeDeck(deck) {
  const prefix = `${deck.kingdom}_`;
  const subPrefix = deck.subKingdom ? `${deck.subKingdom}_` : null;
  const short = id => (id.startsWith(prefix) ? id.slice(prefix.length) : (subPrefix && id.startsWith(subPrefix) ? `~${id.slice(subPrefix.length)}` : `!${id}`));
  const c = Object.entries(deck.cards).filter(([, n]) => n > 0)
    .map(([id, n]) => `${short(id)}${n > 1 ? `*${n}` : ''}`).join(',');
  const payload = { v: 1, m: deck.mode || 'single', k: deck.kingdom, n: deck.name, c };
  if (deck.subKingdom) payload.s = deck.subKingdom;
  // 用到的自定义卡（及自定义势力）一起打包，对方导入时自动加入其自定义内容
  const x = customPayloadFor(deck);
  if (x) payload.x = x;
  const json = JSON.stringify(payload);
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream !== 'undefined') {
    try { return `SGK1-${b64url(await pipe(raw, CompressionStream, 'deflate-raw'))}`; } catch { /* fall through */ }
  }
  return `SGK0-${b64url(raw)}`;
}

/** 卡组用到的自定义卡（及自定义势力）；没有则 null */
export function customPayloadFor(deck) {
  const customIds = Object.keys(deck?.cards || {}).filter(id => !DB_CARD_MAP[id] && getCustomCard(id));
  const needFaction = [deck?.kingdom, deck?.subKingdom].filter(k => k && !KINGDOM_KEYS.includes(k));
  if (!customIds.length && !needFaction.length) return null;
  const sub = pickSubset({ cardIds: customIds, factionKeys: needFaction });
  return { factions: sub.factions, cards: sub.cards.map(({ cardId, maxHp, custom, updatedAt, ...rest }) => rest) };
}

/** 分享码 / 含 ?deck= 的链接 → 卡组（未保存） */
export async function decodeDeck(input) {
  let code = String(input || '').trim();
  const m = code.match(/[?&]deck=([^&#\s]+)/);
  if (m) code = decodeURIComponent(m[1]);
  const mm = code.match(/SGK([01])-([A-Za-z0-9_-]+)/);
  if (!mm) throw new Error('不是有效的卡组分享码');
  let bytes = unb64url(mm[2]);
  if (mm[1] === '1') {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解析该分享码，请更新浏览器');
    bytes = await pipe(bytes, DecompressionStream, 'deflate-raw');
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data.v !== 1) throw new Error('分享码版本无效');
  // 附带的自定义内容：先并入本机自定义卡（同标识不同内容时另存副本并改用新标识）
  let remap = {};
  if (data.x) remap = mergePack({ schemaVersion: 2, factions: data.x.factions || [], cards: data.x.cards || [] }, 'copy').remap;
  if (!KINGDOMS[data.k]) throw new Error('分享码中的势力在本机不存在');
  const cards = {};
  for (const part of String(data.c || '').split(',').filter(Boolean)) {
    const [idPart, nPart] = part.split('*');
    const id = idPart.startsWith('!') ? idPart.slice(1) : idPart.startsWith('~') ? `${data.s}_${idPart.slice(1)}` : `${data.k}_${idPart}`;
    const rid = remap[id] || id;
    cards[rid] = (cards[rid] || 0) + (parseInt(nPart || '1', 10) || 1);
  }
  const deck = { id: null, name: String(data.n || '导入的卡组').slice(0, 24), mode: data.m || 'single', kingdom: data.k, cards };
  if (data.s && KINGDOMS[data.s]) deck.subKingdom = data.s;
  return deck;
}

export function shareLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?deck=${code}`;
}

/** 申请持久存储，降低浏览器自动清理本机数据的概率 */
let persistAsked = false;
export function requestPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { globalThis.navigator?.storage?.persist?.().catch(() => {}); } catch { /* ignore */ }
}
