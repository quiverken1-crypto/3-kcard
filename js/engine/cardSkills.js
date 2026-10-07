/**
 * cardSkills.js — 魏蜀 64 张卡牌的武将技能 / 战法 / 反制战法实现
 *
 * 设计要点：
 *  - 游戏状态会被 JSON 深拷贝（联机同步 / Bot 推演），因此技能逻辑不能挂在卡牌实例上，
 *    统一按 cardId（去掉 _1/_2 副本后缀）在本注册表中查找。
 *  - 被抑制（inhibited）的单位不触发任何卡面技能。
 *  - 所有“单位特效需在结算完成后仍在场才生效”（存活生效律）通过 isOnBoard 检查实现。
 */

import { FACTIONS, PHASES, STATUS_TYPES, TROOP_TYPES, GAME_CONFIG, hasKeyword } from './constants.js';
import {
  drawCard, adjustPrestige, getAllUnits, findUnit, removeUnitFromBoard, registerTurnHooks, markDamaged
} from './state.js';
import { registerAbilityHooks, applyUnitEffect, auraModifiers, activeAbilitiesOf, activeCostBlock, runActiveAbility, refreshAuraKeywords } from './abilities.js';

// ==========================================
// 0. 通用工具
// ==========================================

export const baseId = id => String(id || '').replace(/_[0-9]+$/, '');
export const opp = p => (p === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI);
const FACTION_NAME = { WEI: '魏', SHU: '蜀' };

const active = unit => unit && !unit.status?.[STATUS_TYPES.INHIBITED];
const isOnBoard = (state, unit) => Boolean(unit && findUnit(state, unit.instanceId));
export const isId = (unit, id) => active(unit) && baseId(unit.cardId) === id;
const isMilitary = unit => unit.troopType !== TROOP_TYPES.STRATEGIST;
const hasBadge = (unit, badge) => Array.isArray(unit.badges) && unit.badges.includes(badge);

export function log(state, playerId, message, extra = {}) {
  state.combatLog.push({ type: 'SKILL', playerId, message, ...extra });
}

function unitsWith(state, playerId, id) {
  return getAllUnits(state, playerId).filter(u => isId(u, id));
}

function allBoardUnits(state) {
  return [...getAllUnits(state, FACTIONS.WEI), ...getAllUnits(state, FACTIONS.SHU)];
}

function zoneUnitsOf(state, loc) {
  if (!loc) return [];
  return loc.zoneType === 'SUPPORT'
    ? state.battlefield.support[loc.faction].slots
    : state.battlefield.frontline[loc.zoneKey].units;
}

/** 相邻：同一阵线/区域中左右紧挨的单位 */
export function adjacentUnits(state, unit, loc = null) {
  loc ||= findUnit(state, unit.instanceId);
  if (!loc) return [];
  const arr = zoneUnitsOf(state, loc);
  const i = arr.indexOf(unit);
  return [arr[i - 1], arr[i + 1]].filter(Boolean);
}

/** 守护：目标左右相邻有守护单位时受保护（目标自身为守护则不受保护） */
export function isGuardedUnit(state, defender) {
  if (active(defender) && hasKeyword(defender, '守护')) return false;
  return adjacentUnits(state, defender).some(u => u.faction === defender.faction && active(u) && hasKeyword(u, '守护'));
}

/** 主城在支援阵线最左侧，与第1个单位相邻 */
export function isGuardedHq(state, faction) {
  const first = state.battlefield.support[faction]?.slots?.[0];
  return Boolean(first && active(first) && hasKeyword(first, '守护'));
}

/** 器械（霹雳车、发石车等）：完全不受地形影响 */
export const isSiegeEngine = unit => unit?.troopType === TROOP_TYPES.ARCHER;
export const ignoresTerrain = unit => Boolean(unit) && isSiegeEngine(unit);
/** 张郃·巧变：自己无视地形负面效果（山地视为步兵、林地火攻翻倍），地形增益照常 */
const ignoresTerrainPenalty = unit => ignoresTerrain(unit) || isId(unit, 'wei_zhang_he');

/** 地形；忽略地形的单位视为没有地形 */
function terrainOf(state, loc, unit = null) {
  if (unit && ignoresTerrain(unit)) return null;
  return loc?.zoneType === 'FRONTLINE' ? state.battlefield.frontline[loc.zoneKey]?.terrain : null;
}
export function unitTerrain(state, unit, loc = null) {
  loc ||= findUnit(state, unit?.instanceId);
  return terrainOf(state, loc, unit);
}

const onMountain = (state, loc, unit = null) => terrainOf(state, loc, unit)?.type === 'MOUNTAIN';
const inForest = (state, loc, unit = null) => terrainOf(state, loc, unit)?.type === 'FOREST';

/**
 * 能否从手牌直接部署到某条前线：
 * 【奇袭】可部署到空置或己方占领的区域；器械可直接部署到己方已占领的区域。
 */
export function canDeployToFrontline(state, card, owner, zoneKey) {
  const z = state.battlefield.frontline?.[zoneKey];
  if (!z || z.units.length >= z.capacity) return false;
  if (hasKeyword(card, '奇袭') && (z.occupant === null || z.occupant === owner)) return true;
  if (isSiegeEngine(card) && z.occupant === owner) return true;
  return false;
}

/** 山地：此处所有单位视为步兵 */
export function effectiveTroop(state, unit, loc = null) {
  if (!unit) return null;
  loc ||= findUnit(state, unit.instanceId);
  return onMountain(state, loc, unit) && !ignoresTerrainPenalty(unit) ? TROOP_TYPES.INFANTRY : unit.troopType;
}

/** 矢石：自身词条，或位于山地（居高临下） */
export function hasShiShi(state, unit, loc = null) {
  if (!unit) return false;
  if (Array.isArray(unit.keywords) && unit.keywords.includes('矢石')) return true;
  loc ||= findUnit(state, unit.instanceId);
  return onMountain(state, loc, unit);
}

/** 林地：火攻伤害翻倍 */
export function fireMultiplier(state, unit, loc = null) {
  loc ||= findUnit(state, unit.instanceId);
  return inForest(state, loc, unit) && !ignoresTerrainPenalty(unit) ? 2 : 1;
}

function ensureTurnFx(state) {
  state.turnEffects ||= { WEI: {}, SHU: {} };
  state.turnEffects.WEI ||= {};
  state.turnEffects.SHU ||= {};
  return state.turnEffects;
}

function ensurePlayerMeta(player) {
  player.pendingCapGain ||= 0;
  player.provisionPenalty ||= 0;
  player.reserve ||= [];
  return player;
}

/** 重置离场卡牌数值（回到手牌 / 牌库 / 被复活时使用） */
export function resetCardState(card) {
  card.atk = card.baseAtk ?? card.atk;
  card.maxHp = card.baseMaxHp ?? card.maxHp;
  card.hp = card.maxHp;
  if (Array.isArray(card.baseKeywords)) card.keywords = [...card.baseKeywords];
  card.actionCost = card.baseActionCost ?? card.actionCost;
  card._auraAtk = 0;
  card._auraHp = 0;
  card._grantedExtraGranary = false;
  delete card._acted; // 回到手牌/牌库后重新部署，帷幄重新生效
  // 光环记账一并清掉：否则重新上场时以为“已经加过”，铁骑突击的突袭、各类光环数值不会再给
  card._f2Kw = []; card._f2Aura = 0; card._auraKws = []; card._auraTuXi = false;
  if (card.originalFaction) card.faction = card.originalFaction;
  card.status = {
    suppressed: false, suppressedTurnsLeft: 0, inhibited: false, isFaceDown: false,
    buffedAfterInhibit: false, actionsUsed: 0, movedThisTurn: false, attackedThisTurn: false,
    ambushUsedThisTurn: false, chargeUsed: false, deployedThisTurn: false, damaged: false,
    attacksThisTurn: 0
  };
  return card;
}

export function buff(unit, atk, hp) {
  unit.atk += atk;
  unit.maxHp += hp;
  unit.hp += hp;
  if (unit.status?.[STATUS_TYPES.INHIBITED]) unit.status[STATUS_TYPES.BUFFED_AFTER_INHIBIT] = true;
}

export function putInHand(state, playerId, card) {
  const player = state.players[playerId];
  // 通过技能进入手牌的牌（撤回、检索、捡回）对手已经见过，视为“明牌”
  card._known = true;
  // 单位回到手牌：数值、词条、光环记账一律复原（否则李文侯等光环的加成会被反向扣掉）
  if (card.type === 'UNIT' && card.status) { resetCardState(card); card.faction = playerId; }
  if (player.hand.length < GAME_CONFIG.HAND_LIMIT) { player.hand.push(card); return true; }
  player.discard.push(card);
  state.combatLog.push({ type: 'CARD_BURNED', playerId, card });
  return false;
}

function spliceFromDiscards(state, card) {
  for (const pid of [FACTIONS.WEI, FACTIONS.SHU]) {
    const d = state.players[pid].discard;
    const idx = d.findIndex(c => c.instanceId === card.instanceId);
    if (idx !== -1) return d.splice(idx, 1)[0];
  }
  return null;
}

function randomPick(state, arr) {
  if (!arr.length) return null;
  const i = arr.length === 1 ? 0 : state.prng.randomInt(0, arr.length - 1);
  return arr[i];
}

// ==========================================
// 主动技能（己方回合内由玩家发动，每回合1次）
// ==========================================
/**
 * 插件钩子（开放接口）：外部脚本可以不改核心代码，按卡牌 id 追加行为。
 *   PLUGIN_HOOKS.onEnter.push((state, unit) => {...})              单位进场（部署/召唤/换防）后
 *   PLUGIN_HOOKS.afterAttack.push((state, attacker, defender, result, targetIsHq) => {...})  每次攻击结算后
 *   PLUGIN_HOOKS.onDeath.push((state, unit, owner, { banish }) => {...})  单位离场（阵亡/被移除）时
 *   PLUGIN_HOOKS.onTurnEnd.push((state, playerId) => {...})         某方回合结束时
 * 钩子里可以调用本文件导出的工具函数（damageUnit、suppressUnit、damageHq、log 等，见 window.SGK.skills）。
 */
export const PLUGIN_HOOKS = { onEnter: [], afterAttack: [], onDeath: [], onTurnEnd: [] };
/**
 * 扩展点（开放接口，factions2.js 等势力模块在这里挂技能）：
 *   fold 型（返回新值）：attack(atk, state, unit, loc, foe) / actionCost(cost, state, unit, loc) / deployCost(cost, state, owner, card)
 *                        unitDamage(amount, state, unit, source) / hqDamage(amount, state, playerId, source) / counter(can, state, attacker, defender)
 *                        hqAttackMult(mult, state, attacker)
 *   any 型（返回真假）：cannotAttack(state, unit) / longRange(state, unit) / ignoresGuardian(state, unit) / ignoresWeiWo(state, unit) / ignoresJianZhen(unit)
 *   run 型（无返回）：turnStart(state, pid) / tactic(state, owner, card) / draw(state, pid, card) / moved(state, unit, from, to)
 *                      hqDamaged(state, pid, dmg, source) / hqGain(state, pid, gained) / unitDamaged(state, unit, amount, source)
 *                      aura(state) / youJi(state, unit) / luLue(state, pid, choice, opt, amount)
 */
export const EXT = {
  attack: [], actionCost: [], deployCost: [], unitDamage: [], hqDamage: [], counter: [], hqAttackMult: [],
  cannotAttack: [], longRange: [], ignoresGuardian: [], ignoresWeiWo: [], ignoresJianZhen: [],
  turnStart: [], tactic: [], draw: [], moved: [], discard: [], attacked: [], loseCap: [], combatDamage: [], afterReveal: [], counterDamage: [], hqDamaged: [], hqGain: [], unitDamaged: [], aura: [], youJi: [], luLue: [], taunt: []
};
export function extFold(name, init, ...args) {
  let v = init;
  for (const fn of EXT[name] || []) { try { v = fn(v, ...args); } catch (err) { console.warn(`扩展 ${name} 出错：`, err); } }
  return v;
}
export function extAny(name, ...args) {
  return (EXT[name] || []).some(fn => { try { return fn(...args); } catch (err) { console.warn(`扩展 ${name} 出错：`, err); return false; } });
}
export function extRun(name, ...args) {
  for (const fn of EXT[name] || []) { try { fn(...args); } catch (err) { console.warn(`扩展 ${name} 出错：`, err); } }
}
function runHooks(name, ...args) {
  for (const fn of PLUGIN_HOOKS[name] || []) {
    try { fn(...args); } catch (err) { console.warn(`插件钩子 ${name} 出错：`, err); }
  }
}

export const ACTIVE_SKILLS = {
  // 程昱·捕粮：弃置1张手牌（自选），额外获得2粮草
  wei_cheng_yu: {
    name: '捕粮', desc: '弃置1张手牌，额外获得2粮草（每回合1次）', needsHandCard: true,
    apply(state, unit, payload) {
      const p = state.players[unit.faction];
      const idx = p.hand.findIndex(c => c.instanceId === payload?.cardId);
      if (idx === -1) throw new Error('请选择要弃置的手牌');
      const [card] = p.hand.splice(idx, 1);
      p.discard.push(card);
      p.provisions += 2;
      log(state, unit.faction, `程昱·捕粮：弃置【${card.name}】，额外获得2粮草`);
      extRun('discard', state, unit.faction, card);
    }
  }
};

/** 单位的全部主动技能（内置 1 个，或工坊积木的多个，各自独立） */
export function getActiveSkills(unit) {
  if (!active(unit)) return [];
  const builtin = ACTIVE_SKILLS[baseId(unit?.cardId)];
  if (builtin) return [{ ...builtin, index: 0 }];
  // 工坊积木主动技：消耗 → 判定 → 获得
  const acts = activeAbilitiesOf(unit);
  return acts.map(act => {
    const costLabel = { NONE: '', PROVISIONS: `消耗${act.cost.amount}粮草`, DISCARD: '弃1张手牌', SELF_DAMAGE: `自身受${act.cost.amount}伤`, HQ_HP: `主城失${act.cost.amount}血`, PRESTIGE: `消耗${act.cost.amount}声望`, ACTION: '消耗行动' }[act.cost.type] || '';
    return {
      index: act.index,
      name: act.name || (acts.length > 1 ? `${unit.skill?.name || '主动技'}${act.index + 1}` : (unit.skill?.name || '主动技')),
      custom: act,
      desc: [costLabel, act.chance < 100 ? `${act.chance}%判定` : '', act.limit === 'GAME' ? '每局1次' : '每回合1次'].filter(Boolean).join('，'),
      needsHandCard: act.cost.type === 'DISCARD',
      handPrompt: '点一张手牌弃置',
      apply(state, u, payload) { runActiveAbility(state, u, act, payload); }
    };
  });
}
export function getActiveSkill(unit, index = 0) {
  return getActiveSkills(unit).find(s => s.index === index) || null;
}

