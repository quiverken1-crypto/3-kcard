import { PHASES, STATUS_TYPES } from './constants.js';
import { drawCard, adjustPrestige, getAllUnits, findUnit, removeUnitFromBoard } from './state.js';
import { applySuppression, applyInhibition } from './combat.js';

export const ABILITY_TRIGGERS = Object.freeze([
  'ON_DEPLOY', 'ON_PLAY', 'ON_MOVE', 'ON_ATTACK', 'ON_DEFEND', 'ON_KILL',
  'ON_DEATH', 'ON_DAMAGED', 'ON_TURN_START', 'ON_TURN_END', 'ON_ENEMY_ACTION'
]);
export const EFFECT_TYPES = Object.freeze([
  'DRAW', 'STEAL_CARD', 'DISCARD_RANDOM', 'GAIN_PRESTIGE', 'REMOVE_PRESTIGE',
  'GAIN_PROVISIONS', 'STEAL_PROVISIONS', 'GAIN_CAPACITY',
  'DAMAGE_HQ', 'HEAL_HQ', 'DAMAGE_UNIT', 'HEAL_UNIT',
  'BUFF_ATTACK', 'BUFF_HEALTH', 'APPLY_SUPPRESSION', 'APPLY_INHIBITION',
  'GRANT_KEYWORD', 'REMOVE_KEYWORD', 'REVEAL_UNIT', 'RESTORE_ACTION'
]);
export const EFFECT_TARGETS = Object.freeze([
  'OWNER', 'OPPONENT', 'SELF', 'ATTACKER', 'DEFENDER',
  'RANDOM_ENEMY', 'RANDOM_FRIENDLY', 'ALL_ENEMIES', 'ALL_FRIENDLIES'
]);

const opponentOf = owner => owner === 'WEI' ? 'SHU' : 'WEI';
const randomIndex = (state, count) => count <= 1 ? 0 : state.prng.randomInt(0, count - 1);

function targetPlayer(state, owner, target) {
  const id = target === 'OPPONENT' ? opponentOf(owner) : owner;
  return state.players[id] ? id : null;
}

function targetUnits(state, owner, target, source, context) {
  if (target === 'SELF') return source?.type === 'UNIT' && findUnit(state, source.instanceId) ? [source] : [];
  if (target === 'ATTACKER') return context.attacker && findUnit(state, context.attacker.instanceId) ? [context.attacker] : [];
  if (target === 'DEFENDER') return context.defender && findUnit(state, context.defender.instanceId) ? [context.defender] : [];
  if (target === 'ALL_ENEMIES') return getAllUnits(state, opponentOf(owner));
  if (target === 'ALL_FRIENDLIES') return getAllUnits(state, owner);
  if (target === 'RANDOM_ENEMY' || target === 'RANDOM_FRIENDLY') {
    const units = getAllUnits(state, target === 'RANDOM_ENEMY' ? opponentOf(owner) : owner);
    return units.length ? [units[randomIndex(state, units.length)]] : [];
  }
  return [];
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
    default: break;
  }
  const units = targetUnits(state, owner, effect.target, source, context);
  let changed = false;
  for (const unit of units) {
    if (!findUnit(state, unit.instanceId)) continue;
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
      SOURCE_SURVIVED: source.type !== 'UNIT' || Boolean(findUnit(state, source.instanceId)) ? 1 : 0
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
