import { PHASES, STATUS_TYPES } from './constants.js';
import { drawCard, adjustPrestige, getAllUnits, findUnit, removeUnitFromBoard } from './state.js';
import { applySuppression, applyInhibition } from './combat.js';

/**
 * 积木技能目录（工坊用）：触发时机 / 效果 / 目标 / 目标筛选 / 条件，全部带中文名与分类。
 * 效果 kind: player=作用于玩家；unit=作用于单位；deck=作用于己方牌库
 */
export const TRIGGER_CATALOG = [
  { id: 'ON_DEPLOY', label: '进场时', group: '基础' },
  { id: 'ON_PLAY', label: '打出时（战法/反制）', group: '基础' },
  { id: 'ON_DEATH', label: '阵亡时', group: '基础' },
  { id: 'ON_ATTACK', label: '攻击后', group: '战斗' },
  { id: 'ON_DEFEND', label: '被攻击后', group: '战斗' },
  { id: 'ON_KILL', label: '击败敌军后', group: '战斗' },
  { id: 'ON_DAMAGED', label: '受伤后', group: '战斗' },
  { id: 'ON_MOVE', label: '移动后', group: '行动' },
  { id: 'ON_TURN_START', label: '己方回合开始', group: '回合' },
  { id: 'ON_TURN_END', label: '己方回合结束', group: '回合' },
  { id: 'ON_ALLY_DEPLOY', label: '其他友军进场时', group: '联动' },
  { id: 'ON_ALLY_DEATH', label: '其他友军阵亡时', group: '联动' },
  { id: 'ON_ENEMY_DEPLOY', label: '敌军进场时', group: '联动' },
  { id: 'ON_ENEMY_ACTION', label: '敌方行动时（反制）', group: '反制' },
  { id: 'AURA', label: '在场时持续（光环）', group: '持续' },
  { id: 'ACTIVE', label: '主动技（点单位发动）', group: '主动' }
];
/** 主动技：消耗 → 判定 → 获得 */
export const ACTIVE_COST_CATALOG = [
  ['NONE', '无消耗'], ['PROVISIONS', '消耗粮草'], ['DISCARD', '弃1张手牌（自选）'], ['SELF_DAMAGE', '自身受伤'],
  ['HQ_HP', '己方主城失血'], ['PRESTIGE', '消耗声望'], ['ACTION', '消耗本单位行动']
];
export const ACTIVE_LIMIT_CATALOG = [['TURN', '每回合1次'], ['GAME', '每局1次']];
export const EFFECT_CATALOG = [
  { id: 'DRAW', label: '抽牌', group: '资源', kind: 'player' },
  { id: 'GAIN_PROVISIONS', label: '获得粮草', group: '资源', kind: 'player' },
  { id: 'STEAL_PROVISIONS', label: '夺取粮草', group: '资源', kind: 'player' },
  { id: 'GAIN_CAPACITY', label: '粮草上限+', group: '资源', kind: 'player' },
  { id: 'GAIN_PRESTIGE', label: '获得声望', group: '资源', kind: 'player' },
  { id: 'REMOVE_PRESTIGE', label: '减少声望', group: '资源', kind: 'player' },
  { id: 'DISCARD_RANDOM', label: '随机弃牌', group: '资源', kind: 'player' },
  { id: 'STEAL_CARD', label: '偷取手牌', group: '资源', kind: 'player' },
  { id: 'SEARCH_DECK', label: '检索（从牌库找符合筛选的牌加入手牌）', group: '资源', kind: 'deck' },
  { id: 'DAMAGE_HQ', label: '主城伤害', group: '主城', kind: 'player' },
  { id: 'HEAL_HQ', label: '主城恢复', group: '主城', kind: 'player' },
  { id: 'DAMAGE_UNIT', label: '造成伤害', group: '数值', kind: 'unit' },
  { id: 'HEAL_UNIT', label: '恢复生命', group: '数值', kind: 'unit' },
  { id: 'BUFF_ATTACK', label: '战力+（永久）', group: '数值', kind: 'unit', aura: true },
  { id: 'DEBUFF_ATTACK', label: '战力−（永久）', group: '数值', kind: 'unit', aura: true },
  { id: 'TURN_ATTACK', label: '战力+（到回合结束）', group: '数值', kind: 'unit' },
  { id: 'BUFF_HEALTH', label: '生命+（永久）', group: '数值', kind: 'unit' },
  { id: 'ACTION_COST_DOWN', label: '行动花费−', group: '数值', kind: 'unit', aura: true },
  { id: 'ACTION_COST_UP', label: '行动花费+', group: '数值', kind: 'unit', aura: true },
  { id: 'APPLY_SUPPRESSION', label: '压制（数值=回合数）', group: '状态', kind: 'unit' },
  { id: 'APPLY_INHIBITION', label: '抑制', group: '状态', kind: 'unit' },
  { id: 'REVEAL_UNIT', label: '翻开潜伏', group: '状态', kind: 'unit' },
  { id: 'RESTORE_ACTION', label: '恢复行动', group: '状态', kind: 'unit' },
  { id: 'GRANT_KEYWORD', label: '获得词条（永久；光环里为在场期间）', group: '词条', kind: 'unit', keyword: true, aura: true },
  { id: 'TURN_KEYWORD', label: '获得词条（到回合结束）', group: '词条', kind: 'unit', keyword: true },
  { id: 'REMOVE_KEYWORD', label: '移除词条', group: '词条', kind: 'unit', keyword: true },
  { id: 'RETREAT', label: '撤退（前线→支援，支援→手牌）', group: '位置', kind: 'unit' },
  { id: 'RETURN_HAND', label: '返回所有者手牌', group: '位置', kind: 'unit' },
  { id: 'DESTROY', label: '直接消灭', group: '位置', kind: 'unit' }
];
export const TARGET_CATALOG = [
  { id: 'OWNER', label: '己方', group: '玩家', kind: 'player' },
  { id: 'OPPONENT', label: '对方', group: '玩家', kind: 'player' },
  { id: 'SELF', label: '自身', group: '单个', kind: 'unit' },
  { id: 'ATTACKER', label: '攻击者', group: '单个', kind: 'unit' },
  { id: 'DEFENDER', label: '被攻击者', group: '单个', kind: 'unit' },
  { id: 'TRIGGER_UNIT', label: '触发的那个单位（联动）', group: '单个', kind: 'unit' },
  { id: 'CHOSEN_ENEMY', label: '玩家选择1个敌军', group: '单个', kind: 'unit' },
  { id: 'CHOSEN_FRIENDLY', label: '玩家选择1个友军', group: '单个', kind: 'unit' },
  { id: 'RANDOM_ENEMY', label: '随机1个敌军', group: '单个', kind: 'unit' },
  { id: 'RANDOM_FRIENDLY', label: '随机1个友军', group: '单个', kind: 'unit' },
  { id: 'WEAKEST_ENEMY', label: '生命最低的敌军', group: '单个', kind: 'unit' },
  { id: 'STRONGEST_ENEMY', label: '战力最高的敌军', group: '单个', kind: 'unit' },
  { id: 'ALL_ENEMIES', label: '所有敌军', group: '群体', kind: 'unit' },
  { id: 'ALL_FRIENDLIES', label: '所有友军', group: '群体', kind: 'unit' },
  { id: 'OTHER_FRIENDLIES', label: '其他友军（不含自身）', group: '群体', kind: 'unit' },
  { id: 'SAME_ZONE_FRIENDLIES', label: '同区域友军', group: '群体', kind: 'unit' },
  { id: 'NEARBY_ENEMIES', label: '相邻前线的敌军', group: '群体', kind: 'unit' }
];
export const FILTER_CATALOG = {
  troop: [['', '任意兵种'], ['INFANTRY', '步兵'], ['CAVALRY', '骑兵'], ['NAVY', '水军'], ['STRATEGIST', '谋士'], ['ARCHER', '器械']],
  line: [['', '任意位置'], ['FRONTLINE', '前线'], ['SUPPORT', '支援阵线']],
  cardType: [['', '任意类型'], ['UNIT', '单位'], ['TACTIC', '战法'], ['COUNTER', '反制']]
};
export const CONDITION_CATALOG = [
  { id: 'OWNER_PROVISIONS', label: '己方粮草' }, { id: 'ENEMY_PROVISIONS', label: '对方粮草' },
  { id: 'OWNER_PRESTIGE', label: '己方声望' }, { id: 'ENEMY_PRESTIGE', label: '对方声望' },
  { id: 'OWNER_HAND', label: '己方手牌数' }, { id: 'OWNER_UNITS', label: '己方单位数' }, { id: 'ENEMY_UNITS', label: '敌方单位数' },
  { id: 'OWNER_HQ_HP', label: '己方主城血量' }, { id: 'ENEMY_HQ_HP', label: '对方主城血量' },
  { id: 'SOURCE_HP', label: '自身生命' }, { id: 'SOURCE_IN_FRONTLINE', label: '自身在前线（1是0否）' },
  { id: 'TARGET_HP', label: '被攻击者生命' }, { id: 'TARGET_DIED', label: '被攻击者阵亡（1是0否）' },
  { id: 'SOURCE_SURVIVED', label: '自身存活（1是0否）' }, { id: 'TURN_NUMBER', label: '回合数' }
];

