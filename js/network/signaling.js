/**
 * signaling.js — Zero-Server WebRTC Signaling, Token Codec & LAN Broadcast Discovery
 * Three Kingdoms KARDS (Milestone 3)
 *
 * Implements:
 * 1. Token Codec: Deflate-raw compressed, URL-safe Base64 exchange tokens (TKCO: / TKCA:).
 * 2. Vanilla ICE Waiter: Fast-host candidate detection with configurable timeout cutoff.
 * 3. Session Initializers: createHostOfferSession & createClientAnswerSession.
 * 4. Local LAN Tab Discovery: BroadcastChannel('tk-lan-discovery') beacon and auto-negotiation.
 */

export const TOKEN_PREFIX = Object.freeze({
  OFFER: 'TKCO:',
  ANSWER: 'TKCA:'
});

export const LOBBY_MSG_TYPE = Object.freeze({
  ANNOUNCE: 'TK_LOBBY_ANNOUNCE',
  JOIN: 'TK_LOBBY_JOIN',
  ACK: 'TK_LOBBY_ACK',
  LEAVE: 'TK_LOBBY_LEAVE'
});

export const DEFAULT_RTC_CONFIG = Object.freeze({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 0
});

// ==========================================
// 1. Base64URL & Compression Utilities
// ==========================================

/**
 * Converts a Uint8Array buffer into a URL-safe Base64 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bufferToBase64Url(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa !== 'undefined'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Converts a URL-safe Base64 string into a Uint8Array buffer.
 * @param {string} base64Url
 * @returns {Uint8Array}
 */
export function base64UrlToBuffer(base64Url) {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = typeof atob !== 'undefined'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compresses string using deflate-raw.
 * @param {string} str
 * @returns {Promise<Uint8Array>}
 */
async function compressString(str) {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(new TextEncoder().encode(str));
      writer.close();
      const compressedBuffer = await new Response(cs.readable).arrayBuffer();
      return new Uint8Array(compressedBuffer);
    } catch {
      // Fallback below
    }
  }
  return new TextEncoder().encode(str);
}

/**
 * Decompresses Uint8Array using deflate-raw.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function decompressBuffer(bytes) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
      return new TextDecoder().decode(decompressedBuffer);
    } catch {
      // Might be uncompressed payload
      return new TextDecoder().decode(bytes);
    }
  }
  return new TextDecoder().decode(bytes);
}

// ==========================================
// 2. Token Codec (encodeSignalToken / decodeSignalToken)
// ==========================================

/**
 * Encodes session description and candidates into a compact URL-safe signal token.
 * @param {'offer'|'answer'} type
 * @param {string} sdp
 * @param {Array} [candidates=[]]
 * @returns {Promise<string>}
 */
export async function encodeSignalToken(type, sdp, candidates = []) {
  if (type !== 'offer' && type !== 'answer') {
    throw new Error(`Invalid token type "${type}": must be 'offer' or 'answer'`);
  }
  if (!sdp || typeof sdp !== 'string') {
    throw new Error('SDP session description is required');
  }

  const payload = {
    v: 1,
    type,
    sdp,
    candidates: Array.isArray(candidates) ? candidates : [],
    time: Date.now()
  };

  const jsonStr = JSON.stringify(payload);
  const prefix = type === 'offer' ? TOKEN_PREFIX.OFFER : TOKEN_PREFIX.ANSWER;
  const compressedBytes = await compressString(jsonStr);
  const base64Url = bufferToBase64Url(compressedBytes);

  return `${prefix}${base64Url}`;
}

/**
 * Decodes and validates a signal token.
 * @param {string} token
 * @param {'offer'|'answer'} [expectedType]
 * @returns {Promise<{ type: string, sdp: string, candidates: Array, time: number }>}
 */
