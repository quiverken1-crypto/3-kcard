import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createCard, getLegalActions, dispatch, findUnit } from '../js/engine/rulesEngine.js';
import { getTacticTargets, hqDamageAfterSkills, afterAttack } from '../js/engine/cardSkills.js';
import { InteractionController } from '../js/ui/interaction.js';

test('策反 accepts expensive cavalry and 奋战 targets described on the card', () => {
  const state = createInitialState();
  const tactic = createCard({ cardId: 'wei_ce_fan', type: 'TACTIC', cost: 4 });
  const cavalry = createCard({ cardId: 'shu_test_cavalry', faction: 'SHU', cost: 4, troopType: 'CAVALRY' });
  const doubleStrike = createCard({ cardId: 'shu_test_fenzhan', faction: 'SHU', cost: 5, keywords: ['奋战'] });
  state.battlefield.support.SHU.slots.push(cavalry, doubleStrike);
  const targets = getTacticTargets(state, 'WEI', tactic);
  assert.ok(targets.some(unit => unit.instanceId === cavalry.instanceId));
  assert.ok(targets.some(unit => unit.instanceId === doubleStrike.instanceId));
});

test('李典 reduces one HQ damage when multiple qualifying allies are present', () => {
  const state = createInitialState();
  state.battlefield.support.WEI.slots.push(
    createCard({ cardId: 'wei_li_dian', atk: 2 }),
    createCard({ cardId: 'wei_ally_a', atk: 4 }),
    createCard({ cardId: 'wei_ally_b', atk: 5 })
  );
  assert.equal(hqDamageAfterSkills(state, 'WEI', 3), 2);
});

test('徐晃劫粮 immediately deducts overflow from current provisions', () => {
  const state = createInitialState();
  const xu = createCard({ cardId: 'wei_xu_huang', faction: 'WEI' });
  const enemy = createCard({ cardId: 'shu_enemy', faction: 'SHU', hp: 1 });
  enemy.hp = -2;
  state.battlefield.support.WEI.slots.push(xu);
  state.players.SHU.provisions = 5;
  afterAttack(state, xu, enemy, { defenderDied: true, damageDealt: 3 }, false);
  assert.equal(state.players.SHU.provisions, 3);
  assert.equal(state.players.SHU.provisionPenalty, 0);
});

function swapState() {
  const state = createInitialState();
  state.phase = 'ACTION';
  state.activePlayer = 'SHU';
  state.players.SHU.provisions = 3;
  const bai = createCard({ cardId: 'shu_bai_er_jun', faction: 'SHU', actionCost: 1 });
  state.battlefield.support.SHU.slots.push(bai);
  const zone = state.battlefield.frontline.CENTER;
  zone.occupant = 'SHU';
  zone.units = Array.from({ length: zone.capacity }, (_, index) => createCard({ cardId: `shu_ally_${index}`, faction: 'SHU' }));
  return { state, bai, zone };
}

test('白毦军 can select a full friendly zone and perform its swap', () => {
  const { state, bai, zone } = swapState();
  const controller = new InteractionController();
  controller.gameState = state;
  controller.localPlayerId = 'SHU';
  controller._computeUnitLegalTargets(bai, findUnit(state, bai.instanceId));
  assert.ok(controller.legalMoveTargets.includes('FRONTLINE_CENTER'));
  assert.ok(getLegalActions(state, 'SHU').some(a => a.type === 'MOVE' && a.payload.cardInstanceId === bai.instanceId && a.payload.targetZone === 'FRONTLINE_CENTER'));
  const swapped = zone.units.at(-1);
  dispatch(state, { type: 'MOVE', playerId: 'SHU', payload: { cardInstanceId: bai.instanceId, targetZone: 'FRONTLINE_CENTER' } });
  assert.ok(zone.units.includes(bai));
  assert.ok(state.battlefield.support.SHU.slots.includes(swapped));
});
