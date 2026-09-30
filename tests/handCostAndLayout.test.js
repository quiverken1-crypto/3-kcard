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

// 旧的“手牌叠压”与“松手后才定位”两项已随界面改版移除（手牌改为不堆叠、按宽度缩放/滚动）
