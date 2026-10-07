/**
 * combat.js — Authoritative Combat Pipeline & Keyword Resolution Engine
 * Conforms to rules_spec.md, tech_architecture.md, and testHarness.js.
 * Implements Target Validation, Dual Counterattacks, 25+ Keywords, Status Effects,
 * and Survival Validity (存活生效律).
 */

import {
  FACTIONS,
  TROOP_TYPES,
  PHASES,
  KEYWORDS,
  STATUS_TYPES,
  hasKeyword,
  getKeywordValue
} from './constants.js';
import { findUnit, getAllUnits, removeUnitFromBoard, drawCard, markDamaged } from './state.js';
import {
  getAttackValue, getActionCost, actsLikeCavalry as skillActsLikeCavalry, ignoresGuardian,
  isArtillery, isSiege, isIronWall, findBodyguard, effectiveTroop, hasShiShi, fireMultiplier, isGuardedUnit, isGuardedHq, unitTerrain, baseId, ignoresJianZhen, ignoresWeiWo, cannotAttack, hasLongRange, hqAttackMultiplier, counterOverride, notifyYouJi, notifyAttacked, combatDamageRedirect, immuneToShiShi, allianceBlocks, targetSurcharge, triggerCounters, hasVanguard as hasVanguardSkill, damageHq, zhaXiang, retreatUnit
} from './cardSkills.js';

const getAttackStyle = unit => unit.keywords.includes(KEYWORDS.HUO_GONG) || unit.keywords.includes(KEYWORDS.SHI_SHI) || ['ARCHER', 'STRATEGIST'].includes(unit.troopType)
  ? 'FIREBALL' : 'MELEE';

/**
 * Calculates effective attack of a unit considering continuous auras such as 督战 (+1 ATK to adjacent friendly military units).
 * Strategists are excluded from 督战 bonus.
 */
export function getEffectiveAttack(state, unit, loc = null, foe = null) {
  return getAttackValue(state, unit, loc, foe);
}

/**
 * Propagates fire attack splash damage recursively to adjacent enemy units or enemy HQ.
 */
export function applyFireSplash(state, targetLoc, oppFaction, splashDamage, initialKilledId) {
  const visited = new Set();
  if (initialKilledId) visited.add(initialKilledId);
  const opponent = state.players[oppFaction];

  if (targetLoc.zoneType === 'SUPPORT') {
    opponent.hp = Math.max(0, opponent.hp - splashDamage);
    state.battlefield.support[oppFaction].hq.hp = opponent.hp;
    return;
  } else if (targetLoc.zoneType === 'FRONTLINE') {
    const zone = state.battlefield.frontline[targetLoc.zoneKey];
    if (!zone) return;
    let queue = [];
    const nextTarget = zone.units.find(u => !visited.has(u.instanceId));
    if (nextTarget) {
      queue.push(nextTarget);
    }
    while (queue.length > 0) {
      const u = queue.shift();
      if (visited.has(u.instanceId)) continue;
      visited.add(u.instanceId);
      u.hp -= splashDamage;
      markDamaged(u, splashDamage);
      if (u.hp <= 0) {
        removeUnitFromBoard(state, u.instanceId);
        const next = zone.units.find(zu => !visited.has(zu.instanceId));
        if (next) {
          queue.push(next);
        }
      }
    }
  }
}

// ==========================================
// 1. Target Validation Pipeline
// ==========================================

/**
 * Validates if an attack action can be legitimately declared.
 * @param {object} state
 * @param {string} attackerId
 * @param {string} targetId
 * @param {string|null} [actingPlayerId=null]
 * @param {object} [options={}]
 * @returns {{ valid: boolean, isHq: boolean, defender?: object, targetLoc?: object }}
 */