export const ABILITY_TRIGGERS = Object.freeze(TRIGGER_CATALOG.map(t => t.id));
export const EFFECT_TYPES = Object.freeze(EFFECT_CATALOG.map(e => e.id));
export const EFFECT_TARGETS = Object.freeze(TARGET_CATALOG.map(t => t.id));
export const CONDITION_FIELDS = Object.freeze(CONDITION_CATALOG.map(c => c.id));
export const PLAYER_EFFECTS = new Set(EFFECT_CATALOG.filter(e => e.kind === 'player').map(e => e.id));
export const DECK_EFFECTS = new Set(EFFECT_CATALOG.filter(e => e.kind === 'deck').map(e => e.id));
export const KEYWORD_EFFECTS = new Set(EFFECT_CATALOG.filter(e => e.keyword).map(e => e.id));
export const AURA_EFFECTS = new Set(EFFECT_CATALOG.filter(e => e.aura).map(e => e.id));

/** 由规则层注入：撤退 / 返回手牌 / 消灭 / 玩家选择目标（避免循环依赖） */
// var：循环引用时 cardSkills 可能先于本模块求值，避免暂时性死区
var hooks; // eslint-disable-line no-var
export function registerAbilityHooks(h) { hooks = { ...(hooks || {}), ...h }; }

