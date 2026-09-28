/**
 * cloudConnection.js — 免服务器公网联机
 *  1. 借助公共 MQTT 服务器（免费）用房间号配对、交换 WebRTC 信令；
 *  2. 尝试 P2P 打洞直连（DataChannel）；
 *  3. 打不通时继续经 MQTT 转发对战消息（兜底）。
 * 自带序号/确认/重传，保证消息不丢不乱序（跨两种通道切换也一样）。
 * 对外接口与 PeerConnection 一致：channel / on('open'|'close'|'heartbeat'|'transport') / disconnect()
 */
import { MicroEventEmitter } from './peerConnection.js';
import { MqttLite } from './mqttLite.js';
import { createHostOfferSession, createClientAnswerSession } from './signaling.js';

export const DEFAULT_BROKERS = [
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];
const PREFIX = 'sgkards/v1';
const ROOM_TTL_MS = 20 * 60 * 1000;

// 国内可用的 STUN 优先，谷歌作补充
export const P2P_RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.chat.bilibili.com:3478'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 0
};
const ICE_OPTS = { rtcConfig: P2P_RTC_CONFIG, timeoutMs: 5000, fastHostTimeoutMs: 3500 };

function brokerList() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('mqtt') || globalThis.localStorage?.getItem('sgk_mqtt');
    if (q) return [q];
  } catch { /* ignore */ }
  return DEFAULT_BROKERS;
}
const rid = () => Math.random().toString(36).slice(2, 10);
const code4 = () => String(Math.floor(1000 + Math.random() * 9000));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connectBroker(index) {
  const list = brokerList();
  const url = list[index];
  if (!url) throw new Error('无效房间号');
  const c = new MqttLite(url);
  await c.connect(7000);
  return c;
}

/** 在 topic 上等待第一条消息（用于读取 retained 房间标记） */
function waitFirst(mqtt, topic, ms) {
  return new Promise(resolve => {
    let off = null;
    const t = setTimeout(() => { off?.(); resolve(null); }, ms);
    off = mqtt.onMessage((tp, payload) => {
      if (tp !== topic) return;
      clearTimeout(t); off(); resolve(payload);
    });
    mqtt.subscribe(topic);
  });
}

class CloudChannel {
  constructor(conn) { this._conn = conn; this._ls = new Set(); this.onmessage = null; this.readyState = 'connecting'; }
  send(data) { if (this.readyState === 'open') this._conn._sendApp(typeof data === 'string' ? data : JSON.stringify(data)); }
  addEventListener(type, fn) { if (type === 'message') this._ls.add(fn); }
  removeEventListener(type, fn) { if (type === 'message') this._ls.delete(fn); }
  _deliver(data) {
    const ev = { data };
    for (const fn of [...this._ls]) { try { fn(ev); } catch (e) { console.error(e); } }
    if (typeof this.onmessage === 'function') { try { this.onmessage(ev); } catch (e) { console.error(e); } }
  }
  close() { this._conn.disconnect(); }
}

export class CloudConnection extends MicroEventEmitter {
  constructor({ mqtt, code, isHost, gid }) {
    super();
    this.mqtt = mqtt;
    this.code = code;
    this.isHost = isHost;
    this.gid = gid;
    this.channel = new CloudChannel(this);
    this.p2p = false;
    this.rtt = 0;
    this._dc = null;
    this._rtc = null;
    this._sendSeq = 0;
    this._unacked = new Map();
    this._recvSeq = 0;
    this._recvBuf = new Map();
    this._lastHeard = Date.now();
    this._closed = false;
    this._opened = false;
    this._timers = [];
    this._onPageHide = () => this._bye();
  }

  get roomTopic() { return `${PREFIX}/${this.code}`; }
  get inTopic() { return this.isHost ? `${this.roomTopic}/h` : `${this.roomTopic}/g/${this.gid}`; }
  get outTopic() { return this.isHost ? `${this.roomTopic}/g/${this.gid}` : `${this.roomTopic}/h`; }

  _startLink() {
    this.mqtt.onMessage((topic, payload) => { if (topic === this.inTopic) this._onEnvelope(payload, false); });
    this.mqtt.onclose = () => this._close('与公共服务器断开');
    globalThis.addEventListener?.('pagehide', this._onPageHide);
    this._timers.push(setInterval(() => this._tick(), 1000));
    this._opened = true;
    this.channel.readyState = 'open';
    setTimeout(() => this.emit('open'), 0);
    if (typeof globalThis.RTCPeerConnection === 'function') this._tryP2P();
  }

  _raw(obj) {
    const s = JSON.stringify({ ...obj, f: this.isHost ? 'h' : this.gid });
    if (this._dc && this._dc.readyState === 'open') {
      try { this._dc.send(s); return; } catch { /* 回落 */ }
    }
    this.mqtt.publish(this.outTopic, s);
  }
  _rawMqtt(obj) { this.mqtt.publish(this.outTopic, JSON.stringify({ ...obj, f: this.isHost ? 'h' : this.gid })); }