/** 主动技能当前不能发动的原因；可发动返回空串 */
export function activeSkillBlockReason(state, unit, index = 0) {
  const spec = getActiveSkill(unit, index);
  if (!spec) return '该单位没有主动技能';
  if (state.phase !== PHASES.ACTION || state.activePlayer !== unit.faction) return '只能在己方回合发动';
  if (!isOnBoard(state, unit)) return '单位不在场上';
  if (unit.status?.[STATUS_TYPES.IS_FACE_DOWN]) return '潜伏中无法发动';
  if ((unit._skillUsed || {})[index] === state.turnNumber || (index === 0 && unit._skillUsedTurn === state.turnNumber)) return `【${spec.name}】本回合已发动过`;
  if (spec.needsHandCard && !state.players[unit.faction].hand.length) return '没有手牌可弃置';
  if (spec.custom) {
    if (spec.custom.limit === 'GAME' && (unit._skillUsedGame || {})[index]) return `【${spec.name}】每局只能发动1次`;
    const c = activeCostBlock(state, unit, spec.custom);
    if (c) return c;
  }
  return '';
}

export function activateSkill(state, pid, payload = {}) {
  const unit = findUnit(state, payload.unitId)?.unit;
  if (!unit || unit.faction !== pid) throw new Error('只能发动己方单位的技能');
  const index = Number(payload.skillIndex) || 0;
  const reason = activeSkillBlockReason(state, unit, index);
  if (reason) throw new Error(reason);
  getActiveSkill(unit, index).apply(state, unit, payload);
  (unit._skillUsed ||= {})[index] = state.turnNumber;
  unit._acted = true; // 帷幄：发动主动技也算行动
  (unit._skillUsedGame ||= {})[index] = true;
  processDeaths(state);
  refreshAuras(state);
  return { success: true };
}

// ==========================================
// 结算中途的目标选择（孙权·鼎峙、法正·谋主）：玩家选，15 秒未选则随机
// ==========================================
export const CHOICE_SPECS = {
  sunQuan: {
    source: '孙权·鼎峙', prompt: '选择1个敌军，造成1点伤害',
    auto: list => [...list].sort((a, b) => a.hp - b.hp)[0],
    apply(state, pid, t) { damageUnit(state, t, 1, '孙权·鼎峙'); }
  },
  luLue: {
    source: '掳掠', prompt: '击败敌军：选择获得粮草或抽1张牌', pool: 'option',
    auto: (list, state, pid) => (state?.players?.[pid]?.hand?.length ?? 0) < 4 ? list.find(o => o.instanceId === 'draw') : list.find(o => o.instanceId === 'grain'),
    apply(state, pid, opt, choice) {
      if (opt.instanceId === 'draw') { drawCard(state, pid); log(state, pid, '掳掠：抽1张牌'); }
      else { const n = choice?.amount ?? 2; state.players[pid].provisions += n; log(state, pid, `掳掠：获得${n}粮草`); }
      extRun('luLue', state, pid, choice, opt, opt.instanceId === 'draw' ? 0 : (choice?.amount ?? 2));
    }
  },
  chengYu: {
    source: '程昱·捕粮', prompt: '选择弃置1张最低费手牌，额外获得2粮草', pool: 'hand',
    auto: list => list[0],
    apply(state, pid, card) {
      const p = state.players[pid];
      const i = p.hand.indexOf(card);
      if (i === -1) return;
      p.hand.splice(i, 1);
      p.discard.push(card);
      p.provisions += 2;
      log(state, pid, `程昱·捕粮：弃置【${card.name}】，额外获得2粮草`);
      extRun('discard', state, pid, card);
    }
  },
  shengDong: {
    source: '声东击西', prompt: '选择手牌中1个单位上场换防', pool: 'hand',
    auto: list => [...list].sort(byValueDesc)[0],
    apply(state, pid, card, choice) {
      const target = findUnit(state, choice?.boardTargetId)?.unit;
      if (target) shengDongSwap(state, pid, target, card);
    }
  },
  chongZheng: {
    source: '重整旗鼓', prompt: '选择1张弃牌区的卡加入手牌', pool: 'option',
    auto: (list, state, pid) => {
      const d = state.players[pid].discard;
      const best = [...d].filter(c => list.some(o => o.instanceId === c.instanceId)).sort(byValueDesc)[0];
      return list.find(o => o.instanceId === best?.instanceId) || list[0];
    },
    apply(state, pid, opt) {
      const d = state.players[pid].discard;
      const card = d.find(c => c.instanceId === opt.instanceId);
      if (!card) return;
      d.splice(d.indexOf(card), 1);
      resetCardState(card);
      card.faction = pid;
      putInHand(state, pid, card);
      log(state, pid, `重整旗鼓：【${card.name}】重回手牌`);
    }
  },
  shanJing: {
    source: '单经·掣肘', prompt: '选择1个敌军，使其无法行动',
    auto: list => [...list].sort(byValueDesc)[0],
    apply(state, pid, t, choice) { pinUnit(state, findUnit(state, choice?.pinnerId)?.unit, t); }
  },
  weiLie: {
    source: '公孙瓒·威烈', prompt: '有敌军被击败：选择1个敌军压制',
    auto: list => [...list].sort(byValueDesc)[0],
    apply(state, pid, t) { suppressUnit(state, t, '公孙瓒·威烈'); }
  },
  yiZhi: {
    source: '公孙续·遗志', prompt: '选择1个友军，获得+1+1',
    auto: list => [...list].sort((a, b) => b.atk - a.atk)[0],
    apply(state, pid, t) { buff(t, 1, 1); log(state, pid, `公孙续·遗志：【${t.name}】获得+1+1`); }
  },
  oppHand: {
    source: '手牌', prompt: '指定对方1张手牌', pool: 'option',
    auto: list => list.find(o => String(o.name).startsWith('【')) || list[0],
    apply(state, pid, opt, choice = {}) {
      const foe = opp(pid);
      const fp = state.players[foe];
      let card = fp.hand.find(c => c.instanceId === opt.instanceId);
      if (choice.mode === 'reveal') {
        if (!card || card._known) card = fp.hand.find(c => !c._known); // 已公开则顺延
        if (card) {
          card._known = true;
          log(state, pid, `${choice.source || '军机'}：对方【${card.name}】成为明牌`);
        }
        // 军机全部指定完之后再结算的后续效果（坐观天下等）
        if (choice.after) extRun('afterReveal', state, pid, choice.after);
        return;
      }
      if (!card) card = fp.hand[0];
      if (!card) return;
      fp.hand.splice(fp.hand.indexOf(card), 1);
      fp.discard.push(card);
      log(state, pid, `${choice.source || '弃牌'}：弃掉对方手牌【${card.name}】`);
      extRun('discard', state, foe, card);
    }
  },
  block: {
    source: '技能', prompt: '选择目标',
    auto: (list, state, pid) => {
      const enemy = list[0] && list[0].faction !== pid;
      return enemy ? [...list].sort((a, b) => a.hp - b.hp)[0] : [...list].sort((a, b) => b.atk - a.atk)[0];
    },
    apply(state, pid, t, choice) { if (choice?.effect) applyUnitEffect(state, choice.effect, pid, t); }
  },
  youDi: {
    source: '诱敌深入', prompt: '选择把敌军引到哪条前线', pool: 'option',
    // AI / 超时：优先引到对它不利的地形（水域、山地），否则第一条
    auto: (list, state) => list.find(o => ['WATER', 'MOUNTAIN'].includes(state.battlefield.frontline[o.instanceId]?.terrain?.type)) || list[0],
    apply(state, pid, opt, c = {}) {
      const foe = opp(pid);
      const arr = state.battlefield.support[foe].slots;
      const t = arr.find(u => u.instanceId === c.unitId);
      const z = state.battlefield.frontline[opt.instanceId];
      if (!t || !z || z.units.length >= z.capacity || (z.occupant !== null && z.occupant !== foe)) { log(state, pid, '诱敌深入：目标或位置已失效'); return; }
      arr.splice(arr.indexOf(t), 1);
      z.occupant = foe; z.units.push(t);
      log(state, pid, `诱敌深入：【${t.name}】被引至${opt.name.split('（')[0]}`);
      if (hasBadge(t, '鲁莽') || hasBadge(t, '狂傲')) { applyInhibitionLocal(t); log(state, pid, `诱敌深入：【${t.name}】被抑制`); }
    }
  },
  faZheng: {
    source: '法正·谋主', prompt: '选择1个友方单位，获得+1+1',
    auto: list => [...list].filter(isMilitary).sort((a, b) => b.atk - a.atk)[0] || list[0],
    apply(state, pid, t) { buff(t, 1, 1); log(state, pid, `法正·谋主：【${t.name}】获得+1+1`); }
  }
};

/** 声东击西：手牌单位 incoming 与场上友军 target 换防 */
function shengDongSwap(state, owner, target, incoming) {
  const player = state.players[owner];
  const loc = findUnit(state, target.instanceId);
  if (!loc || !player.hand.includes(incoming)) return;
  const zoneArr = zoneUnitsOf(state, loc);
  const idx = zoneArr.indexOf(target);
  player.hand.splice(player.hand.indexOf(incoming), 1);
  removeUnitFromBoard(state, target.instanceId, true, { silent: true });
  resetCardState(target);
  zoneArr.splice(Math.min(idx, zoneArr.length), 0, incoming);
  if (loc.zoneType === 'FRONTLINE') state.battlefield.frontline[loc.zoneKey].occupant = owner;
  incoming.faction = owner;
  incoming.status[STATUS_TYPES.DEPLOYED_THIS_TURN] = true;
  if (!hasKeyword(incoming, '突袭')) incoming.status[STATUS_TYPES.ACTIONS_USED] = 1;
  putInHand(state, owner, target);
  applyEnterKeywords(state, incoming, owner);
  onUnitEnter(state, incoming);
  log(state, owner, `声东击西：【${incoming.name}】与【${target.name}】换防`);
}

/** 奇谋X：己方未被抑制单位的奇谋合计（战法/反制费用减免） */
export function qiMouDiscount(state, owner) {
  return getAllUnits(state, owner).reduce((sum, u) => {
    if (u.status?.[STATUS_TYPES.INHIBITED]) return sum;
    const qm = (u.keywords || []).find(k => typeof k === 'string' && k.startsWith('奇谋'));
    return sum + (qm ? (parseInt(qm.replace('奇谋', '') || '1', 10) || 1) : 0);
  }, 0);
}

/** 打出这张手牌实际需要的粮草：单位按声望减免，战法/反制按奇谋减免 */
export function getCardPlayCost(state, owner, card) {
  const p = state.players[owner];
  const base = card?.cost ?? 0;
  if (card?.type === 'UNIT') { const b = unitDeployCost(state, owner, card); return (!p.prestigeDiscountUsed && p.prestige > 0) ? Math.max(0, b - p.prestige) : b; }
  if (card?.type === 'TACTIC' || card?.type === 'COUNTER') return Math.max(0, base - qiMouDiscount(state, owner));
  return base;
}

/** 单位的部署花费（未计声望减免）：卡面费用 + 场上技能修正（张梁·人公、王国·合众、张允·副督、蔡夫人·献州…） */
export function unitDeployCost(state, owner, card) {
  return Math.max(0, extFold('deployCost', card?.cost ?? 0, state, owner, card));
}

let _choiceSeq = 0;
export function queueChoice(state, pid, kind, sourceUnit, candidates, extra = {}) {
  const list = candidates.filter(Boolean);
  if (!list.length) return;
  const spec = CHOICE_SPECS[kind];
  // 只有1个候选（或手牌候选全是同一张卡）时无需询问
  const sameCard = spec.pool === 'hand' && list.every(c => baseId(c.cardId) === baseId(list[0].cardId));
  if (list.length === 1 || sameCard) { spec.apply(state, pid, list[0], extra); return; }
  const p = state.players[pid];
  (p.pendingChoices ||= []).push({
    id: `ch_${state.turnNumber}_${++_choiceSeq}_${Math.floor(Math.random() * 1e6)}`,
    kind, source: spec.source, prompt: spec.prompt, sourceId: sourceUnit?.instanceId, pool: spec.pool || 'board',
    labels: Object.fromEntries(list.map(u => [u.instanceId, spec.pool === 'hand' ? `${u.name}（${u.cost ?? 0}费）` : u.name])),
    ...extra,
    targetIds: list.map(u => u.instanceId)
  });
}

function liveChoiceTargets(state, pid, choice) {
  if (choice.pool === 'option') return choice.targetIds.map(id => ({ instanceId: id, name: choice.labels?.[id] || id }));
  if (choice.pool === 'hand') return choice.targetIds.map(id => state.players[pid].hand.find(c => c.instanceId === id)).filter(Boolean);
  return choice.targetIds.map(id => findUnit(state, id)?.unit).filter(Boolean);
}

/** 结算队首的选择：targetId=玩家所选；mode='random' 随机（超时）；mode='auto' AI 挑选 */
export function resolveChoice(state, pid, { choiceId, targetId, mode } = {}) {
  const p = state.players[pid];
  const choice = p.pendingChoices?.[0];
  if (!choice) throw new Error('当前没有待选择的目标');
  if (choiceId && choiceId !== choice.id) throw new Error('该选择已失效');
  const spec = CHOICE_SPECS[choice.kind];
  const live = liveChoiceTargets(state, pid, choice);
  let t = null;
  if (targetId) {
    t = live.find(u => u.instanceId === targetId);
    if (!t) throw new Error('目标不合法');
  } else if (mode === 'random') t = randomPick(state, live);
  else t = spec.auto(live, state, pid);
  p.pendingChoices.shift();
  if (t) {
    const name = t.name;
    if (mode === 'random') log(state, pid, `${choice.source}：超时，随机选择了【${name}】`);
    spec.apply(state, pid, t, choice);
  }
  processDeaths(state);
  refreshAuras(state);
  return t;
}

export function autoChoiceTarget(state, pid) {
  const choice = state.players[pid]?.pendingChoices?.[0];
  if (!choice) return null;
  return CHOICE_SPECS[choice.kind].auto(liveChoiceTargets(state, pid, choice), state, pid)?.instanceId || null;
}

/** 选牌超时：随机挑选至多 max 张 */
export function randomPickCards(state, pick) {
  const pool = [...(pick?.cards || [])];
  const out = [];
  while (pool.length && out.length < (pick?.max ?? 0)) out.push(pool.splice(state.prng.randomInt(0, pool.length - 1), 1)[0].instanceId);
  return out;
}

export function discardRandom(state, playerId, count = 1, reason = '') {
  const player = state.players[playerId];
  for (let i = 0; i < count && player.hand.length; i++) {
    const idx = player.hand.length === 1 ? 0 : state.prng.randomInt(0, player.hand.length - 1);
    const card = player.hand.splice(idx, 1)[0];
    player.discard.push(card);
    log(state, opp(playerId), `${reason}：${FACTION_NAME[playerId]}军弃置了手牌【${card.name}】`);
    extRun('discard', state, playerId, card);
  }
}

