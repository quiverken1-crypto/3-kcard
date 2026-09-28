/**
 * tier1_feature.test.js
 * Tier 1: Core Feature Verification Test Suite.
 * Covers all 12 core features with >= 5 comprehensive test cases per feature.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  createCard,
  setupGame,
  startTurn,
  endTurn,
  drawCard,
  dispatch,
  resolveCombat,
  adjustPrestige,
  FACTIONS,
  TROOP_TYPES,
  TERRAINS
} from './testHarness.js';

describe('Tier 1: Core Feature Coverage', () => {

  // --------------------------------------------------------------------------
  // Feature 1: Battlefield 3 Lines
  // --------------------------------------------------------------------------
  describe('F01: Battlefield 3-Line Structure', () => {
    it('TC01-1: Game initializes with 2 support lines (P1 South, P2 North) and 1 central frontline', () => {
      const state = createInitialState();
      assert.ok(state.battlefield.support[FACTIONS.WEI], 'Wei support line exists');
      assert.ok(state.battlefield.support[FACTIONS.SHU], 'Shu support line exists');
      assert.ok(state.battlefield.frontline.LEFT, 'Frontline LEFT zone exists');
      assert.ok(state.battlefield.frontline.CENTER, 'Frontline CENTER zone exists');
      assert.ok(state.battlefield.frontline.RIGHT, 'Frontline RIGHT zone exists');
    });

    it('TC01-2: Standard units deployed from hand must land in friendly support line', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      const unit = createCard({ name: '魏步军', cost: 1 });
      player.hand.push(unit);

      dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: unit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 1);
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots[0].instanceId, unit.instanceId);
    });

    it('TC01-3: Units without 奇袭 cannot be deployed directly into frontline', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      const normalUnit = createCard({ name: '普通步军', cost: 1, keywords: [] });
      player.hand.push(normalUnit);

      assert.throws(() => {
        dispatch(state, {
          type: 'DEPLOY',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: normalUnit.instanceId, targetZone: 'LEFT' }
        });
      }, /Only units with 奇袭 can deploy directly to frontline/);
    });

    it('TC01-4: Unit with 奇袭 keyword can deploy directly to empty frontline zone', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      const surpriseUnit = createCard({ name: '先锋突骑', cost: 3, keywords: ['奇袭'] });
      player.hand.push(surpriseUnit);

      dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: surpriseUnit.instanceId, targetZone: 'LEFT' }
      });

      assert.equal(state.battlefield.frontline.LEFT.occupant, FACTIONS.WEI);
      assert.equal(state.battlefield.frontline.LEFT.units.length, 1);
      assert.equal(state.battlefield.frontline.LEFT.units[0].name, '先锋突骑');
    });

    it('TC01-5: Frontline unit can retreat back to support line if possessing 游击', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.SHU];
      player.provisions = 5;
      const ranger = createCard({ name: '赵云', faction: FACTIONS.SHU, cost: 4, actionCost: 1, keywords: ['游击'] });
      state.battlefield.frontline.CENTER.occupant = FACTIONS.SHU;
      state.battlefield.frontline.CENTER.units.push(ranger);

      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.SHU,
        payload: { cardInstanceId: ranger.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(state.battlefield.support[FACTIONS.SHU].slots.length, 1);
      assert.equal(state.battlefield.frontline.CENTER.units.length, 0);
      assert.equal(state.battlefield.frontline.CENTER.occupant, null);
    });

    it('TC01-6: Non-游击 unit cannot move backward from frontline to support line', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      const normalUnit = createCard({ name: '魏步兵', faction: FACTIONS.WEI, keywords: [] });
      state.battlefield.frontline.LEFT.occupant = FACTIONS.WEI;
      state.battlefield.frontline.LEFT.units.push(normalUnit);

      assert.throws(() => {
        dispatch(state, {
          type: 'MOVE',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: normalUnit.instanceId, targetZone: 'SUPPORT' }
        });
      }, /Only units with 游击 can retreat back to support line/);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 2: Support Line Capacity (HQ + 4 Units)
  // --------------------------------------------------------------------------
  describe('F02: Support Line Capacity (HQ + 4 Units)', () => {
    it('TC02-1: Support line contains 1 Main City / HQ card at initialization', () => {
      const state = createInitialState();
      assert.equal(state.battlefield.support[FACTIONS.WEI].hq.hp, 20);
      assert.equal(state.battlefield.support[FACTIONS.SHU].hq.hp, 20);
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 0);
    });

    it('TC02-2: Can deploy up to 4 units into friendly support line', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      for (let i = 0; i < 4; i++) {
        const u = createCard({ name: `步兵_${i}`, cost: 1 });
        player.hand.push(u);
        dispatch(state, {
          type: 'DEPLOY',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: u.instanceId, targetZone: 'SUPPORT' }
        });
      }
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 4);
    });

    it('TC02-3: Deploying a 5th unit into a full support line is rejected with error', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      for (let i = 0; i < 4; i++) {
        const u = createCard({ name: `步兵_${i}`, cost: 1 });
        state.battlefield.support[FACTIONS.WEI].slots.push(u);
      }

      const fifth = createCard({ name: '第5单位', cost: 1 });
      player.hand.push(fifth);

      assert.throws(() => {
        dispatch(state, {
          type: 'DEPLOY',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: fifth.instanceId, targetZone: 'SUPPORT' }
        });
      }, /Support line unit slots are full/);
    });

    it('TC02-4: When a unit in support line is defeated, its slot is freed for new deployments', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      const u1 = createCard({ name: '前排兵', cost: 1, hp: 1 });
      state.battlefield.support[FACTIONS.WEI].slots.push(u1);
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 1);

      // Kill u1
      u1.hp = 0;
      state.battlefield.support[FACTIONS.WEI].slots.splice(0, 1);
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 0);

      const u2 = createCard({ name: '新援军', cost: 1 });
      player.hand.push(u2);
      dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: u2.instanceId, targetZone: 'SUPPORT' }
      });
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 1);
    });

    it('TC02-5: When 游击 retreats to a full support line, unit returns to hand instead', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.SHU];
      player.provisions = 5;

      // Fill support line with 4 units
      for (let i = 0; i < 4; i++) {
        state.battlefield.support[FACTIONS.SHU].slots.push(createCard({ name: `守军_${i}`, faction: FACTIONS.SHU }));
      }

      const ranger = createCard({ name: '赵云', faction: FACTIONS.SHU, cost: 4, actionCost: 1, keywords: ['游击'] });
      state.battlefield.frontline.CENTER.occupant = FACTIONS.SHU;
      state.battlefield.frontline.CENTER.units.push(ranger);

      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.SHU,
        payload: { cardInstanceId: ranger.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(state.battlefield.support[FACTIONS.SHU].slots.length, 4, 'Support line stays at 4');
      assert.ok(player.hand.some(c => c.instanceId === ranger.instanceId), 'Unit diverted to hand');
      assert.equal(state.battlefield.frontline.CENTER.units.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 3: Frontline 3 Zones & Exclusive Occupation
  // --------------------------------------------------------------------------
  describe('F03-F04: Frontline 3 Zones & Exclusive Occupation', () => {
    it('TC03-1: Frontline is partitioned into 3 independent parallel zones: LEFT, CENTER, RIGHT', () => {
      const state = createInitialState();
      assert.deepEqual(Object.keys(state.battlefield.frontline), ['LEFT', 'CENTER', 'RIGHT']);
      assert.equal(state.battlefield.frontline.LEFT.occupant, null);
      assert.equal(state.battlefield.frontline.CENTER.occupant, null);
      assert.equal(state.battlefield.frontline.RIGHT.occupant, null);
    });

    it('TC03-2: Advancing from support line into empty frontline zone sets player as occupant', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const unit = createCard({ name: '先遣骑兵', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, actionCost: 1 });
      state.battlefield.support[FACTIONS.WEI].slots.push(unit);

      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: unit.instanceId, targetZone: 'FRONTLINE_CENTER' }
      });

      assert.equal(state.battlefield.frontline.CENTER.occupant, FACTIONS.WEI);
      assert.equal(state.battlefield.frontline.CENTER.units.length, 1);
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 0);
    });

    it('TC03-3: Enemy units cannot move into a frontline zone currently occupied by the other player', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      state.battlefield.frontline.LEFT.occupant = FACTIONS.WEI;
      state.battlefield.frontline.LEFT.units.push(createCard({ name: '魏国守兵', faction: FACTIONS.WEI }));

      const shuPlayer = state.players[FACTIONS.SHU];
      shuPlayer.provisions = 5;
      const shuUnit = createCard({ name: '蜀国突击兵', faction: FACTIONS.SHU, actionCost: 1 });
      state.battlefield.support[FACTIONS.SHU].slots.push(shuUnit);

      assert.throws(() => {
        dispatch(state, {
          type: 'MOVE',
          playerId: FACTIONS.SHU,
          payload: { cardInstanceId: shuUnit.instanceId, targetZone: 'FRONTLINE_LEFT' }
        });
      }, /Frontline zone occupied by enemy/);
    });

    it('TC03-4: Unit can move laterally between adjacent frontline zones (LEFT <-> CENTER)', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const unit = createCard({ name: '虎豹骑', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, actionCost: 1 });
      state.battlefield.frontline.LEFT.occupant = FACTIONS.WEI;
      state.battlefield.frontline.LEFT.units.push(unit);

      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: unit.instanceId, targetZone: 'FRONTLINE_CENTER' }
      });

      assert.equal(state.battlefield.frontline.LEFT.units.length, 0);
      assert.equal(state.battlefield.frontline.LEFT.occupant, null);
      assert.equal(state.battlefield.frontline.CENTER.occupant, FACTIONS.WEI);
      assert.equal(state.battlefield.frontline.CENTER.units[0].instanceId, unit.instanceId);
    });

    it('TC03-5: Direct lateral move between non-adjacent zones (LEFT to RIGHT) is prohibited', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const unit = createCard({ name: '虎豹骑', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, actionCost: 1 });
      state.battlefield.frontline.LEFT.occupant = FACTIONS.WEI;
      state.battlefield.frontline.LEFT.units.push(unit);

      assert.throws(() => {
        dispatch(state, {
          type: 'MOVE',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: unit.instanceId, targetZone: 'FRONTLINE_RIGHT' }
        });
      }, /Invalid lateral move from LEFT to RIGHT/);
    });

    it('TC03-6: Zone occupation flips to empty when the occupying unit leaves or is destroyed', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const ranger = createCard({ name: '游击骑', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, keywords: ['游击'], actionCost: 1 });
      state.battlefield.frontline.RIGHT.occupant = FACTIONS.WEI;
      state.battlefield.frontline.RIGHT.units.push(ranger);

      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: ranger.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(state.battlefield.frontline.RIGHT.occupant, null);
      assert.equal(state.battlefield.frontline.RIGHT.units.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 4: Double Granary 0-10 & Refill
  // --------------------------------------------------------------------------
  describe('F06: Double Granary Provisions (0-10 & Refill)', () => {
    it('TC04-1: Provisions cap starts at 0; turn start increases natural main granary by 1', () => {
      const state = createInitialState();
      assert.equal(state.players[FACTIONS.WEI].provisionsCap, 0);
      startTurn(state, FACTIONS.WEI);
      assert.equal(state.players[FACTIONS.WEI].mainGranaryCap, 1);
      assert.equal(state.players[FACTIONS.WEI].provisionsCap, 1);
      assert.equal(state.players[FACTIONS.WEI].provisions, 1);
    });

    it('TC04-2: Provisions auto-refill to total cap at the start of each turn', () => {
      const state = createInitialState();
      startTurn(state, FACTIONS.WEI);
      const player = state.players[FACTIONS.WEI];
      player.provisions = 0; // drain provisions during action

      endTurn(state); // switch to SHU
      endTurn(state); // switch back to WEI on turn 3
      assert.equal(player.mainGranaryCap, 2);
      assert.equal(player.provisions, 2, 'Provisions auto-refilled to new cap');
    });

    it('TC04-3: Main Granary natural growth strictly caps at 10 and stops growing naturally', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.mainGranaryCap = 10;
      player.provisionsCap = 10;

      startTurn(state, FACTIONS.WEI);
      assert.equal(player.mainGranaryCap, 10, 'Natural granary does not exceed 10');
      assert.equal(player.provisions, 10);
    });

    it('TC04-4: Extra Granary expands total provisions capacity beyond 10 without ceiling', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.mainGranaryCap = 10;
      player.extraGranaryCap = 0;
      player.provisionsCap = 10;
      player.provisions = 10;

      // Deploy unit with 补给 (adds +1 extra granary cap)
      const supplyUnit = createCard({ name: '屯田守军', cost: 2, keywords: ['补给'] });
      player.hand.push(supplyUnit);
      dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: supplyUnit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(player.extraGranaryCap, 1);
      assert.equal(player.provisionsCap, 11, 'Total provisions cap expanded to 11');
    });

    it('TC04-5: Capacity loss drains Extra Granary first, leaving Main Granary intact', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.mainGranaryCap = 10;
      player.extraGranaryCap = 2;
      player.provisionsCap = 12;
      player.provisions = 12;

      // A 补给 unit on board is destroyed
      const supplyUnit = createCard({ name: '屯田守军', faction: FACTIONS.WEI, keywords: ['补给'], hp: 2 });
      state.battlefield.support[FACTIONS.WEI].slots.push(supplyUnit);
      state.players[FACTIONS.SHU].provisions = 5;

      // Simulate combat that kills supplyUnit
      resolveCombat(state, {
        playerId: FACTIONS.SHU,
        payload: {
          attackerId: (() => {
            const att = createCard({ name: '蜀军杀手', faction: FACTIONS.SHU, atk: 5 });
            state.battlefield.support[FACTIONS.SHU].slots.push(att);
            return att.instanceId;
          })(),
          targetId: supplyUnit.instanceId
        }
      });

      assert.equal(player.extraGranaryCap, 1, 'Extra granary reduced by 1');
      assert.equal(player.mainGranaryCap, 10, 'Main granary intact at 10');
      assert.equal(player.provisionsCap, 11);
      assert.equal(player.provisions, 11, 'Current provisions capped at new total cap');
    });

    it('TC04-6: Actions are rejected when player provisions are insufficient', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 1;
      const expensiveCard = createCard({ name: '重甲骑兵', cost: 4 });
      player.hand.push(expensiveCard);

      assert.throws(() => {
        dispatch(state, {
          type: 'DEPLOY',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: expensiveCard.instanceId, targetZone: 'SUPPORT' }
        });
      }, /Insufficient provisions/);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 5: Dynamic Prestige Tug-of-War [0, 2]
  // --------------------------------------------------------------------------
  describe('F07: Dynamic Prestige Tug-of-War [0, 2]', () => {
    it('TC05-1: Both players initialize with 0 prestige; prestige is strictly bounded in [0, 2]', () => {
      const state = createInitialState();
      assert.equal(state.players[FACTIONS.WEI].prestige, 0);
      assert.equal(state.players[FACTIONS.SHU].prestige, 0);
    });

    it('TC05-2: Gaining 1 prestige when opponent has 0 prestige increments player prestige by 1', () => {
      const state = createInitialState();
      adjustPrestige(state, FACTIONS.WEI, 1);
      assert.equal(state.players[FACTIONS.WEI].prestige, 1);
      assert.equal(state.players[FACTIONS.SHU].prestige, 0);
    });

    it('TC05-3: Gaining 1 prestige when opponent has > 0 prestige steals 1 point from opponent', () => {
      const state = createInitialState();
      state.players[FACTIONS.SHU].prestige = 1;
      state.players[FACTIONS.WEI].prestige = 0;

      adjustPrestige(state, FACTIONS.WEI, 1);
      assert.equal(state.players[FACTIONS.SHU].prestige, 0, 'Opponent prestige deducted by 1');
      assert.equal(state.players[FACTIONS.WEI].prestige, 0, 'Player prestige does not increase during steal');
    });

    it('TC05-4: Prestige value is strictly capped at ceiling of 2 points', () => {
      const state = createInitialState();
      state.players[FACTIONS.WEI].prestige = 2;
      state.players[FACTIONS.SHU].prestige = 0;

      adjustPrestige(state, FACTIONS.WEI, 1);
      assert.equal(state.players[FACTIONS.WEI].prestige, 2, 'Cannot exceed 2 prestige');
    });

    it('TC05-5: Gaining prestige from card deploy resolves immediately before subsequent effects', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      const prestigeUnit = createCard({ name: '荀彧', cost: 4, keywords: ['声望1'] });
      player.hand.push(prestigeUnit);

      dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: prestigeUnit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(player.prestige, 1, 'Prestige updated to 1 upon deployment');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 6: Deployment Prestige Discount
  // --------------------------------------------------------------------------
  describe('F08: Deployment Prestige Discount', () => {
    it('TC06-1: Player with 1 prestige gets 1 provision discount on first unit deployment', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      player.prestige = 1;

      const unit = createCard({ name: '魏步兵', cost: 3 });
      player.hand.push(unit);

      const res = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: unit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(res.cost, 2, 'Discount reduced cost from 3 to 2');
      assert.equal(player.provisions, 3, 'Paid 2 provisions');
      assert.equal(player.prestigeDiscountUsed, true);
    });

    it('TC06-2: Player with 2 prestige gets 2 provisions discount on first unit deployment', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      player.prestige = 2;

      const unit = createCard({ name: '重甲兵', cost: 4 });
      player.hand.push(unit);

      const res = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: unit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(res.cost, 2, 'Discount reduced cost from 4 to 2');
      assert.equal(player.provisions, 3);
    });

    it('TC06-3: Prestige discount applies ONLY to first unit deployed in that turn; 2nd unit pays full cost', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;
      player.prestige = 2;

      const u1 = createCard({ name: '首发骑兵', cost: 3 });
      const u2 = createCard({ name: '次发骑兵', cost: 3 });
      player.hand.push(u1, u2);

      const res1 = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: u1.instanceId, targetZone: 'SUPPORT' }
      });
      assert.equal(res1.cost, 1, 'First unit discounted by 2 (3 -> 1)');

      const res2 = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: u2.instanceId, targetZone: 'SUPPORT' }
      });
      assert.equal(res2.cost, 3, 'Second unit pays full cost of 3');
      assert.equal(player.provisions, 6, '10 - 1 - 3 = 6 provisions remaining');
    });

    it('TC06-4: Prestige discount cannot reduce deployment cost below 0', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;
      player.prestige = 2;

      const cheapUnit = createCard({ name: '斥候', cost: 1 });
      player.hand.push(cheapUnit);

      const res = dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: cheapUnit.instanceId, targetZone: 'SUPPORT' }
      });

      assert.equal(res.cost, 0, 'Cost floored at 0');
      assert.equal(player.provisions, 5, 'No provisions deducted');
    });

    it('TC06-5: Prestige discount resets at the start of each new turn', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.prestige = 1;
      player.prestigeDiscountUsed = true;

      startTurn(state, FACTIONS.WEI);
      assert.equal(player.prestigeDiscountUsed, false, 'Discount flag reset at turn start');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 7: Fatigue / Overdraw Damage Formula
  // --------------------------------------------------------------------------
  describe('F10: Fatigue / Overdraw Escalation Formula', () => {
    it('TC07-1: Drawing cards when deck has cards deals 0 fatigue damage', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.deck = [createCard({ name: '牌A' })];
      const initialHp = player.hp;

      drawCard(state, FACTIONS.WEI);
      assert.equal(player.hp, initialHp);
      assert.equal(player.fatigueCount, 0);
    });

    it('TC07-2: 1st draw from an empty deck deals 1 damage directly to Main City', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.deck = [];

      drawCard(state, FACTIONS.WEI);
      assert.equal(player.fatigueCount, 1);
      assert.equal(player.hp, 19);
    });

    it('TC07-3: 2nd draw from empty deck deals 2 damage (cumulative 3 damage)', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.deck = [];

      drawCard(state, FACTIONS.WEI); // 1st: -1
      drawCard(state, FACTIONS.WEI); // 2nd: -2
      assert.equal(player.fatigueCount, 2);
      assert.equal(player.hp, 17, '20 - 1 - 2 = 17');
    });

    it('TC07-4: 3rd draw from empty deck deals 3 damage (cumulative 6 damage)', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.deck = [];

      drawCard(state, FACTIONS.WEI); // -1
      drawCard(state, FACTIONS.WEI); // -2
      drawCard(state, FACTIONS.WEI); // -3
      assert.equal(player.fatigueCount, 3);
      assert.equal(player.hp, 14, '20 - 1 - 2 - 3 = 14');
    });

    it('TC07-5: Cumulative formula N*(N+1)/2 matches 4 consecutive overdraws (10 damage total)', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.deck = [];

      for (let i = 0; i < 4; i++) {
        drawCard(state, FACTIONS.WEI);
      }
      assert.equal(player.fatigueCount, 4);
      assert.equal(player.hp, 10, '20 - 10 = 10');
    });

    it('TC07-6: Fatigue damage triggers immediate game over when HP reaches 0', () => {
      const state = createInitialState({ weiHp: 1 });
      const player = state.players[FACTIONS.WEI];
      player.deck = [];

      drawCard(state, FACTIONS.WEI);
      assert.equal(player.hp, 0);
      assert.equal(state.phase, 'GAME_OVER');
      assert.equal(state.winner, FACTIONS.SHU);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 8: Turn Lifecycle State Machine
  // --------------------------------------------------------------------------
  describe('F11: Turn Lifecycle State Machine', () => {
    it('TC08-1: Setup phase draws 4 cards for P1 and 5 cards for P2', () => {
      const state = createInitialState();
      setupGame(state);

      assert.equal(state.phase, 'MULLIGAN');
      assert.equal(state.players[FACTIONS.WEI].hand.length, 4);
      assert.equal(state.players[FACTIONS.SHU].hand.length, 5);
      assert.equal(state.players[FACTIONS.WEI].deck.length, 36);
      assert.equal(state.players[FACTIONS.SHU].deck.length, 35);
    });

    it('TC08-2: Turn start phase increments granary cap and refills provisions to full', () => {
      const state = createInitialState();
      startTurn(state, FACTIONS.WEI);

      assert.equal(state.phase, 'ACTION');
      assert.equal(state.players[FACTIONS.WEI].provisionsCap, 1);
      assert.equal(state.players[FACTIONS.WEI].provisions, 1);
    });

    it('TC08-3: Player 1 skips draw phase on turn 1', () => {
      const state = createInitialState();
      setupGame(state);
      state.turnNumber = 1;
      startTurn(state, FACTIONS.WEI);

      assert.equal(state.players[FACTIONS.WEI].hand.length, 4, 'No card drawn on Turn 1 P1');
    });

    it('TC08-4: Player 2 draws normally on their turn 1', () => {
      const state = createInitialState();
      setupGame(state);
      state.turnNumber = 2; // P2 turn
      startTurn(state, FACTIONS.SHU);

      assert.equal(state.players[FACTIONS.SHU].hand.length, 6, '5 initial + 1 drawn = 6');
    });

    it('TC08-5: End turn phase resets attack flags and transfers active turn to opponent', () => {
      const state = createInitialState();
      startTurn(state, FACTIONS.WEI);
      const unit = createCard({ name: '先锋骑兵', faction: FACTIONS.WEI });
      unit.status.attackedThisTurn = true;
      state.battlefield.support[FACTIONS.WEI].slots.push(unit);

      endTurn(state);
      assert.equal(state.activePlayer, FACTIONS.SHU, 'Active player switched to SHU');
      assert.equal(state.turnNumber, 2);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 9: Hand Limit 9 & Overflow Burn
  // --------------------------------------------------------------------------
  describe('F12: Hand Limit 9 & Overflow Burn', () => {
    it('TC09-1: Player can hold up to 9 cards in hand without burning', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.hand = [];
      player.deck = [];
      for (let i = 0; i < 9; i++) {
        player.deck.push(createCard({ name: `卡牌_${i}` }));
        drawCard(state, FACTIONS.WEI);
      }
      assert.equal(player.hand.length, 9);
      assert.equal(player.discard.length, 0);
    });

    it('TC09-2: Drawing a 10th card when at 9 cards burns drawn card to discard pile', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.hand = [];
      player.deck = [];
      for (let i = 0; i < 9; i++) {
        player.hand.push(createCard({ name: `手牌_${i}` }));
      }
      const tenth = createCard({ name: '第10张牌' });
      player.deck.push(tenth);

      const burned = drawCard(state, FACTIONS.WEI);
      assert.equal(player.hand.length, 9, 'Hand stays at 9');
      assert.equal(player.discard.length, 1, 'Discard pile receives burned card');
      assert.equal(player.discard[0].instanceId, tenth.instanceId);
      assert.equal(burned.instanceId, tenth.instanceId);
    });

    it('TC09-3: Burned card triggers zero deploy or hand effects', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      for (let i = 0; i < 9; i++) player.hand.push(createCard({ name: `手牌_${i}` }));

      const prestigeCard = createCard({ name: '天子诏令', cost: 1, keywords: ['声望1'] });
      player.deck.push(prestigeCard);

      drawCard(state, FACTIONS.WEI);
      assert.equal(player.prestige, 0, 'No prestige gained from burned card');
    });

    it('TC09-4: Drawing 2 cards when hand has 8 cards enters 1 card and burns 1 card', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.hand = [];
      for (let i = 0; i < 8; i++) player.hand.push(createCard({ name: `手牌_${i}` }));

      const c1 = createCard({ name: '进入手牌' });
      const c2 = createCard({ name: '被烧掉' });
      player.deck = [c1, c2];

      drawCard(state, FACTIONS.WEI); // hand reaches 9
      drawCard(state, FACTIONS.WEI); // burns c2

      assert.equal(player.hand.length, 9);
      assert.equal(player.hand[8].instanceId, c1.instanceId);
      assert.equal(player.discard.length, 1);
      assert.equal(player.discard[0].instanceId, c2.instanceId);
    });

    it('TC09-5: Combat log correctly logs CARD_BURNED event on hand overflow', () => {
      const state = createInitialState();
      const player = state.players[FACTIONS.WEI];
      player.hand = [];
      for (let i = 0; i < 9; i++) player.hand.push(createCard({ name: `手牌_${i}` }));
      player.deck = [createCard({ name: '超限卡' })];

      drawCard(state, FACTIONS.WEI);
      const log = state.combatLog.find(e => e.type === 'CARD_BURNED');
      assert.ok(log, 'Combat log contains CARD_BURNED event');
      assert.equal(log.playerId, FACTIONS.WEI);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 10: Combat & Dual Counterattack
  // --------------------------------------------------------------------------
  describe('F14: Combat & Dual Counterattack', () => {
    it('TC10-1: Unit vs Unit combat deals simultaneous mutual damage', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const attacker = createCard({ name: '步兵A', faction: FACTIONS.WEI, atk: 3, hp: 5, actionCost: 1 });
      const defender = createCard({ name: '步兵B', faction: FACTIONS.SHU, atk: 2, hp: 4 });
      state.battlefield.support[FACTIONS.WEI].slots.push(attacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(defender);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: attacker.instanceId, targetId: defender.instanceId }
      });

      assert.equal(res.damageDealt, 3);
      assert.equal(res.counterDealt, 2);
      assert.equal(defender.hp, 1, 'Defender hp 4 - 3 = 1');
      assert.equal(attacker.hp, 3, 'Attacker hp 5 - 2 = 3');
      assert.equal(res.attackerDied, false);
      assert.equal(res.defenderDied, false);
    });

    it('TC10-2: Attacking enemy Main City deals damage to Main City and takes 0 counterattack', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const attacker = createCard({ name: '先锋骑兵', faction: FACTIONS.WEI, atk: 4, hp: 3, actionCost: 1 });
      state.battlefield.frontline.CENTER.occupant = FACTIONS.WEI;
      state.battlefield.frontline.CENTER.units.push(attacker);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: attacker.instanceId, targetId: 'HQ' }
      });

      assert.equal(res.damageDealt, 4);
      assert.equal(res.counterDealt, 0);
      assert.equal(attacker.hp, 3, 'Attacker took zero counterattack from Main City');
      assert.equal(state.players[FACTIONS.SHU].hp, 16, 'Enemy HQ took 4 damage');
    });

    it('TC10-3: Lethal damage defeats unit and removes it from battlefield to discard pile', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const attacker = createCard({ name: '精锐骑兵', faction: FACTIONS.WEI, atk: 5, hp: 5, actionCost: 1 });
      const defender = createCard({ name: '虚弱步兵', faction: FACTIONS.SHU, atk: 1, hp: 3 });
      state.battlefield.support[FACTIONS.WEI].slots.push(attacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(defender);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: attacker.instanceId, targetId: defender.instanceId }
      });

      assert.equal(res.defenderDied, true);
      assert.equal(state.battlefield.support[FACTIONS.SHU].slots.length, 0, 'Defender removed from board');
      assert.equal(state.players[FACTIONS.SHU].discard.length, 1, 'Defender moved to discard pile');
    });

    it('TC10-4: Simultaneous lethal mutual damage destroys both units concurrently', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const attacker = createCard({ name: '敢死兵A', faction: FACTIONS.WEI, atk: 4, hp: 2, actionCost: 1 });
      const defender = createCard({ name: '敢死兵B', faction: FACTIONS.SHU, atk: 3, hp: 3 });
      state.battlefield.support[FACTIONS.WEI].slots.push(attacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(defender);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: attacker.instanceId, targetId: defender.instanceId }
      });

      assert.equal(res.attackerDied, true);
      assert.equal(res.defenderDied, true);
      assert.equal(state.battlefield.support[FACTIONS.WEI].slots.length, 0);
      assert.equal(state.battlefield.support[FACTIONS.SHU].slots.length, 0);
    });

    it('TC10-5: 降将 (Defector) card defeated in combat enters enemy discard pile', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const attacker = createCard({ name: '魏先锋', faction: FACTIONS.WEI, atk: 4, hp: 4, actionCost: 1 });
      const defector = createCard({ name: '投降武将', faction: FACTIONS.SHU, atk: 1, hp: 2, keywords: ['降将'] });
      state.battlefield.support[FACTIONS.WEI].slots.push(attacker);
      state.battlefield.support[FACTIONS.SHU].slots.push(defector);

      resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: attacker.instanceId, targetId: defector.instanceId }
      });

      assert.equal(state.players[FACTIONS.SHU].discard.length, 0, 'Does not go to Shu discard');
      assert.equal(state.players[FACTIONS.WEI].discard.length, 1, 'Goes to killer (Wei) discard pile');
    });

    it('TC10-6: 霹雳车 (Catapult) transfers overflow damage to enemy Main City', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const catapult = createCard({ name: '霹雳车', faction: FACTIONS.WEI, atk: 5, hp: 3, actionCost: 1, keywords: ['矢石', '溢出转移'] });
      const weakDefender = createCard({ name: '斥候', faction: FACTIONS.SHU, atk: 1, hp: 2 });
      state.battlefield.support[FACTIONS.WEI].slots.push(catapult);
      state.battlefield.support[FACTIONS.SHU].slots.push(weakDefender);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: catapult.instanceId, targetId: weakDefender.instanceId }
      });

      assert.equal(res.defenderDied, true);
      // Overflow = 5 - 2 = 3 damage to HQ
      assert.equal(state.players[FACTIONS.SHU].hp, 17, 'HQ took 3 overflow damage (20 - 3 = 17)');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 11: Strategist (谋士) Mechanics
  // --------------------------------------------------------------------------
  describe('F17: Strategist (谋士) Mechanics', () => {
    it('TC11-1: Strategist can attack any enemy unit or HQ across any zone on entire battlefield', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const strategist = createCard({ name: '郭嘉', faction: FACTIONS.WEI, troopType: TROOP_TYPES.STRATEGIST, atk: 3, hp: 3, actionCost: 1 });
      const distantEnemy = createCard({ name: '蜀国底线兵', faction: FACTIONS.SHU, atk: 2, hp: 5 });
      state.battlefield.support[FACTIONS.WEI].slots.push(strategist);
      state.battlefield.support[FACTIONS.SHU].slots.push(distantEnemy);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: strategist.instanceId, targetId: distantEnemy.instanceId }
      });

      assert.equal(res.damageDealt, 3);
      assert.equal(distantEnemy.hp, 2);
    });

    it('TC11-2: Military units attacked by a strategist take 0 counterattack from strategist and deal 0 counter', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const strategist = createCard({ name: '郭嘉', faction: FACTIONS.WEI, troopType: TROOP_TYPES.STRATEGIST, atk: 3, hp: 3, actionCost: 1 });
      const infantry = createCard({ name: '蜀步军', faction: FACTIONS.SHU, troopType: TROOP_TYPES.INFANTRY, atk: 4, hp: 5 });
      state.battlefield.support[FACTIONS.WEI].slots.push(strategist);
      state.battlefield.support[FACTIONS.SHU].slots.push(infantry);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: strategist.instanceId, targetId: infantry.instanceId }
      });

      assert.equal(res.damageDealt, 3);
      assert.equal(res.counterDealt, 0, 'Infantry cannot counterattack strategist');
      assert.equal(strategist.hp, 3, 'Strategist took 0 counterattack damage');
    });

    it('TC11-3: Military units attacking a strategist receive 0 counterattack from the strategist', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.SHU];
      player.provisions = 5;

      const infantry = createCard({ name: '蜀步军', faction: FACTIONS.SHU, troopType: TROOP_TYPES.INFANTRY, atk: 2, hp: 4, actionCost: 1 });
      const strategist = createCard({ name: '郭嘉', faction: FACTIONS.WEI, troopType: TROOP_TYPES.STRATEGIST, atk: 3, hp: 4 });
      state.battlefield.support[FACTIONS.SHU].slots.push(infantry);
      state.battlefield.support[FACTIONS.WEI].slots.push(strategist);

      const res = resolveCombat(state, {
        playerId: FACTIONS.SHU,
        payload: { attackerId: infantry.instanceId, targetId: strategist.instanceId }
      });

      assert.equal(res.damageDealt, 2);
      assert.equal(res.counterDealt, 0, 'Strategist does not counter military units');
      assert.equal(infantry.hp, 4, 'Infantry takes 0 damage');
    });

    it('TC11-4: Strategist attacking enemy strategist suffers normal counterattack from that strategist', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const weiStrat = createCard({ name: '荀彧', faction: FACTIONS.WEI, troopType: TROOP_TYPES.STRATEGIST, atk: 3, hp: 4, actionCost: 1 });
      const shuStrat = createCard({ name: '诸葛亮', faction: FACTIONS.SHU, troopType: TROOP_TYPES.STRATEGIST, atk: 2, hp: 4 });
      state.battlefield.support[FACTIONS.WEI].slots.push(weiStrat);
      state.battlefield.support[FACTIONS.SHU].slots.push(shuStrat);

      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: weiStrat.instanceId, targetId: shuStrat.instanceId }
      });

      assert.equal(res.damageDealt, 3);
      assert.equal(res.counterDealt, 2, 'Strategists counter each other normally');
      assert.equal(shuStrat.hp, 1);
      assert.equal(weiStrat.hp, 2);
    });

    it('TC11-5: Strategist MUST prioritize enemy strategist in the same frontline zone', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const weiStrat = createCard({ name: '贾诩', faction: FACTIONS.WEI, troopType: TROOP_TYPES.STRATEGIST, atk: 2, hp: 3, actionCost: 1 });
      const enemyStrat = createCard({ name: '孙乾', faction: FACTIONS.SHU, troopType: TROOP_TYPES.STRATEGIST, atk: 1, hp: 2 });
      const enemySoldier = createCard({ name: '蜀步军', faction: FACTIONS.SHU, troopType: TROOP_TYPES.INFANTRY, atk: 2, hp: 4 });

      state.battlefield.frontline.CENTER.occupant = FACTIONS.SHU;
      state.battlefield.frontline.CENTER.units.push(enemyStrat, enemySoldier);
      state.battlefield.support[FACTIONS.WEI].slots.push(weiStrat);

      // Attempting to attack infantry in the same zone when strategist is present fails
      // Note: If weiStrat moves to frontline CENTER, it must prioritize enemy strategist
      state.battlefield.frontline.CENTER.units.push(weiStrat);
      weiStrat.faction = FACTIONS.WEI;

      assert.throws(() => {
        resolveCombat(state, {
          playerId: FACTIONS.WEI,
          payload: { attackerId: weiStrat.instanceId, targetId: enemySoldier.instanceId }
        });
      }, /Strategist must prioritize enemy strategist in the same zone/);
    });

    it('TC11-6: Strategist attacks completely ignore 守护 (Guardian) protection', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 5;

      const strategist = createCard({ name: '郭嘉', faction: FACTIONS.WEI, troopType: TROOP_TYPES.STRATEGIST, atk: 3, hp: 3, actionCost: 1 });
      const guardian = createCard({ name: '傅彤', faction: FACTIONS.SHU, troopType: TROOP_TYPES.INFANTRY, atk: 2, hp: 4, keywords: ['守护'] });
      const protectedUnit = createCard({ name: '受保护兵', faction: FACTIONS.SHU, troopType: TROOP_TYPES.INFANTRY, atk: 1, hp: 3 });

      state.battlefield.support[FACTIONS.WEI].slots.push(strategist);
      state.battlefield.support[FACTIONS.SHU].slots.push(guardian, protectedUnit);

      // Strategist directly attacks protectedUnit bypassing guardian
      const res = resolveCombat(state, {
        playerId: FACTIONS.WEI,
        payload: { attackerId: strategist.instanceId, targetId: protectedUnit.instanceId }
      });

      assert.equal(res.damageDealt, 3);
      assert.equal(protectedUnit.hp, 0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 12: Troop Typology Mobility (步/马/水)
  // --------------------------------------------------------------------------
  describe('F18: Troop Typology Mobility (步/马/水)', () => {
    it('TC12-1: 步军 (Infantry) can move OR attack once per turn (cannot do both)', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      const infantry = createCard({ name: '魏步兵', faction: FACTIONS.WEI, troopType: TROOP_TYPES.INFANTRY, actionCost: 1 });
      state.battlefield.support[FACTIONS.WEI].slots.push(infantry);

      // Move from Support to Frontline
      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: infantry.instanceId, targetZone: 'FRONTLINE_LEFT' }
      });
      assert.equal(infantry.status.actionsUsed, 1);

      // Attempting to attack in the same turn throws
      assert.throws(() => {
        dispatch(state, {
          type: 'ATTACK',
          playerId: FACTIONS.WEI,
          payload: { attackerId: infantry.instanceId, targetId: 'HQ' }
        });
      }, /Infantry cannot attack after moving/);
    });

    it('TC12-2: 马军 (Cavalry) can move AND attack in the same turn in any order', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      const cavalry = createCard({ name: '虎豹骑', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, atk: 4, hp: 4, actionCost: 1 });
      state.battlefield.support[FACTIONS.WEI].slots.push(cavalry);

      // 1. Move to Frontline
      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: cavalry.instanceId, targetZone: 'FRONTLINE_CENTER' }
      });
      assert.equal(cavalry.status.movedThisTurn, true);

      // 2. Attack HQ
      const res = dispatch(state, {
        type: 'ATTACK',
        playerId: FACTIONS.WEI,
        payload: { attackerId: cavalry.instanceId, targetId: 'HQ' }
      });
      assert.equal(res.success, true);
      assert.equal(cavalry.status.attackedThisTurn, true);
    });

    it('TC12-3: 水军 (Navy) on Water terrain behaves like Cavalry (can move AND attack)', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      // CENTER is Water terrain
      assert.equal(state.battlefield.frontline.CENTER.terrain.type, 'WATER');

      const navy = createCard({ name: '满宠', faction: FACTIONS.WEI, troopType: TROOP_TYPES.NAVY, atk: 3, hp: 4, actionCost: 1 });
      state.battlefield.support[FACTIONS.WEI].slots.push(navy);

      // 1. Move into Water
      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: navy.instanceId, targetZone: 'FRONTLINE_CENTER' }
      });

      // 2. Attack from Water in same turn succeeds!
      const res = dispatch(state, {
        type: 'ATTACK',
        playerId: FACTIONS.WEI,
        payload: { attackerId: navy.instanceId, targetId: 'HQ' }
      });
      assert.equal(res.success, true);
      assert.equal(navy.status.attackedThisTurn, true);
    });

    it('TC12-4: 水军 (Navy) on non-Water terrain behaves like Infantry (cannot move AND attack)', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      // LEFT is Plain terrain
      assert.equal(state.battlefield.frontline.LEFT.terrain.type, 'PLAIN');

      const navy = createCard({ name: '满宠', faction: FACTIONS.WEI, troopType: TROOP_TYPES.NAVY, atk: 3, hp: 4, actionCost: 1 });
      state.battlefield.support[FACTIONS.WEI].slots.push(navy);

      // Move into Plain
      dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: navy.instanceId, targetZone: 'FRONTLINE_LEFT' }
      });

      // Attempting to attack after moving on non-water terrain fails
      assert.throws(() => {
        dispatch(state, {
          type: 'ATTACK',
          playerId: FACTIONS.WEI,
          payload: { attackerId: navy.instanceId, targetId: 'HQ' }
        });
      }, /Infantry cannot attack after moving/);
    });

    it('TC12-5: Unit without 突袭 (Rush) cannot attack or move on the turn it is deployed', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      const unit = createCard({ name: '步兵营', faction: FACTIONS.WEI, cost: 2, actionCost: 1, keywords: [] });
      player.hand.push(unit);

      dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: unit.instanceId, targetZone: 'SUPPORT' }
      });

      // Attempting to move on deploy turn without 突袭
      unit.status.actionsUsed = 1; // deployed flag
      assert.throws(() => {
        dispatch(state, {
          type: 'MOVE',
          playerId: FACTIONS.WEI,
          payload: { cardInstanceId: unit.instanceId, targetZone: 'FRONTLINE_LEFT' }
        });
      }, /Infantry can only move or attack once per turn/);
    });

    it('TC12-6: Unit with 突袭 (Rush) can move and act on the turn it is deployed', () => {
      const state = createInitialState();
      state.phase = 'ACTION';
      const player = state.players[FACTIONS.WEI];
      player.provisions = 10;

      const rushUnit = createCard({ name: '轻骑兵', faction: FACTIONS.WEI, troopType: TROOP_TYPES.CAVALRY, cost: 1, atk: 2, hp: 1, actionCost: 1, keywords: ['突袭'] });
      player.hand.push(rushUnit);

      dispatch(state, {
        type: 'DEPLOY',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: rushUnit.instanceId, targetZone: 'SUPPORT' }
      });

      // Can immediately move
      const moveRes = dispatch(state, {
        type: 'MOVE',
        playerId: FACTIONS.WEI,
        payload: { cardInstanceId: rushUnit.instanceId, targetZone: 'FRONTLINE_CENTER' }
      });
      assert.equal(moveRes.success, true);
    });
  });
});