export function validateAttack(state, attackerId, targetId, actingPlayerId = null, options = {}) {
  const loc = findUnit(state, attackerId);
  if (!loc) throw new Error('Attacker not found');
  const attacker = loc.unit;

  const expectedFaction = actingPlayerId || state.activePlayer;
  if (attacker.faction !== expectedFaction) {
    throw new Error('Attacker does not belong to active player');
  }
  if (attacker.status[STATUS_TYPES.SUPPRESSED]) {
    throw new Error('Suppressed unit cannot attack');
  }
  if (cannotAttack(state, attacker)) throw new Error(`【${attacker.name}】无法主动攻击`);

  // Non-突袭 Deploy Sickness
  if (attacker.status[STATUS_TYPES.DEPLOYED_THIS_TURN] && !hasKeyword(attacker, KEYWORDS.TU_XI)) {
    throw new Error('Unit without 突袭 cannot attack on the turn it is deployed');
  }

  // Check troop type mobility rules on terrain & 奋战 (Double Strike)
  const actsLikeCavalry = skillActsLikeCavalry(state, attacker, loc);

  const hasDoubleStrike = hasKeyword(attacker, KEYWORDS.FEN_ZHAN);
  const maxAttacks = hasDoubleStrike ? 2 : 1;
  if (!attacker.status[STATUS_TYPES.ATTACKED_THIS_TURN] && (attacker.status.attacksThisTurn || 0) >= maxAttacks) {
    attacker.status.attacksThisTurn = 0;
  }
  const currentAttacks = attacker.status.attacksThisTurn || 0;

  if (attacker.status[STATUS_TYPES.ATTACKED_THIS_TURN] || currentAttacks >= maxAttacks) {
    throw new Error('Unit already attacked this turn');
  }

  if (!actsLikeCavalry) {
    if (attacker.status[STATUS_TYPES.MOVED_THIS_TURN]) {
      throw new Error('Infantry cannot attack after moving');
    }
    if (!hasDoubleStrike && attacker.status[STATUS_TYPES.ACTIONS_USED] > 0) {
      throw new Error('Infantry cannot attack after moving');
    }
  }

  if (allianceBlocks(state, attacker)) throw new Error('鲁肃·结盟：战力大于3的单位无法攻击');
  const player = state.players[attacker.faction];
  const attackCost = getActionCost(state, attacker, loc) + (targetId !== 'HQ' ? targetSurcharge(findUnit(state, targetId)?.unit || {}) : 0);
  if (player.provisions < attackCost) {
    throw new Error(`Insufficient provisions for attack (need ${attackCost})`);
  }

  const oppFaction = attacker.faction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
  const isHq = targetId === 'HQ' || targetId === state.battlefield.support[oppFaction]?.hq?.id;

  if (isHq) {
    // Range check: Strategist has global reach; Military units must be in frontline
    if (effectiveTroop(state, attacker) !== TROOP_TYPES.STRATEGIST && !isArtillery(attacker)) {
      if (loc.zoneType === 'SUPPORT') {
        throw new Error('Military unit in support line cannot attack enemy HQ directly');
      }
      // Check if enemy has units in the frontline zone
      const flZone = state.battlefield.frontline[loc.zoneKey];
      if (flZone.occupant === oppFaction && flZone.units.length > 0) {
        throw new Error('Cannot attack enemy HQ while enemy frontline zone is occupied');
      }
    }

    // Check 守护 (Guardian) in enemy support protecting HQ
    if (effectiveTroop(state, attacker) !== TROOP_TYPES.STRATEGIST && !attacker.keywords.includes(KEYWORDS.GONG_XIN) && !ignoresGuardian(attacker, state)) {
      if (isGuardedHq(state, oppFaction)) {
        throw new Error('Cannot attack HQ while protected by 守护 (Guardian)');
      }
    }
    return { valid: true, isHq: true };
  }

  // Target: Unit
  const targetLoc = findUnit(state, targetId);
  if (!targetLoc) throw new Error('Target unit not found');
  const defender = targetLoc.unit;

  if (defender.faction === attacker.faction) {
    throw new Error('Cannot attack friendly unit');
  }

  // Strategist Priority Rule: In the targeted line/zone, strategist MUST attack enemy strategist if present
  if (effectiveTroop(state, attacker) === TROOP_TYPES.STRATEGIST) {
    let targetZoneUnits = [];
    if (targetLoc.zoneType === 'FRONTLINE') {
      targetZoneUnits = state.battlefield.frontline[targetLoc.zoneKey]?.units || [];
    } else if (targetLoc.zoneType === 'SUPPORT') {
      targetZoneUnits = state.battlefield.support[oppFaction]?.slots || [];
    }
    const enemyStrategist = targetZoneUnits.find(u => effectiveTroop(state, u) === TROOP_TYPES.STRATEGIST);
    if (enemyStrategist && effectiveTroop(state, defender) !== TROOP_TYPES.STRATEGIST) {
      throw new Error('Strategist must prioritize enemy strategist in the same zone');
    }
  }

  // 守护 (Guardian) Protection Rule:
  // Non-strategist without 攻心 cannot attack non-guardian if guardian is adjacent in same zone
  if (effectiveTroop(state, attacker) !== TROOP_TYPES.STRATEGIST && !attacker.keywords.includes(KEYWORDS.GONG_XIN) && !ignoresGuardian(attacker, state)) {
    if (isGuardedUnit(state, defender)) {
      throw new Error('Target is protected by adjacent 守护 (Guardian)');
    }
  }

  // 黄盖·诈降：首次攻击前不能成为敌方指向的目标
  if (zhaXiang(defender)) throw new Error('黄盖·诈降：首次攻击前不能被指向');

  // 帷幄 (Curtain) Rule: Cannot be targeted before its first action, unless attacker has 攻心
  if (defender.keywords.includes(KEYWORDS.WEI_WO) && defender.status[STATUS_TYPES.ACTIONS_USED] === 0 && !attacker.keywords.includes(KEYWORDS.GONG_XIN) && !ignoresWeiWo(attacker, state)) {
    throw new Error('Target protected by 帷幄 (cannot be attacked before acting)');
  }

  // Range / Adjacency Rule:
  // Non-strategist military units in Support line cannot attack opposing Support line directly without advancing to Frontline unless Ranged/矢石
  // 矢石只免反击，射程与普通单位一样（只能打相邻一线）；谋士与抛射器械除外
  if (effectiveTroop(state, attacker) !== TROOP_TYPES.STRATEGIST && !isArtillery(attacker) && !hasLongRange(state, attacker) && !options.skipSupportRangeCheck) {
    if (loc.zoneType === 'SUPPORT' && targetLoc.zoneType === 'SUPPORT') {
      throw new Error('Military unit in support line cannot attack opposing support line directly without advancing to Frontline unless Ranged/矢石');
    }
  }

  // 险关：此处单位每回合最多被攻击1次
  if (targetLoc.zoneType === 'FRONTLINE' && unitTerrain(state, defender, targetLoc)?.type === 'PASS' && baseId(attacker.cardId) !== 'wei_zhang_he' &&
      defender._attackedOnTurn === state.turnNumber) {
    throw new Error('险关：该单位本回合已被攻击过');
  }

  // 前线相邻规则：前线区域之间只能攻击相邻区域（左↔中↔右），谋士与抛射器械除外
  if (loc.zoneType === 'FRONTLINE' && targetLoc.zoneType === 'FRONTLINE' &&
      effectiveTroop(state, attacker) !== TROOP_TYPES.STRATEGIST && !isArtillery(attacker) && !hasLongRange(state, attacker)) {
    const order = { LEFT: 0, CENTER: 1, RIGHT: 2 };
    if (Math.abs(order[loc.zoneKey] - order[targetLoc.zoneKey]) > 1) {
      throw new Error('只能攻击相邻前线区域的敌军');
    }
  }

  return { valid: true, isHq: false, defender, targetLoc };
}