// ==========================================
// 1. 主城伤害 / 治疗（邓芝·使节、李典减伤）
// ==========================================

export function hqDamageAfterSkills(state, playerId, amount) {
  if (amount <= 0) return 0;
  // 深沟固垒：主城坚阵1
  amount = Math.max(0, amount - (state.players[playerId]?.hqFortify || 0));
  if (amount <= 0) return 0;
  const units = getAllUnits(state, playerId);
  if (units.some(u => isId(u, 'shu_deng_zhi') || isId(u, 'shu_sun_qian') || (active(u) && u.keywords.includes('使节')))) return 0;
  let reduction = 0;
  for (const lidian of units.filter(u => isId(u, 'wei_li_dian'))) {
    reduction += units.filter(u => u !== lidian && getAttackValue(state, u) >= 4).length;
  }
  return Math.max(0, amount - reduction);
}

export function damageHq(state, playerId, amount, source = '', opts = {}) {
  const player = state.players[playerId];
  // 关靖·殉城：己方主城受到伤害时，改由关靖承受
  const guanJing = amount > 0 && !opts.noRedirect && getAllUnits(state, playerId).find(u => isId(u, 'gsz_guan_jing') && active(u));
  if (guanJing) {
    log(state, playerId, `关靖·殉城：代主城承受${amount}点伤害`);
    damageUnit(state, guanJing, amount, '关靖·殉城');
    return 0;
  }
  if (amount > 0 && state.activePlayer !== playerId) triggerCounters(state, 'OWN_HQ_DAMAGED', { playerId, amount, source });
  const dmg = extFold('hqDamage', hqDamageAfterSkills(state, playerId, amount), state, playerId, source);
  if (dmg <= 0) {
    if (amount > 0 && source) log(state, opp(playerId), `${source}：伤害被主城防御抵消`);
    return 0;
  }
  player.hp = Math.max(0, player.hp - dmg);
  state.battlefield.support[playerId].hq.hp = player.hp;
  if (!opts.silent) state.combatLog.push({ type: 'HQ_DAMAGED', playerId, damage: dmg, source, hqHpRemaining: player.hp });
  if (player.hp > 0) extRun('hqDamaged', state, playerId, dmg, source);
  // 陈宫·智迟：己方主城受到伤害时，抽1张牌
  if (player.hp > 0) for (const cg of unitsWith(state, playerId, 'lb_chen_gong')) { drawCard(state, playerId); log(state, playerId, '陈宫·智迟：主城受创，抽1张牌'); }
  if (player.hp <= 0 && state.phase !== PHASES.GAME_OVER) {
    state.winner = opp(playerId);
    state.phase = PHASES.GAME_OVER;
  }
  return dmg;
}

export function healHq(state, playerId, amount, allowOverMax = false) {
  const player = state.players[playerId];
  const before = player.hp;
  if (allowOverMax) {
    player.hp += amount;
    player.maxHp = Math.max(player.maxHp, player.hp);
  } else {
    player.hp = Math.min(player.maxHp, player.hp + amount);
  }
  const hq = state.battlefield.support[playerId].hq;
  hq.hp = player.hp;
  hq.maxHp = player.maxHp;
  if (player.hp > before) extRun('hqGain', state, playerId, player.hp - before);
}

// ==========================================
// 2. 单位伤害 / 压制 / 撤退 / 移位
// ==========================================

/** 能力伤害（不受坚阵减免） */
export function damageUnit(state, unit, amount, source = '') {
  if (!isOnBoard(state, unit) || amount <= 0) return false;
  if (String(source).includes('火攻')) amount *= fireMultiplier(state, unit);
  amount = extFold('unitDamage', amount, state, unit, source);
  if (amount <= 0 || !isOnBoard(state, unit)) return !isOnBoard(state, unit);
  unit.hp -= amount;
  markDamaged(unit, amount);
  if (unit.hp > 0 && isId(unit, 'wu_zhou_tai')) unit.atk += amount;
  state.combatLog.push({ type: 'SKILL_DAMAGE', unitId: unit.instanceId, unitName: unit.name, damage: amount, source, playerId: opp(unit.faction) });
  if (unit.hp <= 0) {
    removeUnitFromBoard(state, unit.instanceId);
    return true;
  }
  extRun('unitDamaged', state, unit, amount, source);
  return !isOnBoard(state, unit);
}

export function canBeSuppressed(state, unit) {
  const loc = findUnit(state, unit.instanceId);
  if (!loc) return false;
  // 夏侯惇·摄众：所在区域己方单位无法被压制
  if (isId(unit, 'wei_cao_hong')) return false;
  return !zoneUnitsOf(state, loc).some(u => u.faction === unit.faction && isId(u, 'wei_xia_hou_dun'));
}

export function suppressUnit(state, unit, source = '') {
  if (!isOnBoard(state, unit) || !canBeSuppressed(state, unit)) return false;
  unit.status[STATUS_TYPES.SUPPRESSED] = true;
  // 持续到其所有者的下个回合结束
  unit.status.suppressedTurnsLeft = unit.faction === state.activePlayer ? 2 : 1;
  log(state, opp(unit.faction), `${source}：【${unit.name}】被压制`);
  return true;
}

const isSteadfast = unit => isId(unit, 'wei_cao_hong') || isId(unit, 'wei_pang_de');

/** 撤退：前线→支援阵线（满则回手）；支援阵线→回手 */
export function retreatUnit(state, unit, source = '') {
  const loc = findUnit(state, unit.instanceId);
  if (!loc || isSteadfast(unit)) return false;
  const owner = unit.faction;
  const support = state.battlefield.support[owner].slots;
  if (loc.zoneType === 'FRONTLINE' && support.length < GAME_CONFIG.MAX_SUPPORT_UNITS) {
    removeUnitFromBoard(state, unit.instanceId, true, { silent: true });
    support.push(unit);
    reapplyEnterKeywords(state, unit);
    log(state, owner, `${source}：【${unit.name}】撤回支援阵线`);
  } else {
    removeUnitFromBoard(state, unit.instanceId, true, { silent: true });
    resetCardState(unit);
    putInHand(state, owner, unit);
    log(state, owner, `${source}：【${unit.name}】撤回手牌`);
  }
  return true;
}

/** 撤退回支援阵线时补给等“在场”效果需要重新挂载 */
function reapplyEnterKeywords(state, unit) {
  if (hasKeyword(unit, '补给') && !unit._grantedExtraGranary) {
    const p = state.players[unit.faction];
    p.extraGranaryCap += 1;
    p.provisionsCap = p.mainGranaryCap + p.extraGranaryCap;
    unit._grantedExtraGranary = true;
  }
}

// ==========================================
// 3. 数值修正：战力 / 行动花费
// ==========================================

/**
 * 计算单位当前战力（督战、望梅止渴、黄忠山地、殊死一战已直接写入 atk）
 * @param foe 交战对象（可选），用于 臧霸·骁勇、满宠·驻防、张郃·巧变
 */
export function getAttackValue(state, unit, loc = null, foe = null) {
  let atk = unit.atk;
  loc ||= findUnit(state, unit.instanceId);
  if (!loc) return atk;
  const fx = ensureTurnFx(state)[unit.faction] || {};

  if (effectiveTroop(state, unit, loc) !== TROOP_TYPES.STRATEGIST) {
    // 督战：同区域（相邻）友方军队 +1
    if (adjacentUnits(state, unit, loc).some(u => u.faction === unit.faction && active(u) && hasKeyword(u, '督战'))) atk += 1;
  }
  if (fx.wangMei && loc.zoneType === 'FRONTLINE') atk += 1;
  // 突驰冲锋：前线己方骑兵+3
  if (fx.tuChi && loc.zoneType === 'FRONTLINE' && unit.troopType === TROOP_TYPES.CAVALRY) atk += 3;
  // 以守为攻：本回合步兵按防御力（生命）造成伤害
  if (fx.defAsAtk && effectiveTroop(state, unit, loc) === TROOP_TYPES.INFANTRY && unit.faction === state.activePlayer) atk = Math.max(atk, unit.hp);
  // 侯成·献酒 / 积木“到回合结束”（回合内临时加成）
  atk += unit._tempAtk || 0;
  // 积木光环
  atk += auraModifiers(state, unit).atk;
  // 王平·镇守：己方坚阵单位在敌方回合战力+2
  if (unit.faction !== state.activePlayer && hasKeyword(unit, '坚阵') && getAllUnits(state, unit.faction).some(u => isId(u, 'shu_wang_ping'))) atk += 2;
  // 程普·石阵：己方水军战力+2
  if (unit.troopType === TROOP_TYPES.NAVY && getAllUnits(state, unit.faction).some(u => isId(u, 'wu_cheng_pu'))) atk += 2;

  // 黄忠·烈弓：山地战力+2（张郃·巧变无视敌方地形增益）
  if (isId(unit, 'shu_huang_zhong') && onMountain(state, loc, unit) && !(foe && isId(foe, 'wei_zhang_he'))) atk += 2;

  if (foe) {
    if (isId(unit, 'wei_zang_ba') && foe.troopType === unit.troopType) atk *= 2;
    if ((isId(unit, 'lb_wei_yue') || isId(unit, 'lb_cheng_lian')) && effectiveTroop(state, foe) === TROOP_TYPES.INFANTRY) atk *= 2;
    if (isId(unit, 'lb_cao_xing') && (foe.atk ?? 0) > unit.atk) atk += 2;
    if (isId(unit, 'wei_man_chong') && foe.troopType === TROOP_TYPES.NAVY) atk += 3;
    if (isId(unit, 'wei_man_chong') && baseId(foe.cardId) === 'shu_guan_yu' && active(foe)) atk += 3; // 关羽可视为水军
  }
  atk = extFold('attack', atk, state, unit, loc, foe);
  return Math.max(0, atk);
}

/** 单位当前是否具有先登（含黄忠山地） */
export function hasVanguard(state, unit, loc = null) {
  if (unit.keywords.includes('先登')) return true;
  loc ||= findUnit(state, unit.instanceId);
  if (inForest(state, loc, unit)) return true; // 林地：获得先登
  return isId(unit, 'shu_huang_zhong') && onMountain(state, loc, unit);
}

export function getActionCost(state, unit, loc = null) {
  let cost = unit.actionCost ?? 1;
  loc ||= findUnit(state, unit.instanceId);
  if (!loc) return cost;
  if (isId(unit, 'shu_wu_dang_fei_jun') && onMountain(state, loc, unit)) cost = 0;
  // 并州铁骑：场上有己方步兵时行动花费-1
  if (isId(unit, 'lb_bing_zhou') && getAllUnits(state, unit.faction).some(u => u !== unit && effectiveTroop(state, u) === TROOP_TYPES.INFANTRY)) cost -= 1;
  // 治军：相同兵种的其他友军行动花费-1
  const friends = getAllUnits(state, unit.faction);
  if (friends.some(u => u !== unit && active(u) && hasKeyword(u, '治军') && u.troopType === unit.troopType)) cost -= 1;
  const fx = ensureTurnFx(state)[unit.faction] || {};
  if (fx.wangMei && loc.zoneType === 'FRONTLINE') cost -= 1;
  if (fx.tuChi && loc.zoneType === 'FRONTLINE' && unit.troopType === TROOP_TYPES.CAVALRY) cost -= 1;
  cost += auraModifiers(state, unit).cost;
  cost = extFold('actionCost', cost, state, unit, loc);
  return Math.max(0, cost);
}

/** 关羽可同时视为水军 */
export function actsLikeCavalry(state, unit, loc = null) {
  loc ||= findUnit(state, unit.instanceId);
  if (onMountain(state, loc, unit) && !ignoresTerrainPenalty(unit)) return false; // 山地：视为步兵
  if (unit.troopType === TROOP_TYPES.CAVALRY) return true;
  if (isId(unit, 'wu_gan_ning')) return true; // 锦帆：可同时视为骑兵
  const water = terrainOf(state, loc, unit)?.type === 'WATER';
  const navy = unit.troopType === TROOP_TYPES.NAVY || isId(unit, 'shu_guan_yu');
  return navy && water;
}

const XIAN_ZHEN = ['wei_pang_de', 'lb_gao_shun', 'lb_xian_zhen'];
export const ignoresGuardian = (unit, state = null) => isId(unit, 'shu_ma_dai') || isId(unit, 'shu_ma_chao') || XIAN_ZHEN.some(id => isId(unit, id))
  // 赵云（公孙瓒）·白马：己方有冲阵的单位攻击时无视守护
  || Boolean(state && hasKeyword(unit, '冲阵') && getAllUnits(state, unit.faction).some(u => isId(u, 'gsz_zhao_yun') && active(u)))
  || (active(unit) && hasKeyword(unit, '铁骑')) || Boolean(state && extAny('ignoresGuardian', state, unit));
/** 铁骑：无视帷幄 */
export const ignoresWeiWo = (unit, state = null) => (active(unit) && hasKeyword(unit, '铁骑')) || Boolean(state && extAny('ignoresWeiWo', state, unit));
/** 陷阵 / 攻坚：攻击时无视坚阵 */
export const ignoresJianZhen = unit => XIAN_ZHEN.some(id => isId(unit, id)) || extAny('ignoresJianZhen', unit);
/** 无法主动攻击的原因（宋建·自守…），空串表示可以 */
export const cannotAttack = (state, unit) => extAny('cannotAttack', state, unit);
/** 可攻击任意阵线（冀州强弩） */
export const hasLongRange = (state, unit) => extAny('longRange', state, unit);
/** 攻城倍率（掘子军） */
export const hqAttackMultiplier = (state, unit) => extFold('hqAttackMult', 1, state, unit);
/** 反击修正（刘琮·束手、郭汜·劫卿） */
export const counterOverride = (state, attacker, defender, can) => extFold('counter', can, state, attacker, defender);
/** 对战伤害落到单位前的转移（刘琦·合兵）：返回该单位实际承受的伤害 */
export function combatDamageRedirect(state, unit, amount) { return amount > 0 ? extFold('combatDamage', amount, state, unit) : amount; }
/** 反击伤害修正（潘璋·暗袭）：defender = 做出反击的单位 */
export const counterDamageMod = (state, defender, dmg) => (dmg > 0 ? extFold('counterDamage', dmg, state, defender) : dmg);
/** 单位成为攻击目标（诸葛亮·对策） */
export function notifyAttacked(state, defender, attacker) { extRun('attacked', state, defender, attacker); }
/** 游击触发（撤退或闪避） */
export function notifyYouJi(state, unit) { extRun('youJi', state, unit); }
export const isArtillery = unit => isId(unit, 'wei_pi_li_che') || isId(unit, 'shu_fa_shi_che');
export const isSiege = unit => isId(unit, 'wei_pi_li_che');
export const isIronWall = unit => ['wei_cao_ren', 'wei_lv_chang', 'wu_zhu_ran'].some(id => isId(unit, id));
/** 曹仁·铁壁：额外免疫矢石（矢石攻击者照常受反击） */
export const immuneToShiShi = unit => isId(unit, 'wei_cao_ren');
/** 鲁肃·结盟：双方战力大于3的单位无法攻击 */
export function allianceBlocks(state, attacker) {
  const lusu = [...getAllUnits(state, FACTIONS.WEI), ...getAllUnits(state, FACTIONS.SHU)].some(u => isId(u, 'wu_lu_su'));
  return lusu && getAttackValue(state, attacker) > 3;
}
/** 吕范·威仪：敌方攻击/指向本单位时花费+2 */
export const targetSurcharge = unit => (isId(unit, 'wu_lv_fan') ? 2 : 0);

