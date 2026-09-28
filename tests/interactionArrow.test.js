import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractionController, INTERACTION_STATE } from '../js/ui/interaction.js';

test('selected hand card keeps updating its arrow after pointer release', () => {
  const controller = Object.create(InteractionController.prototype);
  controller.state = INTERACTION_STATE.CARD_SELECTED;
  controller.selectedCard = { instanceId: 'hand_1' };
  controller.dragPointerId = null;
  let seen = null;
  controller._updateCardTargetingCurve = (x, y) => { seen = [x, y]; };
  controller._handlePointerMove({ clientX: 250, clientY: 150, pointerId: 1 });
  assert.deepEqual(seen, [250, 150]);
});

test('selected board unit keeps updating its arrow after pointer release', () => {
  const controller = Object.create(InteractionController.prototype);
  controller.state = INTERACTION_STATE.TARGETING;
  controller.selectedUnit = { instanceId: 'unit_1' };
  controller.dragPointerId = null;
  let seen = null;
  controller._updateTargetingCurve = (x, y) => { seen = [x, y]; };
  controller._handlePointerMove({ clientX: 500, clientY: 280, pointerId: 1 });
  assert.deepEqual(seen, [500, 280]);
});

test('a non-targeted tactic can be played from any battlefield zone', () => {
  const controller = Object.create(InteractionController.prototype);
  controller.selectedCard = { cardDef: { type: 'TACTIC' } };
  const insideFrontline = { closest: selector => selector === '#battlefield-main' ? {} : selector === '#zone-left' ? {} : null };
  assert.equal(controller._resolveDropZone(insideFrontline), 'BATTLEFIELD');
});

test('right click cancels selection before opening card details', () => {
  const controller = Object.create(InteractionController.prototype);
  controller.state = INTERACTION_STATE.CARD_SELECTED;
  let cancelled = false;
  let prevented = false;
  let stopped = false;
  controller.cancelSelection = () => { cancelled = true; };
  controller._handleContextMenu({ preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } });
  assert.equal(cancelled, true);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});
