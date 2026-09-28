import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, setupGame } from '../js/engine/state.js';

const opening = seed => {
  const state = createInitialState({ seed, shuffleDecks: true });
  setupGame(state);
  return state.players.WEI.hand.map(card => card.cardId).join(',');
};

test('same seed reproduces the same shuffled opening hand', () => {
  assert.equal(opening(111), opening(111));
});

test('different seeds change the shuffled opening hand', () => {
  assert.notEqual(opening(111), opening(222));
});