/** 护卫：攻击同区域友军时，改为由护卫单位承受 */
export function findBodyguard(state, defender, attacker) {
  const loc = findUnit(state, defender.instanceId);
  if (!loc || (active(defender) && hasKeyword(defender, '护卫'))) return null;
  return adjacentUnits(state, defender, loc).find(u => u.faction === defender.faction && active(u) && hasKeyword(u, '护卫') && u !== attacker) || null;
}

// ==========================================
// 4. 光环（持续数值）：于禁·毅重、发石车·掩护
// ==========================================

export function refreshAuras(state) {
  gszAuras(state);
  extRun('aura', state);
  refreshAuraKeywords(state);
  for (const pid of [FACTIONS.WEI, FACTIONS.SHU]) {
    const units = getAllUnits(state, pid);
    const frontHasFriend = ['LEFT', 'CENTER', 'RIGHT'].some(zk => state.battlefield.frontline[zk].occupant === pid && state.battlefield.frontline[zk].units.length);
    const typeCount = new Set(units.map(u => u.troopType)).size;
    for (const u of units) {
      let want = 0;
      if (isId(u, 'wei_yu_jin')) want = typeCount;
      else if (isId(u, 'shu_fa_shi_che')) want = frontHasFriend ? 1 : 0;
      const have = u._auraAtk || 0;
      if (want !== have) {
        const d = want - have;
        u.atk += d;
        u.maxHp += d;
        u.hp += d;
        if (d < 0) u.hp = Math.max(1, Math.min(u.hp, u.maxHp));
        u._auraAtk = want;
      }
    }
  }
}

/** 公孙瓒势力的持续效果 */
function gszAuras(state) {
  for (const pid of [FACTIONS.WEI, FACTIONS.SHU]) {
    const units = getAllUnits(state, pid);
    // 严纲·猛进：己方骑兵获得突袭；周瑜·左督：己方水军获得突袭
    const yanGang = units.some(u => (isId(u, 'gsz_yan_gang') || isId(u, 'xl_pang_de')) && active(u));
    const zhouYu = units.some(u => isId(u, 'wu_zhou_yu') && active(u));
    for (const u of units) {
      const want = active(u) && ((yanGang && u.troopType === TROOP_TYPES.CAVALRY) || (zhouYu && u.troopType === TROOP_TYPES.NAVY));
      if (want && !u.keywords.includes('突袭')) { u.keywords.push('突袭'); u._auraTuXi = true; }
      else if (!want && u._auraTuXi) { u.keywords = u.keywords.filter(k => k !== '突袭'); u._auraTuXi = false; }
    }
    // 田豫：被压制的敌军同时被抑制
    if (units.some(u => isId(u, 'gsz_tian_yu') && active(u))) {
      for (const e of getAllUnits(state, opp(pid))) {
        if (e.status?.[STATUS_TYPES.SUPPRESSED] && !e.status?.[STATUS_TYPES.INHIBITED]) {
          applyInhibitionLocal(e);
          log(state, pid, `田豫·制敌：【${e.name}】被压制，同时被抑制`);
        }
      }
    }
  }
  // 单经·掣肘：单经离场则解除；被掣肘的敌军离场后，单经可再掣肘另一个敌军
  for (const pid of [FACTIONS.WEI, FACTIONS.SHU]) {
    for (const e of getAllUnits(state, pid)) {
      if (!e._pinnedBy) continue;
      const pinner = findUnit(state, e._pinnedBy)?.unit;
      if (!pinner || !active(pinner)) {
        delete e._pinnedBy;
        e.status[STATUS_TYPES.SUPPRESSED] = false;
        e.status.suppressedTurnsLeft = 0;
        log(state, opp(pid), `掣肘解除：【${e.name}】恢复行动`);
      } else {
        e.status[STATUS_TYPES.SUPPRESSED] = true;
        e.status.suppressedTurnsLeft = Math.max(e.status.suppressedTurnsLeft || 0, 2);
      }
    }
    for (const sj of getAllUnits(state, pid).filter(u => isId(u, 'gsz_shan_jing') && active(u))) {
      const pinned = sj._pinTarget && findUnit(state, sj._pinTarget)?.unit;
      if (sj._pinTarget && !pinned && !sj._rePinQueued) {
        sj._pinTarget = null;
        sj._rePinQueued = true;
        const list = getAllUnits(state, opp(pid)).filter(u => canSkillTarget(u) && !u._pinnedBy);
        queueChoice(state, pid, 'shanJing', sj, list, { pinnerId: sj.instanceId });
      }
    }
  }
}

function pinUnit(state, pinner, target) {
  if (!pinner || !target || !isOnBoard(state, target)) return;
  target._pinnedBy = pinner.instanceId;
  pinner._pinTarget = target.instanceId;
  pinner._rePinQueued = false;
  target.status[STATUS_TYPES.SUPPRESSED] = true;
  target.status.suppressedTurnsLeft = 2;
  log(state, pinner.faction, `单经·掣肘：【${target.name}】无法行动，直至单经离场`);
}

// ==========================================
// 5. 进场（部署 / 召唤 / 交换）
// ==========================================

/** 声望X / 补给 等“进场时”词条 */
export function applyEnterKeywords(state, card, playerId) {
  const player = state.players[playerId];
  if (hasKeyword(card, '补给') && !card._grantedExtraGranary) {
    player.extraGranaryCap += 1;
    player.provisionsCap = player.mainGranaryCap + player.extraGranaryCap;
    card._grantedExtraGranary = true;
  }
  const pk = card.keywords.find(k => k.startsWith('声望'));
  if (pk) adjustPrestige(state, playerId, parseInt(pk.replace('声望', '') || '1', 10) || 1);
  applyJunJi(state, card, playerId);
}

/** 【军机X】进场/使用时：把对方X张手牌变为明牌（对方手牌对我方是暗的，指定即随机挑未公开的） */
export function applyJunJi(state, card, playerId) {
  const jk = (card.keywords || []).find(k => typeof k === 'string' && k.startsWith('军机'));
  if (!jk) return 0;
  const n = parseInt(jk.replace('军机', '') || '1', 10) || 1;
  return revealHand(state, playerId, n, `${card.name}·军机`);
}
export function revealHand(state, playerId, n, source = '军机') {
  // 由我方指定对方手牌中的 n 张（按位置点选暗牌），逐张选择
  const hidden = state.players[opp(playerId)].hand.filter(c => !c._known).length;
  const k = Math.min(n, hidden);
  for (let i = 0; i < k; i++) queueOppHandPick(state, playerId, 'reveal', source, `${source}：指定对方1张手牌成为明牌（${i + 1}/${k}）`);
  return k;
}

/** 在对方手牌里点选1张（暗牌只显示位置，明牌显示名字）：mode = 'reveal' 变明牌 / 'discard' 弃掉 */
export function queueOppHandPick(state, playerId, mode, source, prompt) {
  const hand = state.players[opp(playerId)].hand;
  const opts = hand.map((c, i) => ({ c, i })).filter(({ c }) => mode !== 'reveal' || !c._known)
    .map(({ c, i }) => ({ instanceId: c.instanceId, name: c._known ? `【${c.name}】` : `第${i + 1}张（暗牌）` }));
  if (!opts.length) return;
  queueChoice(state, playerId, 'oppHand', null, opts, { mode, source, prompt });
}

function scout(state, unit, n) {
  const player = state.players[unit.faction];
  for (let i = 0; i < n && player.deck.length > 1; i++) {
    const top = player.deck[0];
    // 侦查：查看牌库顶，若当前粮草难以负担则置底
    if ((top.cost ?? 0) > player.provisionsCap + 1) {
      player.deck.push(player.deck.shift());
      log(state, unit.faction, `【${unit.name}】侦查：将牌库顶一张高费牌置于牌库底`);
    } else {
      log(state, unit.faction, `【${unit.name}】侦查：牌库顶保持不变`);
    }
  }
}

/** 从牌组检索指定卡加入手牌 */
export function searchDeck(state, pid, id, who) {
  const deck = state.players[pid].deck;
  const idx = deck.findIndex(c => baseId(c.cardId) === id);
  if (idx === -1) { log(state, pid, `${who}：牌组中已无可检索的卡`); return false; }
  const card = deck.splice(idx, 1)[0];
  putInHand(state, pid, card);
  log(state, pid, `${who}：检索【${card.name}】`);
  return true;
}

/** 进场技能的目标：玩家选中的优先，其次（AI/超时）自动挑选 */
export function chosenOr(list, unit, fallback) {
  const id = unit?._skillTargetId;
  if (unit) delete unit._skillTargetId;
  return (id && list.find(u => u.instanceId === id)) || fallback(list);
}

/** 进场时需要选择目标的武将技能：候选列表（部署前计算，不含自身） */
export const DEPLOY_TARGETS = {
  shu_jian_yong: { prompt: '说降：选择敌方支援阵线1个目标', list: (state, owner) => state.battlefield.support[opp(owner)].slots.filter(canSkillTarget) },
  wu_yu_fan: { prompt: '说降：选择敌方支援阵线1个目标', list: (state, owner) => state.battlefield.support[opp(owner)].slots.filter(canSkillTarget) },
  wei_xu_chu: {
    prompt: '震慑：选择要压制的敌军',
    list: (state, owner) => getAllUnits(state, opp(owner)).filter(u => !u.status.suppressed && canBeSuppressed(state, u) && !u.status?.[STATUS_TYPES.IS_FACE_DOWN])
  },
  shu_zhang_fei: {
    prompt: '咆哮：选择1个战力不高于张飞的单位，返回其所有者手牌',
    list: (state, owner, card) => [...getAllUnits(state, opp(owner)).filter(canSkillTarget), ...getAllUnits(state, owner)]
      .filter(u => u.instanceId !== card?.instanceId && getAttackValue(state, u) <= (card?.atk ?? 0) && !isSteadfast(u))
  },
  gsz_shan_jing: {
    prompt: '掣肘：选择1个敌军，使其无法行动',
    list: (state, owner) => getAllUnits(state, opp(owner)).filter(u => canSkillTarget(u) && !u._pinnedBy)
  },
  gsz_gong_sun_fan: {
    prompt: '援护：选择1个友军，获得+2+2',
    list: (state, owner, card) => getAllUnits(state, owner).filter(u => u.instanceId !== card?.instanceId)
  },
  gsz_tian_kai: {
    prompt: '驰援：选择1个友军，生命+2',
    list: (state, owner, card) => getAllUnits(state, owner).filter(u => u.instanceId !== card?.instanceId)
  },
  lb_zhang_liao: {
    prompt: '协战：选择1个己方步兵，双方行动花费各-1',
    list: (state, owner, card) => getAllUnits(state, owner).filter(u => u.instanceId !== card?.instanceId && effectiveTroop(state, u) === TROOP_TYPES.INFANTRY)
  }
};

export function getDeployTargets(state, owner, card) {
  _stateForTarget = state;
  const spec = DEPLOY_TARGETS[baseId(card?.cardId)];
  if (!spec || card?.status?.[STATUS_TYPES.INHIBITED]) return null;
  return { prompt: spec.prompt, targets: applyTaunt(state, owner, spec.list(state, owner, card)) };
}

/** 说降：对敌方支援阵线1个目标造成2伤害，二心翻倍 */
function persuade(state, unit, who) {
  const list = state.battlefield.support[opp(unit.faction)].slots.filter(canSkillTarget);
  const t = chosenOr(list, unit, l => [...l].sort((a, b) => (hasBadge(b, '二心') - hasBadge(a, '二心')) || (a.hp - b.hp))[0]);
  if (!t) return;
  damageUnit(state, t, hasBadge(t, '二心') ? 4 : 2, who);
}