/**
 * Returns list of valid target instance IDs for an attacker.
 * @param {object} state
 * @param {string} attackerId
 * @returns {string[]}
 */
export function getValidTargets(state, attackerId) {
  const loc = findUnit(state, attackerId);
  if (!loc) return [];
  const attacker = loc.unit;
  if (attacker.faction !== state.activePlayer || attacker.status[STATUS_TYPES.SUPPRESSED]) return [];

  const oppFaction = attacker.faction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
  const validTargets = [];

  // Check HQ
  try {
    validateAttack(state, attackerId, 'HQ');
    validTargets.push('HQ');
  } catch (_) {}

  // Check all opponent units
  const oppUnits = getAllUnits(state, oppFaction);
  for (const u of oppUnits) {
    try {
      validateAttack(state, attackerId, u.instanceId);
      validTargets.push(u.instanceId);
    } catch (_) {}
  }
  return validTargets;
}

// ==========================================
// 2. Combat Resolution Master Pipeline
// ==========================================

/**
 * Executes authoritative combat resolution.
 * @param {object} state
 * @param {object} action
 * @returns {object}
 */
export function resolveCombat(state, action) {
  const { attackerId, targetId } = action.payload;
  const validation = validateAttack(state, attackerId, targetId, action.playerId, {
    skipSupportRangeCheck: action.allowSupportCombat ?? true
  });

  const loc = findUnit(state, attackerId);
  const attacker = loc.unit;
  // 潜袭单位主动攻击时揭示（翻到正面）
  if (attacker.status[STATUS_TYPES.IS_FACE_DOWN]) {
    attacker.status[STATUS_TYPES.IS_FACE_DOWN] = false;
    state.combatLog.push({ type: 'SKILL', playerId: attacker.faction, message: `【${attacker.name}】潜袭：发动攻击，身份揭示` });
  }
  const player = state.players[action.playerId];
  const oppFaction = action.playerId === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
  const opponent = state.players[oppFaction];

  // HQ Combat Branch
  if (validation.isHq) {
    return resolveHqCombat(state, attacker, loc, player, opponent, oppFaction, action.playerId);
  }

  // Unit vs Unit Combat Branch
  let { defender, targetLoc } = validation;
  // 护卫：同区域有护卫单位时，由其代为承受攻击
  const guard = findBodyguard(state, defender, attacker);
  if (guard) {
    state.combatLog.push({ type: 'SKILL', playerId: guard.faction, message: `【${guard.name}】护卫：代【${defender.name}】承受攻击` });
    defender = guard;
    targetLoc = findUnit(state, guard.instanceId);
  }
  return resolveUnitCombat(state, attacker, loc, defender, targetLoc, player, opponent, oppFaction, action.playerId);
}

