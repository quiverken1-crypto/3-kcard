/**
 * syncProtocol.js — Host-Authoritative Synchronization & Secret Masking Protocol
 * Three Kingdoms KARDS (Milestone 3)
 *
 * Implements:
 * 1. PROTOCOL_TYPES: Canonical network message constants.
 * 2. ReplayBuffer: Circular buffer of recent authoritative action packets for instant resync.
 * 3. maskStateForPlayer: Defensive secret masking (opponent hands, hidden counters, stealth units, deck counts, seed stripping).
 * 4. computeStateHash: Deterministic 32-bit FNV-1a checksum over canonical state properties.
 * 5. HostSyncManager: Authoritative action dispatcher and sequence coordinator.
 * 6. ClientSyncManager: Client-side action request dispatcher, seq validator, and out-of-order buffer.
 */

import { FACTIONS, PHASES } from '../engine/constants.js';
import { MicroEventEmitter } from './peerConnection.js';

// ==========================================
// 1. Protocol Types Constants
// ==========================================

export const PROTOCOL_TYPES = Object.freeze({
  CLIENT_READY: 'CLIENT_READY',
  MATCH_START: 'MATCH_START',
  ACTION_REQUEST: 'ACTION_REQUEST',
  ACTION_APPLIED: 'ACTION_APPLIED',
  ACTION_REJECTED: 'ACTION_REJECTED',
  SYNC_REQUEST: 'SYNC_REQUEST',
  STATE_SNAPSHOT: 'STATE_SNAPSHOT',
  REPLAY_STREAM: 'REPLAY_STREAM',
  HEARTBEAT_PING: 'HEARTBEAT_PING',
  HEARTBEAT_PONG: 'HEARTBEAT_PONG'
});

// ==========================================
// 2. Replay Buffer
// ==========================================

export class ReplayBuffer {
  /**
   * @param {number} [maxCapacity=100]
   */
  constructor(maxCapacity = 100) {
    this.maxCapacity = maxCapacity;
    this.buffer = []; // [{ seq, packet }]
  }

  add(seq, packet) {
    if (this.buffer.length >= this.maxCapacity) {
      this.buffer.shift();
    }
    this.buffer.push({ seq, packet });
  }

  hasRange(fromSeq, toSeq) {
    if (this.buffer.length === 0) return false;
    const minSeq = this.buffer[0].seq;
    const maxSeq = this.buffer[this.buffer.length - 1].seq;
    return fromSeq >= minSeq && toSeq <= maxSeq;
  }

  getRange(fromSeq, toSeq) {
    return this.buffer
      .filter(item => item.seq >= fromSeq && item.seq <= toSeq)
      .map(item => item.packet);
  }

  clear() {
    this.buffer = [];
  }
}

// ==========================================
// 3. Defensive Secret Information Masking
// ==========================================

/**
 * Projects an authoritative master GameState into a client-safe MaskedGameState for viewerFaction.
 * Strips opponent hand details, secret counters, exact deck card orders, PRNG seeds,
 * and masks face-down stealth units (潜袭).
 *
 * @param {object} masterState
 * @param {string} viewerFaction - 'WEI' or 'SHU'
 * @returns {object}
 */
