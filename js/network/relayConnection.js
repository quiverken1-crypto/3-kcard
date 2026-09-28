/**
 * relayConnection.js — 通过服务端房间中转联机（HTTP 轮询，无需 WebRTC / 端口转发）
 * 与 PeerConnection 提供相同的外部接口：channel / on('open'|'close'|'heartbeat') / disconnect()
 * 服务端：server.js 或 start-game.ps1（/api/...）
 */
import { MicroEventEmitter } from './peerConnection.js';

const SERVER_KEY = 'sgk_relay_server';

/** 联机服务器地址：?server=... > 本地保存 > 当前网站（空字符串） */
export function getServerBase() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('server');
    if (q) return q.replace(/\/+$/, '');
  } catch { /* ignore */ }
  try { return (globalThis.localStorage?.getItem(SERVER_KEY) || '').replace(/\/+$/, ''); } catch { return ''; }
}
export function setServerBase(url) {
  try {
    const v = String(url || '').trim().replace(/\/+$/, '');
    if (v) globalThis.localStorage?.setItem(SERVER_KEY, v); else globalThis.localStorage?.removeItem(SERVER_KEY);
  } catch { /* ignore */ }
}

async function api(base, path, { method = 'GET', body, timeout = 8000 } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetch(`${base}/api/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl?.signal,
      cache: 'no-store'
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 探测服务端是否支持联机中转；不支持（纯静态托管）返回 null */
export async function probeServer(base = getServerBase()) {
  try {
    const d = await api(base, 'ping', { timeout: 3000 });
    return d?.ok ? d : null;
  } catch {
    return null;
  }
}
export const createRoom = (base, name = '') => api(base, 'rooms', { method: 'POST', body: { name } });
export const joinRoom = (base, code) => api(base, `rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: {} });
export const listRooms = (base) => api(base, 'rooms', { timeout: 3000 }).then(d => d?.rooms || []);

/** 模拟 RTCDataChannel 的最小接口，供 Host/ClientSyncManager 使用 */
class RelayChannel {
  constructor(conn) {
    this._conn = conn;
    this._listeners = new Set();
    this.onmessage = null;
    this.readyState = 'connecting';
  }
  send(data) {
    if (this.readyState !== 'open') return;
    this._conn._enqueue(typeof data === 'string' ? data : JSON.stringify(data));
  }
  addEventListener(type, fn) { if (type === 'message') this._listeners.add(fn); }
  removeEventListener(type, fn) { if (type === 'message') this._listeners.delete(fn); }
  _deliver(data) {
    const ev = { data };
    for (const fn of [...this._listeners]) { try { fn(ev); } catch (err) { console.error('[RelayChannel] listener error', err); } }
    if (typeof this.onmessage === 'function') { try { this.onmessage(ev); } catch (err) { console.error(err); } }
  }
  close() { this._conn.disconnect(); }
}

export class RelayConnection extends MicroEventEmitter {
  /**
   * @param {{base:string, code:string, token:string, seat:'host'|'guest'}} opts
   */
  constructor({ base = '', code, token, seat }) {
    super();
    this.base = base;
    this.code = code;
    this.token = token;
    this.seat = seat;
    this.isHost = seat === 'host';
    this.channel = new RelayChannel(this);
    this.rtt = 0;
    this._since = 0;
    this._outbox = [];
    this._sending = false;
    this._running = false;
    this._peerSeen = false;
    this._peerLostAt = 0;
    this._errorSince = 0;
    this._lastActivity = Date.now();
    this._closed = false;
    this._onPageHide = () => this._beaconLeave();
  }

  start() {
    if (this._running) return this;
    this._running = true;
    globalThis.addEventListener?.('pagehide', this._onPageHide);
    this._pollLoop();
    return this;
  }

  _enqueue(str) {
    this._outbox.push(str);
    this._lastActivity = Date.now();
    this._flush();
  }

  async _flush() {
    if (this._sending || this._closed || !this._outbox.length) return;
    this._sending = true;
    const batch = this._outbox.slice(0, 50);
    try {
      await api(this.base, `rooms/${this.code}/send`, { method: 'POST', body: { token: this.token, batch }, timeout: 15000 });
      this._outbox.splice(0, batch.length);
    } catch (err) {
      if (err.status === 404 || err.status === 403) { this._close('房间已关闭'); return; }
      await new Promise(r => setTimeout(r, 600));
    } finally {
      this._sending = false;
    }
    if (this._outbox.length) this._flush();
  }

  async _pollLoop() {
    while (this._running && !this._closed) {
      const t0 = Date.now();
      try {
        const d = await api(this.base, `rooms/${this.code}/poll?token=${encodeURIComponent(this.token)}&since=${this._since}`, { timeout: 10000 });
        this._errorSince = 0;
        this.rtt = Date.now() - t0;
        this.emit('heartbeat', { rtt: this.rtt, latency: Math.round(this.rtt / 2) });

        if (d.peer && !this._peerSeen) {
          this._peerSeen = true;
          this.channel.readyState = 'open';
          this.emit('open');
        }
        if (d.peer) this._peerLostAt = 0;
        else if (this._peerSeen && !this._peerLostAt) this._peerLostAt = Date.now();

        for (const m of d.msgs || []) {
          if (m.i <= this._since) continue;
          this._since = m.i;
          this._lastActivity = Date.now();
          this.channel._deliver(m.d);
        }

        if (d.peerLeft) { this._close('对方已离开'); break; }
        if (this._peerLostAt && Date.now() - this._peerLostAt > 20000) { this._close('对方掉线'); break; }
      } catch (err) {
        if (err.status === 404 || err.status === 403) { this._close('房间已关闭'); break; }
        if (!this._errorSince) this._errorSince = Date.now();
        if (Date.now() - this._errorSince > 25000) { this._close('与服务器失去连接'); break; }
      }
      const idle = Date.now() - this._lastActivity > 20000;
      const hidden = globalThis.document?.hidden;
      await new Promise(r => setTimeout(r, hidden ? 1500 : idle ? 700 : 250));
    }
  }

  _beaconLeave() {
    if (this._closed) return;
    try {
      globalThis.navigator?.sendBeacon?.(`${this.base}/api/rooms/${this.code}/leave`, JSON.stringify({ token: this.token }));
    } catch { /* ignore */ }
  }

  _close(reason) {
    if (this._closed) return;
    this._closed = true;
    this._running = false;
    this.channel.readyState = 'closed';
    globalThis.removeEventListener?.('pagehide', this._onPageHide);
    this.emit('close', { graceful: false, reason });
  }

  /** 主动离开房间 */
  disconnect(reason = 'USER_DISCONNECT') {
    if (this._closed) return;
    this._closed = true;
    this._running = false;
    this.channel.readyState = 'closed';
    globalThis.removeEventListener?.('pagehide', this._onPageHide);
    api(this.base, `rooms/${this.code}/leave`, { method: 'POST', body: { token: this.token }, timeout: 4000 }).catch(() => {});
  }

  getRtt() { return this.rtt; }
}