const opponentOf = owner => owner === 'WEI' ? 'SHU' : 'WEI';
const randomIndex = (state, count) => count <= 1 ? 0 : state.prng.randomInt(0, count - 1);

function targetPlayer(state, owner, target) {
  const id = target === 'OPPONENT' ? opponentOf(owner) : owner;
  return state.players[id] ? id : null;
}

function matchesFilter(state, unit, filter) {
  if (!filter) return true;
  if (filter.troop && unit.troopType !== filter.troop) return false;
  if (filter.line) {
    const loc = findUnit(state, unit.instanceId);
    if (!loc || loc.zoneType !== filter.line) return false;
  }
  if (filter.badge && !(unit.badges || []).includes(filter.badge)) return false;
  if (filter.keyword && !(unit.keywords || []).some(k => k.replace(/\d+$/, '') === filter.keyword)) return false;
  return true;
}

const ZONE_ORDER = { LEFT: 0, CENTER: 1, RIGHT: 2 };
function candidateUnits(state, owner, target, source, context) {
  const enemies = () => getAllUnits(state, opponentOf(owner));
  const friends = () => getAllUnits(state, owner);
  const onBoard = u => u && findUnit(state, u.instanceId) ? [u] : [];
  switch (target) {
    case 'SELF': return source?.type === 'UNIT' ? onBoard(source) : [];
    case 'ATTACKER': return onBoard(context.attacker);
    case 'DEFENDER': return onBoard(context.defender);
    case 'TRIGGER_UNIT': return onBoard(context.triggerUnit);
    case 'ALL_ENEMIES': case 'RANDOM_ENEMY': case 'WEAKEST_ENEMY': case 'STRONGEST_ENEMY': case 'CHOSEN_ENEMY': return enemies();
    case 'ALL_FRIENDLIES': case 'RANDOM_FRIENDLY': case 'CHOSEN_FRIENDLY': return friends();
    case 'OTHER_FRIENDLIES': return friends().filter(u => u !== source);
    case 'SAME_ZONE_FRIENDLIES': {
      const loc = source && findUnit(state, source.instanceId);
      if (!loc) return [];
      return friends().filter(u => { const l = findUnit(state, u.instanceId); return l && l.zoneType === loc.zoneType && l.zoneKey === loc.zoneKey; });
    }
    case 'NEARBY_ENEMIES': {
      const loc = source && findUnit(state, source.instanceId);
      return enemies().filter(u => {
        const l = findUnit(state, u.instanceId);
        if (!l || l.zoneType !== 'FRONTLINE') return false;
        if (!loc || loc.zoneType !== 'FRONTLINE') return true;
        return Math.abs(ZONE_ORDER[l.zoneKey] - ZONE_ORDER[loc.zoneKey]) <= 1;
      });
    }
    default: return [];
  }
}