export async function decodeSignalToken(token, expectedType) {
  if (typeof token !== 'string') {
    throw new Error('Signal token must be a string');
  }

  const cleanToken = token.trim();
  let tokenType = null;
  let payloadStr = '';

  if (cleanToken.startsWith(TOKEN_PREFIX.OFFER)) {
    tokenType = 'offer';
    payloadStr = cleanToken.slice(TOKEN_PREFIX.OFFER.length);
  } else if (cleanToken.startsWith(TOKEN_PREFIX.ANSWER)) {
    tokenType = 'answer';
    payloadStr = cleanToken.slice(TOKEN_PREFIX.ANSWER.length);
  } else {
    throw new Error('Invalid token format: must start with "TKCO:" or "TKCA:"');
  }

  if (expectedType && tokenType !== expectedType) {
    throw new Error(`Token type mismatch: expected ${expectedType.toUpperCase()} token, received ${tokenType.toUpperCase()}`);
  }

  let compressedBytes;
  try {
    compressedBytes = base64UrlToBuffer(payloadStr);
  } catch (err) {
    throw new Error(`Invalid token base64url payload: ${err.message}`);
  }

  let jsonStr;
  try {
    jsonStr = await decompressBuffer(compressedBytes);
  } catch (err) {
    throw new Error(`Corrupted token decompression: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Corrupted token payload: unable to parse JSON: ${err.message}`);
  }

  if (!parsed.sdp || typeof parsed.sdp !== 'string') {
    throw new Error('Invalid token: missing SDP session description');
  }

  return {
    type: parsed.type || tokenType,
    sdp: parsed.sdp,
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    time: parsed.time || 0
  };
}

// ==========================================
// 3. Vanilla ICE Gathering Waiter
// ==========================================

/**
 * Waits for RTCPeerConnection to gather ICE candidates.
 * Employs host candidate fast-cutoff timer to prevent lagging on STUN timeouts in LAN.
 * @param {RTCPeerConnection} pc
 * @param {object} [options]
 * @param {number} [options.timeoutMs=3000]
 * @param {number} [options.fastHostTimeoutMs=1200]
 * @returns {Promise<void>}
 */
export function waitForIceGathering(pc, options = {}) {
  const timeoutMs = options.timeoutMs || 3000;
  const fastHostTimeoutMs = options.fastHostTimeoutMs || 1200;

  return new Promise((resolve) => {
    if (!pc || pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    let overallTimer = null;
    let fastTimer = null;
    let hasHostCandidate = false;
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (overallTimer) clearTimeout(overallTimer);
      if (fastTimer) clearTimeout(fastTimer);
      if (typeof pc.removeEventListener === 'function') {
        pc.removeEventListener('icegatheringstatechange', checkState);
        pc.removeEventListener('icecandidate', onCandidate);
      }
    };

    const done = () => {
      cleanup();
      resolve();
    };

    const checkState = () => {
      if (pc.iceGatheringState === 'complete') {
        done();
      }
    };

    const onCandidate = (event) => {
      if (!event || !event.candidate) {
        // null candidate indicates gathering completion
        done();
        return;
      }
      const cand = event.candidate;
      const isHost = cand.type === 'host' || (typeof cand.candidate === 'string' && cand.candidate.includes('typ host'));
      if (isHost && !hasHostCandidate) {
        hasHostCandidate = true;
        fastTimer = setTimeout(done, fastHostTimeoutMs);
      }
    };

    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('icegatheringstatechange', checkState);
      pc.addEventListener('icecandidate', onCandidate);
    } else {
      // Direct callback fallback
      const prevGathering = pc.onicegatheringstatechange;
      const prevCandidate = pc.onicecandidate;
      pc.onicegatheringstatechange = (e) => {
        if (prevGathering) prevGathering(e);
        checkState();
      };
      pc.onicecandidate = (e) => {
        if (prevCandidate) prevCandidate(e);
        onCandidate(e);
      };
    }

    overallTimer = setTimeout(done, timeoutMs);
  });
}

// ==========================================
// 4. Host & Client Signaling Sessions
// ==========================================

/**
 * Creates Host Signaling Session.
 * Creates Offer, gathers candidates, and generates offerToken.
 * @param {object} [options]
 * @returns {Promise<{ pc: object, dc: object, offerToken: string, applyAnswer: Function, cancel: Function }>}
 */
