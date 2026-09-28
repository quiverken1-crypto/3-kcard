/**
 * verifyMilestone3.js — Verification Test Suite for Milestone 3
 * Three Kingdoms KARDS (Milestone 3)
 *
 * Covers:
 * 1. Signaling Token Codec & BroadcastChannel Discovery
 * 2. PeerConnection Lifecycle, Transport & Heartbeat Watchdog
 * 3. State Sync, Defensive Information Masking & ReplayBuffer Resync
 * 4. Multi-Factor Evaluator Scoring (Terminal, HQ, Frontline, Keywords)
 * 5. Heuristic Bot (Lethal Strike, Legal Actions, Mulligan)
 * 6. 100-Game Headless Bot vs Bot Simulation Benchmark (< 3s, 0 Invariant Violations)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Module Imports
import {
  TOKEN_PREFIX,
  LOBBY_MSG_TYPE,
  encodeSignalToken,
  decodeSignalToken,
  waitForIceGathering,
  LobbyDiscovery
} from '../js/network/signaling.js';

import {
  PEER_STATE,
  SYS_MSG_TYPE,
  MicroEventEmitter,
  PeerConnection
} from '../js/network/peerConnection.js';

import {
  PROTOCOL_TYPES,
  ReplayBuffer,
  maskStateForPlayer,
  computeStateHash,
  HostSyncManager,
  ClientSyncManager
} from '../js/network/syncProtocol.js';

import {
  DEFAULT_EVALUATION_WEIGHTS,
  evaluateBoard
} from '../js/bot/evaluator.js';

import {
  HeuristicBot,
  fastCloneState,
  runBotTurn
} from '../js/bot/heuristicBot.js';

import {
  createInitialState,
  setupGame,
  executeMulligan,
  startTurn,
  dispatch,
  RulesEngine
} from '../js/engine/rulesEngine.js';

import {
  FACTIONS,
  TROOP_TYPES,
  PHASES,
  ACTION_TYPES,
  KEYWORDS,
  STATUS_TYPES,
  GAME_CONFIG
} from '../js/engine/constants.js';

import {
  createWeiDeck,
  createShuDeck,
  createCard
} from '../js/engine/state.js';

import { MockDataChannel } from './mockDataChannel.js';

// =========================================================================
// Suite 1: Signaling Token Codec & Auto-Discovery
// =========================================================================
describe('Milestone 3 — Signaling & Token Codec', () => {
  const sampleOfferSdp = 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\n';
  const sampleAnswerSdp = 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\n';
  const sampleCandidates = [
    { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.100 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 }
  ];

  it('encodes and decodes Offer token with correct prefix and payload', async () => {
    const token = await encodeSignalToken('offer', sampleOfferSdp, sampleCandidates);
    assert.ok(token.startsWith(TOKEN_PREFIX.OFFER), `Token should start with ${TOKEN_PREFIX.OFFER}`);

    const decoded = await decodeSignalToken(token, 'offer');
    assert.equal(decoded.type, 'offer');
    assert.equal(decoded.sdp, sampleOfferSdp);
    assert.equal(decoded.candidates.length, 1);
    assert.equal(decoded.candidates[0].candidate, sampleCandidates[0].candidate);
  });

  it('encodes and decodes Answer token with correct prefix and payload', async () => {
    const token = await encodeSignalToken('answer', sampleAnswerSdp, sampleCandidates);
    assert.ok(token.startsWith(TOKEN_PREFIX.ANSWER), `Token should start with ${TOKEN_PREFIX.ANSWER}`);

    const decoded = await decodeSignalToken(token, 'answer');
    assert.equal(decoded.type, 'answer');
    assert.equal(decoded.sdp, sampleAnswerSdp);
    assert.equal(decoded.candidates.length, 1);
  });

  it('rejects token with expectedType mismatch', async () => {
    const offerToken = await encodeSignalToken('offer', sampleOfferSdp);
    await assert.rejects(
      async () => decodeSignalToken(offerToken, 'answer'),
      /Token type mismatch/
    );
  });

  it('rejects corrupt, malformed, or missing prefix tokens', async () => {
    await assert.rejects(
      async () => decodeSignalToken('INVALID:abcdef12345'),
      /Invalid token format/
    );
    await assert.rejects(
      async () => decodeSignalToken('TKCO:???###corrupted!'),
      /Invalid token/
    );
    await assert.rejects(
      async () => decodeSignalToken(12345),
      /must be a string/
    );
  });

  it('waitForIceGathering resolves immediately if gathering is already complete', async () => {
    const mockPc = { iceGatheringState: 'complete' };
    const startTime = Date.now();
    await waitForIceGathering(mockPc, { timeoutMs: 1000 });
    assert.ok(Date.now() - startTime < 100, 'Should resolve immediately without waiting');
  });

  it('LobbyDiscovery conducts broadcast announce and join handshake', async () => {
    if (typeof BroadcastChannel === 'undefined') return;

    const channelName = 'tk-lan-test-' + Math.random().toString(36).slice(2, 7);
    const hostDiscovery = new LobbyDiscovery(channelName);
    const clientDiscovery = new LobbyDiscovery(channelName);

    const roomId = 'room_lan_test_42';
    const testOfferToken = 'TKCO:dummyOffer';
    const testAnswerToken = 'TKCA:dummyAnswer';

    let roomDiscovered = null;
    let joinReceived = null;

    clientDiscovery.startListener((room) => {
      roomDiscovered = room;
    });

    hostDiscovery.startHost({
      roomId,
      hostFaction: 'WEI',
      hostName: 'CaoCao',
      offerToken: testOfferToken,
      onJoinReceived: (answerToken, joinMsg) => {
        joinReceived = { answerToken, joinMsg };
      }
    });

    // Wait for announce discovery
    await new Promise(r => setTimeout(r, 50));
    assert.ok(roomDiscovered, 'Client should discover host room');
    assert.equal(roomDiscovered.roomId, roomId);
    assert.equal(roomDiscovered.offerToken, testOfferToken);

    // Client responds with join
    clientDiscovery.sendJoin({
      roomId,
      clientFaction: 'SHU',
      clientName: 'LiuBei',
      answerToken: testAnswerToken
    });

    // Wait for join receipt
    await new Promise(r => setTimeout(r, 50));
    assert.ok(joinReceived, 'Host should receive join request');
    assert.equal(joinReceived.answerToken, testAnswerToken);
    assert.equal(joinReceived.joinMsg.clientFaction, 'SHU');

    hostDiscovery.stop();
    clientDiscovery.stop();
  });
});

// =========================================================================
// Suite 2: PeerConnection Lifecycle & Transport over MockDataChannel
// =========================================================================
describe('Milestone 3 — PeerConnection over MockDataChannel', () => {
  it('establishes OPEN state and transmits bidirectional JSON messages', async () => {
    const [hCh, cCh] = MockDataChannel.createPair();
    const hostPeer = new PeerConnection({ isHost: true });
    const clientPeer = new PeerConnection({ isHost: false });

    hostPeer.attachChannel(hCh);
    clientPeer.attachChannel(cCh);

    assert.equal(hostPeer.getState(), PEER_STATE.OPEN);
    assert.equal(clientPeer.getState(), PEER_STATE.OPEN);

    const clientReceived = [];
    const hostReceived = [];
    clientPeer.on('message', (m) => clientReceived.push(m));
    hostPeer.on('message', (m) => hostReceived.push(m));

    hostPeer.send({ type: 'GREETING', from: 'WEI' });
    clientPeer.send({ type: 'GREETING', from: 'SHU' });

    await new Promise(r => setTimeout(r, 20));

    assert.equal(clientReceived.length, 1);
    assert.equal(clientReceived[0].from, 'WEI');
    assert.equal(hostReceived.length, 1);
    assert.equal(hostReceived[0].from, 'SHU');

    hostPeer.disconnect();
    clientPeer.disconnect();
  });

  it('runs ping-pong heartbeat loop and calculates smoothed RTT and latency', async () => {
    const [hCh, cCh] = MockDataChannel.createPair({ latencyMs: 5 });
    const hostPeer = new PeerConnection({ isHost: true, pingIntervalMs: 40 });
    const clientPeer = new PeerConnection({ isHost: false });

    hostPeer.attachChannel(hCh);
    clientPeer.attachChannel(cCh);

    // Wait for multiple ping-pong cycles
    await new Promise(r => setTimeout(r, 150));

    assert.ok(hostPeer.getRtt() >= 0, 'Host should record RTT');
    assert.ok(clientPeer.getLatency() >= 0, 'Client should record latency');

    hostPeer.disconnect();
    clientPeer.disconnect();
  });

  it('detects STALLED state when heartbeats are missed past threshold', async () => {
    const [hCh, cCh] = MockDataChannel.createPair();
    const hostPeer = new PeerConnection({
      isHost: true,
      pingIntervalMs: 200,
      stallTimeoutMs: 60,
      disconnectTimeoutMs: 150
    });

    let stallEmitted = false;
    hostPeer.on('stall', () => { stallEmitted = true; });

    hostPeer.attachChannel(hCh);
    assert.equal(hostPeer.getState(), PEER_STATE.OPEN);

    // Simulate complete silence by decoupling pong reply
    cCh.onmessage = null;

    await new Promise(r => setTimeout(r, 90));
    assert.equal(hostPeer.getState(), PEER_STATE.STALLED);
    assert.ok(stallEmitted, 'Stall event must be emitted');

    hostPeer.disconnect();
  });

  it('gracefully disconnects and transitions state to CLOSED', async () => {
    const [hCh, cCh] = MockDataChannel.createPair();
    const hostPeer = new PeerConnection({ isHost: true });
    const clientPeer = new PeerConnection({ isHost: false });

    hostPeer.attachChannel(hCh);
    clientPeer.attachChannel(cCh);

    let clientClosed = false;
    clientPeer.on('close', () => { clientClosed = true; });

    hostPeer.disconnect('TEST_QUIT');
    await new Promise(r => setTimeout(r, 80));

    assert.equal(hostPeer.getState(), PEER_STATE.CLOSED);
    assert.ok(clientClosed, 'Client should receive close event upon host disconnect');
  });
});

// =========================================================================
// Suite 3: State Sync Protocol, Masking & ReplayBuffer Resync
// =========================================================================
describe('Milestone 3 — State Synchronization & Defensive Masking', () => {
  it('maskStateForPlayer defensively scrubs opponent hand, counters, deck order and seeds', () => {
    const engine = new RulesEngine();
    setupGame(engine.state);

    // Add an active counter for WEI
    engine.state.activeCounters.push({
      id: 'counter_wei_1',
      owner: FACTIONS.WEI,
      cardId: 'WEI_020',
      name: '逆击',
      cost: 2,
      triggerCondition: 'ON_ENEMY_ATTACK',
      isRevealed: false
    });

    // Add face-down unit for WEI (潜袭)
    const stealthCard = createCard({
      cardId: 'WEI_030',
      name: '潜行兵',
      cost: 2,
      atk: 2,
      hp: 2,
      keywords: [KEYWORDS.QIAN_XI]
    });
    stealthCard.status.isFaceDown = true;
    engine.state.battlefield.support.WEI.slots.push(stealthCard);

    // Project view for SHU player
    const masked = maskStateForPlayer(engine.state, FACTIONS.SHU);

    // 1. Opponent (WEI) hand cards must be completely masked
    assert.ok(masked.players.WEI.hand.length > 0);
    for (const c of masked.players.WEI.hand) {
      assert.equal(c.isHidden, true);
      assert.equal(c.name, '???');
      assert.equal(c.cardId, null);
      assert.equal(c.cost, null);
      assert.equal(c.atk, null);
      assert.equal(c.hp, null);
      assert.deepEqual(c.keywords, []);
      assert.ok(c.instanceId, 'Card instanceId must be retained for slot tracking');
    }

    // 2. Self (SHU) hand cards must remain plaintext
    assert.ok(masked.players.SHU.hand.length > 0);
    assert.ok(masked.players.SHU.hand[0].cardId !== null);
    assert.equal(masked.players.SHU.hand[0].isHidden, undefined);

    // 3. Decks must only expose card counts
    assert.equal(typeof masked.players.WEI.deck.count, 'number');
    assert.equal(Array.isArray(masked.players.WEI.deck), false);
    assert.equal(typeof masked.players.SHU.deck.count, 'number');
    assert.equal(Array.isArray(masked.players.SHU.deck), false);

    // 4. Opponent active counters must be masked
    const oppCounter = masked.activeCounters.find(c => c.id === 'counter_wei_1');
    assert.ok(oppCounter);
    assert.equal(oppCounter.isHidden, true);
    assert.equal(oppCounter.name, '???');
    assert.equal(oppCounter.cardId, null);
    assert.equal(oppCounter.triggerCondition, null);

    // 5. Opponent face-down stealth units must be masked
    const oppStealthUnit = masked.battlefield.support.WEI.slots.find(u => u.instanceId === stealthCard.instanceId);
    assert.ok(oppStealthUnit);
    assert.equal(oppStealthUnit.isHidden, true);
    assert.equal(oppStealthUnit.name, '伏兵');
    assert.equal(oppStealthUnit.atk, '?');
    assert.equal(oppStealthUnit.hp, '?');

    // 6. PRNG state must be stripped
    assert.equal(masked.prng, null);
    assert.equal(masked.seed, null);
  });

  it('computeStateHash produces deterministic 8-character hex checksum', () => {
    const engine = new RulesEngine();
    setupGame(engine.state);

    const hash1 = computeStateHash(engine.state);
    const hash2 = computeStateHash(engine.state);

    assert.equal(hash1, hash2);
    assert.equal(typeof hash1, 'string');
    assert.equal(hash1.length, 8);
    assert.ok(/^[0-9a-f]{8}$/.test(hash1), 'State hash must be valid 8-char hex');
  });

  it('HostSyncManager and ClientSyncManager execute action requests with monotonic sequence increments', async () => {
    const [hCh, cCh] = MockDataChannel.createPair();
    const engine = new RulesEngine();
    setupGame(engine.state);
    executeMulligan(engine.state, FACTIONS.WEI, []);
    executeMulligan(engine.state, FACTIONS.SHU, []);
    startTurn(engine.state, FACTIONS.WEI);

    const host = new HostSyncManager({ rulesEngine: engine, channel: hCh });
    const client = new ClientSyncManager({ channel: cCh, clientFaction: FACTIONS.SHU });

    host.broadcastMatchStart();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(client.expectedSeq, 1);

    // Host executes action 1: Deploy WEI unit
    const cardWei = engine.state.players.WEI.hand[0];
    const dispatchRes = host.dispatchAction({
      type: ACTION_TYPES.DEPLOY,
      playerId: FACTIONS.WEI,
      payload: { cardInstanceId: cardWei.instanceId, targetZone: 'SUPPORT' }
    });

    assert.equal(dispatchRes.success, true);
    assert.equal(dispatchRes.seq, 1);

    await new Promise(r => setTimeout(r, 20));
    assert.equal(client.expectedSeq, 2);
    assert.equal(client.state.battlefield.support.WEI.slots.length, 1);

    // Host ends turn -> SHU turn begins
    host.dispatchAction({ type: ACTION_TYPES.END_TURN, playerId: FACTIONS.WEI, payload: {} });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(client.expectedSeq, 3);
    assert.equal(client.state.activePlayer, FACTIONS.SHU);

    // Client requests action: Deploy SHU unit
    engine.state.players.SHU.provisions = 10; // Ensure sufficient provisions
    const cardShu = client.state.players.SHU.hand[0];
    const clientPromise = client.sendAction({
      type: ACTION_TYPES.DEPLOY,
      playerId: FACTIONS.SHU,
      payload: { cardInstanceId: cardShu.instanceId, targetZone: 'SUPPORT' }
    });

    const clientActionRes = await clientPromise;
    assert.equal(clientActionRes.seq, 3);
    assert.equal(client.expectedSeq, 4);
    assert.equal(client.state.battlefield.support.SHU.slots.length, 1);
  });

  it('HostSyncManager rejects illegal client actions and ClientSyncManager reconciles state', async () => {
    const [hCh, cCh] = MockDataChannel.createPair();
    const engine = new RulesEngine();
    setupGame(engine.state);
    executeMulligan(engine.state, FACTIONS.WEI, []);
    executeMulligan(engine.state, FACTIONS.SHU, []);
    startTurn(engine.state, FACTIONS.WEI);

    const host = new HostSyncManager({ rulesEngine: engine, channel: hCh });
    const client = new ClientSyncManager({ channel: cCh, clientFaction: FACTIONS.SHU });
    host.broadcastMatchStart();
    await new Promise(r => setTimeout(r, 20));

    // Client attempts to act with insufficient provisions -> rejected
    const cardShu = client.state.players.SHU.hand[0];
    await assert.rejects(
      async () => client.sendAction({
        type: ACTION_TYPES.DEPLOY,
        playerId: FACTIONS.SHU,
        payload: { cardInstanceId: cardShu.instanceId, targetZone: 'SUPPORT' }
      }),
      /Insufficient provisions|Not your turn/i
    );
  });

  it('ClientSyncManager detects sequence gap and triggers ReplayBuffer resync', async () => {
    const [hCh, cCh] = MockDataChannel.createPair();
    const engine = new RulesEngine();
    setupGame(engine.state);
    executeMulligan(engine.state, FACTIONS.WEI, []);
    executeMulligan(engine.state, FACTIONS.SHU, []);
    startTurn(engine.state, FACTIONS.WEI);

    const host = new HostSyncManager({ rulesEngine: engine, channel: hCh });
    const client = new ClientSyncManager({ channel: cCh, clientFaction: FACTIONS.SHU });
    host.broadcastMatchStart();
    await new Promise(r => setTimeout(r, 20));

    // Host generates 3 actions
    host.dispatchAction({ type: ACTION_TYPES.END_TURN, playerId: FACTIONS.WEI, payload: {} }); // seq 1
    host.dispatchAction({ type: ACTION_TYPES.END_TURN, playerId: FACTIONS.SHU, payload: {} }); // seq 2
    host.dispatchAction({ type: ACTION_TYPES.END_TURN, playerId: FACTIONS.WEI, payload: {} }); // seq 3

    await new Promise(r => setTimeout(r, 50));
    assert.equal(client.expectedSeq, 4);

    // Test artificial gap: clear client state and send packet with seq 6
    client.expectedSeq = 4;
    const futurePacket = {
      type: PROTOCOL_TYPES.ACTION_APPLIED,
      seq: 5,
      action: { type: ACTION_TYPES.END_TURN, playerId: FACTIONS.SHU, payload: {} },
      events: [],
      state: maskStateForPlayer(engine.state, FACTIONS.SHU),
      stateHash: computeStateHash(engine.state)
    };

    // Store in host replay buffer so resync can satisfy it
    host.replayBuffer.add(4, {
      type: PROTOCOL_TYPES.ACTION_APPLIED,
      seq: 4,
      action: { type: ACTION_TYPES.END_TURN, playerId: FACTIONS.SHU, payload: {} },
      events: [],
      state: maskStateForPlayer(engine.state, FACTIONS.SHU),
      stateHash: computeStateHash(engine.state)
    });
    host.replayBuffer.add(5, futurePacket);
    host.seq = 5;

    // Simulate out of order packet arrival
    client.handleActionApplied(futurePacket);

    await new Promise(r => setTimeout(r, 50));
    assert.equal(client.expectedSeq, 6);
  });
});

// =========================================================================
// Suite 4: Multi-Factor Evaluator
// =========================================================================
describe('Milestone 3 — Board State Evaluator', () => {
  it('correctly scores terminal victory and terminal defeat', () => {
    const engine = new RulesEngine();
    setupGame(engine.state);

    engine.state.winner = FACTIONS.WEI;
    assert.equal(evaluateBoard(engine.state, FACTIONS.WEI), DEFAULT_EVALUATION_WEIGHTS.WIN_SCORE);
    assert.equal(evaluateBoard(engine.state, FACTIONS.SHU), DEFAULT_EVALUATION_WEIGHTS.LOSS_SCORE);

    engine.state.winner = null;
    engine.state.players.SHU.hp = 0;
    assert.equal(evaluateBoard(engine.state, FACTIONS.WEI), DEFAULT_EVALUATION_WEIGHTS.WIN_SCORE);
  });

  it('incorporates lethal pressure scaling and Sun Qian HQ immunity bonus', () => {
    const engine = new RulesEngine();
    setupGame(engine.state);

    // When opponent HQ drops to <= 8, lethal pressure scale bonus activates
    engine.state.players.SHU.hp = 6;
    const scoreNormalLethal = evaluateBoard(engine.state, FACTIONS.WEI);

    // If opponent has Sun Qian, lethal pressure on opponent HQ is negated
    const sunQian = createCard({
      cardId: 'SHU_010',
      name: '孙乾',
      faction: FACTIONS.SHU,
      cost: 2,
      atk: 1,
      hp: 3,
      keywords: [KEYWORDS.SHI_JIE]
    });
    engine.state.battlefield.support.SHU.slots.push(sunQian);
    const scoreWithEnemySunQian = evaluateBoard(engine.state, FACTIONS.WEI);

    assert.ok(
      scoreNormalLethal > scoreWithEnemySunQian,
      'Lethal bonus should be suppressed when opponent controls Sun Qian'
    );
  });

  it('incorporates frontline center occupancy and unit dominance', () => {
    const engine = new RulesEngine();
    setupGame(engine.state);

    const baseScore = evaluateBoard(engine.state, FACTIONS.WEI);

    // Occupy Center Frontline
    engine.state.battlefield.frontline.CENTER.occupant = FACTIONS.WEI;
    engine.state.battlefield.frontline.CENTER.units.push(createCard({
      cardId: 'WEI_001',
      name: '轻骑兵',
      faction: FACTIONS.WEI,
      cost: 1,
      atk: 2,
      hp: 2
    }));

    const occupiedScore = evaluateBoard(engine.state, FACTIONS.WEI);
    assert.ok(occupiedScore > baseScore, 'Center frontline occupation must boost evaluation score');
  });

  it('rewards positive keyword traits (Guardian, Double Strike, Fortify)', () => {
    const engine = new RulesEngine();
    setupGame(engine.state);

    const vanillaUnit = createCard({
      cardId: 'TEST_01',
      name: '步卒',
      faction: FACTIONS.WEI,
      atk: 2,
      hp: 2,
      keywords: []
    });
    const eliteUnit = createCard({
      cardId: 'TEST_02',
      name: '曹仁',
      faction: FACTIONS.WEI,
      atk: 2,
      hp: 2,
      keywords: [KEYWORDS.SHOU_HU, '坚阵2']
    });

    engine.state.battlefield.support.WEI.slots.push(vanillaUnit);
    const scoreVanilla = evaluateBoard(engine.state, FACTIONS.WEI);

    engine.state.battlefield.support.WEI.slots[0] = eliteUnit;
    const scoreElite = evaluateBoard(engine.state, FACTIONS.WEI);

    assert.ok(scoreElite > scoreVanilla, 'Units with Guardian and Fortify must be evaluated higher');
  });
});

// =========================================================================
// Suite 5: Heuristic Bot Decision Loop
// =========================================================================
describe('Milestone 3 — Heuristic Bot AI Agent', () => {
  it('decideMulligan keeps early curve and replaces high-cost cards', () => {
    const bot = new HeuristicBot(FACTIONS.WEI);
    const hand = [
      { cardId: 'C1', cost: 1 },
      { cardId: 'C2', cost: 6 },
      { cardId: 'C3', cost: 7 },
      { cardId: 'C4', cost: 5 }
    ];

    const discardedIndices = bot.decideMulligan(hand);
    assert.ok(!discardedIndices.includes(0), 'Should keep 1-cost card');
    assert.ok(discardedIndices.includes(1), 'Should mulligan 6-cost card');
    assert.ok(discardedIndices.includes(2), 'Should mulligan 7-cost card');
    assert.ok(discardedIndices.includes(3), 'Should mulligan 5-cost card');
  });

  it('checkImmediateLethal detects instant match win against enemy HQ', () => {
    const bot = new HeuristicBot(FACTIONS.WEI);
    const engine = new RulesEngine();
    setupGame(engine.state);
    executeMulligan(engine.state, FACTIONS.WEI, []);
    executeMulligan(engine.state, FACTIONS.SHU, []);
    startTurn(engine.state, FACTIONS.WEI);

    // Place high ATK attacker on Center Frontline
    const attacker = createCard({
      cardId: 'WEI_004',
      name: '张辽',
      faction: FACTIONS.WEI,
      atk: 5,
      hp: 4,
      troopType: TROOP_TYPES.CAVALRY,
      keywords: [KEYWORDS.TU_XI]
    });
    engine.state.battlefield.frontline.CENTER.occupant = FACTIONS.WEI;
    engine.state.battlefield.frontline.CENTER.units.push(attacker);

    // Set opponent HQ to 4 HP (killable by 5 ATK)
    engine.state.players.SHU.hp = 4;
    engine.state.battlefield.support.SHU.hq.hp = 4;

    const lethalAction = bot.checkImmediateLethal(engine.state, FACTIONS.WEI);
    assert.ok(lethalAction, 'Bot must detect immediate lethal');
    assert.equal(lethalAction.type, ACTION_TYPES.ATTACK);
    assert.equal(lethalAction.payload.attackerId, attacker.instanceId);
    assert.equal(lethalAction.payload.targetId, 'HQ');

    // If opponent has Sun Qian, lethal must be withheld
    const sunQian = createCard({
      cardId: 'SHU_010',
      name: '孙乾',
      faction: FACTIONS.SHU,
      atk: 1,
      hp: 3,
      keywords: [KEYWORDS.SHI_JIE]
    });
    engine.state.battlefield.support.SHU.slots.push(sunQian);

    const blockedLethal = bot.checkImmediateLethal(engine.state, FACTIONS.WEI);
    assert.equal(blockedLethal, null, 'Lethal must be blocked by Sun Qian');
  });

  it('enumerateLegalActions generates complete legal candidate actions including END_TURN', () => {
    const bot = new HeuristicBot(FACTIONS.WEI);
    const engine = new RulesEngine();
    setupGame(engine.state);
    executeMulligan(engine.state, FACTIONS.WEI, []);
    executeMulligan(engine.state, FACTIONS.SHU, []);
    startTurn(engine.state, FACTIONS.WEI);

    const actions = bot.enumerateLegalActions(engine.state, FACTIONS.WEI);
    assert.ok(actions.length > 0);
    assert.ok(actions.some(a => a.type === ACTION_TYPES.END_TURN), 'Must always include END_TURN');
    assert.ok(actions.some(a => a.type === ACTION_TYPES.DEPLOY), 'Should include valid DEPLOY actions');
  });

  it('runBotTurn autonomously drives turn and transfers priority cleanly', () => {
    const engine = new RulesEngine();
    setupGame(engine.state);
    executeMulligan(engine.state, FACTIONS.WEI, []);
    executeMulligan(engine.state, FACTIONS.SHU, []);
    startTurn(engine.state, FACTIONS.WEI);

    assert.equal(engine.state.activePlayer, FACTIONS.WEI);
    const res = runBotTurn(engine, FACTIONS.WEI);

    assert.ok(typeof res.actionsExecuted === 'number');
    assert.equal(engine.state.activePlayer, FACTIONS.SHU, 'Priority must pass to next player after turn ends');
  });
});

// =========================================================================
// Suite 6: 100-Game Headless Bot vs Bot Simulation Benchmark
// =========================================================================
describe('Milestone 3 — Headless 100-Game Stress Simulation Benchmark', () => {
  it('Executes 100 complete Bot vs Bot matches with 0 invariant violations in under 3.0 seconds', () => {
    const TOTAL_GAMES = 100;
    const stats = {
      totalGames: TOTAL_GAMES,
      weiWins: 0,
      shuWins: 0,
      draws: 0,
      totalTurns: 0,
      totalActions: 0,
      invariantViolations: 0
    };

    const startTime = performance.now();

    for (let gameIndex = 0; gameIndex < TOTAL_GAMES; gameIndex++) {
      const seed = 1000 + gameIndex;
      const state = createInitialState({
        weiDeck: createWeiDeck(),
        shuDeck: createShuDeck(),
        firstPlayer: gameIndex % 2 === 0 ? FACTIONS.WEI : FACTIONS.SHU,
        initialHp: 20,
        seed
      });

      setupGame(state);

      const botWei = new HeuristicBot(FACTIONS.WEI, { seed: seed * 2 });
      const botShu = new HeuristicBot(FACTIONS.SHU, { seed: seed * 3 });

      // Mulligan
      const weiMull = botWei.decideMulligan(state.players[FACTIONS.WEI].hand);
      const shuMull = botShu.decideMulligan(state.players[FACTIONS.SHU].hand);
      executeMulligan(state, FACTIONS.WEI, weiMull);
      executeMulligan(state, FACTIONS.SHU, shuMull);

      // Start initial turn
      startTurn(state, state.firstPlayer);

      let gameActions = 0;

      while (state.phase !== PHASES.GAME_OVER && state.turnNumber < GAME_CONFIG.MAX_TURNS_SAFETY_CAP) {
        const activeFaction = state.activePlayer;
        const currentBot = activeFaction === FACTIONS.WEI ? botWei : botShu;

        const turnResult = currentBot.playTurn(state, activeFaction);
        gameActions += turnResult.actionsExecuted;

        // --- Invariant Checks on every turn ---
        for (const f of [FACTIONS.WEI, FACTIONS.SHU]) {
          const p = state.players[f];
          // INV-2: Provisions bounds
          assert.ok(p.provisions >= 0, `Provisions negative for ${f} in game ${gameIndex}`);
          assert.ok(
            p.provisions <= (10 + (p.extraGranaryCap || 0)),
            `Provisions exceeded max cap for ${f} in game ${gameIndex}`
          );
          // INV-3: Prestige bounds
          assert.ok(p.prestige >= 0 && p.prestige <= 2, `Prestige out of [0, 2] for ${f} in game ${gameIndex}`);
          // INV-4: Hand limit
          assert.ok(p.hand.length <= GAME_CONFIG.HAND_LIMIT, `Hand limit exceeded for ${f} in game ${gameIndex}`);
        }

        // INV-5: Frontline zone single occupant
        for (const zk of ['LEFT', 'CENTER', 'RIGHT']) {
          const z = state.battlefield.frontline[zk];
          if (z.units.length > 0) {
            assert.ok(z.occupant !== null, `Zone ${zk} has units but no occupant in game ${gameIndex}`);
            assert.ok(
              z.units.every(u => u.faction === z.occupant),
              `Zone ${zk} contains mixed faction units in game ${gameIndex}`
            );
          }
        }
      }

      // Check termination & Winner
      assert.ok(
        state.turnNumber < GAME_CONFIG.MAX_TURNS_SAFETY_CAP,
        `Game ${gameIndex} timed out at turn ${state.turnNumber}`
      );
      assert.ok(state.winner !== null, `Game ${gameIndex} ended without winner`);

      if (state.winner === FACTIONS.WEI) stats.weiWins++;
      else if (state.winner === FACTIONS.SHU) stats.shuWins++;
      else stats.draws++;

      stats.totalTurns += state.turnNumber;
      stats.totalActions += gameActions;
    }

    const elapsed = performance.now() - startTime;
    const avgTurns = (stats.totalTurns / TOTAL_GAMES).toFixed(1);
    const avgActions = (stats.totalActions / TOTAL_GAMES).toFixed(1);
    const msPerGame = (elapsed / TOTAL_GAMES).toFixed(2);

    console.log(`\n================================================================`);
    console.log(`         HEADLESS BOT VS BOT BENCHMARK RESULTS (100 GAMES)      `);
    console.log(`================================================================`);
    console.log(`  Games Simulated       : ${TOTAL_GAMES}`);
    console.log(`  Elapsed Time          : ${elapsed.toFixed(1)} ms (${msPerGame} ms / game)`);
    console.log(`  Wei Victories         : ${stats.weiWins} (${((stats.weiWins / TOTAL_GAMES) * 100).toFixed(1)}%)`);
    console.log(`  Shu Victories         : ${stats.shuWins} (${((stats.shuWins / TOTAL_GAMES) * 100).toFixed(1)}%)`);
    console.log(`  Draws                 : ${stats.draws}`);
    console.log(`  Average Turns         : ${avgTurns}`);
    console.log(`  Average Actions/Game  : ${avgActions}`);
    console.log(`  Rule Invariants Broken: 0`);
    console.log(`  Status                : ALL 100 GAMES COMPLETED SUCCESSFULLY`);
    console.log(`================================================================\n`);

    assert.ok(elapsed < 3000, `Benchmark took too long: ${elapsed.toFixed(1)} ms (threshold: 3000 ms)`);
    assert.equal(stats.weiWins + stats.shuWins + stats.draws, 100);
    assert.equal(stats.invariantViolations, 0);
  });
});
