/**
 * api.js — 三国KARDS 开放接口（window.SGK）
 *
 * 目的：让其他人或 AI 不必读懂全部源码，也能在浏览器控制台 / 外部脚本里
 *   · 查询卡牌、势力、主城、词条；
 *   · 用规则引擎跑对局、写测试、做平衡模拟；
 *   · 注册新卡牌/新势力（走自定义内容通道，会保存在本机并进入卡组编辑器）；
 *   · 给卡牌挂技能：战法 / 进场技能 / 反制 / 主动技能 / 选择目标 / 插件钩子。
 *
 * 详细说明见仓库根目录的 ARCHITECTURE.md 与 CONTRIBUTING.md。
 *
 * 用法示例（浏览器控制台）：
 *   SGK.data.card('shu_zhao_yun')                     // 查卡
 *   SGK.content.importPack({ schemaVersion: 2, factions: [], cards: [...] })   // 导入自定义卡包
 *   SGK.skills.TACTICS.my_card = { play(state, owner) { SGK.skills.drawCard(state, owner); } }
 *   SGK.skills.PLUGIN_HOOKS.afterAttack.push((state, atk, def, result) => { ... })
 *   const s = SGK.engine.createInitialState(); SGK.engine.dispatch(s, { type: 'END_TURN', playerId: 'WEI' })
 */
import * as constants from './engine/constants.js';
import * as rules from './engine/rulesEngine.js';
import * as stateMod from './engine/state.js';
import * as combat from './engine/combat.js';
import * as skills from './engine/cardSkills.js';
import * as abilities from './engine/abilities.js';
import * as preview from './engine/preview.js';
import * as cardDB from './data/cardDB.js';
import * as terrains from './data/terrains.js';
import * as deckStore from './data/deckStore.js';
import * as presets from './data/presetDecks.js';
import * as custom from './data/customContent.js';
import * as bot from './bot/heuristicBot.js';
import * as evaluator from './bot/evaluator.js';
import * as renderer from './ui/cardRenderer.js';

export const REPO_URL = 'https://github.com/quiverken1-crypto/3-kcard';
export const API_VERSION = 1;

export const SGK = Object.freeze({
  version: API_VERSION,
  repo: REPO_URL,
  docs: `${REPO_URL}/blob/main/ARCHITECTURE.md`,

  /** 常量：阵营座位、兵种、阶段、动作类型、地形、词条名 */
  constants,

  /** 规则引擎：纯函数式，state 是普通对象，可 structuredClone */
  engine: {
    ...rules,
    createCard: stateMod.createCard,
    createKingdomDeck: stateMod.createKingdomDeck,
    findUnit: stateMod.findUnit,
    getAllUnits: stateMod.getAllUnits,
    previewAction: preview,
    combat
  },

  /** 数据：卡牌库、势力、主城、预设卡组 */
  data: {
    KINGDOMS: cardDB.KINGDOMS,
    CARDS_BY_KINGDOM: cardDB.CARDS_BY_KINGDOM,
    DB_CARD_MAP: cardDB.DB_CARD_MAP,
    HQ_CARDS: terrains.HQ_CARDS,
    TERRAINS: terrains.TERRAINS,
    KEYWORD_GLOSSARY: renderer.KEYWORD_GLOSSARY,
    EXTRA_PRESETS: presets.EXTRA_PRESETS,
    card: id => deckStore.getCardDef(id),
    libraryFor: deckStore.libraryFor,
    officialPresets: deckStore.officialPresets,
    registerKingdom: cardDB.registerKingdom,
    registerHqs: terrains.registerHqs,
    registerKeyword: renderer.registerKeyword
  },

  /** 卡组：本机保存、校验、分享码 */
  decks: deckStore,

  /** 自定义内容（与“工坊”同一通道）：导入后保存在本机，自动进入卡组编辑器 */
  content: {
    ...custom,
    importPack: (pack, mode = 'copy') => custom.mergePack(pack, mode),
    exportAll: () => custom.customPack()
  },

  /**
   * 技能注册表（可直接增改）：
   *   TACTICS[id]        战法 { targets?, autoPick?, precheck?, precheckMsg?, play(state, owner, card, target, payload) }
   *   DEPLOY_SKILLS[id]  进场技能 (state, unit) => void；需要选目标时同时在 DEPLOY_TARGETS[id] 写 { prompt, list(state, owner, card) }
   *   COUNTERS[id]       反制 { event: 'ENEMY_TACTIC'|'ENEMY_MOVE'|'OWN_ATTACKED'|'ENEMY_ATTACK', check, fire }
   *   ACTIVE_SKILLS[id]  主动技能 { name, desc, needsHandCard?, apply(state, unit, payload) }
   *   CHOICE_SPECS[kind] 结算中途让玩家选目标 { source, prompt, pool?: 'board'|'hand'|'option', auto, apply }
   *   PLUGIN_HOOKS       onEnter / afterAttack / onDeath / onTurnEnd 数组
   * 以及工具函数：damageUnit、damageHq、healHq、suppressUnit、retreatUnit、buff、searchDeck、log …
   */
  skills: { ...skills, hasKeyword: constants.hasKeyword, drawCard: stateMod.drawCard, adjustPrestige: stateMod.adjustPrestige },

  /** 积木（工坊）目录与执行器 */
  abilities,

  /** AI：启发式机器人与局面评估 */
  bot: { ...bot, ...evaluator },

  /** 当前运行中的界面实例（仅浏览器） */
  get app() { return globalThis.__TK_APP__ || null; }
});

if (typeof globalThis !== 'undefined') globalThis.SGK = SGK;
export default SGK;
