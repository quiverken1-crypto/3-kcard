import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnClock } from '../js/ui/turnClock.js';
import { createInitialState, setupGame, startTurn } from '../js/engine/state.js';
import { dispatch } from '../js/engine/rulesEngine.js';
import { HostSyncManager } from '../js/network/syncProtocol.js';
import { AppCoordinator, APP_MODE } from '../js/main.js';

test('40s step clock and 80s turn clock', () => {
  let now = 1000;
  let expired = 0;
  const clock = new TurnClock({ now: () => now, onExpire: () => expired++ });
  clock.start();
  assert.equal(clock.remainingSeconds(), 40);
  assert.equal(clock.totalRemainingSeconds(), 80);
  now = 40999; clock.tick();
  assert.equal(expired, 0);
  // 行动后只重置单步
  clock.restartStep();
  assert.equal(clock.remainingSeconds(), 40);
  assert.equal(clock.totalRemainingSeconds(), 41);
  assert.equal(clock.isTotalWarning(), false);
  now = 51000;
  assert.equal(clock.isTotalWarning(), true);
  clock.restartStep();
  // 总时间比单步先到
  assert.equal(clock.remainingSeconds(), 30);
  now = 81000; clock.tick(); clock.tick();
  assert.equal(expired, 1);
  clock.start();
  assert.equal(clock.remainingSeconds(), 40);
  clock.stop();
  now = 999999; clock.tick();
  assert.equal(expired, 1);
});

test('an action from the timed-out former player is rejected after turn advance', () => {
  const state = createInitialState();
  setupGame(state);
  startTurn(state, 'WEI');
  const card = state.players.WEI.hand[0];
  dispatch(state, { type: 'END_TURN', playerId: 'WEI', payload: {} });
  assert.equal(state.activePlayer, 'SHU');
  const host = new HostSyncManager({ rulesEngine: { state, dispatch: action => dispatch(state, action) } });
  const result = host.dispatchAction({ type: 'DEPLOY', playerId: 'WEI', payload: { cardInstanceId: card.instanceId, targetZone: 'SUPPORT' } });
  assert.equal(result.success, false);
  assert.match(result.error, /active player/i);
});

test('only the authority submits a timeout end-turn action', () => {
  const calls = [];
  const app = Object.create(AppCoordinator.prototype);
  app.mode = APP_MODE.P2P_HOST;
  app.localPlayerId = 'WEI';
  app.getCurrentState = () => ({ phase: 'ACTION', activePlayer: 'SHU' });
  app.hostSync = { dispatchAction: action => { calls.push(action); return { success: true }; } };
  app._handleTurnTimeout();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].playerId, 'SHU');
  app.mode = APP_MODE.P2P_CLIENT;
  app._handleTurnTimeout();
  assert.equal(calls.length, 1);
});

test('mulligan timeout advances to the action phase through the host', () => {
  const actions = [];
  const app = Object.create(AppCoordinator.prototype);
  app.mode = APP_MODE.P2P_HOST;
  app.getCurrentState = () => ({ phase: 'MULLIGAN', firstPlayer: 'WEI' });
  app.hostSync = { dispatchAction: action => actions.push(action) };
  app._handleTurnTimeout();
  assert.equal(actions[0].type, 'MULLIGAN');
  assert.deepEqual(actions[0].payload.cardIndices, []);
});
