import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrestigeDiscountStatus } from '../js/ui/boardRenderer.js';

test('prestige badge does not advertise a playable deployment when provisions remain insufficient', () => {
  const status = getPrestigeDiscountStatus({ prestige: 1, prestigeDiscountUsed: false, provisions: 1, hand: [{ type: 'UNIT', cost: 4 }] }, true);
  assert.equal(status.state, 'pending');
  assert.match(status.text, /粮草不足/);
});

test('prestige badge reports a playable unit only when discounted cost is affordable', () => {
  const status = getPrestigeDiscountStatus({ prestige: 2, prestigeDiscountUsed: false, provisions: 1, hand: [{ type: 'UNIT', cost: 3 }] }, true);
  assert.equal(status.state, 'ready');
  assert.match(status.text, /可用/);
});

test('zero prestige is not described as consumed', () => {
  const status = getPrestigeDiscountStatus({ prestige: 0, prestigeDiscountUsed: false, provisions: 3, hand: [] }, true);
  assert.equal(status.state, 'inactive');
  assert.doesNotMatch(status.text, /已消耗/);
});