function resolveHqCombat(state, attacker, loc, player, opponent, oppFaction, playerId) {
  const attackCost = getActionCost(state, attacker, loc);
  player.provisions -= attackCost;
  attacker.status.attacksThisTurn = (attacker.status.attacksThisTurn || 0) + 1;
  const maxAttacks = attacker.keywords.includes(KEYWORDS.FEN_ZHAN) ? 2 : 1;
  attacker.status[STATUS_TYPES.ATTACKED_THIS_TURN] = attacker.status.attacksThisTurn >= maxAttacks;
  attacker.status[STATUS_TYPES.ACTIONS_USED] += 1;

  // 逆击（反制）：敌军攻击主城时同样先受3点伤害
  triggerCounters(state, 'ENEMY_ATTACK', { attacker, defender: null });
  if (!findUnit(state, attacker.instanceId)) {
    return { success: true, attackerDied: true, defenderDied: false, damageDealt: 0, counterDealt: 0, targetIsHq: true };
  }

  // 主城伤害经由技能结算（邓芝·使节免伤、李典减伤）
  const hqDamage = damageHq(state, oppFaction, getEffectiveAttack(state, attacker, loc) * hqAttackMultiplier(state, attacker), attacker.name, { silent: true });

  // 攻心 HQ Provision Steal
  let provisionsStolen = 0;
  if (attacker.keywords.includes(KEYWORDS.GONG_XIN) && hqDamage > 0) {
    if (opponent.provisions > 0) {
      opponent.provisions -= 1;
      player.provisions = Math.min(player.provisionsCap, player.provisions + 1);
      provisionsStolen = 1;
    }
  }

  state.combatLog.push({
    type: 'ATTACK_HQ',
    playerId,
    attacker: attacker.name,
    attackerId: attacker.instanceId,
    attackerTroopType: attacker.troopType,
    audioCue: attacker.audioCue,
    attackStyle: getAttackStyle(attacker), attackerCardId: attacker.cardId, attackerKeywords: [...attacker.keywords],
    damageDealt: hqDamage,
    hqHpRemaining: opponent.hp,
    provisionsStolen
  });

  if (opponent.hp <= 0) {
    state.winner = playerId;
    state.phase = PHASES.GAME_OVER;
  }

  return {
    success: true,
    attackerDied: false,
    defenderDied: false,
    damageDealt: hqDamage,
    counterDealt: 0,
    targetIsHq: true,
    provisionsStolen
  };
}