export async function createHostOfferSession(options = {}) {
  const RTCPC = options.RTCPeerConnection || globalThis.RTCPeerConnection;
  if (!RTCPC) {
    throw new Error('RTCPeerConnection is not available in this environment');
  }
  const rtcConfig = options.rtcConfig || DEFAULT_RTC_CONFIG;
  const pc = new RTCPC(rtcConfig);
  const candidates = [];

  const candidateListener = (e) => {
    if (e.candidate) {
      candidates.push(typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate);
    }
  };

  if (typeof pc.addEventListener === 'function') {
    pc.addEventListener('icecandidate', candidateListener);
  } else {
    pc.onicecandidate = candidateListener;
  }

  const dc = pc.createDataChannel('tk-channel', { ordered: true });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await waitForIceGathering(pc, options);
  const sdp = pc.localDescription?.sdp || offer.sdp;
  const offerToken = await encodeSignalToken('offer', sdp, candidates);

  return {
    pc,
    dc,
    offerToken,
    applyAnswer: async (answerToken) => {
      const decoded = await decodeSignalToken(answerToken, 'answer');
      const RTCSessionDesc = options.RTCSessionDescription || globalThis.RTCSessionDescription;
      const desc = RTCSessionDesc ? new RTCSessionDesc({ type: 'answer', sdp: decoded.sdp }) : { type: 'answer', sdp: decoded.sdp };
      await pc.setRemoteDescription(desc);

      if (decoded.candidates && decoded.candidates.length > 0) {
        const RTCIce = options.RTCIceCandidate || globalThis.RTCIceCandidate;
        for (const c of decoded.candidates) {
          try {
            const cand = RTCIce ? new RTCIce(c) : c;
            await pc.addIceCandidate(cand);
          } catch {
            // Ignored if duplicate candidate
          }
        }
      }
    },
    cancel: () => {
      try { dc.close(); } catch {}
      try { pc.close(); } catch {}
    }
  };
}

/**
 * Creates Client Signaling Session.
 * Consumes offerToken, creates Answer, gathers candidates, and generates answerToken.
 * @param {string} offerToken
 * @param {object} [options]
 * @returns {Promise<{ pc: object, answerToken: string, waitForChannel: Function, getChannel: Function, cancel: Function }>}
 */
export async function createClientAnswerSession(offerToken, options = {}) {
  const decodedOffer = await decodeSignalToken(offerToken, 'offer');
  const RTCPC = options.RTCPeerConnection || globalThis.RTCPeerConnection;
  if (!RTCPC) {
    throw new Error('RTCPeerConnection is not available in this environment');
  }
  const rtcConfig = options.rtcConfig || DEFAULT_RTC_CONFIG;
  const pc = new RTCPC(rtcConfig);
  const candidates = [];
  let clientDc = null;

  const candidateListener = (e) => {
    if (e.candidate) {
      candidates.push(typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate);
    }
  };

  if (typeof pc.addEventListener === 'function') {
    pc.addEventListener('icecandidate', candidateListener);
  } else {
    pc.onicecandidate = candidateListener;
  }

  const dcPromise = new Promise((resolve) => {
    const onDataChannel = (event) => {
      clientDc = event.channel;
      resolve(clientDc);
    };
    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('datachannel', onDataChannel);
    } else {
      pc.ondatachannel = onDataChannel;
    }
  });

  const RTCSessionDesc = options.RTCSessionDescription || globalThis.RTCSessionDescription;
  const offerDesc = RTCSessionDesc ? new RTCSessionDesc({ type: 'offer', sdp: decodedOffer.sdp }) : { type: 'offer', sdp: decodedOffer.sdp };
  await pc.setRemoteDescription(offerDesc);

  if (decodedOffer.candidates && decodedOffer.candidates.length > 0) {
    const RTCIce = options.RTCIceCandidate || globalThis.RTCIceCandidate;
    for (const c of decodedOffer.candidates) {
      try {
        const cand = RTCIce ? new RTCIce(c) : c;
        await pc.addIceCandidate(cand);
      } catch {}
    }
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await waitForIceGathering(pc, options);
  const sdp = pc.localDescription?.sdp || answer.sdp;
  const answerToken = await encodeSignalToken('answer', sdp, candidates);

  return {
    pc,
    answerToken,
    waitForChannel: () => dcPromise,
    getChannel: () => clientDc,
    cancel: () => {
      if (clientDc) {
        try { clientDc.close(); } catch {}
      }
      try { pc.close(); } catch {}
    }
  };
}