export const DEPLOY_SKILLS = {
  gsz_shan_jing(state, unit) {
    const list = getAllUnits(state, opp(unit.faction)).filter(u => canSkillTarget(u) && !u._pinnedBy);
    const t = chosenOr(list, unit, l => [...l].sort(byValueDesc)[0]);
    pinUnit(state, unit, t);
  },
  gsz_gong_sun_fan(state, unit) {
    const list = getAllUnits(state, unit.faction).filter(u => u !== unit);
    const t = chosenOr(list, unit, l => [...l].sort((a, b) => b.atk - a.atk)[0]);
    if (t) { buff(t, 2, 2); log(state, unit.faction, `公孙范·援护：【${t.name}】获得+2+2`); }
  },
  gsz_tian_kai(state, unit) {
    const list = getAllUnits(state, unit.faction).filter(u => u !== unit);
    const t = chosenOr(list, unit, l => [...l].sort((a, b) => a.hp - b.hp)[0]);
    if (t) { buff(t, 0, 2); log(state, unit.faction, `田楷·驰援：【${t.name}】生命+2`); }
  },
  wei_zao_zhi(state, unit) { searchDeck(state, unit.faction, 'wei_tun_tian_zhi', '枣祗·屯田'); },
  wei_zhang_lu(state, unit) {
    if (state.players[unit.faction].prestige > 1) { drawCard(state, unit.faction); log(state, unit.faction, '张鲁·归附：声望>1，摸1张牌'); }
  },
  shu_jian_yong(state, unit) { persuade(state, unit, '简雍·说降'); },
  wu_yu_fan(state, unit) { persuade(state, unit, '虞翻·说降'); },
  wu_zhang_zhao(state, unit) {
    drawCard(state, unit.faction); healHq(state, unit.faction, 3, true);
    log(state, unit.faction, '张昭·辅政：摸1张牌，主城+3');
  },
  wu_han_dang(state, unit) { healHq(state, unit.faction, 4, true); log(state, unit.faction, '韩当·平叛：主城+4'); },
  wu_jie_fan(state, unit) { searchDeck(state, unit.faction, 'wu_shui_lu', '解烦兵'); },
  lb_wei_xu(state, unit) { searchDeck(state, unit.faction, 'lb_xian_zhen', '魏续·守兵'); },
  lb_zhang_liao(state, unit) {
    const inf = chosenOr(getAllUnits(state, unit.faction).filter(u => u !== unit && effectiveTroop(state, u) === TROOP_TYPES.INFANTRY), unit,
      l => [...l].sort((a, b) => (b.actionCost || 0) - (a.actionCost || 0))[0]);
    if (!inf) return;
    unit.actionCost = Math.max(0, (unit.actionCost ?? 1) - 1);
    inf.actionCost = Math.max(0, (inf.actionCost ?? 1) - 1);
    log(state, unit.faction, `张辽·协战：与【${inf.name}】行动花费各-1`);
  },
  // 许褚·震慑：进场时压制1个前线敌军
  wei_xu_chu(state, unit) {
    const targets = getAllUnits(state, opp(unit.faction))
      .filter(u => !u.status.suppressed && canBeSuppressed(state, u) && !u.status?.[STATUS_TYPES.IS_FACE_DOWN]);
    const t = chosenOr(targets, unit, l => [...l].sort((a, b) => b.atk - a.atk)[0]);
    if (t) suppressUnit(state, t, '许褚·震慑');
  },
  wei_man_chong(state, unit) { scout(state, unit, 1); },
  // 徐庶·举荐
  shu_xu_shu(state, unit) { drawCard(state, unit.faction); log(state, unit.faction, '徐庶·举荐：抽1张牌'); },
  // 连弩营·掩射
  shu_lian_nu_ying(state, unit) {
    if (getAllUnits(state, opp(unit.faction)).some(u => hasKeyword(u, '突袭'))) {
      if (!unit.keywords.includes('突袭')) unit.keywords.push('突袭');
      unit.status[STATUS_TYPES.ACTIONS_USED] = 0;
      log(state, unit.faction, '连弩营·掩射：敌方有突袭单位，获得【突袭】');
    }
  },
  // 陈到·白毦：从备用区将1张白毦军加入支援阵线
  shu_chen_dao(state, unit) {
    const player = ensurePlayerMeta(state.players[unit.faction]);
    const support = state.battlefield.support[unit.faction].slots;
    if (support.length >= GAME_CONFIG.MAX_SUPPORT_UNITS) { log(state, unit.faction, '陈到·白毦：支援阵线已满，未能召集白毦军'); return; }
    const idx = player.reserve.findIndex(c => baseId(c.cardId) === 'shu_bai_er_jun');
    if (idx === -1) { log(state, unit.faction, '陈到·白毦：备用区已无白毦军'); return; }
    const card = player.reserve.splice(idx, 1)[0];
    card.faction = unit.faction;
    card.status[STATUS_TYPES.DEPLOYED_THIS_TURN] = true;
    card.status[STATUS_TYPES.ACTIONS_USED] = 1;
    support.push(card);
    log(state, unit.faction, '陈到·白毦：白毦军自备用区加入支援阵线');
  },
  // 张飞·大喝：将1个战力不高于自己的单位返回其所有者卡组顶
  shu_zhang_fei(state, unit) {
    const myAtk = getAttackValue(state, unit);
    const enemies = getAllUnits(state, opp(unit.faction)).filter(u => canSkillTarget(u) && getAttackValue(state, u) <= myAtk && !isSteadfast(u));
    const own = getAllUnits(state, unit.faction).filter(u => u !== unit && getAttackValue(state, u) <= myAtk && !isSteadfast(u));
    const t = chosenOr([...enemies, ...own], unit, () => [...enemies].sort((a, b) => (b.cost - a.cost) || (b.atk - a.atk))[0]);
    if (!t) return;
    removeUnitFromBoard(state, t.instanceId, true, { silent: true });
    resetCardState(t);
    putInHand(state, t.faction, t);
    log(state, unit.faction, `张飞·咆哮：【${t.name}】被喝退回手牌`);
  }
};

export function onUnitEnter(state, unit, opts = {}) {
  // 死亡优先：进场时已被消灭（如被反制击杀）则不再结算进场技能
  if (!active(unit) || !isOnBoard(state, unit)) return;
  if (opts.skillTargetId) unit._skillTargetId = opts.skillTargetId;
  // 徐盛·疑兵：己方下个进场单位获得潜袭
  const meta = ensurePlayerMeta(state.players[unit.faction]);
  if (meta.nextStealth && !isId(unit, 'wu_xu_sheng')) {
    meta.nextStealth = false;
    if (!unit.keywords.includes('潜袭')) unit.keywords.push('潜袭');
    unit.status[STATUS_TYPES.IS_FACE_DOWN] = true;
    log(state, unit.faction, `徐盛·疑兵：【${unit.name}】获得潜袭`);
  }
  if (isId(unit, 'wu_xu_sheng')) meta.nextStealth = true;
  const fn = DEPLOY_SKILLS[baseId(unit.cardId)];
  if (fn) fn(state, unit);
  delete unit._skillTargetId;
  runHooks('onEnter', state, unit);
  refreshAuras(state);
  // 严纲：进场的己方骑兵获得突袭，本回合即可行动
  if (unit._auraTuXi && unit.status[STATUS_TYPES.DEPLOYED_THIS_TURN] && unit.status[STATUS_TYPES.ACTIONS_USED] === 1 && !unit.status.attacksThisTurn && !unit.status[STATUS_TYPES.MOVED_THIS_TURN]) {
    unit.status[STATUS_TYPES.ACTIONS_USED] = 0;
  }
}

// ==========================================
// 6. 移动相关：夏侯渊·虎步、廖化·先锋、诱敌深入
// ==========================================

export function onUnitMoved(state, unit, fromZoneType, toZoneType) {
  if (!isOnBoard(state, unit)) return;
  if (isId(unit, 'wei_xia_hou_yuan')) { unit.atk += 1; log(state, unit.faction, '夏侯渊·虎步：移动后战力+1'); }
  const toFront = fromZoneType === 'SUPPORT' && toZoneType === 'FRONTLINE';
  if (isId(unit, 'shu_liao_hua') && toFront) { buff(unit, 1, 1); log(state, unit.faction, '廖化·先锋：移至前线，获得+1+1'); }
  if (isId(unit, 'wu_sun_jian') && toFront) { buff(unit, 1, 1); log(state, unit.faction, '孙坚·先驱：进入前线，获得+1+1'); }
  if (isId(unit, 'wei_yue_jin') && toFront) { drawCard(state, unit.faction); log(state, unit.faction, '乐进·骁果：进入前线，摸1张牌'); }
  extRun('moved', state, unit, fromZoneType, toZoneType);
  if (fromZoneType === 'FRONTLINE' && toZoneType === 'SUPPORT' && hasKeyword(unit, '游击')) notifyYouJi(state, unit);
  if (isOnBoard(state, unit)) triggerCounters(state, 'ENEMY_MOVE', { unit, fromZoneType, toZoneType });
  refreshAuras(state);
}

// ==========================================
// 7. 反制战法
// ==========================================

export const COUNTERS = {
  // 逆击：敌军发起攻击时，先对其造成3点伤害
  gsz_ni_ji: {
    event: 'ENEMY_ATTACK',
    check: (state, owner, ctx) => Boolean(ctx.attacker && ctx.attacker.faction !== owner && isOnBoard(state, ctx.attacker)),
    fire(state, owner, ctx) { damageUnit(state, ctx.attacker, 3, '逆击'); log(state, owner, `反制【逆击】：先对【${ctx.attacker.name}】造成3点伤害`); }
  },
  // 识破：敌方指令（战法）指向己方目标时，使其无效
  shipo: {
    event: 'ENEMY_TACTIC',
    check: (state, owner, ctx) => Boolean(ctx.target && ctx.target.faction === owner),
    fire(state, owner, ctx) { ctx.negated = true; log(state, owner, `反制【识破】：【${ctx.card.name}】被识破，无效`); }
  },
  // 烧屯伪遁：己方单位被攻击时，使其获得伏击并+1+2，选择交战
  shu_shao_tun: {
    event: 'OWN_ATTACKED',
    check: (state, owner, ctx) => Boolean(ctx.defender && ctx.defender.faction === owner && isOnBoard(state, ctx.defender)),
    fire(state, owner, ctx) {
      const u = ctx.defender;
      if (!u.keywords.includes('伏击')) u.keywords.push('伏击');
      u.status[STATUS_TYPES.AMBUSH_USED_THIS_TURN] = false;
      buff(u, 1, 2);
      log(state, owner, `反制【烧屯伪遁】：【${u.name}】获得伏击并+1+2`);
    }
  },
  // 诱敌深入：敌军移动时，对其造成3伤害；狂傲/鲁莽则造成6伤害
  wei_you_di_shen_ru: {
    event: 'ENEMY_MOVE',
    check: (state, owner, ctx) => ctx.unit && ctx.unit.faction !== owner && isOnBoard(state, ctx.unit) && canTargetEnemy(ctx.unit),
    fire(state, owner, ctx) {
      const u = ctx.unit;
      const dmg = (hasBadge(u, '狂傲') || hasBadge(u, '鲁莽')) ? 6 : 3;
      damageUnit(state, u, dmg, '诱敌深入');
      log(state, owner, `反制【诱敌深入】触发：对【${u.name}】造成${dmg}点伤害`);
    }
  }
};

export function triggerCounters(state, event, ctx) {
  for (const counter of [...(state.activeCounters || [])]) {
    const cid = baseId(counter.cardId);
    const spec = COUNTERS[cid] || COUNTERS[cid.replace(/^[a-z]+_/, '')];
    if (!spec || spec.event !== event || counter.owner === state.activePlayer) continue;
    if (!spec.check(state, counter.owner, ctx)) continue;
    state.activeCounters = state.activeCounters.filter(c => c.id !== counter.id);
    state.players[counter.owner].discard.push(counter.cardDef);
    state.combatLog.push({ type: 'COUNTER_TRIGGERED', playerId: counter.owner, counterName: counter.name });
    spec.fire(state, counter.owner, ctx);
    processDeaths(state);
    return true; // 一次只触发一张
  }
}

// ==========================================
// 8. 战法
// ==========================================

/** 敌方战法/反制能否指向该单位（警戒、背面） */
let _stateForTarget = null;
/** 武将技能指向：【警戒】只防战法/反制，技能只排除潜伏(背面)单位 */
export const canSkillTarget = u => !u?.status?.[STATUS_TYPES.IS_FACE_DOWN] && !zhaXiang(u);
/** 黄盖·诈降：首次攻击前，不能成为敌方指向的目标 */
export const zhaXiang = u => Boolean(u && isId(u, 'wu_huang_gai') && active(u) && !u._hasAttacked);

export const canTargetEnemy = u => {
  if (active(u) && hasKeyword(u, '警戒')) return false;
  if (zhaXiang(u)) return false;
  if (u.status?.[STATUS_TYPES.IS_FACE_DOWN]) return false;
  // 高顺·禁酒：己方步兵获得警戒
  if (_stateForTarget && effectiveTroop(_stateForTarget, u) === TROOP_TYPES.INFANTRY && getAllUnits(_stateForTarget, u.faction).some(x => isId(x, 'lb_gao_shun'))) return false;
  return true;
};

function frontlineEnemies(state, owner) {
  return ['LEFT', 'CENTER', 'RIGHT'].flatMap(zk => {
    const z = state.battlefield.frontline[zk];
    return z.occupant === opp(owner) ? z.units : [];
  });
}

function occupiedZones(state, pid) {
  return ['LEFT', 'CENTER', 'RIGHT'].filter(zk => state.battlefield.frontline[zk].occupant === pid && state.battlefield.frontline[zk].units.length).length;
}

const byValueDesc = (a, b) => ((b.cost || 0) - (a.cost || 0)) || ((b.atk || 0) - (a.atk || 0));

function raiseCap(state, pid, n) {
  const p = state.players[pid];
  p.extraGranaryCap += n;
  p.provisionsCap = p.mainGranaryCap + p.extraGranaryCap;
}

export function applyInhibitionLocal(unit) {
  unit.status[STATUS_TYPES.INHIBITED] = true;
  unit.keywords = [];
  unit.atk = unit.baseAtk; unit.maxHp = unit.baseMaxHp; unit.hp = Math.min(unit.hp, unit.baseMaxHp);
  unit.actionCost = unit.baseActionCost ?? unit.actionCost;
}

/** 通用战法（各势力卡组共用同一效果）：wei_xxx / shu_xxx / wu_xxx / lb_xxx */
function commonTactic(key, spec) {
  return Object.fromEntries(['wei', 'shu', 'wu', 'lb', 'gsz', 'ys', 'hj', 'dz', 'xl', 'lbiao', 'yshu'].map(k => [`${k}_${key}`, spec]));
}