function targetUnits(state, owner, target, source, context, filter) {
  const list = candidateUnits(state, owner, target, source, context).filter(u => matchesFilter(state, u, filter));
  if (!list.length) return [];
  if (target === 'RANDOM_ENEMY' || target === 'RANDOM_FRIENDLY') return [list[randomIndex(state, list.length)]];
  if (target === 'WEAKEST_ENEMY') return [[...list].sort((a, b) => a.hp - b.hp)[0]];
  if (target === 'STRONGEST_ENEMY') return [[...list].sort((a, b) => b.atk - a.atk)[0]];
  return list;
}

function changeHq(state, playerId, delta, owner) {
  const player = state.players[playerId];
  if (!player || delta === 0) return false;
  player.hp = Math.max(0, Math.min(player.maxHp, player.hp + delta));
  state.battlefield.support[playerId].hq.hp = player.hp;
  if (player.hp <= 0) {
    state.winner = playerId === owner ? opponentOf(owner) : owner;
    state.phase = PHASES.GAME_OVER;
  }
  return true;
}

function applyEffect(state, effect, owner, source, context) {
  const amount = effect.amount ?? 1;
  const playerId = targetPlayer(state, owner, effect.target);
  const player = state.players[playerId];
  switch (effect.type) {
    case 'DRAW':
      for (let i = 0; i < amount; i++) drawCard(state, playerId);
      return amount > 0;
    case 'STEAL_CARD': {
      const victim = state.players[opponentOf(owner)];
      let moved = false;
      for (let i = 0; i < amount && victim.hand.length; i++) {
        const stolen = victim.hand.splice(randomIndex(state, victim.hand.length), 1)[0];
        stolen.originalFaction ||= stolen.faction;
        stolen.faction = owner;
        if (state.players[owner].hand.length < 9) state.players[owner].hand.push(stolen);
        else state.players[owner].discard.push(stolen);
        moved = true;
      }
      return moved;
    }
    case 'DISCARD_RANDOM': {
      let moved = false;
      for (let i = 0; i < amount && player.hand.length; i++) {
        player.discard.push(player.hand.splice(randomIndex(state, player.hand.length), 1)[0]);
        moved = true;
      }
      return moved;
    }
    case 'GAIN_PRESTIGE': adjustPrestige(state, playerId, amount); return amount > 0;
    case 'REMOVE_PRESTIGE': player.prestige = Math.max(0, player.prestige - amount); return amount > 0;
    case 'GAIN_PROVISIONS': player.provisions = Math.min(player.provisionsCap, player.provisions + amount); return amount > 0;
    case 'STEAL_PROVISIONS': {
      const victim = state.players[effect.target === 'OWNER' ? owner : opponentOf(owner)];
      const taken = Math.min(amount, victim.provisions);
      victim.provisions -= taken;
      state.players[owner].provisions = Math.min(state.players[owner].provisionsCap, state.players[owner].provisions + taken);
      return taken > 0;
    }
    case 'GAIN_CAPACITY':
      player.extraGranaryCap += amount;
      player.provisionsCap = player.mainGranaryCap + player.extraGranaryCap;
      return amount > 0;
    case 'DAMAGE_HQ': return changeHq(state, playerId, -amount, owner);
    case 'HEAL_HQ': return changeHq(state, playerId, amount, owner);
    case 'SEARCH_DECK': {
      const me = state.players[owner];
      let found = 0;
      for (let i = 0; i < amount; i++) {
        const idx = me.deck.findIndex(c => (!effect.filter?.cardType || c.type === effect.filter.cardType) && (!effect.filter?.troop || c.troopType === effect.filter.troop));
        if (idx === -1) break;
        const [card] = me.deck.splice(idx, 1);
        if (me.hand.length < 9) me.hand.push(card); else me.discard.push(card);
        found++;
      }
      return found > 0;
    }
    default: break;
  }
  if (effect.target === 'CHOSEN_ENEMY' || effect.target === 'CHOSEN_FRIENDLY') {
    const list = targetUnits(state, owner, effect.target, source, context, effect.filter);
    if (!list.length) return false;
    if (hooks?.chooseUnit) { hooks.chooseUnit(state, owner, source, list, effect); return true; }
    return applyUnitEffect(state, effect, owner, list[0]);
  }
  const units = targetUnits(state, owner, effect.target, source, context, effect.filter);
  let changed = false;
  for (const unit of units) changed = applyUnitEffect(state, effect, owner, unit) || changed;
  return changed;
}

