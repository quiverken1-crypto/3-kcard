import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCardPack, buildDeckOptions } from '../js/data/customCards.js';
import { createInitialState, createCard, setupGame } from '../js/engine/state.js';
import { dispatch } from '../js/engine/rulesEngine.js';

const card = (overrides = {}) => ({
  id: 'custom_wei_001', name: '试作军师', faction: 'WEI', type: 'UNIT',
  troopType: 'STRATEGIST', cost: 1, actionCost: 1, atk: 1, hp: 2,
  description: '部署时摸牌并增加声望。', keywords: [],
  abilities: [{ trigger: 'ON_DEPLOY', effects: [
    { type: 'DRAW', amount: 1, target: 'OWNER' },
    { type: 'GAIN_PRESTIGE', amount: 1, target: 'OWNER' }
  ] }], ...overrides
});

test('card pack validation accepts declarative abilities and rejects code or unknown effects', () => {
  const pack = normalizeCardPack({ schemaVersion: 1, cards: [card()] });
  assert.equal(pack.cards[0].abilities[0].effects[0].type, 'DRAW');
  assert.throws(() => normalizeCardPack({ schemaVersion: 1, cards: [card({ abilities: [{ trigger: 'ON_DEPLOY', effects: [{ type: 'EVAL', code: 'alert(1)' }] }] })] }), /EVAL|effect/i);
  assert.throws(() => normalizeCardPack({ schemaVersion: 1, cards: [card({ id: '__proto__' })] }), /id/i);
});

test('custom cards enter the matching faction deck without changing its size', () => {
  const options = buildDeckOptions(normalizeCardPack({ schemaVersion: 1, cards: [card()] }));
  assert.equal(options.weiDeck.length, 40);
  assert.equal(options.shuDeck.length, 40);
  assert.equal(options.weiDeck.filter(c => c.cardId === 'custom_wei_001').length, 1);
});

test('deployment applies configured draw and prestige effects', () => {
  const state = createInitialState({ phase: 'ACTION' });
  setupGame(state);
  state.phase = 'ACTION';
  state.activePlayer = 'WEI';
  const player = state.players.WEI;
  const custom = createCard(normalizeCardPack({ schemaVersion: 1, cards: [card()] }).cards[0]);
  player.hand = [custom];
  player.provisions = 10;
  const originalDeckCount = player.deck.length;
  dispatch(state, { type: 'DEPLOY', playerId: 'WEI', payload: { cardInstanceId: custom.instanceId, targetZone: 'SUPPORT' } });
  assert.equal(player.prestige, 1);
  assert.equal(player.hand.length, 1);
  assert.equal(player.deck.length, originalDeckCount - 1);
  assert.ok(state.combatLog.some(e => e.type === 'ABILITY_TRIGGERED' && e.cardName === custom.name));
});

test('tactic effects compose provision theft and enemy HQ damage', () => {
  const state = createInitialState({ phase: 'ACTION' });
  setupGame(state);
  state.phase = 'ACTION';
  state.activePlayer = 'WEI';
  const player = state.players.WEI;
  const enemy = state.players.SHU;
  const tactic = createCard(normalizeCardPack({ schemaVersion: 1, cards: [card({
    id: 'custom_tactic', name: '断粮火计', type: 'TACTIC', cost: 1,
    abilities: [{ trigger: 'ON_PLAY', effects: [
      { type: 'STEAL_PROVISIONS', amount: 2, target: 'OPPONENT' },
      { type: 'DAMAGE_HQ', amount: 3, target: 'OPPONENT' }
    ] }]
  })] }).cards[0]);
  player.hand = [tactic];
  player.provisions = 5;
  player.provisionsCap = 10;
  enemy.provisions = 4;
  const oldHp = enemy.hp;
  dispatch(state, { type: 'PLAY_TACTIC', playerId: 'WEI', payload: { cardInstanceId: tactic.instanceId } });
  assert.equal(enemy.provisions, 2);
  assert.equal(player.provisions, 6);
  assert.equal(enemy.hp, oldHp - 3);
});

test('custom counter reacts once to an enemy action and moves to discard', () => {
  const state = createInitialState({ phase: 'ACTION' });
  setupGame(state);
  state.phase = 'ACTION';
  state.activePlayer = 'SHU';
  const counter = createCard(normalizeCardPack({ schemaVersion: 1, cards: [card({
    id: 'custom_counter', faction: 'WEI', name: '暗箭', type: 'COUNTER',
    abilities: [{ trigger: 'ON_ENEMY_ACTION', effects: [{ type: 'DAMAGE_HQ', amount: 2, target: 'OPPONENT' }] }]
  })] }).cards[0]);
  state.activeCounters.push({ id: 'c1', owner: 'WEI', cardDef: counter, name: counter.name, isRevealed: false });
  const targetHp = state.players.SHU.hp;
  dispatch(state, { type: 'END_TURN', playerId: 'SHU', payload: {} });
  assert.equal(state.players.SHU.hp, targetHp);
  state.activePlayer = 'SHU';
  state.phase = 'ACTION';
  const unit = createCard({ cardId: 'sample', name: '测试步兵', faction: 'SHU', type: 'UNIT', cost: 0 });
  state.players.SHU.hand.push(unit);
  dispatch(state, { type: 'DEPLOY', playerId: 'SHU', payload: { cardInstanceId: unit.instanceId, targetZone: 'SUPPORT' } });
  assert.equal(state.players.SHU.hp, targetHp - 2);
  assert.equal(state.activeCounters.length, 0);
  assert.ok(state.players.WEI.discard.some(c => c.instanceId === counter.instanceId));
});

test('turn-start ability fires after the next player begins their turn', () => {
  const state = createInitialState({ phase: 'ACTION' });
  setupGame(state);
  state.phase = 'ACTION';
  state.activePlayer = 'SHU';
  const unit = createCard(normalizeCardPack({ schemaVersion: 1, cards: [card({
    abilities: [{ trigger: 'ON_TURN_START', effects: [{ type: 'GAIN_PRESTIGE', target: 'OWNER', amount: 1 }] }]
  })] }).cards[0]);
  state.battlefield.support.WEI.slots.push(unit);
  dispatch(state, { type: 'END_TURN', playerId: 'SHU', payload: {} });
  assert.equal(state.activePlayer, 'WEI');
  assert.equal(state.players.WEI.prestige, 1);
});