export function maskStateForPlayer(masterState, viewerFaction) {
  if (!masterState) return null;

  const oppFaction = viewerFaction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
  const selfPlayer = masterState.players[viewerFaction];
  const oppPlayer = masterState.players[oppFaction];

  // 1. Mask Opponent Hand (preserve instanceId, mask identity and stats)
  const maskedOppHand = oppPlayer.hand.map(card => ({
    instanceId: card.instanceId,
    isHidden: true,
    name: '???',
    cardId: null,
    cost: null,
    actionCost: null,
    atk: null,
    hp: null,
    troopType: null,
    type: card.type || 'UNIT',
    keywords: [],
    badges: []
  }));

  // 2. Protect Decks (only expose card counts)
  const selfDeckCount = Array.isArray(selfPlayer.deck)
    ? selfPlayer.deck.length
    : (selfPlayer.deck?.count ?? 0);
  const oppDeckCount = Array.isArray(oppPlayer.deck)
    ? oppPlayer.deck.length
    : (oppPlayer.deck?.count ?? 0);

  // 3. Mask Battlefield Face-Down Stealth Units (潜袭)
  const maskUnit = (unit) => {
    if (!unit) return null;
    if (unit.faction !== viewerFaction && unit.status?.isFaceDown) {
      return {
        instanceId: unit.instanceId,
        faction: unit.faction,
        kingdom: unit.kingdom,
        isHidden: true,
        name: '伏兵',
        cardId: null,
        troopType: null,
        cost: null,
        actionCost: null,
        atk: '?',
        hp: '?',
        maxHp: '?',
        keywords: ['潜袭'],
        status: { ...unit.status, isFaceDown: true }
      };
    }
    return JSON.parse(JSON.stringify(unit));
  };

  const supportMasked = {
    [viewerFaction]: {
      hq: { ...masterState.battlefield.support[viewerFaction].hq },
      slots: masterState.battlefield.support[viewerFaction].slots.map(maskUnit)
    },
    [oppFaction]: {
      hq: { ...masterState.battlefield.support[oppFaction].hq },
      slots: masterState.battlefield.support[oppFaction].slots.map(maskUnit)
    }
  };

  const frontlineMasked = {};
  for (const zk of ['LEFT', 'CENTER', 'RIGHT']) {
    const zone = masterState.battlefield.frontline[zk];
    frontlineMasked[zk] = {
      zone: zone.zone,
      occupant: zone.occupant,
      terrain: zone.terrain ? { ...zone.terrain } : null,
      capacity: zone.capacity,
      units: zone.units.map(maskUnit)
    };
  }

  // 4. Mask Opponent Active Counters
  const maskedCounters = (masterState.activeCounters || []).map(counter => {
    if (counter.owner === viewerFaction || counter.isRevealed) {
      return JSON.parse(JSON.stringify(counter));
    }
    return {
      id: counter.id,
      owner: counter.owner,
      cardInstanceId: counter.cardInstanceId,
      isHidden: true,
      name: '???',
      cardId: null,
      cost: null,
      triggerCondition: null,
      isRevealed: false
    };
  });

  // 5. Construct Sanitized Masked State
  return {
    matchId: masterState.matchId,
    turnNumber: masterState.turnNumber,
    activePlayer: masterState.activePlayer,
    firstPlayer: masterState.firstPlayer,
    phase: masterState.phase,
    winner: masterState.winner,
    firstTurnDrawSkip: masterState.firstTurnDrawSkip,

    players: {
      [viewerFaction]: {
        ...JSON.parse(JSON.stringify(selfPlayer)),
        deck: { count: selfDeckCount }
      },
      [oppFaction]: {
        ...JSON.parse(JSON.stringify(oppPlayer)),
        hand: maskedOppHand,
        deck: { count: oppDeckCount }
      }
    },

    battlefield: {
      support: supportMasked,
      frontline: frontlineMasked,
      reserveTerrain: masterState.battlefield.reserveTerrain
        ? { ...masterState.battlefield.reserveTerrain }
        : null
    },

    activeCounters: maskedCounters,
    combatLog: Array.isArray(masterState.combatLog) ? [...masterState.combatLog] : [],
    // Strip PRNG seeds
    prng: null,
    seed: null
  };
}

// ==========================================
// 4. State Integrity Hashing (FNV-1a 32-bit)
// ==========================================

/**
 * Computes a deterministic 32-bit FNV-1a hash over canonical public state properties.
 * @param {object} state
 * @returns {string} Hexadecimal string hash (e.g. "7f3b89a1")
 */