/** 把一个单位效果作用到指定单位（玩家选择目标后也走这里） */
export function applyUnitEffect(state, effect, owner, unit) {
  const amount = effect.amount ?? 1;
  let changed = false;
  if (!unit || !findUnit(state, unit.instanceId)) return false;
  {
    switch (effect.type) {
      case 'DAMAGE_UNIT':
        unit.hp -= amount;
        unit.status[STATUS_TYPES.DAMAGED] = true;
        if (unit.hp <= 0) removeUnitFromBoard(state, unit.instanceId);
        changed = true;
        break;
      case 'HEAL_UNIT': unit.hp = Math.min(unit.maxHp, unit.hp + amount); changed = true; break;
      case 'BUFF_ATTACK': unit.atk += amount; changed = true; break;
      case 'BUFF_HEALTH': unit.maxHp += amount; unit.hp += amount; changed = true; break;
      case 'APPLY_SUPPRESSION': applySuppression(unit, Math.max(1, amount)); changed = true; break;
      case 'APPLY_INHIBITION': changed = applyInhibition(unit) || changed; break;
      case 'GRANT_KEYWORD':
        if (!unit.keywords.includes(effect.keyword)) { unit.keywords.push(effect.keyword); changed = true; }
        break;
      case 'REMOVE_KEYWORD':
        if (unit.keywords.includes(effect.keyword)) { unit.keywords = unit.keywords.filter(kw => kw !== effect.keyword); changed = true; }
        break;
      case 'REVEAL_UNIT': unit.status[STATUS_TYPES.IS_FACE_DOWN] = false; changed = true; break;
      case 'RESTORE_ACTION':
        unit.status[STATUS_TYPES.ACTIONS_USED] = 0;
        unit.status[STATUS_TYPES.MOVED_THIS_TURN] = false;
        unit.status[STATUS_TYPES.ATTACKED_THIS_TURN] = false;
        unit.status.attacksThisTurn = 0;
        changed = true;
        break;
      case 'DEBUFF_ATTACK': unit.atk = Math.max(0, unit.atk - amount); changed = true; break;
      case 'TURN_ATTACK': unit._tempAtk = (unit._tempAtk || 0) + amount; changed = true; break;
      case 'ACTION_COST_DOWN': unit.actionCost = Math.max(0, (unit.actionCost ?? 1) - amount); changed = true; break;
      case 'ACTION_COST_UP': unit.actionCost = (unit.actionCost ?? 1) + amount; changed = true; break;
      case 'TURN_KEYWORD':
        if (effect.keyword && !unit.keywords.includes(effect.keyword)) {
          unit.keywords.push(effect.keyword);
          (unit._tempKw ||= []).push(effect.keyword);
          changed = true;
        }
        break;
      case 'RETREAT': changed = hooks?.retreat ? hooks.retreat(state, unit) : false; break;
      case 'RETURN_HAND': changed = hooks?.returnToHand ? hooks.returnToHand(state, unit) : false; break;
      case 'DESTROY': removeUnitFromBoard(state, unit.instanceId); changed = true; break;
      default: break;
    }
  }
  return changed;
}