export const TACTICS = {
  // 围困：己方每比对手多占领一个前线区域，对手下回合粮草-1
  wei_wei_kun: {
    play(state, owner) {
      const delta = occupiedZones(state, owner) - occupiedZones(state, opp(owner));
      if (delta > 0) {
        ensurePlayerMeta(state.players[opp(owner)]).provisionPenalty += delta * 3;
        log(state, owner, `围困：对手下回合粮草-${delta * 3}`);
      } else log(state, owner, '围困：前线占领未占优，无效果');
    }
  },
  // 屯田制：粮草上限+1
  wei_tun_tian_zhi: {
    play(state, owner) { raiseCap(state, owner, 1); log(state, owner, '屯田制：粮草上限+1'); }
  },
  // 天子诏令：【声望】粮草上限+1，额外摸1张牌；若己方声望>1，改为粮草上限+2
  wei_tian_zi_zhao_ling: {
    play(state, owner) {
      const p = state.players[owner];
      if (p.prestige > 1) { raiseCap(state, owner, 2); log(state, owner, '天子诏令：声望>1，粮草上限+2'); }
      else { raiseCap(state, owner, 1); drawCard(state, owner); log(state, owner, '天子诏令：粮草上限+1，摸1张牌'); }
    }
  },
  // ---------------- 实体卡新增战法 ----------------
  ...commonTactic('shanjia', {
    targets: (state, owner) => getAllUnits(state, owner).filter(isMilitary),
    autoPick: (state, owner, list) => [...list].sort((a, b) => b.atk - a.atk)[0],
    play(state, owner, card, t) { buff(t, 2, 2); log(state, owner, `缮甲厉兵：【${t.name}】+2+2`); }
  }),
  ...commonTactic('tuqi', {
    targets: (state, owner) => getAllUnits(state, opp(owner)).filter(canTargetEnemy),
    autoPick: (state, owner, list) => [...list].sort((a, b) => (a.hp - b.hp) || byValueDesc(a, b))[0],
    play(state, owner, card, t) { const dead = damageUnit(state, t, 1, '突骑掠阵'); if (!dead) suppressUnit(state, t, '突骑掠阵'); }
  }),
  ...commonTactic('tuchi', {
    play(state, owner) { ensureTurnFx(state)[owner].tuChi = true; log(state, owner, '突驰冲锋：前线己方骑兵战力+3，行动花费-1'); }
  }),
  ...commonTactic('jueshui', {
    play(state, owner) {
      const list = [...state.battlefield.support[opp(owner)].slots];
      const n = list.length;
      for (const u of list) if (canTargetEnemy(u) || true) damageUnit(state, u, n, '决水淹城');
      log(state, owner, `决水淹城：敌方支援阵线每个单位受到${n}点伤害`);
    }
  }),
  ...commonTactic('chengsheng', {
    targets: (state, owner) => getAllUnits(state, opp(owner)).filter(u => canTargetEnemy(u) && u.hp < u.maxHp),
    autoPick: (state, owner, list) => [...list].sort(byValueDesc)[0],
    play(state, owner, card, t) { removeUnitFromBoard(state, t.instanceId, true); log(state, owner, `乘胜掩杀：消灭【${t.name}】`); }
  }),
  ...commonTactic('youdi', {
    targets: (state, owner) => state.battlefield.support[opp(owner)].slots.filter(canTargetEnemy),
    autoPick: (state, owner, list) => [...list].sort((a, b) => ((hasBadge(b, '鲁莽') || hasBadge(b, '狂傲')) - (hasBadge(a, '鲁莽') || hasBadge(a, '狂傲'))) || (a.hp - b.hp))[0],
    play(state, owner, card, t) {
      // 由玩家指定把敌军引到哪条前线（空置或敌方占领且未满的区域）
      const foe = opp(owner);
      const ZN = { LEFT: '左路', CENTER: '中路', RIGHT: '右路' };
      const opts = ['LEFT', 'CENTER', 'RIGHT'].filter(k => { const z = state.battlefield.frontline[k]; return (z.occupant === null || z.occupant === foe) && z.units.length < z.capacity; })
        .map(k => { const z = state.battlefield.frontline[k]; return { instanceId: k, name: `${ZN[k]}·${z.terrain?.name || '前线'}（${z.units.length}/${z.capacity}）` }; });
      if (!opts.length) { log(state, owner, '诱敌深入：前线无处可引'); return; }
      queueChoice(state, owner, 'youDi', null, opts, { unitId: t.instanceId, prompt: `诱敌深入：把【${t.name}】引到哪条前线` });
    }
  }),
  ...commonTactic('andu', {
    precheck: (state) => Boolean(state.battlefield.reserveTerrain) && ['LEFT', 'CENTER', 'RIGHT'].some(k => !state.battlefield.frontline[k].units.length),
    play(state, owner) {
      const bf = state.battlefield;
      const k = ['LEFT', 'CENTER', 'RIGHT'].find(x => !bf.frontline[x].units.length && bf.frontline[x].terrain?.type !== bf.reserveTerrain.type)
        || ['LEFT', 'CENTER', 'RIGHT'].find(x => !bf.frontline[x].units.length);
      const old = bf.frontline[k].terrain;
      bf.frontline[k].terrain = bf.reserveTerrain;
      bf.frontline[k].capacity = bf.reserveTerrain.capacity;
      bf.reserveTerrain = old;
      log(state, owner, `暗度陈仓：${old.name}改为${bf.frontline[k].terrain.name}`);
    }
  }),
  shu_yi_shou_wei_gong: { play(state, owner) { ensureTurnFx(state)[owner].defAsAtk = true; log(state, owner, '以守为攻：本回合步兵以防御力作战'); } },
  shu_shou_long: {
    targets: (state, owner) => state.battlefield.support[owner].slots,
    autoPick: (state, owner, list) => [...list].sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0],
    play(state, owner, card, t) { t.hp = t.maxHp; drawCard(state, owner); log(state, owner, `收拢亡卒：【${t.name}】完全恢复，摸1张牌`); }
  },
  wu_zhi_qun: { play(state, owner) { ensurePlayerMeta(state.players[owner]).bonusProvisions = (state.players[owner].bonusProvisions || 0) + 5; log(state, owner, '指囷相赠：下回合额外获得5粮草'); } },
  wu_shou_xiang: { play(state, owner) { drawCard(state, owner); drawCard(state, owner); log(state, owner, '收降山越：摸2张牌'); } },
  wu_jie_jiang: {
    targets: (state, owner) => getAllUnits(state, opp(owner)).filter(canTargetEnemy),
    autoPick: (state, owner, list) => {
      const dmg = new Set(getAllUnits(state, owner).map(u => u.troopType)).size + 1;
      return [...list].sort((a, b) => ((b.hp <= dmg) - (a.hp <= dmg)) || byValueDesc(a, b))[0];
    },
    play(state, owner, card, t) {
      const dmg = new Set(getAllUnits(state, owner).map(u => u.troopType)).size + 1;
      damageUnit(state, t, dmg, '截江断援');
    }
  },
  wu_shui_lu: {
    targets: (state, owner) => getAllUnits(state, owner).filter(u => isMilitary(u) && u.hp > u.atk),
    autoPick: (state, owner, list) => [...list].sort((a, b) => (b.hp - b.atk) - (a.hp - a.atk))[0],
    play(state, owner, card, t) { t.atk = t.hp; log(state, owner, `水陆并进：【${t.name}】战力变为${t.hp}`); }
  },
  wu_shui_tu: {
    // 卡面：“将1个单位”——己方、敌方均可（敌方需可被指向）
    targets: (state, owner) => [...getAllUnits(state, owner), ...getAllUnits(state, opp(owner)).filter(canTargetEnemy)],
    autoPick: (state, owner, list) => {
      const foes = list.filter(u => u.faction !== owner).sort((a, b) => (b.atk - (b.actionCost ?? 1)) - (a.atk - (a.actionCost ?? 1)));
      return foes[0] || list[0];
    },
    play(state, owner, card, t) {
      (ensureTurnFx(state)[owner].swapped ||= []).push({ instanceId: t.instanceId, atk: t.atk, act: t.actionCost });
      const a = t.atk; t.atk = t.actionCost ?? 1; t.actionCost = a;
      log(state, owner, `水土不服：【${t.name}】战力与行动花费互换`);
    }
  },
  wu_bai_yi: {
    play(state, owner) {
      const foe = opp(owner);
      const n = state.players[foe].hand.length;
      damageHq(state, foe, n, '白衣渡江');
      discardRandom(state, foe, 1, '白衣渡江');
    }
  },
  lb_yuan_men: {
    play(state, owner) {
      for (const zk of ['LEFT', 'CENTER', 'RIGHT']) for (const u of [...state.battlefield.frontline[zk].units]) retreatUnit(state, u, '辕门射戟');
      ensurePlayerMeta(state.players[opp(owner)]).noDeployNextTurn = true;
      log(state, owner, '辕门射戟：前线单位尽数撤退，敌方下回合不能部署单位');
    }
  },
  lb_ye_xi: {
    targets: (state, owner) => getAllUnits(state, opp(owner)).filter(canTargetEnemy),
    autoPick: (state, owner, list) => [...list].sort(byValueDesc)[0],
    play(state, owner, card, t) {
      const loc = findUnit(state, t.instanceId);
      const rash = hasBadge(t, '鲁莽') || hasBadge(t, '狂傲');
      removeUnitFromBoard(state, t.instanceId, true);
      log(state, owner, `夜袭：消灭【${t.name}】`);
      if (rash && loc) {
        const arr = zoneUnitsOf(state, loc);
        for (let i = arr.length - 1; i > 0; i--) { const j = state.prng.randomInt(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; }
        log(state, owner, '夜袭：敌阵大乱，该阵线敌军被打乱站位');
      }
    }
  },
  // 望梅止渴：本回合前线己方单位战力+1，行动花费-1
  wei_wang_mei_zhi_ke: {
    play(state, owner) { ensureTurnFx(state)[owner].wangMei = true; log(state, owner, '望梅止渴：本回合前线己方单位战力+1，行动花费-1'); }
  },
  // 鸿门宴：对1个敌军造成2伤害，若其在支援阵线则伤害翻倍
  wei_hong_men_yan: {
    targets: (state, owner) => getAllUnits(state, opp(owner)).filter(canTargetEnemy),
    autoPick: (state, owner, list) => [...list].sort((a, b) => {
      const da = findUnit(state, a.instanceId).zoneType === 'SUPPORT' ? 4 : 2;
      const db = findUnit(state, b.instanceId).zoneType === 'SUPPORT' ? 4 : 2;
      return ((b.hp <= db) - (a.hp <= da)) || byValueDesc(a, b);
    })[0],
    play(state, owner, card, target) {
      const dmg = findUnit(state, target.instanceId).zoneType === 'SUPPORT' ? 4 : 2;
      damageUnit(state, target, dmg, '鸿门宴');
    }
  },
  // 策反：控制1个花费不大于3或有二心的敌军至回合结束；若己方声望更高则永久控制
  wei_ce_fan: {
    precheck: (state, owner) => state.battlefield.support[owner].slots.length < GAME_CONFIG.MAX_SUPPORT_UNITS,
    precheckMsg: '己方支援阵线已满（4个），无法策反',
    targets: (state, owner) => state.battlefield.support[owner].slots.length >= GAME_CONFIG.MAX_SUPPORT_UNITS ? []
      : getAllUnits(state, opp(owner)).filter(u => canTargetEnemy(u) && ((u.cost ?? 0) <= 3 || hasBadge(u, '二心')) && canBeSuppressed(state, u)),
    autoPick: (state, owner, list) => [...list].sort(byValueDesc)[0],
    play(state, owner, card, target) {
      const permanent = hasBadge(target, '二心') || state.players[owner].prestige > state.players[opp(owner)].prestige;
      const from = target.faction;
      removeUnitFromBoard(state, target.instanceId, true, { silent: true });
      target.originalFaction ||= from;
      target.faction = owner;
      Object.assign(target.status, { actionsUsed: 0, movedThisTurn: false, attackedThisTurn: false, attacksThisTurn: 0, deployedThisTurn: false, suppressed: false });
      state.battlefield.support[owner].slots.push(target);
      reapplyEnterKeywords(state, target);
      if (permanent) target.originalFaction = owner;
      else (ensureTurnFx(state)[owner].controlled ||= []).push({ instanceId: target.instanceId, owner: from });
      log(state, owner, `策反：【${target.name}】倒戈${permanent ? '（声望占优，永久控制）' : '至回合结束'}`);
    }
  },
  // 诈败：使1个前线友军撤退，移除所有伤害，本回合该单位可再次行动
  shu_zha_bai: {
    targets: (state, owner) => getAllUnits(state, owner).filter(u => findUnit(state, u.instanceId).zoneType === 'FRONTLINE' && !isSteadfast(u)),
    autoPick: (state, owner, list) => [...list].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0],
    play(state, owner, card, target) {
      retreatUnit(state, target, '诈败');
      if (isOnBoard(state, target)) {
        target.hp = target.maxHp;
        Object.assign(target.status, { actionsUsed: 0, movedThisTurn: false, attackedThisTurn: false, attacksThisTurn: 0, deployedThisTurn: false });
      }
    }
  },
  // 重整旗鼓：将1张己方弃牌区单位加入手牌
  shu_chong_zheng_qi_gu: {
    precheck: (state, owner) => state.players[owner].discard.length > 0,
    play(state, owner, card) {
      // 由玩家从弃牌区挑选（同名卡只列一张）
      const seen = new Set();
      const opts = state.players[owner].discard.filter(c => c !== card && c.instanceId !== undefined && !seen.has(baseId(c.cardId)) && seen.add(baseId(c.cardId)))
        .map(c => ({ instanceId: c.instanceId, name: `${c.name}（${c.cost ?? 0}费）` }));
      queueChoice(state, owner, 'chongZheng', null, opts);
    }
  },
  // 喘息之机：所有友方单位完全恢复，每实际恢复1个单位，抽1张牌
  shu_chuan_xi_zhi_ji: {
    play(state, owner) {
      let healed = 0;
      for (const u of getAllUnits(state, owner)) if (u.hp < u.maxHp) { u.hp = u.maxHp; healed++; }
      for (let i = 0; i < healed; i++) drawCard(state, owner);
      log(state, owner, `喘息之机：恢复${healed}个单位，抽${healed}张牌`);
    }
  },
  // 声东击西：选择手上1张单位，将其与场上1个友军交换
  shu_sheng_dong_ji_xi: {
    precheck: (state, owner, card) => state.players[owner].hand.some(c => c.type === 'UNIT' && c.instanceId !== card.instanceId),
    targets: (state, owner, card) => {
      const hand = state.players[owner].hand.filter(c => c.type === 'UNIT' && c.instanceId !== card?.instanceId);
      return getAllUnits(state, owner).filter(u => hand.some(h => Math.abs((h.cost || 0) - (u.cost || 0)) <= 4));
    },
    autoPick: (state, owner, list) => [...list].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0],
    play(state, owner, card, target, payload = {}) {
      const player = state.players[owner];
      const handUnits = player.hand.filter(c => c.type === 'UNIT' && Math.abs((c.cost || 0) - (target.cost || 0)) <= 4);
      const chosen = handUnits.find(c => c.instanceId === payload.handCardId);
      if (chosen) { shengDongSwap(state, owner, target, chosen); return; }
      // 由玩家从手牌里选上场的单位（15 秒未选则随机）
      queueChoice(state, owner, 'shengDong', null, handUnits, { boardTargetId: target.instanceId });
    }
  },
  // 连弩迭射：对所有敌军造成1点伤害，若有单位被消灭，重复此效果
  // ---- 公孙瓒 ----
  gsz_lu_mang: {
    targets: (state, owner) => getAllUnits(state, owner).filter(u => u.troopType === TROOP_TYPES.CAVALRY),
    autoPick: (state, owner, list) => [...list].sort((a, b) => b.atk - a.atk)[0],
    play(state, owner, card, t) {
      t._tempAtk = (t._tempAtk || 0) + 5;
      t._doomTurn = state.turnNumber;
      log(state, owner, `鲁莽冲锋：【${t.name}】战力+5，回合结束时被消灭`);
    }
  },
  gsz_shen_gou: {
    play(state, owner) {
      const p = state.players[owner];
      p.hqFortify = 1;
      p._shenGou = true;
      healHq(state, owner, 5, true);
      const drop = ['冲阵', '奋战', '斩将', '先登', '矢石', '火攻', '攻心', '掳掠', '突袭', '游击', '奇袭', '潜袭'];
      for (const u of getAllUnits(state, owner)) u.keywords = u.keywords.filter(k => !drop.includes(k));
      log(state, owner, '深沟固垒：主城获得坚阵1、生命+5；己方单位失去攻击、机动类词条');
    }
  },
  gsz_gu_zhu: {
    precheck: (state, owner) => state.players[owner].hp < 6,
    precheckMsg: '己方主城生命低于6时才能使用',
    play(state, owner) {
      for (const u of [...getAllUnits(state, owner), ...getAllUnits(state, opp(owner))]) damageUnit(state, u, 3, '孤注一掷');
      log(state, owner, '孤注一掷：对所有单位（不分敌我）造成3点伤害');
    }
  },
  gsz_yan_zhen: {
    targets: (state, owner) => getAllUnits(state, opp(owner)).filter(canTargetEnemy),
    autoPick: (state, owner, list) => [...list].sort((a, b) => adjacentUnits(state, b).length - adjacentUnits(state, a).length || a.hp - b.hp)[0],
    play(state, owner, card, t) {
      const hit = [t, ...adjacentUnits(state, t).filter(u => u.faction !== owner)];
      for (const u of hit) { const dead = damageUnit(state, u, 1, '雁阵驰射'); if (!dead) suppressUnit(state, u, '雁阵驰射'); }
    }
  },
  shu_lian_nu_lian_she: {
    play(state, owner) {
      for (let round = 1; round <= 12; round++) {
        const targets = getAllUnits(state, opp(owner)).filter(u => !u.status[STATUS_TYPES.IS_FACE_DOWN]);
        if (!targets.length) break;
        let killed = 0;
        for (const u of targets) if (damageUnit(state, u, 1, '连弩迭射')) killed++;
        log(state, owner, `连弩迭射 第${round}轮：消灭${killed}个敌军`);
        processDeaths(state);
        if (!killed) break;
      }
    }
  },
  // 火烧连营（吴）：对所有敌军造成1点伤害，若有单位被消灭，重复
  wu_huo_shao: {
    play(state, owner) {
      for (let round = 1; round <= 12; round++) {
        const targets = getAllUnits(state, opp(owner)).filter(u => !u.status[STATUS_TYPES.IS_FACE_DOWN]);
        if (!targets.length) break;
        let killed = 0;
        for (const u of targets) if (damageUnit(state, u, 1, '火烧连营')) killed++;
        log(state, owner, `火烧连营 第${round}轮：消灭${killed}个敌军`);
        processDeaths(state);
        if (!killed) break;
      }
    }
  },
  // 隆中对：己方每占领1个前线区域，抽1张牌，粮草上限+1
  shu_long_zhong_dui: {
    play(state, owner) {
      const n = occupiedZones(state, owner);
      const p = state.players[owner];
      for (let i = 0; i < n; i++) drawCard(state, owner);
      p.extraGranaryCap += n;
      p.provisionsCap = p.mainGranaryCap + p.extraGranaryCap;
      log(state, owner, `隆中对：占领${n}个前线区域，抽${n}张牌，粮草上限+${n}`);
    }
  },
  // 殊死一战：己方所有军队的战力与生命互换，直到回合结束
  shu_shu_si_yi_zhan: {
    play(state, owner) {
      const recs = (ensureTurnFx(state)[owner].shuSi ||= []);
      for (const u of getAllUnits(state, owner).filter(isMilitary)) {
        recs.push({ instanceId: u.instanceId, atk: u.atk, hp: u.hp, maxHp: u.maxHp });
        const a = u.atk;
        u.atk = u.hp;
        u.hp = a;
        u.maxHp = a;
      }
      for (const u of getAllUnits(state, owner)) if (u.hp <= 0) removeUnitFromBoard(state, u.instanceId);
      log(state, owner, '殊死一战：己方军队战力与生命互换至回合结束');
    }
  },
  // 火攻：对1个前线敌军造成3伤害，若将其击败，则对其1个相邻单位重复
  shu_huo_gong: {
    targets: (state, owner) => frontlineEnemies(state, owner).filter(canTargetEnemy),
    autoPick: (state, owner, list) => [...list].sort((a, b) => ((b.hp <= 3) - (a.hp <= 3)) || byValueDesc(a, b))[0],
    play(state, owner, card, target) {
      let current = target;
      for (let i = 0; current && i < 6; i++) {
        const loc = findUnit(state, current.instanceId);
        if (!loc) break;
        const arr = zoneUnitsOf(state, loc);
        const idx = arr.indexOf(current);
        const neighbours = [arr[idx + 1], arr[idx - 1]].filter(Boolean);
        const killed = damageUnit(state, current, 3, '火攻');
        if (!killed) break;
        current = neighbours.find(u => !u.status[STATUS_TYPES.IS_FACE_DOWN]) || null;
      }
    }
  },
  // 豪杰归心：翻看3+己方声望张牌，由玩家自己挑选至多2张加入手中，其余弃置
  shu_hao_jie_gui_xin: {
    precheck: (state, owner) => state.players[owner].deck.length > 0,
    play(state, owner) {
      const p = state.players[owner];
      const n = 3 + p.prestige;
      const revealed = p.deck.splice(0, n);
      if (!revealed.length) return;
      p.pendingPick = { source: '豪杰归心', max: 2, cards: revealed };
      log(state, owner, `豪杰归心：翻看${revealed.length}张牌，挑选至多2张加入手牌`);
    }
  }
};