  _sendApp(data) {
    const n = ++this._sendSeq;
    this._unacked.set(n, { d: data, t: Date.now() });
    this._raw({ k: 'm', n, d: data });
  }

  _onEnvelope(payload, viaDc) {
    let m;
    try { m = JSON.parse(payload); } catch { return; }
    if (!m || typeof m !== 'object') return;
    // 只接受房间内对手的消息
    if (this.isHost ? m.f !== this.gid : m.f !== 'h') return;
    this._lastHeard = Date.now();
    switch (m.k) {
      case 'm': {
        if (typeof m.n !== 'number') return;
        if (m.n > this._recvSeq && !this._recvBuf.has(m.n)) this._recvBuf.set(m.n, m.d);
        while (this._recvBuf.has(this._recvSeq + 1)) {
          const d = this._recvBuf.get(this._recvSeq + 1);
          this._recvBuf.delete(++this._recvSeq);
          this.channel._deliver(d);
        }
        this._scheduleAck();
        break;
      }
      case 'ack': this._ack(m.a); break;
      case 'p': this._ack(m.a); this._raw({ k: 'po', ts: m.ts, a: this._recvSeq }); break;
      case 'po':
        this._ack(m.a);
        if (m.ts) { this.rtt = Date.now() - m.ts; this.emit('heartbeat', { rtt: this.rtt, latency: Math.round(this.rtt / 2), p2p: this.p2p }); }
        break;
      case 'sig': this._onSignal(m); break;
      case 'bye': this._close('对方已离开'); break;
      default: break;
    }
  }

  _ack(a) {
    if (typeof a !== 'number') return;
    for (const n of [...this._unacked.keys()]) if (n <= a) this._unacked.delete(n);
  }
  _scheduleAck() {
    if (this._ackTimer) return;
    this._ackTimer = setTimeout(() => { this._ackTimer = null; this._raw({ k: 'ack', a: this._recvSeq }); }, 150);
  }

  _tick() {
    if (this._closed) return;
    const now = Date.now();
    for (const [n, it] of this._unacked) {
      if (now - it.t > 2500) { it.t = now; this._raw({ k: 'm', n, d: it.d }); }
    }
    if (!this._pingAt || now - this._pingAt > 2000) { this._pingAt = now; this._raw({ k: 'p', ts: now, a: this._recvSeq }); }
    if (now - this._lastHeard > 25000) this._close('对方掉线');
  }

  // ---------- P2P 打洞 ----------
  async _tryP2P() {
    try {
      if (this.isHost) {
        const s = await createHostOfferSession(ICE_OPTS);
        if (this._closed) { s.cancel(); return; }
        this._rtc = s;
        this._bindDc(s.dc);
        this._rawMqtt({ k: 'sig', offer: s.offerToken });
      }
    } catch (e) {
      console.warn('[cloud] P2P 发起失败，继续使用中转', e);
    }
  }
  async _onSignal(m) {
    try {
      if (!this.isHost && m.offer && !this._rtc) {
        const s = await createClientAnswerSession(m.offer, ICE_OPTS);
        if (this._closed) { s.cancel(); return; }
        this._rtc = s;
        this._rawMqtt({ k: 'sig', answer: s.answerToken });
        s.waitForChannel().then(dc => this._bindDc(dc));
      } else if (this.isHost && m.answer && this._rtc && !this._rtcAnswered) {
        this._rtcAnswered = true;
        await this._rtc.applyAnswer(m.answer);
      }
    } catch (e) {
      console.warn('[cloud] P2P 协商失败，继续使用中转', e);
    }
  }
  _bindDc(dc) {
    if (!dc) return;
    const onOpen = () => {
      if (this._closed) return;
      this._dc = dc;
      this.p2p = true;
      this.emit('transport', { p2p: true });
      // 通道切换：未确认的消息经直连补发一次
      for (const [n, it] of this._unacked) { it.t = Date.now(); this._raw({ k: 'm', n, d: it.d }); }
    };
    dc.onmessage = (ev) => this._onEnvelope(typeof ev.data === 'string' ? ev.data : '', true);
    dc.onclose = () => { if (this._dc === dc) { this._dc = null; this.p2p = false; this.emit('transport', { p2p: false }); } };
    if (dc.readyState === 'open') onOpen(); else dc.onopen = onOpen;
  }

  // ---------- 关闭 ----------
  _bye() {
    if (this._closed) return;
    try { this._raw({ k: 'bye' }); this._rawMqtt({ k: 'bye' }); } catch { /* */ }
  }
  _teardown() {
    this._closed = true;
    this.channel.readyState = 'closed';
    this._timers.forEach(clearInterval);
    clearTimeout(this._ackTimer);
    globalThis.removeEventListener?.('pagehide', this._onPageHide);
    try { this._rtc?.cancel(); } catch { /* */ }
    setTimeout(() => { try { this.mqtt.onclose = null; this.mqtt.end(); } catch { /* */ } }, 300);
  }
  _close(reason) {
    if (this._closed) return;
    this._teardown();
    this.emit('close', { graceful: false, reason });
  }
  disconnect() {
    if (this._closed) return;
    this._bye();
    this._teardown();
  }
  getRtt() { return this.rtt; }
}

