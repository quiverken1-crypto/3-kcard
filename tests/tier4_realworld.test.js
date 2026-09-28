/**
 * tier4_realworld.test.js
 * Tier 4: Realistic Full Game Simulations Test Suite.
 * Simulates complete end-to-end games under realistic conditions:
 * - Simulation A: Wei Preset 40-Card vs Shu Preset 40-Card Match to Victory (HP <= 0).
 * - Simulation B: Attrition & Fatigue Escalation Deathmatch (Deck Exhaustion).
 * - Simulation C: Virtual WebRTC P2P DataChannel Host-Authoritative Synchronization.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  createCard,
  createWeiDeck,
  createShuDeck,
  setupGame,
  executeMulligan,
  startTurn,
  endTurn,
  dispatch,
  drawCard,
  projectStateForClient,
  FACTIONS,
  TROOP_TYPES
} from './testHarness.js';
import { MockDataChannel } from './mockDataChannel.js';

describe('Tier 4: Realistic Full Game Simulations', () => {

  // --------------------------------------------------------------------------
  // Simulation A: Standard Match Simulation (Wei 40-Card vs Shu 40-Card)
  // --------------------------------------------------------------------------
  it('Simulation A: Wei Preset 40-Card vs Shu Preset 40-Card Match Played to Victory', () => {
    const weiDeck = createWeiDeck();
    const shuDeck = createShuDeck();

    assert.equal(weiDeck.length, 40, 'Wei deck contains 40 cards');
    assert.equal(shuDeck.length, 40, 'Shu deck contains 40 cards');

    const state = createInitialState({
      weiDeck,
      shuDeck,
      firstPlayer: FACTIONS.WEI,
      weiHp: 20,
      shuHp: 20
    });

    // 1. Setup Phase & Initial Hands
    setupGame(state);
    assert.equal(state.phase, 'MULLIGAN');
    assert.equal(state.players[FACTIONS.WEI].hand.length, 4);
    assert.equal(state.players[FACTIONS.SHU].hand.length, 5);

    // 2. Mulligan Phase
    executeMulligan(state, FACTIONS.WEI, [0, 1]); // Wei redraws 2 cards
    executeMulligan(state, FACTIONS.SHU, [2]);    // Shu redraws 1 card
    assert.equal(state.players[FACTIONS.WEI].hand.length, 4);
    assert.equal(state.players[FACTIONS.SHU].hand.length, 5);

    // 3. Turn-by-Turn Game Playout Loop
    let maxTurns = 50;
    startTurn(state, FACTIONS.WEI);

    while (state.phase !== 'GAME_OVER' && maxTurns-- > 0) {
      const activeFaction = state.activePlayer;
      const player = state.players[activeFaction];
      const oppFaction = activeFaction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;

      // AI Decision Step 1: Deploy affordable units from hand to Support Line
      for (let i = player.hand.length - 1; i >= 0; i--) {
        const card = player.hand[i];
        if (card.type === 'UNIT') {
          let cost = card.cost;
          if (!player.prestigeDiscountUsed && player.prestige > 0) {
            cost = Math.max(0, cost - player.prestige);
          }
          const supportSlots = state.battlefield.support[activeFaction].slots;
          if (player.provisions >= cost && supportSlots.length < 4) {
            try {
              dispatch(state, {
                type: 'DEPLOY',
                playerId: activeFaction,
                payload: { cardInstanceId: card.instanceId, targetZone: 'SUPPORT' }
              });
            } catch (_) {
              // Ignore if illegal
            }
          }
        }
      }

      // AI Decision Step 2: Advance units from Support Line to empty Frontline zones
      const supportUnits = [...state.battlefield.support[activeFaction].slots];
      for (const u of supportUnits) {
        if (player.provisions >= u.actionCost && u.status.actionsUsed === 0) {
          for (const zoneKey of ['CENTER', 'LEFT', 'RIGHT']) {
            const flZone = state.battlefield.frontline[zoneKey];
            if ((flZone.occupant === null || flZone.occupant === activeFaction) && flZone.units.length < flZone.capacity) {
              try {
                dispatch(state, {
                  type: 'MOVE',
                  playerId: activeFaction,
                  payload: { cardInstanceId: u.instanceId, targetZone: `FRONTLINE_${zoneKey}` }
                });
                break;
              } catch (_) {}
            }
          }
        }
      }

      // AI Decision Step 3: Attack enemy units or enemy HQ from Frontline
      for (const zoneKey of ['CENTER', 'LEFT', 'RIGHT']) {
        const flZone = state.battlefield.frontline[zoneKey];
        if (flZone.occupant === activeFaction) {
          const zoneUnits = [...flZone.units];
          for (const u of zoneUnits) {
            if (player.provisions >= u.actionCost && !u.status.attackedThisTurn) {
              // Priority: attack enemy units in support line, or enemy HQ
              const oppSupport = state.battlefield.support[oppFaction].slots;
              if (oppSupport.length > 0) {
                const target = oppSupport[0];
                try {
                  dispatch(state, {
                    type: 'ATTACK',
                    playerId: activeFaction,
                    payload: { attackerId: u.instanceId, targetId: target.instanceId }
                  });
                } catch (_) {}
              } else {
                // Direct strike on Main City HQ
                try {
                  dispatch(state, {
                    type: 'ATTACK',
                    playerId: activeFaction,
                    payload: { attackerId: u.instanceId, targetId: 'HQ' }
                  });
                } catch (_) {}
              }
            }
            if (state.phase === 'GAME_OVER') break;
          }
        }
        if (state.phase === 'GAME_OVER') break;
      }

      // Step 4: End turn if game continues
      if (state.phase !== 'GAME_OVER') {
        endTurn(state);
      }
    }

    // Assertions for full match resolution
    assert.equal(state.phase, 'GAME_OVER', 'Match concluded with GAME_OVER state');
    assert.ok(state.winner === FACTIONS.WEI || state.winner === FACTIONS.SHU, 'Winner is valid faction');

    const winningPlayer = state.players[state.winner];
    const losingFaction = state.winner === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
    const losingPlayer = state.players[losingFaction];

    assert.ok(winningPlayer.hp > 0, `Winner ${state.winner} HQ HP > 0 (current: ${winningPlayer.hp})`);
    assert.ok(losingPlayer.hp <= 0, `Loser ${losingFaction} HQ HP <= 0 (current: ${losingPlayer.hp})`);
    assert.ok(state.turnNumber <= 50, `Game terminated within turn limit (turns: ${state.turnNumber})`);
  });

  // --------------------------------------------------------------------------
  // Simulation B: Attrition & Deck Exhaustion Fatigue Knockout
  // --------------------------------------------------------------------------
  it('Simulation B: Attrition & Fatigue Escalation Deathmatch (Deck Exhaustion)', () => {
    // Both players start with small decks of 5 cards to simulate deep endgame
    const smallWeiDeck = [
      createCard({ name: '魏盾兵', cost: 1 }),
      createCard({ name: '魏甲士', cost: 2 }),
      createCard({ name: '守备卫', cost: 2 }),
      createCard({ name: '斥候', cost: 1 }),
      createCard({ name: '轻骑', cost: 1 })
    ];
    const smallShuDeck = [
      createCard({ name: '蜀盾兵', faction: FACTIONS.SHU, cost: 1 }),
      createCard({ name: '蜀甲士', faction: FACTIONS.SHU, cost: 2 }),
      createCard({ name: '守备卫', faction: FACTIONS.SHU, cost: 2 }),
      createCard({ name: '斥候', faction: FACTIONS.SHU, cost: 1 }),
      createCard({ name: '轻骑', faction: FACTIONS.SHU, cost: 1 })
    ];

    const state = createInitialState({
      weiDeck: smallWeiDeck,
      shuDeck: smallShuDeck,
      firstPlayer: FACTIONS.WEI,
      weiHp: 15,
      shuHp: 10
    });

    // Run turns where both players draw and defend until deck runs dry
    setupGame(state); // draws 4 for Wei, 5 for Shu (Shu deck now 0, Wei deck now 1)

    startTurn(state, FACTIONS.WEI); // Turn 1 (P1 skips draw)
    endTurn(state);                 // Switch to Shu

    // Shu draws on empty deck -> Overdraw 1 (-1 dmg) -> Shu HP 9
    assert.equal(state.players[FACTIONS.SHU].hp, 9);
    assert.equal(state.players[FACTIONS.SHU].fatigueCount, 1);

    endTurn(state); // Switch to Wei (Turn 3)
    // Wei draws last card (deck now 0) -> Wei HP 15
    assert.equal(state.players[FACTIONS.WEI].hp, 15);
    assert.equal(state.players[FACTIONS.WEI].fatigueCount, 0);

    endTurn(state); // Switch to Shu (Turn 4)
    // Shu overdraw 2 (-2 dmg) -> Shu HP 7
    assert.equal(state.players[FACTIONS.SHU].hp, 7);
    assert.equal(state.players[FACTIONS.SHU].fatigueCount, 2);

    endTurn(state); // Switch to Wei (Turn 5)
    // Wei overdraw 1 (-1 dmg) -> Wei HP 14
    assert.equal(state.players[FACTIONS.WEI].hp, 14);

    endTurn(state); // Switch to Shu (Turn 6)
    // Shu overdraw 3 (-3 dmg) -> Shu HP 4
    assert.equal(state.players[FACTIONS.SHU].hp, 4);

    endTurn(state); // Switch to Wei (Turn 7)
    // Wei overdraw 2 (-2 dmg) -> Wei HP 12

    endTurn(state); // Switch to Shu (Turn 8)
    // Shu overdraw 4 (-4 dmg) -> Shu HP 0 -> FATIGUE KNOCKOUT!
    assert.equal(state.players[FACTIONS.SHU].hp, 0);
    assert.equal(state.phase, 'GAME_OVER');
    assert.equal(state.winner, FACTIONS.WEI);
  });

  // --------------------------------------------------------------------------
  // Simulation C: Virtual WebRTC P2P DataChannel State Synchronization
  // --------------------------------------------------------------------------
  it('Simulation C: Virtual WebRTC P2P DataChannel Synchronization (Host vs Client)', async () => {
    // 1. Establish Virtual P2P DataChannel Pair
    const [hostChannel, clientChannel] = MockDataChannel.createPair();

    assert.equal(hostChannel.readyState, 'open');
    assert.equal(clientChannel.readyState, 'open');

    // Host maintains Master State
    const hostState = createInitialState({ firstPlayer: FACTIONS.WEI });
    setupGame(hostState);
    startTurn(hostState, FACTIONS.WEI);

    let clientReceivedEvents = [];
    let clientProjectedState = null;

    // Client listens for Host events & state diffs
    clientChannel.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'ACTION_RESOLVED') {
        clientReceivedEvents.push(...msg.events);
        clientProjectedState = msg.projectedState;
      }
    };

    // Client prepares an action intent: deploy a card
    const clientFaction = FACTIONS.SHU;
    const shuPlayer = hostState.players[clientFaction];
    shuPlayer.provisions = 5;
    const unitToDeploy = shuPlayer.hand[0];

    // Client sends ACTION_INTENT to Host via clientChannel
    const actionIntent = {
      type: 'ACTION_INTENT',
      action: {
        type: 'DEPLOY',
        playerId: clientFaction,
        payload: { cardInstanceId: unitToDeploy.instanceId, targetZone: 'SUPPORT' }
      }
    };

    // Host receives client action, validates and executes
    const hostPromise = new Promise((resolve) => {
      hostChannel.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ACTION_INTENT') {
          // Host Authoritative Validation & Dispatch
          const res = dispatch(hostState, msg.action);

          // Host generates Masked State Projection for Client
          const projected = projectStateForClient(hostState, clientFaction);

          // Host broadcasts ACTION_RESOLVED to Client
          hostChannel.send({
            type: 'ACTION_RESOLVED',
            action: msg.action,
            events: [{ type: 'UNIT_DEPLOYED', cardId: unitToDeploy.cardId }],
            projectedState: projected
          });
          resolve(res);
        }
      };
    });

    clientChannel.send(actionIntent);
    await hostPromise;

    // Allow microtasks to deliver clientChannel.onmessage
    await new Promise(r => queueMicrotask(r));

    // Verify client received authoritative broadcast
    assert.equal(clientReceivedEvents.length, 1);
    assert.equal(clientReceivedEvents[0].type, 'UNIT_DEPLOYED');
    assert.ok(clientProjectedState, 'Client received projected state');

    // Verify Information Masking: Opponent (Wei) hand cards are masked
    const maskedWeiHand = clientProjectedState.players[FACTIONS.WEI].hand;
    assert.ok(maskedWeiHand.every(c => c.isHidden === true), 'Host hid all opponent hand cards from client');

    // Verify Own (Shu) hand cards are fully visible
    const visibleShuHand = clientProjectedState.players[FACTIONS.SHU].hand;
    assert.ok(visibleShuHand.every(c => !c.isHidden), 'Client has full plaintext visibility of own hand');

    // Close virtual channels cleanly
    hostChannel.close();
    assert.equal(hostChannel.readyState, 'closed');
    assert.equal(clientChannel.readyState, 'closed');
  });
});