/** 选牌（豪杰归心等）：AI / 超时自动挑选价值最高的 */
export function autoPickCards(pick) {
  return [...(pick?.cards || [])].sort(byValueDesc).slice(0, pick?.max ?? 0).map(c => c.instanceId);
}

/** 结算选牌：选中的进手牌，其余弃置 */
export function resolvePick(state, owner, cardIds = []) {
  const p = state.players[owner];
  const pick = p.pendingPick;
  if (!pick) throw new Error('当前没有待选择的牌');
  const ids = [...new Set(cardIds)];
  if (ids.length > pick.max) throw new Error(`最多只能选择${pick.max}张`);
  if (ids.some(id => !pick.cards.some(c => c.instanceId === id))) throw new Error('选择的牌不在可选范围内');
  const keep = [];
  for (const c of pick.cards) {
    if (ids.includes(c.instanceId)) { putInHand(state, owner, c); keep.push(c); } else if (pick.restTo === 'bottom') p.deck.push(c); else p.discard.push(c);
  }
  p.pendingPick = null;
  log(state, owner, `${pick.source}：收入${keep.map(c => '【' + c.name + '】').join('') || '无'}，其余${pick.restTo === 'bottom' ? '置于牌堆底' : '弃置'}`);
  return keep;
}

const ALIASES = { shengdong: 'shu_sheng_dong_ji_xi', cefan: 'wei_ce_fan', shipo: null };
export function getTacticSpec(card) {
  const id = baseId(card?.cardId);
  if (TACTICS[id]) return TACTICS[id];
  const key = id.replace(/^[a-z]+_/, '');
  return ALIASES[key] ? TACTICS[ALIASES[key]] : null;
}

/** 战法当前无法使用的原因（给界面提示用）；可用时返回空串 */
export function tacticBlockReason(state, owner, card) {
  _stateForTarget = state;
  const spec = getTacticSpec(card);
  if (!spec) return '';
  if (spec.precheck && !spec.precheck(state, owner, card)) return spec.precheckMsg || '当前没有可用目标';
  if (spec.targets && !spec.optionalTarget && !spec.targets(state, owner, card).length) return '当前没有合法目标';
  return '';
}

export function getTacticTargets(state, owner, card) {
  _stateForTarget = state;
  const spec = getTacticSpec(card);
  if (!spec?.targets) return null;
  return applyTaunt(state, owner, spec.targets(state, owner, card));
}
/** 颜良·魔盖等：敌方指向效果只能指向“嘲讽”单位（若它在候选里） */
export function applyTaunt(state, owner, list) {
  if (!Array.isArray(list) || !list.length) return list;
  const forced = list.filter(u => u && u.faction && u.faction !== owner && extAny('taunt', state, u));
  return forced.length ? forced : list;
}

/** 校验战法是否可用并确定目标；无合法目标时抛错（在付费之前调用） */
export function prepareTactic(state, owner, card, payload = {}) {
  _stateForTarget = state;
  const spec = getTacticSpec(card);
  if (!spec) return { spec: null, target: null };
  if (spec.precheck && !spec.precheck(state, owner, card)) throw new Error(`【${card.name}】${spec.precheckMsg || '当前没有可用目标'}`);
  let target = null;
  if (spec.targets) {
    const list = applyTaunt(state, owner, spec.targets(state, owner, card));
    if (!list.length && !spec.optionalTarget) throw new Error(`【${card.name}】当前没有合法目标`);
    if (!list.length) return { spec, target: null };
    if (payload.targetId) {
      target = list.find(u => u.instanceId === payload.targetId);
      if (!target) throw new Error(`【${card.name}】目标不合法`);
    } else {
      target = spec.autoPick ? spec.autoPick(state, owner, list) : list[0];
    }
  }
  return { spec, target };
}

export function resolveTactic(state, owner, card, prepared, payload = {}) {
  const { spec, target } = prepared;
  // 识破：敌方以己方单位为目标的战法无效
  const ctx = { card, target, negated: false };
  if (target) triggerCounters(state, 'ENEMY_TACTIC', ctx);
  if (spec && !ctx.negated) spec.play(state, owner, card, target, payload);
  processDeaths(state);
  if (state.phase !== PHASES.GAME_OVER) extRun('tactic', state, owner, card);
  processDeaths(state);
  if (state.phase === PHASES.GAME_OVER) return;

  // 郭嘉·鬼才：己方使用战法时，对敌方主城造成2伤害
  for (const gj of unitsWith(state, owner, 'wei_guo_jia')) {
    damageHq(state, opp(owner), 2, '郭嘉·鬼才');
    log(state, owner, '郭嘉·鬼才：对敌方主城造成2点伤害');
  }
  // 法正·谋主：己方使用战法时，使1友方单位+1+1
  for (const fz of unitsWith(state, owner, 'shu_fa_zheng')) {
    queueChoice(state, owner, 'faZheng', fz, getAllUnits(state, owner));
  }
  // 诸葛亮·料敌：敌方使用战法时，对其主城造成等同于其花费的伤害
  for (const zg of unitsWith(state, opp(owner), 'shu_zhu_ge_liang')) {
    const dmg = card.cost ?? 0;
    damageHq(state, owner, dmg, '诸葛亮·料敌');
    log(state, opp(owner), `诸葛亮·料敌：对敌方主城造成${dmg}点伤害`);
  }
  refreshAuras(state);
}

// ==========================================
// 9. 交战后结算
// ==========================================

export function afterAttack(state, attacker, defender, result, targetIsHq) {
  // 游击撤退：这次攻击无效，被攻击者不再吃到任何“攻击后”效果（压制、抑制、伤害、减益等）
  if (result?.evaded) defender = null;
  const attackerAlive = isOnBoard(state, attacker);
  const defenderAlive = defender && isOnBoard(state, defender);
  const enemy = opp(attacker.faction);

  // 【掳掠】击败敌军后二选一：获得 2×本单位行动费 的粮草，或抽1张牌
  if (!targetIsHq && result.defenderDied && attackerAlive && active(attacker) && hasKeyword(attacker, '掳掠')) {
    const amount = 2 * (attacker.actionCost ?? 1);
    queueChoice(state, attacker.faction, 'luLue', attacker, [{ instanceId: 'grain', name: `获得${amount}粮草` }, { instanceId: 'draw', name: '抽1张牌' }], { amount, sourceId: attacker.instanceId });
  }

  // 曹洪·贪吝：每次交战后行动花费+1
  if (!targetIsHq && attackerAlive && isId(attacker, 'wei_cao_hong')) { attacker.actionCost = (attacker.actionCost ?? 1) + 1; }
  if (!targetIsHq && defenderAlive && isId(defender, 'wei_cao_hong')) { defender.actionCost = (defender.actionCost ?? 1) + 1; }
  // 周泰·不屈：每受到1伤害，+1战力
  if (!targetIsHq && defenderAlive && isId(defender, 'wu_zhou_tai') && result.damageDealt > 0) { defender.atk += result.damageDealt; log(state, defender.faction, `周泰·不屈：战力+${result.damageDealt}`); }
  if (!targetIsHq && attackerAlive && isId(attacker, 'wu_zhou_tai') && result.counterDealt > 0) { attacker.atk += result.counterDealt; log(state, attacker.faction, `周泰·不屈：战力+${result.counterDealt}`); }
  // 吕蒙·渡江：揭示时检索白衣渡江
  for (const u of [attacker, defender]) {
    if (u && isOnBoard(state, u) && isId(u, 'wu_lv_meng') && !u.status[STATUS_TYPES.IS_FACE_DOWN] && !u._revealedOnce) {
      u._revealedOnce = true;
      searchDeck(state, u.faction, 'wu_bai_yi', '吕蒙·渡江');
    }
  }
  // 吕布·飞将：每消灭1个敌方单位，可额外行动1次（同一回合内不限次数，只要粮草够就能一直连斩）
  if (!targetIsHq && attackerAlive && result.defenderDied && isId(attacker, 'lb_lv_bu')) {
    Object.assign(attacker.status, { actionsUsed: 0, movedThisTurn: false, attackedThisTurn: false, attacksThisTurn: 0 });
    log(state, attacker.faction, '吕布·飞将：斩敌后可额外行动1次');
  }
  // 孙策·霸王：主动攻击和反击击败敌军都触发；按声望拔河结算。
  if (!targetIsHq) {
    for (const [unit, alive, killed] of [[attacker, attackerAlive, result.defenderDied], [defender, defenderAlive, result.attackerDied]]) {
      if (!alive || !killed || !isId(unit, 'wu_sun_ce')) continue;
      const rival = opp(unit.faction);
      const ownBefore = state.players[unit.faction].prestige;
      const rivalBefore = state.players[rival].prestige;
      adjustPrestige(state, unit.faction, 1);
      log(state, unit.faction, `孙策·霸王：争夺1声望（己方 ${ownBefore}→${state.players[unit.faction].prestige}，敌方 ${rivalBefore}→${state.players[rival].prestige}）`);
    }
  }
  runHooks('afterAttack', state, attacker, defender, result, targetIsHq);
  // 黄盖·诈降：攻击过一次后失效
  if (attacker) attacker._hasAttacked = true;
  // 许攸·贪冒：每次攻击后，行动花费+1
  if (attackerAlive && isId(attacker, 'wei_xu_you')) { attacker.actionCost = (attacker.actionCost ?? 1) + 1; log(state, attacker.faction, '许攸·贪冒：行动花费+1'); }
  // 陆逊·韬隐：每次对战后战力翻倍，最多3次
  for (const u of targetIsHq ? [] : [attacker, defender]) {
    if (u && isOnBoard(state, u) && isId(u, 'wu_lu_xun') && active(u) && (u._taoYin || 0) < 3) {
      u._taoYin = (u._taoYin || 0) + 1;
      u.atk *= 2;
      log(state, u.faction, `陆逊·韬隐：战力翻倍（第${u._taoYin}次）`);
    }
  }
  // 白马义从：攻击后压制被攻击的敌军
  if (!targetIsHq && attackerAlive && defenderAlive && isId(attacker, 'gsz_bai_ma_yi_cong')) suppressUnit(state, defender, '白马义从');
  // 孙坚·破虏：压制被自己攻击的单位
  if (!targetIsHq && attackerAlive && defenderAlive && isId(attacker, 'wu_sun_jian')) suppressUnit(state, defender, '孙坚·破虏');

  if (targetIsHq) {
    if (attackerAlive && isId(attacker, 'wei_zhang_liao')) discardRandom(state, enemy, 1, '张辽·劫虑');
    if (attackerAlive && isId(attacker, 'wu_wu_nan')) { buff(attacker, 1, 1); drawCard(state, attacker.faction); log(state, attacker.faction, '无难水军：攻城后+1+1，抽1张牌'); }
  } else if (defender) {
    if (attackerAlive) {
      if (isId(attacker, 'shu_wei_yan')) { buff(attacker, 2, 2); log(state, attacker.faction, '魏延·破军：攻击后获得+2+2'); }
      if (isId(attacker, 'shu_liu_bei')) { attacker.atk += 2; log(state, attacker.faction, '刘备·枭雄：交战存活，战力+2'); }
      if (result.defenderDied && isId(attacker, 'shu_zhao_yun')) {
        if (!attacker.keywords.includes('冲阵')) attacker.keywords.push('冲阵');
        attacker.status[STATUS_TYPES.CHARGE_USED] = false;
        log(state, attacker.faction, '赵云·突围：击败敌军，重新获得【冲阵】');
      }
      if (result.defenderDied && isId(attacker, 'shu_guan_yu')) queueOppHandPick(state, attacker.faction, 'discard', '关羽·威震', '关羽·威震：指定弃掉对方1张手牌');
      if (result.defenderDied && isId(attacker, 'wei_xu_huang')) {
        const overflow = Math.max(0, -(defender.hp ?? 0));
        if (overflow > 0) {
          ensurePlayerMeta(state.players[enemy]).provisionPenalty += overflow;
          log(state, attacker.faction, `徐晃·劫粮：对手下回合损失${overflow}粮草`);
        }
      }
      if (isId(attacker, 'wei_wen_pin') && defenderAlive && result.damageDealt > 0) suppressUnit(state, defender, '文聘·镇守');
    }
    if (defenderAlive) {
      if (isId(defender, 'shu_liu_bei')) { defender.atk += 2; log(state, defender.faction, '刘备·枭雄：交战存活，战力+2'); }
      if (isId(defender, 'wei_wen_pin') && attackerAlive && result.counterDealt > 0) suppressUnit(state, attacker, '文聘·镇守');
    }
  }
  processDeaths(state);
  refreshAuras(state);
}

