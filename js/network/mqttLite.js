/**
 * mqttLite.js — 极简 MQTT 3.1.1 over WebSocket 客户端（仅 QoS0：连接/订阅/发布/心跳）
 * 用于借助公共 MQTT 服务器交换联机信令与转发对战消息，无需自建服务器。
 */
const te = new TextEncoder();
const td = new TextDecoder();

function encLen(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
function str(s) {
  const b = te.encode(s);
  return [b.length >> 8, b.length & 0xff, ...b];
}
function packet(type, body) {
  const head = [type, ...encLen(body.length)];
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

export class MqttLite {
  constructor(url, { clientId, keepalive = 30 } = {}) {
    this.url = url;
    this.clientId = clientId || `sgk_${Math.random().toString(36).slice(2, 12)}`;
    this.keepalive = keepalive;
    this.ws = null;
    this.buf = new Uint8Array(0);
    this.handlers = new Set();
    this.onclose = null;
    this.connected = false;
    this._pid = 1;
    this._ping = null;
  }

  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; try { this.ws?.close(); } catch { /* */ } reject(e instanceof Error ? e : new Error(String(e))); } };
      const timer = setTimeout(() => fail(new Error('连接超时')), timeoutMs);
      let ws;
      try {
        ws = new WebSocket(this.url, ['mqtt']);
      } catch (e) { clearTimeout(timer); fail(e); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        const body = [...str('MQTT'), 4, 0x02, this.keepalive >> 8, this.keepalive & 0xff, ...str(this.clientId)];
        ws.send(packet(0x10, body));
      };
      ws.onmessage = (ev) => {
        const data = new Uint8Array(ev.data);
        const merged = new Uint8Array(this.buf.length + data.length);
        merged.set(this.buf, 0); merged.set(data, this.buf.length);
        this.buf = merged;
        this._drain((type, body) => {
          if (type === 0x20 && !settled) {
            clearTimeout(timer);
            if (body[1] !== 0) { fail(new Error(`服务器拒绝连接(${body[1]})`)); return; }
            settled = true;
            this.connected = true;
            this._ping = setInterval(() => this._send(new Uint8Array([0xc0, 0])), this.keepalive * 1000 * 0.6);
            resolve(this);
          }
        });
      };
      ws.onerror = () => fail(new Error('无法连接'));
      ws.onclose = () => {
        clearTimeout(timer);
        const was = this.connected;
        this.connected = false;
        clearInterval(this._ping);
        if (!settled) fail(new Error('连接被关闭'));
        else if (was && this.onclose) this.onclose();
      };
    });
  }

  _drain(onControl) {
    let b = this.buf;
    for (;;) {
      if (b.length < 2) break;
      let mul = 1, len = 0, i = 1, byte;
      do {
        if (i >= b.length) { this.buf = b; return; }
        byte = b[i++];
        len += (byte & 0x7f) * mul;
        mul *= 128;
      } while (byte & 0x80);
      if (b.length < i + len) break;
      const type = b[0];
      const body = b.subarray(i, i + len);
      if ((type & 0xf0) === 0x30) {
        const tlen = (body[0] << 8) | body[1];
        const topic = td.decode(body.subarray(2, 2 + tlen));
        let off = 2 + tlen;
        if ((type >> 1) & 3) off += 2; // QoS>0 带报文标识
        const payload = td.decode(body.subarray(off));
        for (const h of [...this.handlers]) { try { h(topic, payload); } catch (e) { console.error('[mqtt] handler', e); } }
      } else if (onControl) {
        onControl(type & 0xf0, body);
      }
      b = b.subarray(i + len);
    }
    this.buf = b.slice();
  }

  _send(bytes) {
    try { if (this.ws?.readyState === 1) { this.ws.send(bytes); return true; } } catch { /* */ }
    return false;
  }

  subscribe(topic) {
    const id = this._pid++ & 0xffff || 1;
    return this._send(packet(0x82, [id >> 8, id & 0xff, ...str(topic), 0]));
  }

  publish(topic, message, { retain = false } = {}) {
    const payload = te.encode(message);
    const t = str(topic);
    const body = new Uint8Array(t.length + payload.length);
    body.set(t, 0); body.set(payload, t.length);
    return this._send(packet(0x30 | (retain ? 1 : 0), body));
  }

  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }

  end() {
    clearInterval(this._ping);
    this.connected = false;
    this._send(new Uint8Array([0xe0, 0]));
    try { this.ws?.close(); } catch { /* */ }
  }
}
