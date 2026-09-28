/**
 * tier2_boundary.test.js
 * Tier 2: Boundary & Corner Cases Test Suite.
 * Stresses numerical boundaries, capacity ceilings, status interactions,
 * and rulebook edge cases (limits of 0 and 10 granary, hand limit 9 exactly vs 10th burned,
 * 0/1/2 prestige, fatigue escalation, suppression vs inhibition, survival validity 存活生效律).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  createCard,
  startTurn,
  endTurn,
  drawCard,
  dispatch,
  resolveCombat,
  adjustPrestige,
  applySuppression,
  applyInhibition,
  FACTIONS,
  TROOP_TYPES
} from './testHarness.js';

describe('Tier 2: Boundary & Corner Cases', () => {

  // --------------------------------------------------------------------------
  // Boundary 1: Limits of 0 and 10 Granary
  // --------------------------------------------------------------------------
  describe('Boundary 1: Provisions Limits [0, 10]', () => {
    it('TC01: Zero provisions strictly prohibits deploying a 1-cost unit', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 0;

      const unit = createCard({ name: '轻步兵', cost: 1 });
      player.hand.push(unit);

      assert.throws(() => {
        dispatch(state, {
          type: 'DEPLOY',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: unit.instanceId, targetZone: 'SUPPORT' }
        });
      }, /Insufficient provisions/);
    });

    it('TC02: Zero provisions strictly prohibits moving a unit', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 0;

      const unit = createCard({ name: '巡逻骑兵', faction: FACTIONS.WEI, actionCost: 1 });
      state.battlefield.support[FACTIONS.WEI].slots.push(unit);

      assert.throws(() => {
        dispatch(state, {
          type: 'MOVE',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: unit.instanceId, targetZone: 'FRONTLINE_CENTER' }
        });
      }, /Insufficient provisions for move/);
    });

    it('TC03: Zero provisions strictly prohibits unit from attacking', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 0;

      const unit = createCard({ name: '先锋', faction: FACTIONS.WEI, actionCost: 1 });
      state.battlefield.frontline.CENTER.occupant = FACTIONS.WEI;
      state.battlefield.frontline.CENTER.units.push(unit);

      assert.throws(() => {
        dispatch(state, {
          type: 'ATTACK',
          playerId: FACTIONS.WEI,
          payload: { attackerId: unit.instanceId, targetId: 'HQ' }
        });
      }, /Insufficient provisions for attack/);
    });

    it('TC04: Natural granary cap strictly does not increment on turn 11 (caps at 10)', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.mainGranaryCap = 10;
      player.provisionsCap = 10;

      // Advance turn
      state.turnNumber = 11;
      startTurn(state, FACTIONS.WEI);

      assert.equal(player.mainGranaryCap, 10, 'Main granary strictly capped at 10');
      assert.equal(player.provisionsCap, 10);
      assert.equal(player.provisions, 10);
    });

    it('TC05: Spending exactly all remaining provisions leaves 0 without negative balance', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 3;

      const unit = createCard({ name: '重甲战车', cost: 3 });
      player.hand.push(unit);

      dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: unit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(player.provisions, 0, 'Exact provisions spent');
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 1);
    });
  });

  // --------------------------------------------------------------------------
  // Boundary 2: Hand Limit 9 Exactly vs 10th Card Burned
  // --------------------------------------------------------------------------
  describe('Boundary 2: Hand Limit 9 Exactly vs 10th Card Burned', () => {
    it('TC06: Hand size at exactly 8: drawing 1 card results in hand size 9 with no card burned', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.hand = [];
      player.discard = [];
      for (let i = 0; i < 8; i++) player.hand.push(createCard({ name: `手牌_${i}` }));
      player.deck = [createCard({ name: '第9张牌' })];

      const drawn = drawCard(state, FACTIONS.WEI);
      assert.equal(player.hand.length, 9);
      assert.equal(player.discard.length, 0);
      assert.equal(drawn.name, '第9张牌');
    });

    it('TC07: Hand size at exactly 9: drawing 1 card leaves hand at 9 and burns card to discard', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.hand = [];
      player.discard = [];
      for (let i = 0; i < 9; i++) player.hand.push(createCard({ name: `手牌_${i}` }));
      const tenthCard = createCard({ name: '第10张牌' });
      player.deck = [tenthCard];

      drawCard(state, FACTIONS.WEI);
      assert.equal(player.hand.length, 9, 'Hand size stays at 9');
      assert.equal(player.discard.length, 1, 'Discard receives burned card');
      assert.equal(player.discard[0].instanceId, tenthCard.instanceId);
    });

    it('TC08: Hand size at exactly 9: multiple card draws burn all excess cards sequentially', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.hand = [];
      player.discard = [];
      for (let i = 0; i < 9; i++) player.hand.push(createCard({ name: `手牌_${i}` }));

      const c1 = createCard({ name: '溢出1' });
      const c2 = createCard({ name: '溢出2' });
      const c3 = createCard({ name: '溢出3' });
      player.deck = [c1, c2, c3];

      drawCard(state, FACTIONS.WEI);
      drawCard(state, FACTIONS.WEI);
      drawCard(state, FACTIONS.WEI);

      assert.equal(player.hand.length, 9);
      assert.equal(player.discard.length, 3);
      assert.deepEqual(player.discard.map(c => c.name), ['溢出1', '溢出2', '溢出3']);
    });
  });

  // --------------------------------------------------------------------------
  // Boundary 3: Prestige Boundaries {0, 1, 2}
  // --------------------------------------------------------------------------
  describe('Boundary 3: Prestige Boundaries {0, 1, 2}', () => {
    it('TC09: Prestige 0: deploying 3-cost unit provides 0 discount', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.prestige = 0;
      player.provisions = 5;

      const unit = createCard({ name: '步兵', cost: 3 });
      player.hand.push(unit);

      const res = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: unit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(res.cost, 3);
      assert.equal(res.discountApplied, 0);
      assert.equal(player.provisions, 2);
    });

    it('TC10: Prestige 1: deploying 3-cost unit costs 2 provisions; 2nd unit pays full 3 provisions', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.prestige = 1;
      player.provisions = 10;

      const u1 = createCard({ name: '先发部队', cost: 3 });
      const u2 = createCard({ name: '后发部队', cost: 3 });
      player.hand.push(u1, u2);

      const res1 = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: u1.instanceId, targetZone: 'SUPPORT' }
      });
      assert.equal(res1.cost, 2);
      assert.equal(res1.discountApplied, 1);

      const res2 = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: u2.instanceId, targetZone: 'SUPPORT' }
      });
      assert.equal(res2.cost, 3);
      assert.equal(res2.discountApplied, 0);
    });

    it('TC11: Prestige 2: deploying 3-cost unit costs 1 provision; deploying 1-cost unit is floored at 0', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.prestige = 2;
      player.provisions = 5;

      const cheapUnit = createCard({ name: '1费斥候', cost: 1 });
      player.hand.push(cheapUnit);

      const res = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: cheapUnit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(res.cost, 0, 'Cost floored at 0');
      assert.equal(res.discountApplied, 1, 'Applied 1 discount out of 2 available');
      assert.equal(player.provisions, 5, 'No provisions consumed');
    });

    it('TC12: Player at 2 prestige gaining prestige stays at 2; opponent at 0 is unaffected', () => {
      const state = createInitialState();
      state.players[FACTIONS.WEI].prestige = 2;
      state.players[FACTIONS.SHU].prestige = 0;

      adjustPrestige(state, FACTIONS.WEI, 1);
      assert.equal(state.players[FACTIONS.WEI].prestige, 2, 'Cannot exceed 2');
      assert.equal(state.players[FACTIONS.SHU].prestige, 0);
    });

    it('TC13: Opponent at 2 prestige, player gaining prestige reduces opponent to 1 while player stays at 0', () => {
      const state = createInitialState();
      state.players[FACTIONS.SHU].prestige = 2;
      state.players[FACTIONS.WEI].prestige = 0;

      adjustPrestige(state, FACTIONS.WEI, 1);
      assert.equal(state.players[FACTIONS.SHU].prestige, 1, 'Opponent stolen from 2 to 1');
      assert.equal(state.players[FACTIONS.WEI].prestige, 0, 'Player stays at 0');
    });
  });

  // --------------------------------------------------------------------------
  // Boundary 4: Fatigue Escalation
  // --------------------------------------------------------------------------
  describe('Boundary 4: Fatigue Escalation', () => {
    it('TC14: Consecutive empty deck overdraws scale exactly 1, 2, 3, 4, 5 damage (total 15)', () => {
      const state = createInitialState({ weiHp: 20 });
      const player = state.players[FACTIONS.WEI];
      player.deck = [];

      const damages = [];
      for (let i = 0; i < 5; i++) {
        const prevHp = player.hp;
        drawCard(state, FACTIONS.WEI);
        damages.push(prevHp - player.hp);
      }

      assert.deepEqual(damages, [1, 2, 3, 4, 5]);
      assert.equal(player.hp, 5, '20 - 15 = 5');
    });

    it('TC15: Fatigue reduces Main City HP to <= 0, terminating match with immediate defeat', () => {
      const state = createInitialState({ shuHp: 3 });
      const player = state.players[FACTIONS.SHU];
      player.deck = [];

      drawCard(state, FACTIONS.SHU); // overdraw 1: 3 - 1 = 2 HP
      assert.equal(state.phase !== 'GAME_OVER', true);

      drawCard(state, FACTIONS.SHU); // overdraw 2: 2 - 2 = 0 HP
      assert.equal(player.hp, 0);
      assert.equal(state.phase, 'GAME_OVER');
      assert.equal(state.winner, FACTIONS.WEI);
    });

    it('TC16: Fatigue applied during multi-draw tactic executes discrete damage ticks', () => {
      const state = createInitialState({ weiHp: 20 });
      const player = state.players[FACTIONS.WEI];
      player.deck = [];

      // Draw 2 cards successively
      drawCard(state, FACTIONS.WEI); // tick 1: -1 -> 19
      drawCard(state, FACTIONS.WEI); // tick 2: -2 -> 17

      const fatigueLogs = state.combatLog.filter(e => e.type === 'FATIGUE');
      assert.equal(fatigueLogs.length, 2);
      assert.equal(fatigueLogs[0].damage, 1);
      assert.equal(fatigueLogs[1].damage, 2);
    });
  });

  // --------------------------------------------------------------------------
  // Boundary 5: Suppression vs Inhibition Edge Cases
  // --------------------------------------------------------------------------
  describe('Boundary 5: Suppression vs Inhibition Edge Cases', () => {
    it('TC17: Suppressed unit cannot initiate move or attack, but retains normal counterattack', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const unit = createCard({ name: '魏甲士', faction: FACTIONS.WEI, atk: 3, hp: 5, actionCost: 1 });
      state.battlefield.support[FACTIONS.WEI].slots.push(unit);
      applySuppression(unit, 2);

      // Attempt active attack throws
      assert.throws(() => {
        dispatch(state, {
          type: 'ATTACK',
          playerId: FACTIONS.WEI,
          payload: { attackerId: unit.instanceId, targetId: 'HQ' }
        });
      }, /Suppressed unit cannot attack/);

      // Enemy attacks suppressed unit -> suppressed unit executes counterattack!
      const enemyAttacker = createCard({ name: '蜀步军', faction: FACTIONS.SHU, atk: 2, hp: 4, actionCost: 1 });
      state.battlefield.support[FACTIONS.SHU].slots.push(enemyAttacker);
      state.players[FACTIONS.SHU].provisions = 5;

      const res = resolveCombat(state, {
        playerId: FACTIONS.SHU,
        payload: { attackerId: enemyAttacker.instanceId, targetId: unit.instanceId }
      });

      assert.equal(res.damageDealt, 2);
      assert.equal(res.counterDealt, 3, 'Suppressed unit counterattacks for full 3 damage');
      assert.equal(enemyAttacker.hp, 1);
    });

    it('TC18: Suppressed unit retains passive defense traits (坚阵2 still reduces incoming damage)', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.players[FACTIONS.SHU].provisions = 5;

      const defender = createCard({ name: '曹仁', faction: FACTIONS.WEI, atk: 3, hp: 5, keywords: ['坚阵2'] });
      state.battlefield.support[FACTIONS.WEI].slots.push(defender);
      applySuppression(defender, 2);

      const attacker = createCard({ name: '突击兵', faction: FACTIONS.SHU, atk: 4, hp: 4, actionCost: 1 });
      state.battlefield.support[FACTIONS.SHU].slots.push(attacker);

      const res = resolveCombat(state, {
        playerId: FACTIONS.SHU,
        payload: { attackerId: attacker.instanceId, targetId: defender.instanceId }
      });

      // 4 ATK - 坚阵2 = 2 damage dealt
      assert.equal(res.damageDealt, 2);
      assert.equal(defender.hp, 3);
    });

    it('TC19: Suppression lasts until owner NEXT turn end phase, then clears automatically', () => {
      const state = createInitialState();
      startTurn(state, FACTIONS.WEI);

      const unit = createCard({ name: '被压制骑兵', faction: FACTIONS.WEI });
      state.battlefield.support[FACTIONS.WEI].slots.push(unit);
      applySuppression(unit, 2); // 2 turns: opponent turn + own turn

      // End Wei turn
      endTurn(state); // SHU turn
      assert.equal(unit.status.suppressed, true, 'Still suppressed during enemy turn');

      endTurn(state); // Back to Wei turn
      assert.equal(unit.status.suppressed, true, 'Still suppressed during own turn');

      endTurn(state); // End of Wei turn
      assert.equal(unit.status.suppressed, false, 'Suppression cleared at owner turn end');
    });

    it('TC20: Inhibition immediately strips all traits turning unit into vanilla card', () => {
      const unit = createCard({
        name: '超级武将',
        atk: 5,
        hp: 5,
        keywords: ['守护', '坚阵2', '先登', '冲阵', '伏击']
      });

      applyInhibition(unit);
      assert.deepEqual(unit.keywords, [], 'All keywords stripped');
      assert.equal(unit.status.inhibited, true);
    });

    it('TC21: Inhibition resets attack and cost to original printed card stats', () => {
      const unit = createCard({ name: '狂暴卫士', cost: 2, atk: 3, hp: 4 });
      unit.atk = 7; // buffed
      unit.actionCost = 0; // buffed

      applyInhibition(unit);
      assert.equal(unit.atk, 3, 'Attack reset to base 3');
      assert.equal(unit.actionCost, 1, 'Action cost reset to base 1');
    });

    it('TC22: Inhibition max HP reset: if current HP <= base max HP, current HP remains unchanged', () => {
      const unit = createCard({ name: '受损卫士', cost: 2, atk: 2, hp: 5 });
      unit.hp = 3; // Damaged below baseMaxHp 5

      applyInhibition(unit);
      assert.equal(unit.maxHp, 5, 'Max HP reset to base 5');
      assert.equal(unit.hp, 3, 'Current HP unchanged at 3');
    });

    it('TC23: Inhibition max HP reset: if current HP > base max HP (buffed), current HP lowered to base max HP', () => {
      const unit = createCard({ name: '强化卫士', cost: 2, atk: 2, hp: 4 });
      unit.maxHp = 8; // buffed
      unit.hp = 7; // buffed above baseMaxHp 4

      applyInhibition(unit);
      assert.equal(unit.maxHp, 4, 'Max HP lowered to base 4');
      assert.equal(unit.hp, 4, 'Current HP lowered to base max HP 4');
    });

    it('TC24: Re-inhibition immunity: an already inhibited unit cannot be inhibited again until re-buffed', () => {
      const unit = createCard({ name: '白板兵', atk: 2, hp: 2 });
      const firstInhibit = applyInhibition(unit);
      assert.equal(firstInhibit, true, 'First inhibition succeeds');

      const secondInhibit = applyInhibition(unit);
      assert.equal(secondInhibit, false, 'Second inhibition blocked by immunity');
    });
  });

  // --------------------------------------------------------------------------
  // Boundary 6: Survival Validity (存活生效律)
  // --------------------------------------------------------------------------
  describe('Boundary 6: Survival Validity (存活生效律)', () => {
    it('TC26: Cao Cao with 归心 (draw on kill) attacks and trades evenly with enemy (both die): 归心 does NOT trigger', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      player.hand = [];
      player.deck = [createCard({ name: '抽到的牌' })];

      const caoCao = createCard({ name: '曹操', faction: FACTIONS.WEI, atk: 4, hp: 3, actionCost: 1, keywords: ['归心'] });
      const enemy = createCard({ name: '刘备', faction: FACTIONS.SHU, atk: 3, hp: 4 });
      state.battlefield.support[FACTIONS.WEI].slots.push(caoCao);
      state.battlefield.support[FACTIONS.SHU].slots.push(enemy);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: caoCao.instanceId, targetId: enemy.instanceId }
      });

      assert.equal(res.attackerDied, true, 'Cao Cao died');
      assert.equal(res.defenderDied, true, 'Liu Bei died');
      assert.equal(player.hand.length, 0, '归心 did NOT trigger because Cao Cao did not survive minimal resolution');
      assert.equal(player.deck.length, 1);
    });

    it('TC27: Sun Qian 使节 (HQ damage immunity) fails immediately when Sun Qian is dealt lethal damage', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const opp = state.players[FACTIONS.SHU];

      // Sun Qian provides 使节 aura
      const sunQian = createCard({ name: '孙乾', faction: FACTIONS.SHU, atk: 1, hp: 2, keywords: ['使节'] });
      state.battlefield.support[FACTIONS.SHU].slots.push(sunQian);

      // Kill Sun Qian
      sunQian.hp = 0;
      state.battlefield.support[FACTIONS.SHU].slots.splice(0, 1);

      // Subsequent or concurrent attack to HQ deals full damage
      state.players[FACTIONS.WEI].provisions = 5;
      const attacker = createCard({ name: '黄盖', faction: FACTIONS.WEI, atk: 4, hp: 4, actionCost: 1 });
      state.battlefield.frontline.CENTER.occupant = FACTIONS.WEI;
      state.battlefield.frontline.CENTER.units.push(attacker);

      resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: attacker.instanceId, targetId: 'HQ' }
      });

      assert.equal(opp.hp, 16, 'HQ took 4 damage because 使节 aura expired upon Sun Qian death');
    });

    it('TC28: Killer surviving lethal combat triggers onKill draw successfully', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      player.hand = [];
      player.deck = [createCard({ name: '归心获得卡' })];

      // Cao Cao has 5 HP, enemy has 2 ATK, 4 HP -> Cao Cao deals 4, kills enemy, takes 2 dmg, survives with 3 HP
      const caoCao = createCard({ name: '曹操', faction: FACTIONS.WEI, atk: 4, hp: 5, actionCost: 1, keywords: ['归心'] });
      const enemy = createCard({ name: '敌将', faction: FACTIONS.SHU, atk: 2, hp: 4 });
      state.battlefield.support[FACTIONS.WEI].slots.push(caoCao);
      state.battlefield.support[FACTIONS.SHU].slots.push(enemy);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: caoCao.instanceId, targetId: enemy.instanceId }
      });

      assert.equal(res.attackerDied, false);
      assert.equal(res.defenderDied, true);
      assert.equal(caoCao.hp, 3);
      assert.equal(player.hand.length, 1, '归心 triggered successfully on survival');
      assert.equal(player.hand[0].name, '归心获得卡');
    });
  });
});