export function computeStateHash(state) {
  if (!state || !state.players) return '00000000';

  const wei = state.players.WEI;
  const shu = state.players.SHU;
  if (!wei || !shu) return '00000000';

  const weiDeckCount = Array.isArray(wei.deck) ? wei.deck.length : (wei.deck?.count ?? 0);
  const shuDeckCount = Array.isArray(shu.deck) ? shu.deck.length : (shu.deck?.count ?? 0);

  const frontlineUnits = ['LEFT', 'CENTER', 'RIGHT'].flatMap(zk => {
    const zone = state.battlefield?.frontline?.[zk];
    if (!zone || !Array.isArray(zone.units)) return [];
    return zone.units.map(u => `${u.instanceId}:${u.atk}:${u.hp}:${u.faction}:${zk}`);
  }).sort();

  const weiSupportUnits = (state.battlefield?.support?.WEI?.slots || [])
    .map(u => `${u.instanceId}:${u.atk}:${u.hp}:WEI:SUPPORT`)
    .sort();

  const shuSupportUnits = (state.battlefield?.support?.SHU?.slots || [])
    .map(u => `${u.instanceId}:${u.atk}:${u.hp}:SHU:SUPPORT`)
    .sort();

  const summary = [
    state.turnNumber,
    state.activePlayer,
    state.phase,
    state.winner || 'NONE',
    wei.hp,
    wei.provisions,
    wei.prestige,
    wei.hand.length,
    weiDeckCount,
    (wei.discard || []).length,
    shu.hp,
    shu.provisions,
    shu.prestige,
    shu.hand.length,
    shuDeckCount,
    (shu.discard || []).length,
    ...frontlineUnits,
    ...weiSupportUnits,
    ...shuSupportUnits,
    (state.activeCounters || []).length
  ].join('|');

  let hash = 0x811c9dc5;
  for (let i = 0; i < summary.length; i++) {
    hash ^= summary.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ==========================================
// 5. HostSyncManager Class
// ==========================================

export class HostSyncManager extends MicroEventEmitter {
  /**
   * @param {object} options
   * @param {object} options.rulesEngine - Authoritative RulesEngine instance
   * @param {object} [options.channel=null] - WebRTC DataChannel or MockDataChannel
   * @param {string} [options.hostFaction='WEI']
   * @param {string} [options.clientFaction='SHU']
   */
  constructor(options = {}) {
    super();
    this.rulesEngine = options.rulesEngine;
    this.channel = options.channel || null;
    this.hostFaction = options.hostFaction || FACTIONS.WEI;
    this.clientFaction = options.clientFaction || FACTIONS.SHU;

    this.seq = 0;
    this.replayBuffer = new ReplayBuffer(100);

    if (this.channel) {
      this._bindChannel();
    }
  }

  attachChannel(channel) {
    this.channel = channel;
    this._bindChannel();
  }

  _bindChannel() {
    const ch = this.channel;
    if (!ch) return;

    const onMessage = (event) => {
      const rawData = (event && typeof event === 'object' && 'data' in event) ? event.data : event;
      let msg;
      try {
        msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      } catch (err) {
        console.error('[HostSyncManager] Error parsing message:', err);
        return;
      }
      this.handleClientMessage(msg);
    };

    if (typeof ch.addEventListener === 'function') {
      ch.addEventListener('message', onMessage);
    } else if (typeof ch.on === 'function') {
      ch.on('message', onMessage);
    } else {
      ch.onmessage = onMessage;
    }
  }

  handleClientMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case PROTOCOL_TYPES.ACTION_REQUEST:
        this.handleActionRequest(msg);
        break;
      case PROTOCOL_TYPES.SYNC_REQUEST:
        this.handleSyncRequest(msg);
        break;
      case PROTOCOL_TYPES.CLIENT_READY:
        this.emit('clientReady', msg);
        break;
      default:
        // Ignore unhandled or system messages
        break;
    }
  }

  /**
   * Dispatches and authorizes an action.
   * Increments sequence, projects masked state, and transmits ACTION_APPLIED.
   *
   * @param {object} action
   * @param {string|null} [reqId=null]
   * @returns {{ success: boolean, seq?: number, result?: object, error?: string }}
   */
  dispatchAction(action, reqId = null) {
    const isClientAction = reqId !== null;
    const state = this.rulesEngine.state;

    try {
      if (state.phase === PHASES.ACTION && action.playerId !== state.activePlayer) {
        throw new Error('Action player is not the active player');
      }
      const logStart = Array.isArray(state.combatLog) ? state.combatLog.length : 0;
      const result = this.rulesEngine.dispatch(action);
      const newLogs = Array.isArray(state.combatLog) ? state.combatLog.slice(logStart) : [];

      this.seq += 1;

      const clientMaskedState = maskStateForPlayer(state, this.clientFaction);
      const stateHash = computeStateHash(state);

      const packet = {
        type: PROTOCOL_TYPES.ACTION_APPLIED,
        seq: this.seq,
        reqId,
        action,
        events: newLogs,
        result,
        state: clientMaskedState,
        stateHash
      };

      this.replayBuffer.add(this.seq, packet);

      if (this.channel && this.channel.readyState === 'open') {
        this.channel.send(JSON.stringify(packet));
      }

      this.emit('actionApplied', {
        seq: this.seq,
        reqId,
        action,
        result,
        state,
        events: newLogs,
        stateHash
      });

      return { success: true, seq: this.seq, result };
    } catch (err) {
      if (isClientAction) {
        const clientMaskedState = maskStateForPlayer(state, this.clientFaction);
        const rejectPacket = {
          type: PROTOCOL_TYPES.ACTION_REJECTED,
          reqId,
          action,
          reason: err.message,
          seq: this.seq,
          state: clientMaskedState,
          stateHash: computeStateHash(state)
        };
        if (this.channel && this.channel.readyState === 'open') {
          this.channel.send(JSON.stringify(rejectPacket));
        }
      }
      this.emit('actionRejected', { action, reqId, reason: err.message });
      return { success: false, error: err.message };
    }
  }

  handleActionRequest(msg) {
    this.dispatchAction(msg.action, msg.reqId);
  }

  handleSyncRequest(msg) {
    const lastSeq = msg.lastSeq ?? 0;
    if (lastSeq >= 0 && this.replayBuffer.hasRange(lastSeq + 1, this.seq)) {
      const packets = this.replayBuffer.getRange(lastSeq + 1, this.seq);
      const reply = {
        type: PROTOCOL_TYPES.REPLAY_STREAM,
        fromSeq: lastSeq + 1,
        toSeq: this.seq,
        packets
      };
      if (this.channel && this.channel.readyState === 'open') {
        this.channel.send(JSON.stringify(reply));
      }
    } else {
      const snapshot = {
        type: PROTOCOL_TYPES.STATE_SNAPSHOT,
        seq: this.seq,
        state: maskStateForPlayer(this.rulesEngine.state, this.clientFaction),
        stateHash: computeStateHash(this.rulesEngine.state)
      };
      if (this.channel && this.channel.readyState === 'open') {
        this.channel.send(JSON.stringify(snapshot));
      }
    }
  }

  /**
   * Broadcasts initial match start snapshot to client.
   * @param {string} [matchId]
   */
  broadcastMatchStart(matchId = 'match_init') {
    const state = this.rulesEngine.state;
    const packet = {
      type: PROTOCOL_TYPES.MATCH_START,
      seq: 0,
      matchId,
      hostFaction: this.hostFaction,
      clientFaction: this.clientFaction,
      firstPlayer: state.firstPlayer,
      state: maskStateForPlayer(state, this.clientFaction),
      stateHash: computeStateHash(state)
    };

    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify(packet));
    }
    return packet;
  }
}

