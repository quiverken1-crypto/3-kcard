import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createCard, dispatch, getLegalActions } from '../js/engine/rulesEngine.js';
import * as cardSkills from '../js/engine/cardSkills.js';
import { InteractionController, INTERACTION_STATE } from '../js/ui/interaction.js';
import * as boardRenderer from '../js/ui/boardRenderer.js';

function tacticState() {
  const state = createInitialState();
  state.phase = 'ACTION';
  state.activePlayer = 'WEI';
  const player = state.players.WEI;
  player.provisions = 2;
  const strategist = createCard({ name: '谋士', type: 'UNIT', faction: 'WEI', keywords: ['奇谋1'] });
  state.battlefield.support.WEI.slots.push(strategist);
  const tactic = createCard({ name: '测试战法', type: 'TACTIC', faction: 'WEI', cost: 3 });
  player.hand.push(tactic);
  return { state, strategist, tactic };
}

test('奇谋 discounts tactic for both hand interaction and rule settlement', () => {
  const { state, tactic } = tacticState();
  assert.equal(typeof cardSkills.getCardPlayCost, 'function');
  const { getCardPlayCost } = cardSkills;
  assert.equal(getCardPlayCost(state, 'WEI', tactic), 2);
  const controller = new InteractionController();
  controller.gameState = state;
  controller.localPlayerId = 'WEI';
  controller._computeLegalDropZones = () => {};
  controller._highlightLegalDropZones = () => {};
  controller._updateCardTargetingCurve = () => {};
  const cardEl = { dataset: { instanceId: tactic.instanceId }, classList: { add() {} } };
  controller._handleHandPointerDown({
    button: 0, pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0,
    target: { closest: () => cardEl }, preventDefault() {}
  });
  assert.equal(controller.state, INTERACTION_STATE.CARD_SELECTED);
  assert.equal(controller.selectedCard.cost, 2);
  dispatch(state, { type: 'PLAY_TACTIC', playerId: 'WEI', payload: { cardInstanceId: tactic.instanceId } });
  assert.equal(state.players.WEI.provisions, 0);
});

test('抑制 removes 奇谋 discount from both legal actions and settlement', () => {
  const { state, strategist, tactic } = tacticState();
  assert.equal(typeof cardSkills.getCardPlayCost, 'function');
  const { getCardPlayCost } = cardSkills;
  strategist.status.inhibited = true;
  assert.equal(getCardPlayCost(state, 'WEI', tactic), 3);
  assert.equal(getLegalActions(state, 'WEI').some(a => a.type === 'PLAY_TACTIC'), false);
  assert.throws(() => dispatch(state, { type: 'PLAY_TACTIC', playerId: 'WEI', payload: { cardInstanceId: tactic.instanceId } }), /Insufficient provisions/);
});

test('nine hand cards overlap enough to fit the available width', () => {
  assert.equal(typeof boardRenderer.calculateHandOverlap, 'function');
  const { calculateHandOverlap } = boardRenderer;
  const overlap = calculateHandOverlap(9, 500, 116);
  assert.ok(overlap > 0);
  assert.ok(9 * 116 - 8 * overlap <= 500);
  assert.equal(calculateHandOverlap(3, 500, 116), 0);
});

test('selected card settles only after pointer release', async () => {
  const { state, tactic } = tacticState();
  const controller = new InteractionController();
  controller.gameState = state;
  controller.localPlayerId = 'WEI';
  controller._computeLegalDropZones = () => {};
  controller._highlightLegalDropZones = () => {};
  controller._updateCardTargetingCurve = () => {};
  const classes = new Set();
  const cardEl = {
    dataset: { instanceId: tactic.instanceId },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    isConnected: true
  };
  controller._handleHandPointerDown({
    button: 0, pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0,
    target: { closest: () => cardEl }, preventDefault() {}
  });
  assert.equal(classes.has('selection-settled'), false);
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector: () => cardEl, elementFromPoint: () => cardEl };
  try {
    controller._handlePointerUp({ button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    assert.equal(classes.has('selection-settled'), false);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(classes.has('selection-settled'), true);
  } finally {
    globalThis.document = previousDocument;
  }
});