function resolveUnitCombat(state, attacker, loc, defender, targetLoc, player, opponent, oppFaction, playerId) {
  const attackCost = getActionCost(state, attacker, loc) + targetSurcharge(defender);
  // 烧屯伪遁（反制）：己方单位被攻击时触发
  triggerCounters(state, 'OWN_ATTACKED', { defender, attacker });
  notifyAttacked(state, defender, attacker);
  const ironWall = isIronWall(defender); // 曹仁·铁壁：免疫先登、冲阵、斩将
  defender._attackedOnTurn = state.turnNumber;
  const wasFaceDown = defender.status[STATUS_TYPES.IS_FACE_DOWN];

  // Reveal 潜袭 if attacked
  if (defender.status[STATUS_TYPES.IS_FACE_DOWN]) {
    defender.status[STATUS_TYPES.IS_FACE_DOWN] = false;
  }

  player.provisions -= attackCost;
  attacker.status.attacksThisTurn = (attacker.status.attacksThisTurn || 0) + 1;
  const maxAttacks = attacker.keywords.includes(KEYWORDS.FEN_ZHAN) ? 2 : 1;
  attacker.status[STATUS_TYPES.ATTACKED_THIS_TURN] = attacker.status.attacksThisTurn >= maxAttacks;
  attacker.status[STATUS_TYPES.ACTIONS_USED] += 1;

  let damageDealt = 0;
  let counterDealt = 0;
  let attackerDied = false;
  let defenderDied = false;
  let ambushTriggered = false;

  // 逆击（反制）：敌军发起攻击时先受3点伤害；若因此阵亡，攻击不再进行
  triggerCounters(state, 'ENEMY_ATTACK', { attacker, defender });
  if (!findUnit(state, attacker.instanceId)) {
    state.combatLog.push({ type: 'COMBAT_DAMAGE', attackerName: attacker.name, defenderName: defender.name, playerId, attackerId: attacker.instanceId, defenderId: defender.instanceId, attackerTroopType: attacker.troopType, audioCue: attacker.audioCue, attackStyle: getAttackStyle(attacker), attackerCardId: attacker.cardId, attackerKeywords: [...attacker.keywords], damageDealt: 0, counterDealt: 0, attackerDied: true, defenderDied: false });
    return { success: true, attackerDied: true, defenderDied: false, damageDealt: 0, counterDealt: 0 };
  }

  // 游击：敌方回合首次受到攻击时可撤退，并使该次攻击无效（自动在“这一击会致命”时发动）
  if (hasKeyword(defender, KEYWORDS.YOU_JI) && !defender.status[STATUS_TYPES.INHIBITED] && targetLoc.zoneType === 'FRONTLINE' &&
      defender.faction !== state.activePlayer && defender._evadeTurn !== state.turnNumber &&
      state.battlefield.support[defender.faction].slots.length < 5) {
    const jz = defender.keywords.find(k => k.startsWith(KEYWORDS.JIAN_ZHEN_PREFIX));
    const reduce = jz && !attacker.keywords.includes(KEYWORDS.GONG_XIN) ? (parseInt(jz.replace(KEYWORDS.JIAN_ZHEN_PREFIX, '') || '1', 10) || 1) : 0;
    const lethal = getEffectiveAttack(state, attacker, loc, defender) - reduce >= defender.hp ||
      (baseId(attacker.cardId) === 'gsz_you_zhou_tu_qi' && defender.status[STATUS_TYPES.SUPPRESSED]);
    if (lethal) {
      defender._evadeTurn = state.turnNumber;
      retreatUnit(state, defender, '游击');
      notifyYouJi(state, defender);
      state.combatLog.push({ type: 'SKILL', playerId: defender.faction, message: `【${defender.name}】游击：撤回支援阵线，本次攻击无效` });
      return { success: true, attackerDied: false, defenderDied: false, damageDealt: 0, counterDealt: 0, evaded: true };
    }
  }

  // 幽州突骑：攻击被压制的敌军时直接将其消灭
  if (baseId(attacker.cardId) === 'gsz_you_zhou_tu_qi' && defender.status[STATUS_TYPES.SUPPRESSED] && !attacker.status[STATUS_TYPES.INHIBITED]) {
    removeUnitFromBoard(state, defender.instanceId);
    state.combatLog.push({ type: 'SKILL', playerId, message: `幽州突骑：直接消灭被压制的【${defender.name}】` });
    state.combatLog.push({ type: 'COMBAT_DAMAGE', attackerName: attacker.name, defenderName: defender.name, playerId, attackerId: attacker.instanceId, defenderId: defender.instanceId, attackerTroopType: attacker.troopType, audioCue: attacker.audioCue, attackStyle: getAttackStyle(attacker), attackerCardId: attacker.cardId, attackerKeywords: [...attacker.keywords], damageDealt: defender.hp, counterDealt: 0, attackerDied: false, defenderDied: true });
    return { success: true, attackerDied: false, defenderDied: true, damageDealt: defender.hp, counterDealt: 0, defenderRef: defender };
  }

  const attackerEffectiveAtk = getEffectiveAttack(state, attacker, loc, defender);
  const defenderEffectiveAtk = getEffectiveAttack(state, defender, targetLoc, attacker);

  // 坚阵值：词条坚阵X + 险关地形坚阵+1（器械不受地形影响，不享受）
  function getJianZhenValue(unit) {
    const kw = unit.keywords.find(k => k.startsWith(KEYWORDS.JIAN_ZHEN_PREFIX));
    let v = kw ? parseInt(kw.replace(KEYWORDS.JIAN_ZHEN_PREFIX, '') || '1', 10) : 0;
    const uLoc = unit === attacker ? loc : targetLoc;
    if (uLoc?.zoneType === 'FRONTLINE' && unitTerrain(state, unit, uLoc)?.type === 'PASS') v += 1;
    return v;
  }

  // Consume 冲阵 (Charge) if present: consumed/removed upon making attack
  const hadCharge = attacker.keywords.includes(KEYWORDS.CHONG_ZHEN) && !attacker.status[STATUS_TYPES.CHARGE_USED] && !ironWall;
  if (hadCharge) {
    attacker.status[STATUS_TYPES.CHARGE_USED] = true;
    attacker.keywords = attacker.keywords.filter(k => k !== KEYWORDS.CHONG_ZHEN);
  }

  // Step 1: 伏击 (Ambush) Check
  // Defender strikes first; if attacker dies, attacker deals 0 damage!
  // Strategist ignores 伏击!
  const hasAmbush = defender.keywords.includes(KEYWORDS.FU_JI) && !defender.status[STATUS_TYPES.AMBUSH_USED_THIS_TURN];
  if (hasAmbush && effectiveTroop(state, attacker) !== TROOP_TYPES.STRATEGIST) {
    ambushTriggered = true;
    defender.status[STATUS_TYPES.AMBUSH_USED_THIS_TURN] = true;
    let rawAmbushCounter = defenderEffectiveAtk;
    if (getJianZhenValue(attacker) > 0 && !defender.keywords.includes(KEYWORDS.GONG_XIN)) {
      rawAmbushCounter = Math.max(0, rawAmbushCounter - getJianZhenValue(attacker));
    }
    counterDealt = rawAmbushCounter;
    const ambushTaken = combatDamageRedirect(state, attacker, counterDealt);
    attacker.hp -= ambushTaken;
    markDamaged(attacker, ambushTaken);

    if (attacker.hp <= 0) {
      attackerDied = true;
      removeUnitFromBoard(state, attacker.instanceId);
      state.combatLog.push({
        type: 'COMBAT_DAMAGE', attackerName: attacker.name, defenderName: defender.name,
        playerId,
        attackerId: attacker.instanceId, defenderId: defender.instanceId,
        attackerTroopType: attacker.troopType,
        audioCue: attacker.audioCue,
        attackStyle: getAttackStyle(attacker), attackerCardId: attacker.cardId, attackerKeywords: [...attacker.keywords],
        damageDealt: 0, counterDealt, attackerDied: true, defenderDied: false,
        ambushTriggered: true
      });
      return {
        success: true,
        attackerDied: true,
        defenderDied: false,
        damageDealt: 0,
        counterDealt,
        ambushTriggered: true
      };
    }
  }

  // Step 2: 斩将 (Banish) Check
  // If attacker has 斩将, defender does not have 伏击/潜袭, and attacker effective atk > defender effective atk: banish!
  if (attacker.keywords.includes(KEYWORDS.ZHAN_JIANG) && !defender.keywords.includes(KEYWORDS.FU_JI) && !wasFaceDown && !ironWall) {
    if (attackerEffectiveAtk > defenderEffectiveAtk) {
      removeUnitFromBoard(state, defender.instanceId, true /* isBanish */);
      state.combatLog.push({
        type: 'COMBAT_DAMAGE', attackerName: attacker.name, defenderName: defender.name,
        playerId,
        attackerId: attacker.instanceId, defenderId: defender.instanceId,
        attackerTroopType: attacker.troopType,
        audioCue: attacker.audioCue,
        attackStyle: getAttackStyle(attacker), attackerCardId: attacker.cardId, attackerKeywords: [...attacker.keywords],
        damageDealt: 999, counterDealt: 0, attackerDied: false, defenderDied: true,
        banished: true
      });
      return {
        success: true,
        attackerDied: false,
        defenderDied: true,
        banished: true,
        damageDealt: 999,
        counterDealt: 0
      };
    }
  }

  // Step 3: Special Attacker Properties
  // 先登 (Vanguard): strikes first without counterattack IF it kills the defender.
  // Ineffective if defender has 伏击 or was face down.
  const hasVanguard = hasVanguardSkill(state, attacker, loc) && !defender.keywords.includes(KEYWORDS.FU_JI) && !wasFaceDown && !ironWall;
  // 冲阵 (Charge): immunity to counterattack unless negated by Ambush
  const hasCharge = hadCharge && !ambushTriggered;

  // Step 4: Attacker Outgoing Damage Calculation
  let rawAttackerDmg = attackerEffectiveAtk;
  if (getJianZhenValue(defender) > 0 && !attacker.keywords.includes(KEYWORDS.GONG_XIN) && !ignoresJianZhen(attacker)) {
    rawAttackerDmg = Math.max(0, rawAttackerDmg - getJianZhenValue(defender));
  }
  if (attacker.keywords.includes(KEYWORDS.HUO_GONG)) rawAttackerDmg *= fireMultiplier(state, defender, targetLoc);
  damageDealt = rawAttackerDmg;
  const defenderTaken = combatDamageRedirect(state, defender, damageDealt);
  defender.hp -= defenderTaken;
  markDamaged(defender, defenderTaken);
  if (defender.hp <= 0) {
    defenderDied = true;
  }

  // Step 5: Counterattack Calculation
  let canCounter = true;
  if (ambushTriggered) canCounter = false;
  if (hasVanguard && defenderDied) canCounter = false;
  if (hasCharge) canCounter = false;
  if (effectiveTroop(state, attacker) === TROOP_TYPES.STRATEGIST && effectiveTroop(state, defender) !== TROOP_TYPES.STRATEGIST) canCounter = false;
  if (effectiveTroop(state, defender) === TROOP_TYPES.STRATEGIST && effectiveTroop(state, attacker) !== TROOP_TYPES.STRATEGIST) canCounter = false;
  if (hasShiShi(state, attacker) && !hasShiShi(state, defender) && !immuneToShiShi(defender)) canCounter = false;
  canCounter = counterOverride(state, attacker, defender, canCounter);

  if (canCounter) {
    let rawCounterDmg = defenderEffectiveAtk;
    if (getJianZhenValue(attacker) > 0 && !defender.keywords.includes(KEYWORDS.GONG_XIN)) {
      rawCounterDmg = Math.max(0, rawCounterDmg - getJianZhenValue(attacker));
    }
    counterDealt = rawCounterDmg;
    const counterTaken = combatDamageRedirect(state, attacker, counterDealt);
    attacker.hp -= counterTaken;
    markDamaged(attacker, counterTaken);
    if (attacker.hp <= 0) attackerDied = true;
  }

  // Overflow Damage Transfer (矢石 / 霹雳车 / 溢出转移)
  let overflowDamage = 0;
  if (defenderDied && (attacker.keywords.includes(KEYWORDS.YI_CHU_ZHUAN_YI) || attacker.keywords.includes('攻城') || isSiege(attacker))) {
    const overflow = Math.max(0, -defender.hp);
    if (overflow > 0) overflowDamage = damageHq(state, oppFaction, overflow, `${attacker.name}·攻城`);
  }

  // 火攻 (Fire Attack) Propagation (Ignores 坚阵)
  let splashDamage = 0;
  if (defenderDied && attacker.keywords.includes(KEYWORDS.HUO_GONG)) {
    splashDamage = attackerEffectiveAtk;
    applyFireSplash(state, targetLoc, oppFaction, splashDamage, defender.instanceId);
  }

  // Survival Validity (存活生效律): 曹操 归心
  // Draw card on kill ONLY IF CAO CAO SURVIVES
  const guixinTriggered = attacker.keywords.includes(KEYWORDS.GUI_XIN) && defenderDied && !attackerDied;
  if (guixinTriggered) {
    drawCard(state, playerId);
  }

  // Post-combat Death Cleanup
  if (defenderDied) removeUnitFromBoard(state, defender.instanceId);
  if (attackerDied) removeUnitFromBoard(state, attacker.instanceId);

  // Check HQ Defeat
  if (opponent.hp <= 0) {
    state.winner = playerId;
    state.phase = PHASES.GAME_OVER;
  }

  state.combatLog.push({
    type: 'COMBAT_DAMAGE',
    playerId,
    attackerName: attacker.name,
    defenderName: defender.name,
    attackerId: attacker.instanceId,
    defenderId: defender.instanceId,
    attackerTroopType: attacker.troopType,
    audioCue: attacker.audioCue,
    attackStyle: getAttackStyle(attacker), attackerCardId: attacker.cardId, attackerKeywords: [...attacker.keywords],
    attackerDamage: damageDealt,
    defenderDamage: counterDealt,
    damageDealt,
    counterDealt,
    attackerDied,
    defenderDied,
    attackerKilled: attackerDied,
    defenderKilled: defenderDied,
    ambushTriggered,
    vanguardImmunity: hasVanguard && defenderDied,
    chargeImmunity: hasCharge,
    rangedImmunity: hasShiShi(state, attacker) && !hasShiShi(state, defender),
    guixinTriggered,
    overflowDamage,
    splashDamage
  });

  const result = {
    success: true,
    defenderRef: defender,
    attackerDied,
    defenderDied,
    damageDealt,
    counterDealt,
    ambushTriggered,
    overflowDamage,
    splashDamage
  };

  if (hasVanguard && defenderDied) {
    result.vanguardImmunity = true;
  }
  if (hasCharge) {
    result.chargeImmunity = true;
  }

  return result;
}

