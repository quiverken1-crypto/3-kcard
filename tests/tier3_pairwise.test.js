/**
 * tier3_pairwise.test.js
 * Tier 3: Cross-Feature Pairwise Combinatorial Test Suite.
 * Stresses multi-keyword collisions, defensive overrides, attack priority conflicts,
 * and status interactions (Strategist vs Guard vs Ambush, Fire attack chain vs 坚阵,
 * 先登 vs 伏击, 冲阵 vs 伏击, 斩将 vs 伏击/潜袭, 压制 vs 抑制).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  createCard,
  resolveCombat,
  dispatch,
  applySuppression,
  applyInhibition,
  FACTIONS,
  TROOP_TYPES
} from './testHarness.js';

describe('Tier 3: Cross-Feature Pairwise Combinatorial Interactions', () => {

  // --------------------------------------------------------------------------
  // Pairwise 1: Strategist vs Guard vs Ambush
  // --------------------------------------------------------------------------
  describe('Pairwise 1: Strategist vs Guard vs Ambush', () => {
    it('TC01: Strategist attacks non-guard unit protected by adjacent Guard -> Strategist bypasses Guard completely', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const strategist = createCard({ name: '郭嘉', faction: FACTIONS.WEI, troopType: TROOP_TYPES.STRATEGIST, atk: 3, hp: 3, actionCost: 1 });
      const guardian = createCard({ name: '曹仁', faction: FACTIONS.SHU, atk: 2, hp: 5, keywords: ['守护'] });
      const protectedUnit = createCard({ name: '受保目标', faction: FACTIONS.SHU, atk: 1, hp: 4 });

      state.battlefield.support[FACTIONS.WEI].slots.push(strategist);
      state.battlefield.support[FACTIONS.SHU].slots.push(guardian, protectedUnit);

      // Strategist directly attacks protectedUnit bypassing guardian
      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: strategist.instanceId, targetId: protectedUnit.instanceId }
      });

      assert.equal(res.success, true);
      assert.equal(res.damageDealt, 3);
      assert.equal(protectedUnit.hp, 1);
      assert.equal(guardian.hp, 5, 'Guardian took zero damage');
    });

    it('TC02: Military unit attacks non-guard protected by adjacent Guard -> Guard intercepts and blocks attack', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const militaryAttacker = createCard({ name: '魏突骑', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, atk: 4, hp: 4, actionCost: 1 });
      const guardian = createCard({ name: '曹仁', faction: FACTIONS.SHU, atk: 2, hp: 5, keywords: ['守护'] });
      const protectedUnit = createCard({ name: '受保目标', faction: FACTIONS.SHU, atk: 1, hp: 4 });

      state.battlefield.support[FACTIONS.WEI].slots.push(militaryAttacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(guardian, protectedUnit);

      assert.throws(() => {
        resolveCombat(state, {
          playerId: FACTIONS.WEI,
          payload: { attackerId: militaryAttacker.instanceId, targetId: protectedUnit.instanceId }
        });
      }, /Target is protected by adjacent 守护 \(Guardian\)/);
    });

    it('TC03: Strategist attacks Ambush unit -> Strategist is IMMUNE to Ambush counterattack (Ambush does 0 counter)', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const strategist = createCard({ name: '诸葛亮', faction: FACTIONS.WEI, troopType: TROOP_TYPES.STRATEGIST, atk: 3, hp: 4, actionCost: 1 });
      const ambusher = createCard({ name: '臧霸', faction: FACTIONS.SHU, atk: 4, hp: 2, keywords: ['伏击'] });

      state.battlefield.support[FACTIONS.WEI].slots.push(strategist);
      state.battlefield.support[FACTIONS.SHU].slots.push(ambusher);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: strategist.instanceId, targetId: ambusher.instanceId }
      });

      assert.equal(res.damageDealt, 3);
      assert.equal(res.counterDealt, 0, 'Military ambusher cannot counterattack strategist');
      assert.equal(strategist.hp, 4, 'Strategist took 0 counterattack');
      assert.equal(res.defenderDied, true);
    });

    it('TC04: Military unit attacks Ambush unit -> Ambush strikes first; lethal counter destroys attacker with 0 outgoing damage', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const militaryAttacker = createCard({ name: '轻骑兵', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, atk: 3, hp: 2, actionCost: 1 });
      const ambusher = createCard({ name: '臧霸', faction: FACTIONS.SHU, atk: 3, hp: 3, keywords: ['伏击'] });

      state.battlefield.support[FACTIONS.WEI].slots.push(militaryAttacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(ambusher);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: militaryAttacker.instanceId, targetId: ambusher.instanceId }
      });

      assert.equal(res.ambushTriggered, true);
      assert.equal(res.attackerDied, true);
      assert.equal(res.damageDealt, 0, 'Attacker was slain before dealing damage');
      assert.equal(ambusher.hp, 3, 'Ambusher unharmed');
    });

    it('TC05: Guard unit that also has Ambush is attacked by military -> Guard intercepts and triggers Ambush first-strike', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const militaryAttacker = createCard({ name: '轻骑兵', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, atk: 3, hp: 2, actionCost: 1 });
      const ambushGuard = createCard({ name: '严颜', faction: FACTIONS.SHU, atk: 4, hp: 5, keywords: ['守护', '伏击'] });

      state.battlefield.support[FACTIONS.WEI].slots.push(militaryAttacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(ambushGuard);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: militaryAttacker.instanceId, targetId: ambushGuard.instanceId }
      });

      assert.equal(res.ambushTriggered, true);
      assert.equal(res.attackerDied, true);
      assert.equal(ambushGuard.hp, 5, 'Ambush guard took zero damage');
    });
  });

  // --------------------------------------------------------------------------
  // Pairwise 2: Fire Attack (火攻) vs 坚阵 (Fortify)
  // --------------------------------------------------------------------------
  describe('Pairwise 2: Fire Attack (火攻) Chain vs 坚阵 (Fortify)', () => {
    it('TC06: Fire attack kill deals splash damage to adjacent unit with 坚阵2, completely BYPASSING 坚阵', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      // Attacker has 火攻 (4 ATK)
      const fireAttacker = createCard({ name: '黄盖', faction: FACTIONS.WEI, atk: 4, hp: 4, actionCost: 1, keywords: ['火攻'] });
      // Primary defender has 2 HP (will die)
      const primaryTarget = createCard({ name: '前锋兵', faction: FACTIONS.SHU, atk: 1, hp: 2 });
      // Adjacent defender in same zone has 坚阵2 and 5 HP
      const fortifyDefender = createCard({ name: '曹仁', faction: FACTIONS.SHU, atk: 2, hp: 5, keywords: ['坚阵2'] });

      state.battlefield.frontline.CENTER.occupant = FACTIONS.SHU;
      state.battlefield.frontline.CENTER.units.push(primaryTarget, fortifyDefender);
      state.battlefield.support[FACTIONS.WEI].slots.push(fireAttacker);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: fireAttacker.instanceId, targetId: primaryTarget.instanceId }
      });

      assert.equal(res.defenderDied, true);
      // Fire attack deals 4 splash damage to fortifyDefender, BYPASSING 坚阵2!
      // 5 HP - 4 = 1 HP remaining (if 坚阵 applied, it would have been 5 - (4-2) = 3 HP)
      assert.equal(fortifyDefender.hp, 1, 'Fire attack splash damage completely bypassed 坚阵2');
    });

    it('TC07: Fire attack killing a defender in support line splashes directly to enemy Main City (HQ)', () => {
      const state = createInitialState({ shuHp: 20 });
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const fireAttacker = createCard({ name: '黄盖', faction: FACTIONS.WEI, atk: 5, hp: 4, actionCost: 1, keywords: ['火攻'] });
      const supportUnit = createCard({ name: '守门兵', faction: FACTIONS.SHU, atk: 1, hp: 2 });

      state.battlefield.frontline.CENTER.occupant = FACTIONS.WEI;
      state.battlefield.frontline.CENTER.units.push(fireAttacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(supportUnit);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: fireAttacker.instanceId, targetId: supportUnit.instanceId }
      });

      assert.equal(res.defenderDied, true);
      assert.equal(state.players[FACTIONS.SHU].hp, 15, 'HQ took full 5 splash damage from 火攻 (20 - 5 = 15)');
    });

    it('TC08: Fire attack non-lethal attack deals zero splash damage', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const fireAttacker = createCard({ name: '黄盖', faction: FACTIONS.WEI, atk: 3, hp: 4, actionCost: 1, keywords: ['火攻'] });
      const heavyDefender = createCard({ name: '重甲兵', faction: FACTIONS.SHU, atk: 1, hp: 5 });
      const adjacentDefender = createCard({ name: '后卫兵', faction: FACTIONS.SHU, atk: 1, hp: 4 });

      state.battlefield.frontline.CENTER.occupant = FACTIONS.SHU;
      state.battlefield.frontline.CENTER.units.push(heavyDefender, adjacentDefender);
      state.battlefield.support[FACTIONS.WEI].slots.push(fireAttacker);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: fireAttacker.instanceId, targetId: heavyDefender.instanceId }
      });

      assert.equal(res.defenderDied, false);
      assert.equal(adjacentDefender.hp, 4, 'No splash damage dealt because primary target survived');
    });
  });

  // --------------------------------------------------------------------------
  // Pairwise 3: 先登 (Vanguard) vs 伏击 (Ambush)
  // --------------------------------------------------------------------------
  describe('Pairwise 3: 先登 (Vanguard) vs 伏击 (Ambush)', () => {
    it('TC09: Vanguard attacking Ambush has its first-strike immunity NEGATED by Ambush (Ambush strikes first)', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      // Vanguard has 4 ATK, 2 HP (normally would kill defender with 0 counter)
      const vanguard = createCard({ name: '黄忠', faction: FACTIONS.WEI, atk: 4, hp: 2, actionCost: 1, keywords: ['先登'] });
      // Ambusher has 3 ATK, 3 HP
      const ambusher = createCard({ name: '臧霸', faction: FACTIONS.SHU, atk: 3, hp: 3, keywords: ['伏击'] });

      state.battlefield.support[FACTIONS.WEI].slots.push(vanguard);
      state.battlefield.support[FACTIONS.SHU].slots.push(ambusher);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: vanguard.instanceId, targetId: ambusher.instanceId }
      });

      // Ambush overrides Vanguard! Ambusher deals 3 damage to Vanguard (HP 2 -> -1), slaying Vanguard before Vanguard strikes!
      assert.equal(res.ambushTriggered, true);
      assert.equal(res.attackerDied, true);
      assert.equal(res.damageDealt, 0);
      assert.equal(ambusher.hp, 3);
    });

    it('TC10: When Vanguard survives Ambush counterattack, Vanguard then deals normal combat damage', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      // Vanguard has 4 ATK, 5 HP (survives 2 ATK counter)
      const vanguard = createCard({ name: '黄忠', faction: FACTIONS.WEI, atk: 4, hp: 5, actionCost: 1, keywords: ['先登'] });
      // Ambusher has 2 ATK, 3 HP
      const ambusher = createCard({ name: '臧霸', faction: FACTIONS.SHU, atk: 2, hp: 3, keywords: ['伏击'] });

      state.battlefield.support[FACTIONS.WEI].slots.push(vanguard);
      state.battlefield.support[FACTIONS.SHU].slots.push(ambusher);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: vanguard.instanceId, targetId: ambusher.instanceId }
      });

      assert.equal(res.ambushTriggered, true);
      assert.equal(res.attackerDied, false);
      assert.equal(vanguard.hp, 3, 'Vanguard took 2 counter damage');
      // Vanguard then attacks normally, dealing 4 damage and slaying ambusher
      assert.equal(res.defenderDied, true);
      assert.equal(state.battlefield.support[FACTIONS.SHU].slots.length, 0);
    });

    it('TC11: Vanguard attacking regular non-ambush defender slays defender with ZERO counterattack', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const vanguard = createCard({ name: '黄忠', faction: FACTIONS.WEI, atk: 4, hp: 2, actionCost: 1, keywords: ['先登'] });
      const normalDefender = createCard({ name: '普通兵', faction: FACTIONS.SHU, atk: 4, hp: 3, keywords: [] });

      state.battlefield.support[FACTIONS.WEI].slots.push(vanguard);
      state.battlefield.support[FACTIONS.SHU].slots.push(normalDefender);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: vanguard.instanceId, targetId: normalDefender.instanceId }
      });

      assert.equal(res.vanguardImmunity, true);
      assert.equal(res.counterDealt, 0);
      assert.equal(vanguard.hp, 2, 'Vanguard took 0 counter damage');
      assert.equal(res.defenderDied, true);
    });
  });

  // --------------------------------------------------------------------------
  // Pairwise 4: 冲阵 (Charge) vs 伏击 (Ambush)
  // --------------------------------------------------------------------------
  describe('Pairwise 4: 冲阵 (Charge) vs 伏击 (Ambush)', () => {
    it('TC12: Charge attacking Ambush has its counter-immunity NEGATED; Ambush strikes first', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const chargeUnit = createCard({ name: '张辽', faction: FACTIONS.WEI, atk: 5, hp: 2, actionCost: 1, keywords: ['冲阵'] });
      const ambusher = createCard({ name: '伏兵', faction: FACTIONS.SHU, atk: 3, hp: 4, keywords: ['伏击'] });

      state.battlefield.support[FACTIONS.WEI].slots.push(chargeUnit);
      state.battlefield.support[FACTIONS.SHU].slots.push(ambusher);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: chargeUnit.instanceId, targetId: ambusher.instanceId }
      });

      assert.equal(res.ambushTriggered, true);
      assert.equal(res.attackerDied, true, 'Charge unit was slain by Ambush first-strike');
      assert.equal(res.damageDealt, 0);
    });

    it('TC13: Charge attacking Ambush is consumed/removed regardless of outcome', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const chargeUnit = createCard({ name: '张飞', faction: FACTIONS.WEI, atk: 5, hp: 6, actionCost: 1, keywords: ['冲阵'] });
      const ambusher = createCard({ name: '伏兵', faction: FACTIONS.SHU, atk: 2, hp: 4, keywords: ['伏击'] });

      state.battlefield.support[FACTIONS.WEI].slots.push(chargeUnit);
      state.battlefield.support[FACTIONS.SHU].slots.push(ambusher);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: chargeUnit.instanceId, targetId: ambusher.instanceId }
      });

      assert.equal(res.attackerDied, false);
      assert.equal(chargeUnit.hp, 4);
      assert.equal(res.defenderDied, true);
    });
  });

  // --------------------------------------------------------------------------
  // Pairwise 5: 斩将 (Banish) vs 伏击 (Ambush) / 潜袭 (Infiltrate)
  // --------------------------------------------------------------------------
  describe('Pairwise 5: 斩将 (Banish) vs 伏击 (Ambush) / 潜袭 (Infiltrate)', () => {
    it('TC14: High-ATK Banish unit attacking Ambush has Banish rendered INVALID; Ambush strikes first', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      // Guan Yu has 斩将, 6 ATK, 2 HP
      const guanYu = createCard({ name: '关羽', faction: FACTIONS.WEI, atk: 6, hp: 2, actionCost: 1, keywords: ['斩将'] });
      // Ambusher has 3 ATK, 3 HP (ATK lower than Guan Yu, but 伏击 negates 斩将)
      const ambusher = createCard({ name: '臧霸', faction: FACTIONS.SHU, atk: 3, hp: 3, keywords: ['伏击'] });

      state.battlefield.support[FACTIONS.WEI].slots.push(guanYu);
      state.battlefield.support[FACTIONS.SHU].slots.push(ambusher);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: guanYu.instanceId, targetId: ambusher.instanceId }
      });

      assert.equal(res.banished, undefined, 'Banish was negated by Ambush');
      assert.equal(res.ambushTriggered, true);
      assert.equal(res.attackerDied, true, 'Guan Yu slain by Ambush first-strike');
    });

    it('TC15: High-ATK Banish unit attacking face-down 潜袭 has Banish rendered INVALID; 潜袭 reveals face up', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const guanYu = createCard({ name: '关羽', faction: FACTIONS.WEI, atk: 6, hp: 5, actionCost: 1, keywords: ['斩将'] });
      const infiltrateUnit = createCard({ name: '潜袭斥候', faction: FACTIONS.SHU, atk: 2, hp: 4, keywords: ['潜袭'] });
      infiltrateUnit.status.isFaceDown = true;

      state.battlefield.support[FACTIONS.WEI].slots.push(guanYu);
      state.battlefield.support[FACTIONS.SHU].slots.push(infiltrateUnit);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: guanYu.instanceId, targetId: infiltrateUnit.instanceId }
      });

      assert.equal(res.banished, undefined, 'Banish invalid against 潜袭');
      assert.equal(infiltrateUnit.status.isFaceDown, false, 'Infiltrate unit revealed face up');
      assert.equal(res.damageDealt, 6);
      assert.equal(res.counterDealt, 2);
      assert.equal(res.defenderDied, true);
    });
  });

  // --------------------------------------------------------------------------
  // Pairwise 6: 压制 (Suppression) vs 抑制 (Inhibition)
  // --------------------------------------------------------------------------
  describe('Pairwise 6: 压制 (Suppression) vs 抑制 (Inhibition)', () => {
    it('TC16: Suppressed unit subsequently targeted by Inhibition has suppression and all traits purged', () => {
      const unit = createCard({ name: '重甲护卫', atk: 3, hp: 5, keywords: ['守护', '坚阵1'] });
      applySuppression(unit, 2);
      assert.equal(unit.status.suppressed, true);

      // Apply inhibition
      applyInhibition(unit);
      assert.equal(unit.status.inhibited, true);
      assert.equal(unit.status.suppressed, false, 'Suppression purged by inhibition');
      assert.deepEqual(unit.keywords, [], 'All traits removed');
    });

    it('TC17: Inhibited unit can subsequently be targeted by Suppression to disable active moves', () => {
      const unit = createCard({ name: '白板步兵', atk: 2, hp: 3 });
      applyInhibition(unit);
      assert.equal(unit.status.inhibited, true);

      // Now apply suppression
      applySuppression(unit, 2);
      assert.equal(unit.status.suppressed, true, 'Inhibited vanilla unit can still be suppressed');
    });

    it('TC18: Suppressed unit attacked by 攻心 (Direct Mind) unit still counterattacks while 攻心 ignores defense', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.WEI].provisions = 5;

      const directMindAttacker = createCard({ name: '无当飞军', faction: FACTIONS.WEI, atk: 4, hp: 5, actionCost: 1, keywords: ['攻心'] });
      const suppressedDefender = createCard({ name: '铁壁卫', faction: FACTIONS.SHU, atk: 3, hp: 5, keywords: ['坚阵2'] });
      applySuppression(suppressedDefender, 2);

      state.battlefield.support[FACTIONS.WEI].slots.push(directMindAttacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(suppressedDefender);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: directMindAttacker.instanceId, targetId: suppressedDefender.instanceId }
      });

      // 攻心 ignores 坚阵2: deals full 4 damage
      assert.equal(res.damageDealt, 4);
      assert.equal(suppressedDefender.hp, 1);
      // Suppressed unit still executes counterattack: deals 3 damage to attacker
      assert.equal(res.counterDealt, 3);
      assert.equal(directMindAttacker.hp, 2);
    });
  });
});