function checkConditions(state, conditions, owner, source, context) {
  return (conditions || []).every(condition => {
    const opponent = opponentOf(owner);
    const values = {
      OWNER_PROVISIONS: state.players[owner].provisions,
      OWNER_PRESTIGE: state.players[owner].prestige,
      ENEMY_PROVISIONS: state.players[opponent].provisions,
      SOURCE_HP: source.hp ?? 0,
      TARGET_HP: context.defender?.hp ?? 0,
      TURN_NUMBER: state.turnNumber,
      TARGET_DIED: context.result?.defenderDied ? 1 : 0,
      SOURCE_SURVIVED: source.type !== 'UNIT' || Boolean(findUnit(state, source.instanceId)) ? 1 : 0,
      ENEMY_PRESTIGE: state.players[opponent].prestige,
      OWNER_HAND: state.players[owner].hand.length,
      OWNER_UNITS: getAllUnits(state, owner).length,
      ENEMY_UNITS: getAllUnits(state, opponent).length,
      OWNER_HQ_HP: state.players[owner].hp,
      ENEMY_HQ_HP: state.players[opponent].hp,
      SOURCE_IN_FRONTLINE: findUnit(state, source.instanceId)?.zoneType === 'FRONTLINE' ? 1 : 0
    };
    const actual = values[condition.field];
    if (actual === undefined) return false;
    return condition.op === 'EQ' ? actual === condition.value
      : condition.op === 'GTE' ? actual >= condition.value : actual <= condition.value;
  });
}

export function runAbilityTrigger(state, trigger, source, context = {}) {
  if (!source || source.status?.[STATUS_TYPES.INHIBITED]) return [];
  // 死亡优先于技能结算：已阵亡/离场的单位只结算“阵亡时”技能
  if (source.type === 'UNIT' && trigger !== 'ON_DEATH' && !findUnit(state, source.instanceId)) return [];
  const owner = source.faction;
  if (!state.players[owner]) return [];
  const emitted = [];
  for (const ability of source.abilities || []) {
    if (ability.trigger === 'AURA') continue;
    if (ability.trigger !== trigger || !checkConditions(state, ability.conditions, owner, source, context)) continue;
    let applied = false;
    for (const effect of ability.effects || []) {
      applied = applyEffect(state, effect, owner, source, context) || applied;
    }
    if (applied) {
      const event = { type: 'ABILITY_TRIGGERED', playerId: owner, cardName: source.name, cardId: source.cardId, audioCue: source.audioCue, trigger, effects: ability.effects.map(effect => effect.type) };
      state.combatLog.push(event);
      emitted.push(event);
    }
  }
  return emitted;
}

