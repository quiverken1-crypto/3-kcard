/**
 * peerConnection.js — WebRTC PeerConnection & DataChannel Lifecycle Management
 * Three Kingdoms KARDS (Milestone 3)
 *
 * Implements:
 * 1. MicroEventEmitter: Zero-dependency event bus.
 * 2. PeerConnection: Robust lifecycle state machine over RTCDataChannel or MockDataChannel.
 * 3. Ping-Pong Heartbeat: Latency (RTT) estimation with EMA smoothing.
 * 4. Stalled State Detection & Disconnect Watchdog.
 */

// ==========================================
// 1. Portable Event Emitter
// ==========================================

export class MicroEventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  once(event, fn) {
    if (typeof fn !== 'function') return () => {};
    const wrapper = (...args) => {
      this.off(event, wrapper);
      fn(...args);
    };
    return this.on(event, wrapper);
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(fn);
      if (set.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (set) {
      for (const fn of Array.from(set)) {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[MicroEventEmitter] Error in listener for "${event}":`, err);
        }
      }
    }
  }

  removeAllListeners(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}

// ==========================================
// 2. Constants & Enums
// ==========================================

export const PEER_STATE = Object.freeze({
  DISCONNECTED: 'DISCONNECTED', // No channel attached
  CONNECTING: 'CONNECTING',     // Channel attached, waiting for readyState === 'open'
  OPEN: 'OPEN',                 // Channel open and heartbeat healthy
  STALLED: 'STALLED',           // Missed heartbeat threshold exceeded
  CLOSING: 'CLOSING',           // Disconnect / close in progress
  CLOSED: 'CLOSED'              // Channel closed or torn down
});

export const SYS_MSG_TYPE = Object.freeze({
  PING: 'SYS_PING',
  PONG: 'SYS_PONG',
  HEARTBEAT_ACK: 'SYS_HEARTBEAT_ACK',
  DISCONNECT: 'SYS_DISCONNECT'
});

// ==========================================
// 3. PeerConnection Wrapper Class
// ==========================================

export class PeerConnection extends MicroEventEmitter {
  /**
   * @param {object} [options]
   * @param {boolean} [options.isHost=false]
   * @param {number} [options.pingIntervalMs=2000]
   * @param {number} [options.stallTimeoutMs=4000]
   * @param {number} [options.disconnectTimeoutMs=8000]
   * @param {object} [options.channel=null] RTCDataChannel or MockDataChannel
   * @param {object} [options.pc=null] Optional underlying RTCPeerConnection
   */
  constructor(options = {}) {
    super();
    this.isHost = Boolean(options.isHost);
    this.pingIntervalMs = options.pingIntervalMs || 2000;
    this.stallTimeoutMs = options.stallTimeoutMs || 4000;
    this.disconnectTimeoutMs = options.disconnectTimeoutMs || 8000;

    this.state = PEER_STATE.DISCONNECTED;
    this.channel = null;
    this.pc = null;

    // Heartbeat metrics
    this.pingSeq = 0;
    this.rtt = 0;
    this.latency = 0;
    this.lastPongReceivedAt = Date.now();
    this.lastPingSentAt = 0;

    // Timers
    this._pingTimer = null;
    this._watchdogTimer = null;

    // Queue for messages during CONNECTING state
    this._outboundQueue = [];

    // Diagnostics
    this.stats = {
      packetsSent: 0,
      packetsReceived: 0,
      bytesSent: 0,
      bytesReceived: 0
    };

    if (options.channel) {
      this.attachChannel(options.channel, options.pc);
    }
  }

  /**
   * Attaches an RTCDataChannel (or MockDataChannel) to this peer instance.
   * @param {object} channel
   * @param {object} [pc=null]
   */
  attachChannel(channel, pc = null) {
    if (!channel) throw new Error('Channel cannot be null or undefined');
    this.channel = channel;
    this.pc = pc;

    this._bindChannelEvents();

    if (channel.readyState === 'open') {
      this._handleChannelOpen();
    } else {
      this._setState(PEER_STATE.CONNECTING);
    }
  }

  _bindChannelEvents() {
    const ch = this.channel;

    const on = (name, handler) => {
      if (typeof ch.addEventListener === 'function') {
        ch.addEventListener(name, handler);
      } else if (typeof ch.on === 'function') {
        ch.on(name, handler);
      } else {
        ch[`on${name}`] = handler;
      }
    };

    on('open', () => this._handleChannelOpen());
    on('message', (event) => this._handleChannelMessage(event));
    on('close', () => this._handleChannelClose({ graceful: false, reason: 'CHANNEL_CLOSED' }));
    on('error', (err) => this._handleChannelError(err));
  }

  _setState(newState) {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.emit('stateChange', newState, oldState);
  }

  _handleChannelOpen() {
    this._setState(PEER_STATE.OPEN);
    this.lastPongReceivedAt = Date.now();

    // Flush any pending queued outbound packets
    while (this._outboundQueue.length > 0) {
      const pending = this._outboundQueue.shift();
      this.send(pending);
    }

    this._startHeartbeat();
    this.emit('open');
  }

  _handleChannelMessage(event) {
    const rawData = (event && typeof event === 'object' && 'data' in event) ? event.data : event;
    this.stats.packetsReceived++;
    this.stats.bytesReceived += typeof rawData === 'string'
      ? rawData.length
      : (rawData?.byteLength || 0);

    // Binary payload handling
    if (rawData instanceof ArrayBuffer || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(rawData))) {
      this.emit('message', rawData, true);
      return;
    }

    // Try parsing as JSON
    let parsed;
    try {
      parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      // Non-JSON plain string
      this.emit('message', rawData, false);
      return;
    }

    // Handle System Messages
    if (parsed && typeof parsed.type === 'string' && parsed.type.startsWith('SYS_')) {
      this._handleSystemMessage(parsed);
      return;
    }

    // Application domain message
    this.emit('message', parsed, false);
  }

  _handleSystemMessage(msg) {
    const now = Date.now();

    switch (msg.type) {
      case SYS_MSG_TYPE.PING:
        this._sendRaw({
          type: SYS_MSG_TYPE.PONG,
          pingTimestamp: msg.timestamp,
          seq: msg.seq
        });
        break;

      case SYS_MSG_TYPE.PONG: {
        const measuredRtt = Math.max(0, now - msg.pingTimestamp);
        this.rtt = this.rtt === 0 ? measuredRtt : Math.round(0.8 * this.rtt + 0.2 * measuredRtt);
        this.latency = Math.max(1, Math.round(this.rtt / 2));
        this.lastPongReceivedAt = now;

        if (this.state === PEER_STATE.STALLED) {
          this._setState(PEER_STATE.OPEN);
        }

        this.emit('heartbeat', { rtt: this.rtt, latency: this.latency });

        if (this.isHost) {
          this._sendRaw({
            type: SYS_MSG_TYPE.HEARTBEAT_ACK,
            rtt: this.rtt,
            latency: this.latency
          });
        }
        break;
      }

      case SYS_MSG_TYPE.HEARTBEAT_ACK:
        this.rtt = msg.rtt;
        this.latency = msg.latency;
        this.lastPongReceivedAt = now;
        if (this.state === PEER_STATE.STALLED) {
          this._setState(PEER_STATE.OPEN);
        }
        this.emit('heartbeat', { rtt: this.rtt, latency: this.latency });
        break;

      case SYS_MSG_TYPE.DISCONNECT:
        this._handleChannelClose({ graceful: true, reason: msg.reason || 'PEER_DISCONNECTED' });
        break;
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();

    if (this.isHost) {
      this._pingTimer = setInterval(() => {
        if (this.state === PEER_STATE.OPEN || this.state === PEER_STATE.STALLED) {
          this.lastPingSentAt = Date.now();
          this._sendRaw({
            type: SYS_MSG_TYPE.PING,
            timestamp: this.lastPingSentAt,
            seq: ++this.pingSeq
          });
        }
      }, this.pingIntervalMs);
    }

    this._watchdogTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastPongReceivedAt;

      if (elapsed > this.stallTimeoutMs && this.state === PEER_STATE.OPEN) {
        this._setState(PEER_STATE.STALLED);
        this.emit('stall');
      }

      if (elapsed > this.disconnectTimeoutMs && this.state === PEER_STATE.STALLED) {
        this._handleChannelClose({ graceful: false, reason: 'HEARTBEAT_TIMEOUT' });
      }
    }, Math.min(1000, Math.floor(this.stallTimeoutMs / 2)));
  }

  _stopHeartbeat() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  /**
   * Transmits data (object, string, or binary) to peer.
   * @param {object|string|ArrayBuffer} data
   * @returns {boolean}
   */
  send(data) {
    if (this.state === PEER_STATE.CLOSED || this.state === PEER_STATE.CLOSING) {
      return false;
    }

    if (this.state === PEER_STATE.CONNECTING) {
      this._outboundQueue.push(data);
      return true;
    }

    return this._sendRaw(data);
  }

  /**
   * Convenience JSON sender.
   * @param {object} obj
   * @returns {boolean}
   */
  sendJson(obj) {
    return this.send(obj);
  }

  _sendRaw(data) {
    if (!this.channel || this.channel.readyState !== 'open') {
      return false;
    }

    let payload;
    if (typeof data === 'string' || data instanceof ArrayBuffer || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data))) {
      payload = data;
    } else {
      payload = JSON.stringify(data);
    }

    try {
      this.channel.send(payload);
      this.stats.packetsSent++;
      this.stats.bytesSent += typeof payload === 'string' ? payload.length : (payload?.byteLength || 0);
      return true;
    } catch (err) {
      this.emit('error', err);
      return false;
    }
  }

  /**
   * Gracefully disconnects the peer session.
   * @param {string} [reason='USER_DISCONNECT']
   */
  disconnect(reason = 'USER_DISCONNECT') {
    if (this.state === PEER_STATE.CLOSED) return;

    this._stopHeartbeat();
    this._setState(PEER_STATE.CLOSING);
    this._sendRaw({
      type: SYS_MSG_TYPE.DISCONNECT,
      reason
    });

    setTimeout(() => {
      this._handleChannelClose({ graceful: true, reason });
    }, 50);
  }

  _handleChannelClose(info = { graceful: false, reason: 'CHANNEL_CLOSED' }) {
    if (this.state === PEER_STATE.CLOSED) return;

    this._stopHeartbeat();
    this._setState(PEER_STATE.CLOSED);

    if (this.channel) {
      try { this.channel.close(); } catch (_) {}
      this.channel = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch (_) {}
      this.pc = null;
    }

    this.emit('close', info);
  }

  _handleChannelError(err) {
    this.emit('error', err);
  }

  getRtt() {
    return this.rtt;
  }

  getLatency() {
    return this.latency;
  }

  getState() {
    return this.state;
  }

  getDiagnostics() {
    return {
      state: this.state,
      isHost: this.isHost,
      rtt: this.rtt,
      latency: this.latency,
      stats: { ...this.stats },
      queuedOutbound: this._outboundQueue.length
    };
  }
}

export default {
  MicroEventEmitter,
  PEER_STATE,
  SYS_MSG_TYPE,
  PeerConnection
};