// ==========================================
// 3. Status Effects Management
// ==========================================

/**
 * Applies Suppression (压制) to a unit.
 * @param {object} unit
 * @param {number} [durationTurns=2]
 */
export function applySuppression(unit, durationTurns = 2) {
  unit.status[STATUS_TYPES.SUPPRESSED] = true;
  unit.status.suppressedTurnsLeft = durationTurns;
}

/**
 * Applies Inhibition (抑制) to a unit (strips all traits, resets to vanilla, enforces re-inhibition immunity).
 * @param {object} unit
 * @returns {boolean} True if successfully inhibited, false if immune.
 */
export function applyInhibition(unit) {
  if (unit.status[STATUS_TYPES.INHIBITED] && !unit.status[STATUS_TYPES.BUFFED_AFTER_INHIBIT]) {
    return false; // Re-inhibition immunity!
  }
  unit.status[STATUS_TYPES.INHIBITED] = true;
  unit.status[STATUS_TYPES.BUFFED_AFTER_INHIBIT] = false;
  unit.status[STATUS_TYPES.SUPPRESSED] = false; // Purges suppression
  unit.keywords = [];
  unit.atk = unit.baseAtk;
  unit.actionCost = 1;
  unit.maxHp = unit.baseMaxHp;
  if (unit.hp > unit.baseMaxHp) {
    unit.hp = unit.baseMaxHp;
  }
  return true;
}

export default {
  validateAttack,
  getValidTargets,
  resolveCombat,
  applySuppression,
  applyInhibition
};