/** 联动触发：某单位进场 / 阵亡时，通知场上其他单位（友军 ALLY_*，敌军 ENEMY_DEPLOY） */
export function runLinkedTriggers(state, kind, unit) {
  if (!unit) return;
  const owner = unit.faction;
  const foe = opponentOf(owner);
  if (kind === 'DEPLOY') {
    for (const u of [...getAllUnits(state, owner)]) if (u !== unit) runAbilityTrigger(state, 'ON_ALLY_DEPLOY', u, { triggerUnit: unit });
    for (const u of [...getAllUnits(state, foe)]) runAbilityTrigger(state, 'ON_ENEMY_DEPLOY', u, { triggerUnit: unit });
  } else if (kind === 'DEATH') {
    for (const u of [...getAllUnits(state, owner)]) if (u !== unit) runAbilityTrigger(state, 'ON_ALLY_DEATH', u, { triggerUnit: unit });
  }
}

/** 光环：场上带 AURA 积木的单位，对符合筛选的单位持续提供战力 / 行动花费修正 */
export function auraModifiers(state, unit) {
  let atk = 0, cost = 0;
  if (!unit) return { atk, cost };
  for (const pid of ['WEI', 'SHU']) {
    for (const src of getAllUnits(state, pid)) {
      if (src.status?.[STATUS_TYPES.INHIBITED]) continue;
      for (const ab of src.abilities || []) {
        if (ab.trigger !== 'AURA') continue;
        for (const ef of ab.effects || []) {
          if (!AURA_EFFECTS.has(ef.type)) continue;
          const friendly = unit.faction === pid;
          const t = ef.target;
          const hit = (t === 'SELF' && unit === src) || (t === 'ALL_FRIENDLIES' && friendly) || (t === 'OTHER_FRIENDLIES' && friendly && unit !== src) || (t === 'ALL_ENEMIES' && !friendly);
          if (!hit || !matchesFilter(state, unit, ef.filter)) continue;
          const n = ef.amount ?? 1;
          if (ef.type === 'BUFF_ATTACK') atk += n;
          else if (ef.type === 'DEBUFF_ATTACK') atk -= n;
          else if (ef.type === 'ACTION_COST_DOWN') cost -= n;
          else if (ef.type === 'ACTION_COST_UP') cost += n;
        }
      }
    }
  }
  return { atk, cost };
}

/** 主动技：每条“主动技”积木都是一个独立技能（各自的消耗、判定、次数与效果） */
export function activeAbilitiesOf(unit) {
  return (unit?.abilities || []).filter(a => a.trigger === 'ACTIVE').map((a, index) => ({
    index,
    name: a.name || '',
    cost: a.cost || { type: 'NONE', amount: 0 },
    chance: Math.max(0, Math.min(100, a.chance ?? 100)),
    limit: a.limit === 'GAME' ? 'GAME' : 'TURN',
    conditions: a.conditions || [],
    effects: a.effects || []
  }));
}
export const activeAbilityOf = unit => activeAbilitiesOf(unit)[0] || null;