// ==========================================
// 10. 离场结算（亡计、归心、迟误 …）
// ==========================================

export function processDeaths(state) {
  let guard = 0;
  while ((state.pendingDeaths?.length || 0) > 0 && guard++ < 50) {
    const rec = state.pendingDeaths.shift();
    const unit = rec.unit;
    const owner = rec.owner;
    runHooks('onDeath', state, unit, owner, { banish: Boolean(rec.banish) });
    const wasActive = !unit.status?.[STATUS_TYPES.INHIBITED];
    const id = baseId(unit.cardId);

    // 曹操·归心：每当有敌军被消灭时，摸1张牌
    for (const cc of unitsWith(state, opp(owner), 'wei_cao_cao')) {
      drawCard(state, cc.faction);
      log(state, cc.faction, `曹操·归心：【${unit.name}】被消灭，摸1张牌`);
    }

    if (!rec.banish && wasActive) {
      // 郭嘉·遗计：战败时从牌堆选择1张战法加入手牌
      if (id === 'wei_guo_jia') {
        const deck = state.players[owner].deck;
        const idx = deck.findIndex(c => c.type === 'TACTIC');
        if (idx !== -1) { const c = deck.splice(idx, 1)[0]; putInHand(state, owner, c); log(state, owner, `郭嘉·遗计：检索战法【${c.name}】`); }
      }
      // 刘备·枭雄：被击败后返回牌堆顶
      if (id === 'shu_liu_bei') {
        const c = spliceFromDiscards(state, unit);
        if (c) { resetCardState(c); c.faction = owner; state.players[owner].deck.unshift(c); log(state, owner, '刘备·枭雄：败走，返回牌堆顶'); }
      }
      // 廖化·诈死：被击败后洗回牌堆
      if (id === 'shu_liao_hua') {
        const c = spliceFromDiscards(state, unit);
        if (c) {
          resetCardState(c); c.faction = owner;
          const deck = state.players[owner].deck;
          deck.splice(deck.length ? state.prng.randomInt(0, deck.length) : 0, 0, c);
          log(state, owner, '廖化·诈死：洗回牌堆');
        }
      }
    }
    // 公孙瓒·威烈：每当敌军被消灭时，压制1个敌军
    {
      for (const gz of unitsWith(state, opp(owner), 'gsz_gong_sun_zan')) {
        if (!active(gz)) continue;
        const list = getAllUnits(state, owner).filter(u => !u.status?.[STATUS_TYPES.SUPPRESSED] && canBeSuppressed(state, u) && canSkillTarget(u));
        queueChoice(state, gz.faction, 'weiLie', gz, list);
      }
    }
    if (!rec.banish && wasActive) {
      // 公孙瓒·焚亡：离场时，对己方主城造成3点伤害（见下方，含被斩将移除）
      // 公孙续·遗志：被击败时，使1个友军+1+1
      if (id === 'gsz_gong_sun_xu') queueChoice(state, owner, 'yiZhi', null, getAllUnits(state, owner));
    }
    if (id === 'gsz_gong_sun_zan' && wasActive) damageHq(state, owner, 3, '公孙瓒·焚亡', { noRedirect: true });
    // 黄权·权变：每当己方单位离场时，对敌方主城造成1伤害
    for (const hq of unitsWith(state, owner, 'shu_huang_quan')) damageHq(state, opp(owner), 1, '黄权·权变');
    if (!rec.banish && wasActive) {
      // 宋宪/郝萌·叛乱：被击败时，对己方主城造成1点伤害
      if (id === 'lb_song_xian' || id === 'lb_hao_meng') damageHq(state, owner, 1, `${unit.name}·叛乱`);
      // 傅彤/陈武·死战：敌方回合被击败时，立即结束敌方回合
      if ((id === 'shu_fu_tong' || id === 'wu_chen_wu') && state.activePlayer !== owner && state.phase !== PHASES.GAME_OVER) {
        state.forceEndTurn = true;
        log(state, owner, `${unit.name}·死战：敌方回合立即结束`);
      }
    }
    // 刘封·迟误：每当有友军被击败时，自己撤退
    if (!rec.banish) {
      for (const lf of unitsWith(state, owner, 'shu_liu_feng')) retreatUnit(state, lf, '刘封·迟误');
    }
  }
  refreshAuras(state);
}

// ==========================================
// 11. 回合钩子
// ==========================================

function beforeRefill(state, pid) {
  const p = ensurePlayerMeta(state.players[pid]);
  if (p.pendingCapGain > 0) {
    p.extraGranaryCap += p.pendingCapGain;
    log(state, pid, `粮草上限+${p.pendingCapGain}（屯田/诏令）`);
    p.pendingCapGain = 0;
  }
}

function afterRefill(state, pid) {
  const p = ensurePlayerMeta(state.players[pid]);
  if (p.noDeployNextTurn) p._noDeployActive = true;
  if (p.bonusProvisions > 0) { p.provisions += p.bonusProvisions; log(state, pid, `指囷相赠：额外获得${p.bonusProvisions}粮草`); p.bonusProvisions = 0; }
  if (p.provisionPenalty > 0) {
    const lost = Math.min(p.provisions, p.provisionPenalty);
    p.provisions -= lost;
    log(state, opp(pid), `围困/劫粮：${FACTION_NAME[pid]}军本回合粮草-${lost}`);
    p.provisionPenalty = 0;
  }
  for (const u of getAllUnits(state, pid)) {
    // 于禁·毅重：回合开始时完全恢复
    if (isId(u, 'wei_yu_jin') && u.hp < u.maxHp) { u.hp = u.maxHp; log(state, pid, '于禁·毅重：完全恢复'); }
    // 孙权·鼎峙：若上回合未被攻击，对任意敌军造成1伤害
    if (isId(u, 'wu_sun_quan') && u._attackedOnTurn !== state.turnNumber - 1) {
      _stateForTarget = state;
      queueChoice(state, pid, 'sunQuan', u, getAllUnits(state, opp(pid)).filter(canSkillTarget));
    }
    // 贾逵·筑城：回合开始时，己方主城+1防
    if (isId(u, 'wei_jia_kui')) { healHq(state, pid, 1, true); log(state, pid, '贾逵·筑城：主城+1'); }
  }
  extRun('turnStart', state, pid);
  processDeaths(state);
  refreshAuras(state);
}

function onTurnEnd(state, pid) {
  runHooks('onTurnEnd', state, pid);
  const fx = ensureTurnFx(state)[pid];
  const p = state.players[pid];
  const units = getAllUnits(state, pid);

  // 荀彧·王佐：友方回合结束时，若前线有友方单位，抽1张牌
  if (units.some(u => isId(u, 'wei_xun_yu')) && occupiedZones(state, pid) > 0) {
    for (const _ of unitsWith(state, pid, 'wei_xun_yu')) { drawCard(state, pid); log(state, pid, '荀彧·王佐：抽1张牌'); }
  }
  // 幕僚：己方回合结束时，若在支援阵线，主城恢复1点
  for (const u of state.battlefield.support[pid].slots) {
    if (active(u) && hasKeyword(u, '幕僚') && p.hp < p.maxHp) { healHq(state, pid, 1); log(state, pid, `【${u.name}】幕僚：主城恢复1点`); }
  }
  // 李通·砺战：敌方回合结束时若在前线，获得+1+1
  for (const lt of unitsWith(state, opp(pid), 'wei_li_tong')) {
    if (findUnit(state, lt.instanceId)?.zoneType === 'FRONTLINE') { buff(lt, 1, 1); log(state, lt.faction, '李通·砺战：获得+1+1'); }
  }

  // 殊死一战复原
  for (const rec of fx.shuSi || []) {
    const u = findUnit(state, rec.instanceId)?.unit;
    if (!u) continue;
    const damage = Math.max(0, u.maxHp - u.hp);
    u.atk = rec.atk;
    u.maxHp = rec.maxHp;
    u.hp = rec.hp - damage;
    if (u.hp <= 0) removeUnitFromBoard(state, u.instanceId);
  }
  // 策反（临时）归还
  for (const rec of fx.controlled || []) {
    const u = findUnit(state, rec.instanceId)?.unit;
    if (!u) continue;
    removeUnitFromBoard(state, u.instanceId, true, { silent: true });
    u.faction = rec.owner;
    const support = state.battlefield.support[rec.owner].slots;
    if (support.length < GAME_CONFIG.MAX_SUPPORT_UNITS) { support.push(u); reapplyEnterKeywords(state, u); }
    else { resetCardState(u); putInHand(state, rec.owner, u); }
    log(state, rec.owner, `【${u.name}】策反结束，回归本阵`);
  }
  // 水土不服复原
  for (const rec of fx.swapped || []) {
    const u = findUnit(state, rec.instanceId)?.unit;
    if (u) { u.atk = rec.atk; u.actionCost = rec.act; }
  }
  // 侯成·献酒：临时战力清零
  for (const u of [...getAllUnits(state, FACTIONS.WEI), ...getAllUnits(state, FACTIONS.SHU)]) {
    u._tempAtk = 0;
    // 鲁莽冲锋：回合结束时被消灭
    if (u._doomTurn !== undefined && u._doomTurn <= state.turnNumber) { delete u._doomTurn; removeUnitFromBoard(state, u.instanceId); log(state, u.faction, `鲁莽冲锋：【${u.name}】力竭阵亡`); continue; }
    // 积木“到回合结束”获得的词条
    if (u._tempKw?.length) { u.keywords = u.keywords.filter(k => !u._tempKw.includes(k)); u._tempKw = []; }
  }
  // 辕门射戟：本方“不能部署”在自己回合结束时解除
  if (p.noDeployNextTurn && p._noDeployActive) { p.noDeployNextTurn = false; p._noDeployActive = false; }
  state.turnEffects[pid] = {};
  processDeaths(state);
}

/** 抽牌钩子：甘宁·锦帆、侯成·献酒 */
function onDraw(state, pid) {
  if (state.phase === PHASES.GAME_OVER) return;
  for (const gn of unitsWith(state, pid, 'wu_gan_ning')) damageHq(state, opp(pid), 1, '甘宁·锦帆');
  for (const hc of unitsWith(state, pid, 'lb_hou_cheng')) { hc._tempAtk = (hc._tempAtk || 0) + 2; log(state, pid, '侯成·献酒：战力+2'); }
  const hand = state.players[pid].hand;
  extRun('draw', state, pid, hand[hand.length - 1]);
}

registerTurnHooks({ beforeRefill, afterRefill, onTurnEnd, onDraw });

export default {
  TACTICS, getTacticTargets, prepareTactic, resolveTactic, afterAttack, processDeaths,
  onUnitEnter, onUnitMoved, applyEnterKeywords, getAttackValue, getActionCost, damageHq, refreshAuras
};

// 积木技能：撤退 / 返回手牌 / 玩家选择目标（15 秒，超时随机）
registerAbilityHooks({
  retreat: (state, unit) => retreatUnit(state, unit, '技能'),
  returnToHand: (state, unit) => {
    if (!findUnit(state, unit.instanceId)) return false;
    removeUnitFromBoard(state, unit.instanceId, true, { silent: true });
    resetCardState(unit);
    const owner = unit.originalFaction || unit.faction;
    unit.faction = owner;
    putInHand(state, owner, unit);
    log(state, owner, `【${unit.name}】返回手牌`);
    return true;
  },
  chooseUnit: (state, owner, source, list, effect) => {
    const name = EFFECT_NAMES[effect.type] || '效果';
    queueChoice(state, owner, 'block', source, list, { effect, source: source?.name || '技能', prompt: `选择${list[0]?.faction === owner ? '友军' : '敌军'}：${name}${effect.amount ? ` ${effect.amount}` : ''}${effect.keyword ? `【${effect.keyword}】` : ''}` });
  }
});
const EFFECT_NAMES = { DAMAGE_UNIT: '造成伤害', HEAL_UNIT: '恢复', BUFF_ATTACK: '战力+', DEBUFF_ATTACK: '战力−', TURN_ATTACK: '本回合战力+', BUFF_HEALTH: '生命+', ACTION_COST_DOWN: '行动花费−', ACTION_COST_UP: '行动花费+', APPLY_SUPPRESSION: '压制', APPLY_INHIBITION: '抑制', REVEAL_UNIT: '翻开', RESTORE_ACTION: '恢复行动', GRANT_KEYWORD: '获得', TURN_KEYWORD: '本回合获得', REMOVE_KEYWORD: '移除', RETREAT: '撤退', RETURN_HAND: '返回手牌', DESTROY: '消灭' };

// 新势力技能（袁绍 / 黄巾 / 董卓 / 西凉 / 刘表）：模块内只定义函数，这里在本文件初始化完成后再挂载，避免循环引用
import { installFactions2 } from './factions2.js';
installFactions2();