// ==========================================
// 5. Local LAN / Tab Discovery (BroadcastChannel)
// ==========================================

export class LobbyDiscovery {
  constructor(channelName = 'tk-lan-discovery', options = {}) {
    this.channelName = channelName;
    this.BroadcastChannelCtor = options.BroadcastChannel || globalThis.BroadcastChannel;
    this.channel = null;
    this.beaconTimer = null;
    this.activeRoomId = null;
  }

  _ensureChannel() {
    if (!this.channel) {
      if (!this.BroadcastChannelCtor) {
        throw new Error('BroadcastChannel is not supported in this environment');
      }
      this.channel = new this.BroadcastChannelCtor(this.channelName);
    }
    return this.channel;
  }

  /**
   * Host starts broadcasting room advertisement.
   * @param {object} params
   * @param {string} params.roomId
   * @param {string} [params.hostFaction='WEI']
   * @param {string} [params.hostName='Host']
   * @param {string} params.offerToken
   * @param {Function} [params.onJoinReceived]
   */
  startHost({ roomId, hostFaction = 'WEI', hostName = 'Host', offerToken, onJoinReceived }) {
    this.stop();
    const ch = this._ensureChannel();
    this.activeRoomId = roomId;

    const announce = () => {
      try {
        ch.postMessage({
          type: LOBBY_MSG_TYPE.ANNOUNCE,
          v: 1,
          roomId,
          hostFaction,
          hostName,
          offerToken,
          timestamp: Date.now()
        });
      } catch (_) {}
    };

    ch.onmessage = (event) => {
      const msg = event.data;
      if (!msg || msg.v !== 1) return;

      if (msg.type === LOBBY_MSG_TYPE.JOIN && msg.roomId === this.activeRoomId) {
        if (typeof onJoinReceived === 'function') {
          onJoinReceived(msg.answerToken, msg);
        }
        try {
          ch.postMessage({
            type: LOBBY_MSG_TYPE.ACK,
            v: 1,
            roomId: this.activeRoomId,
            timestamp: Date.now()
          });
        } catch (_) {}
      }
    };

    announce();
    this.beaconTimer = setInterval(announce, 1000);
  }

  /**
   * Client listens for active hosts.
   * @param {Function} onRoomDiscovered
   */
  startListener(onRoomDiscovered) {
    this.stop();
    const ch = this._ensureChannel();

    ch.onmessage = (event) => {
      const msg = event.data;
      if (!msg || msg.v !== 1) return;

      if (msg.type === LOBBY_MSG_TYPE.ANNOUNCE) {
        if (typeof onRoomDiscovered === 'function') {
          onRoomDiscovered(msg);
        }
      }
    };
  }

  /**
   * Client announces intent to join a discovered room.
   * @param {object} params
   * @param {string} params.roomId
   * @param {string} [params.clientFaction='SHU']
   * @param {string} [params.clientName='Client']
   * @param {string} params.answerToken
   */
  sendJoin({ roomId, clientFaction = 'SHU', clientName = 'Client', answerToken }) {
    const ch = this._ensureChannel();
    ch.postMessage({
      type: LOBBY_MSG_TYPE.JOIN,
      v: 1,
      roomId,
      clientFaction,
      clientName,
      answerToken,
      timestamp: Date.now()
    });
  }

  stop() {
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    if (this.channel) {
      try {
        this.channel.close();
      } catch (_) {}
      this.channel = null;
    }
    this.activeRoomId = null;
  }
}

export default {
  TOKEN_PREFIX,
  LOBBY_MSG_TYPE,
  DEFAULT_RTC_CONFIG,
  bufferToBase64Url,
  base64UrlToBuffer,
  encodeSignalToken,
  decodeSignalToken,
  waitForIceGathering,
  createHostOfferSession,
  createClientAnswerSession,
  LobbyDiscovery
};