/** 主动技当前能否支付消耗；可以返回空串 */
export function activeCostBlock(state, unit, act) {
  const p = state.players[unit.faction];
  const n = act.cost.amount ?? 1;
  switch (act.cost.type) {
    case 'PROVISIONS': return p.provisions < n ? `粮草不足（需${n}）` : '';
    case 'DISCARD': return p.hand.length ? '' : '没有手牌可弃置';
    case 'PRESTIGE': return p.prestige < n ? `声望不足（需${n}）` : '';
    case 'SELF_DAMAGE': return (unit.hp ?? 0) <= n ? '生命不足以支付' : '';
    case 'HQ_HP': return p.hp <= n ? '主城生命不足以支付' : '';
    case 'ACTION': return (unit.status?.[STATUS_TYPES.ACTIONS_USED] || 0) >= 1 ? '本单位本回合已行动' : '';
    default: return '';
  }
}

/** 发动主动技：先付消耗，再判定（条件 + 概率），成功则结算效果；返回是否判定成功 */
export function runActiveAbility(state, unit, act, payload = {}) {
  const p = state.players[unit.faction];
  const n = act.cost.amount ?? 1;
  switch (act.cost.type) {
    case 'PROVISIONS': p.provisions -= n; break;
    case 'DISCARD': {
      const idx = p.hand.findIndex(c => c.instanceId === payload?.cardId);
      if (idx === -1) throw new Error('请选择要弃置的手牌');
      p.discard.push(p.hand.splice(idx, 1)[0]);
      break;
    }
    case 'PRESTIGE': p.prestige -= n; break;
    case 'SELF_DAMAGE': unit.hp -= n; unit.status[STATUS_TYPES.DAMAGED] = true; break;
    case 'HQ_HP': changeHq(state, unit.faction, -n, unit.faction); break;
    case 'ACTION': unit.status[STATUS_TYPES.ACTIONS_USED] = (unit.status[STATUS_TYPES.ACTIONS_USED] || 0) + 1; break;
    default: break;
  }
  const condOk = checkConditions(state, act.conditions, unit.faction, unit, {});
  const roll = act.chance >= 100 ? 100 : state.prng.randomInt(1, 100);
  const success = condOk && roll <= act.chance;
  if (success) for (const ef of act.effects) applyEffect(state, ef, unit.faction, unit, {});
  state.combatLog.push({ type: 'SKILL', playerId: unit.faction, message: `【${unit.name}】发动${act.name ? `【${act.name}】` : '主动技'}${act.chance < 100 ? `（判定 ${roll}/${act.chance}）` : ''}：${success ? '成功' : '判定失败'}` });
  return success;
}

/** 光环词条：带 AURA+GRANT_KEYWORD 积木的单位在场时，符合筛选的单位获得词条；离场后收回（每次刷新重算） */
export function refreshAuraKeywords(state) {
  const all = [...getAllUnits(state, 'WEI'), ...getAllUnits(state, 'SHU')];
  const want = new Map();
  for (const src of all) {
    if (src.status?.[STATUS_TYPES.INHIBITED]) continue;
    for (const ab of src.abilities || []) {
      if (ab.trigger !== 'AURA') continue;
      for (const ef of ab.effects || []) {
        if (ef.type !== 'GRANT_KEYWORD' || !ef.keyword) continue;
        for (const u of all) {
          const friendly = u.faction === src.faction;
          const t = ef.target;
          const hit = (t === 'SELF' && u === src) || (t === 'ALL_FRIENDLIES' && friendly) || (t === 'OTHER_FRIENDLIES' && friendly && u !== src) || (t === 'ALL_ENEMIES' && !friendly);
          if (hit && matchesFilter(state, u, ef.filter)) { if (!want.has(u)) want.set(u, new Set()); want.get(u).add(ef.keyword); }
        }
      }
    }
  }
  for (const u of all) {
    const had = u._auraKws || [];
    const now = [...(want.get(u) || [])];
    for (const k of had) if (!now.includes(k)) u.keywords = u.keywords.filter(x => x !== k);
    const added = [];
    for (const k of now) { if (!u.keywords.includes(k)) { u.keywords.push(k); added.push(k); } else if (had.includes(k)) added.push(k); }
    u._auraKws = added;
  }
}