// ==========================================
// 6. ClientSyncManager Class
// ==========================================

export class ClientSyncManager extends MicroEventEmitter {
  /**
   * @param {object} options
   * @param {object} [options.channel=null] - WebRTC DataChannel or MockDataChannel
   * @param {string} [options.clientFaction='SHU']
   */
  constructor(options = {}) {
    super();
    this.channel = options.channel || null;
    this.clientFaction = options.clientFaction || FACTIONS.SHU;

    this.state = null;
    this.expectedSeq = 1;
    this.pendingRequests = new Map(); // reqId -> { action, resolve, reject, timestamp }
    this.outOfOrderBuffer = new Map(); // seq -> packet

    if (this.channel) {
      this._bindChannel();
    }
  }

  attachChannel(channel) {
    this.channel = channel;
    this._bindChannel();
  }

  _bindChannel() {
    const ch = this.channel;
    if (!ch) return;

    const onMessage = (event) => {
      const rawData = (event && typeof event === 'object' && 'data' in event) ? event.data : event;
      let msg;
      try {
        msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      } catch (err) {
        console.error('[ClientSyncManager] Error parsing message:', err);
        return;
      }
      this.handleHostMessage(msg);
    };

    if (typeof ch.addEventListener === 'function') {
      ch.addEventListener('message', onMessage);
    } else if (typeof ch.on === 'function') {
      ch.on('message', onMessage);
    } else {
      ch.onmessage = onMessage;
    }
  }