/**
 * 创建公网房间。返回 { code, waitForGuest(): Promise<CloudConnection>, cancel() }
 */
export async function cloudCreateRoom({ onStatus } = {}) {
  const list = brokerList();
  let mqtt = null, idx = 0, lastErr = null;
  for (; idx < list.length; idx++) {
    try { onStatus?.(`正在连接公共服务器 ${idx + 1}/${list.length}…`); mqtt = await connectBroker(idx); break; } catch (e) { lastErr = e; }
  }
  if (!mqtt) throw new Error(`公共服务器都连不上（${lastErr?.message || ''}），请检查网络`);

  let code = '';
  for (let i = 0; i < 6; i++) {
    const c = (idx > 0 ? String(idx) : '') + code4();
    const prev = await waitFirst(mqtt, `${PREFIX}/${c}`, 700);
    let busy = false;
    try { const p = prev && JSON.parse(prev); busy = Boolean(p && Date.now() - p.at < ROOM_TTL_MS); } catch { /* */ }
    if (!busy) { code = c; break; }
  }
  if (!code) throw new Error('暂时分配不到房间号，请重试');

  const roomTopic = `${PREFIX}/${code}`;
  mqtt.publish(roomTopic, JSON.stringify({ t: 'room', at: Date.now() }), { retain: true });
  const hostIn = `${roomTopic}/h`;
  mqtt.subscribe(hostIn);

  let cancelled = false;
  let refresh = setInterval(() => mqtt.publish(roomTopic, JSON.stringify({ t: 'room', at: Date.now() }), { retain: true }), 60000);
  const clearRoom = () => { clearInterval(refresh); refresh = null; mqtt.publish(roomTopic, '', { retain: true }); };

  const waitForGuest = () => new Promise((resolve, reject) => {
    let taken = false;
    mqtt.onclose = () => { if (!taken) reject(new Error('与公共服务器断开')); };
    const off = mqtt.onMessage((topic, payload) => {
      if (topic !== hostIn || cancelled) return;
      let m; try { m = JSON.parse(payload); } catch { return; }
      if (m?.k !== 'join' || typeof m.gid !== 'string') return;
      const reply = `${roomTopic}/g/${m.gid}`;
      if (taken) { mqtt.publish(reply, JSON.stringify({ k: 'full', f: 'h' })); return; }
      taken = true;
      off();
      clearRoom();
      mqtt.publish(reply, JSON.stringify({ k: 'accept', f: 'h' }));
      const conn = new CloudConnection({ mqtt, code, isHost: true, gid: m.gid });
      conn._startLink();
      resolve(conn);
    });
  });

  return {
    code,
    waitForGuest,
    cancel: () => { cancelled = true; try { clearRoom(); } catch { /* */ } setTimeout(() => mqtt.end(), 300); }
  };
}

/** 按房间号加入公网房间，返回 CloudConnection */
export async function cloudJoinRoom(code, { onStatus } = {}) {
  code = String(code).trim();
  const idx = code.length === 5 ? Number(code[0]) : 0;
  onStatus?.('正在连接公共服务器…');
  const mqtt = await connectBroker(idx);
  const roomTopic = `${PREFIX}/${code}`;
  onStatus?.(`正在查找房间 ${code}…`);
  const flag = await waitFirst(mqtt, roomTopic, 3000);
  let ok = false;
  try { const p = flag && JSON.parse(flag); ok = Boolean(p && Date.now() - p.at < ROOM_TTL_MS); } catch { /* */ }
  if (!ok) { mqtt.end(); const e = new Error(`房间 ${code} 不存在、已满或已关闭`); e.status = 404; throw e; }

  const gid = rid();
  const myIn = `${roomTopic}/g/${gid}`;
  const reply = new Promise(resolve => {
    const t = setTimeout(() => { off(); resolve(null); }, 8000);
    const off = mqtt.onMessage((topic, payload) => {
      if (topic !== myIn) return;
      let m; try { m = JSON.parse(payload); } catch { return; }
      if (m?.k === 'accept' || m?.k === 'full') { clearTimeout(t); off(); resolve(m.k); }
    });
  });
  mqtt.subscribe(myIn);
  await sleep(300);
  onStatus?.('正在加入…');
  mqtt.publish(`${roomTopic}/h`, JSON.stringify({ k: 'join', gid }));
  const r = await reply;
  if (r !== 'accept') { mqtt.end(); const e = new Error(r === 'full' ? `房间 ${code} 已满` : '房主没有响应'); e.status = r === 'full' ? 409 : 408; throw e; }
  const conn = new CloudConnection({ mqtt, code, isHost: false, gid });
  conn._startLink();
  return conn;
}
