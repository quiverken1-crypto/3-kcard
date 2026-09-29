/**
 * deckStore.js — 卡组：官方预设 + 玩家自组（本机保存）+ 分享码
 *
 * 卡组结构：{ id, name, mode:'single', kingdom, cards: { cardId: 张数 }, official?, updatedAt }
 * 玩家卡组保存在浏览器 localStorage（键 sgk_decks_v1）；官方预设来自卡牌库，不可直接修改。
 * 分享码：SGK1-<base64url(deflate(JSON))>，不支持压缩的浏览器用 SGK0-<base64url(JSON)>。
 */
import { CARDS_BY_KINGDOM, DB_DECKS, DB_CARD_MAP, KINGDOMS } from './cardDB.js';

export const DECK_SIZE = 40;
export const MIN_UNITS_HINT = 15;
const STORE_KEY = 'sgk_decks_v1';
const LAST_KEY = 'sgk_last_deck_v1';
export const KINGDOM_KEYS = ['wei', 'shu', 'wu', 'lb'];

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** 某势力可用的卡牌（按类型、费用排序） */
export function libraryFor(kingdom) {
  const order = { UNIT: 0, TACTIC: 1, COUNTER: 2 };
  return [...(CARDS_BY_KINGDOM[kingdom] || [])].sort((a, b) => (order[a.type] - order[b.type]) || (a.cost - b.cost) || a.name.localeCompare(b.name, 'zh'));
}

/** 单张卡在卡组中的上限：实体卡张数 */
export const cardLimit = id => DB_CARD_MAP[id]?.copies ?? 1;

const countsFromList = ids => ids.reduce((m, id) => { m[id] = (m[id] || 0) + 1; return m; }, {});

/** 官方预设（单阵营） */
export function officialPresets() {
  return KINGDOM_KEYS.map(k => ({
    id: `preset_${k}_standard`,
    name: `${KINGDOMS[k].army}·标准`,
    mode: 'single', kingdom: k, official: true,
    cards: countsFromList(DB_DECKS[k].main)
  }));
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
export function lastDeckId(kingdom) {
  try { return JSON.parse(storage()?.getItem(LAST_KEY) || '{}')[kingdom] || `preset_${kingdom}_standard`; } catch { return `preset_${kingdom}_standard`; }
}

export const deckTotal = deck => Object.values(deck?.cards || {}).reduce((a, n) => a + n, 0);

/** 校验：张数、单卡上限、所属势力 */
export function validateDeck(deck) {
  const errors = [];
  const warnings = [];
  const total = deckTotal(deck);
  const lib = new Set((CARDS_BY_KINGDOM[deck?.kingdom] || []).map(c => c.id));
  let units = 0;
  for (const [id, n] of Object.entries(deck?.cards || {})) {
    const def = DB_CARD_MAP[id];
    if (!def) { errors.push(`未知卡牌：${id}`); continue; }
    if (!lib.has(id)) errors.push(`【${def.name}】不属于${KINGDOMS[deck.kingdom]?.name || ''}势力`);
    if (n > cardLimit(id)) errors.push(`【${def.name}】最多${cardLimit(id)}张（当前${n}张）`);
    if (def.type === 'UNIT') units += n;
  }
  if (total !== DECK_SIZE) errors.push(`卡组需要正好${DECK_SIZE}张（当前${total}张）`);
  if (total && units < MIN_UNITS_HINT) warnings.push(`单位只有${units}张，建议至少${MIN_UNITS_HINT}张`);
  return { ok: errors.length === 0, total, units, errors, warnings };
}

/** 卡组 → 卡牌定义列表（交给对局创建实例） */
export function deckCardDefs(deck) {
  const out = [];
  for (const [id, n] of Object.entries(deck.cards)) {
    const def = DB_CARD_MAP[id];
    if (def) for (let i = 0; i < n; i++) out.push(def);
  }
  return out;
}

/** 统计：类型张数与费用曲线（0..7+） */
export function deckStats(deck) {
  const byType = { UNIT: 0, TACTIC: 0, COUNTER: 0 };
  const curve = Array(8).fill(0);
  for (const [id, n] of Object.entries(deck?.cards || {})) {
    const def = DB_CARD_MAP[id];
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
  const c = Object.entries(deck.cards).filter(([, n]) => n > 0)
    .map(([id, n]) => `${id.startsWith(prefix) ? id.slice(prefix.length) : `!${id}`}${n > 1 ? `*${n}` : ''}`).join(',');
  const json = JSON.stringify({ v: 1, m: deck.mode || 'single', k: deck.kingdom, n: deck.name, c });
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream !== 'undefined') {
    try { return `SGK1-${b64url(await pipe(raw, CompressionStream, 'deflate-raw'))}`; } catch { /* fall through */ }
  }
  return `SGK0-${b64url(raw)}`;
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
  if (data.v !== 1 || !KINGDOM_KEYS.includes(data.k)) throw new Error('分享码版本或势力无效');
  const cards = {};
  for (const part of String(data.c || '').split(',').filter(Boolean)) {
    const [idPart, nPart] = part.split('*');
    const id = idPart.startsWith('!') ? idPart.slice(1) : `${data.k}_${idPart}`;
    cards[id] = (cards[id] || 0) + (parseInt(nPart || '1', 10) || 1);
  }
  return { id: null, name: String(data.n || '导入的卡组').slice(0, 24), mode: data.m || 'single', kingdom: data.k, cards };
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