  /**
   * Sends an action request to the host and returns a Promise resolving on ACTION_APPLIED.
   * @param {object} action
   * @returns {Promise<object>}
   */
  sendAction(action) {
    const reqId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const request = {
      type: PROTOCOL_TYPES.ACTION_REQUEST,
      reqId,
      playerId: this.clientFaction,
      action
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, {
        action,
        resolve,
        reject,
        timestamp: Date.now()
      });

      if (this.channel && this.channel.readyState === 'open') {
        this.channel.send(JSON.stringify(request));
      } else {
        this.pendingRequests.delete(reqId);
        reject(new Error('Network channel not open'));
      }
    });
  }

  handleHostMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case PROTOCOL_TYPES.MATCH_START:
      case PROTOCOL_TYPES.STATE_SNAPSHOT:
        this.state = msg.state;
        this.expectedSeq = (msg.seq ?? 0) + 1;
        this.outOfOrderBuffer.clear();
        this.emit('stateUpdated', { state: this.state, seq: msg.seq });
        break;

      case PROTOCOL_TYPES.ACTION_APPLIED:
        this.handleActionApplied(msg);
        break;

      case PROTOCOL_TYPES.ACTION_REJECTED:
        this.handleActionRejected(msg);
        break;

      case PROTOCOL_TYPES.REPLAY_STREAM:
        if (Array.isArray(msg.packets)) {
          for (const packet of msg.packets) {
            this.handleActionApplied(packet);
          }
        }
        break;

      default:
        break;
    }
  }

  handleActionApplied(packet) {
    const { seq, reqId } = packet;

    if (seq < this.expectedSeq) {
      // Duplicate packet -> ignore
      return;
    }

    if (seq > this.expectedSeq) {
      // Gap detected -> buffer and request sync
      this.outOfOrderBuffer.set(seq, packet);
      this.requestSync(this.expectedSeq - 1);
      return;
    }

    // In-order execution: seq === this.expectedSeq
    this.state = packet.state;
    this.expectedSeq = seq + 1;

    if (reqId && this.pendingRequests.has(reqId)) {
      const pending = this.pendingRequests.get(reqId);
      this.pendingRequests.delete(reqId);
      pending.resolve(packet);
    }

    this.emit('actionApplied', packet);
    this.emit('stateUpdated', { state: this.state, seq });

    // Check if subsequent buffered packet is now ready
    if (this.outOfOrderBuffer.has(this.expectedSeq)) {
      const nextPacket = this.outOfOrderBuffer.get(this.expectedSeq);
      this.outOfOrderBuffer.delete(this.expectedSeq);
      this.handleActionApplied(nextPacket);
    }
  }

  handleActionRejected(packet) {
    const { reqId, reason, state } = packet;
    if (reqId && this.pendingRequests.has(reqId)) {
      const pending = this.pendingRequests.get(reqId);
      this.pendingRequests.delete(reqId);
      pending.reject(new Error(reason || 'Action rejected'));
    }

    if (state) {
      this.state = state;
      this.emit('stateUpdated', { state: this.state, seq: packet.seq });
    }
    this.emit('actionRejected', packet);
  }

  requestSync(lastSeq) {
    const syncReq = {
      type: PROTOCOL_TYPES.SYNC_REQUEST,
      playerId: this.clientFaction,
      lastSeq
    };
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify(syncReq));
    }
  }
}

export default {
  PROTOCOL_TYPES,
  ReplayBuffer,
  maskStateForPlayer,
  computeStateHash,
  HostSyncManager,
  ClientSyncManager
};
