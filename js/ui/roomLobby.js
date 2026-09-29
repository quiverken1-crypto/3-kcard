/**
 * roomLobby.js — 房间号联机面板
 *  公网：公共 MQTT 配对 + P2P 打洞，打不通走中转（无需自建服务器）
 *  局域网：本机服务（局域网开房.cmd / server.js）中转，含房间列表与扫码
 */
import {
  getServerBase, setServerBase, probeServer, createRoom, joinRoom, listRooms, RelayConnection
} from '../network/relayConnection.js';
import { cloudCreateRoom, cloudJoinRoom } from '../network/cloudConnection.js';
import { qrSvg } from './qrcode.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isLocalHost = h => /^(localhost|127\.|\[?::1\]?$)/.test(h || '');
const isPrivateHost = h => isLocalHost(h) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h || '') || !h;

export class RoomLobby {
  constructor({ root, onConnected }) {
    this.root = root;
    this.onConnected = onConnected || (() => {});
    this.base = getServerBase();
    this.info = null;
    this.mode = null;
    this.conn = null;        // 局域网等待中的连接
    this.cloudRoom = null;   // 公网等待中的房间
    this.listTimer = null;
    this.active = false;
    this._pendingJoin = null;
    this._busy = false;
    if (root) this._bind();
  }

  $(id) { return this.root.querySelector(`#${id}`); }

  _bind() {
    this.$('net-create-room')?.addEventListener('click', () => this.create());
    this.$('net-join-room')?.addEventListener('click', () => this.join(this.$('net-room-code-input').value));
    this.$('net-room-code-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') this.join(e.target.value); });
    this.$('net-cancel-room')?.addEventListener('click', () => this.cancel());
    this.$('net-server-save')?.addEventListener('click', () => {
      setServerBase(this.$('net-server-input').value);
      this.base = getServerBase();
      this.activate();
    });
    this.root.querySelectorAll('.net-mode-tab').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
  }

  _status(html, kind = '') {
    const el = this.$('net-server-status');
    if (!el) return;
    el.className = `net-server-status ${kind}`;
    el.innerHTML = html;
  }

  _waiting() { return Boolean(this.conn || this.cloudRoom); }

  async activate() {
    this.active = true;
    const input = this.$('net-server-input');
    if (input) input.value = this.base;
    if (this._waiting()) return;
    this.info = await probeServer(this.base);
    if (!this.active) return;
    const pending = this._pendingJoin;
    const preferred = pending?.mode || this.mode || (this.info?.lan ? 'lan' : this.info ? 'lan' : 'cloud');
    this.setMode(this.info ? preferred : (preferred === 'lan' && !pending ? 'cloud' : preferred));
    if (pending) { this._pendingJoin = null; this.join(pending.code, pending.mode); }
  }

  setMode(mode) {
    if (this._waiting() || this._busy) return;
    this.mode = mode;
    this.root.querySelectorAll('.net-mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    this._showActions();
    this._stopListPolling();
    const adv = globalThis.document?.getElementById('net-advanced');
    if (adv) adv.open = false;
    const cfg = this.root.querySelector('.net-server-config');
    if (cfg) cfg.style.display = mode === 'lan' ? '' : 'none';
    if (mode === 'cloud') {
      this.$('net-room-actions')?.classList.remove('disabled');
      this._status('🌐 公网联机：通过免费公共服务器配对，优先 P2P 直连，连不通自动转发。<br>创建房间后把房间号或邀请链接发给朋友，对方打开游戏网址输入房间号即可。', 'ok');
      this._renderLanShare(null);
      return;
    }
    if (!this.info) {
      this.$('net-room-actions')?.classList.add('disabled');
      this._status('局域网联机需要由一台电脑双击「局域网开房.cmd」开服，其他人打开它窗口里显示的地址。<br>不在同一网络，请切到「公网联机」。', 'warn');
      this._renderLanShare(null);
      return;
    }
    this.$('net-room-actions')?.classList.remove('disabled');
    this._status(this.info.lan ? '🟢 局域网联机服务已就绪：创建房间，或从下方列表/房间号加入。' : '🟢 已连接联机服务器：创建房间后把房间号或邀请链接发给朋友。', 'ok');
    this._renderLanShare(this.info.lan ? this.info.urls : null);
    if (this.info.list) this._startListPolling();
  }

  deactivate() {
    this.active = false;
    this._stopListPolling();
    if (this._waiting()) this.cancel();
  }

  /** 通过邀请链接 ?room= 进入时调用 */
  joinWhenReady(code, mode) {
    this._pendingJoin = { code, mode: mode === 'lan' ? 'lan' : mode === 'cloud' ? 'cloud' : null };
    const input = this.$('net-room-code-input');
    if (input) input.value = code;
  }

  _inviteLink(code) {
    const loc = globalThis.location;
    let pageBase = `${loc.origin}${loc.pathname}`;
    if (this.mode === 'lan') {
      if (this.info?.urls?.[0] && isLocalHost(loc.hostname)) pageBase = this.info.urls[0];
    } else if (isPrivateHost(loc.hostname) || loc.protocol === 'file:') {
      return ''; // 本地打开的页面，朋友无法访问，只给房间号
    }
    const u = new URL(pageBase, loc.href);
    u.searchParams.set('room', code);
    u.searchParams.set('net', this.mode);
    if (this.mode === 'lan' && this.base) u.searchParams.set('server', this.base);
    return u.toString();
  }

  _renderLanShare(urls) {
    const box = this.$('net-lan-share');
    if (!box) return;
    if (!urls || !urls.length || this._waiting()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const main = urls.find(u => /\/\/(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(u)) || urls[0];
    box.classList.remove('hidden');
    box.innerHTML = `<div class="net-lan-qr">${qrSvg(main, 132)}</div>
      <div class="net-lan-text"><b>同一 WiFi 的朋友</b>（手机也行）扫码或在浏览器输入：
        ${urls.map(u => `<div class="net-url">${esc(u)}</div>`).join('')}
        <small>若手机打不开，检查电脑防火墙是否允许访问，且双方连的是同一个 WiFi。</small></div>`;
  }

  _startListPolling() {
    this._stopListPolling();
    const tick = async () => {
      if (!this.active || this._waiting() || this.mode !== 'lan') return;
      try {
        const rooms = await listRooms(this.base);
        const box = this.$('net-room-list');
        if (box && !this._waiting() && this.mode === 'lan') {
          box.innerHTML = rooms.length
            ? `<div class="net-list-title">局域网中等待的房间</div>${rooms.map(r => `<button class="net-room-item" data-code="${esc(r.code)}">🏰 房间 ${esc(r.code)}${r.name ? ' · ' + esc(r.name) : ''}<span>加入 ›</span></button>`).join('')}`
            : '';
          box.querySelectorAll('.net-room-item').forEach(b => { b.onclick = () => this.join(b.dataset.code); });
        }
      } catch { /* ignore */ }
    };
    tick();
    this.listTimer = setInterval(tick, 2000);
  }
  _stopListPolling() {
    if (this.listTimer) clearInterval(this.listTimer);
    this.listTimer = null;
    const box = this.$('net-room-list');
    if (box) box.innerHTML = '';
  }

  _showActions() {
    this.$('net-room-actions')?.classList.remove('hidden');
    this.$('net-waiting')?.classList.add('hidden');
    this.root.querySelectorAll('.net-mode-tab').forEach(b => { b.disabled = false; });
  }

  _showWaiting(code) {
    this._stopListPolling();
    this.$('net-room-actions')?.classList.add('hidden');
    this._renderLanShare(null);
    this.root.querySelectorAll('.net-mode-tab').forEach(b => { b.disabled = true; });
    const wait = this.$('net-waiting');
    wait?.classList.remove('hidden');
    this.$('net-room-code').textContent = code;
    const link = this._inviteLink(code);
    let share = wait.querySelector('.net-invite');
    if (!share) { share = globalThis.document.createElement('div'); share.className = 'net-invite'; wait.insertBefore(share, this.$('net-cancel-room')); }
    if (!link) {
      share.innerHTML = `<div class="net-invite-text"><p style="margin:0">你是在本机打开的游戏，朋友需要打开<b>公开的游戏网址</b>（如部署好的 GitHub Pages 地址），在「群雄逐鹿 → 公网联机」里输入房间号 <b>${esc(code)}</b>。从公开网址打开时，这里会直接显示邀请链接和二维码。</p></div>`;
      return;
    }
    share.innerHTML = `<div class="net-invite-qr">${qrSvg(link, 132)}</div>
      <div class="net-invite-text">邀请链接（朋友直接打开即可加入）：
        <input class="net-invite-link" readonly value="${esc(link)}">
        <button class="modal-btn btn-secondary net-copy-link">复制邀请链接</button></div>`;
    share.querySelector('.net-invite-link').onclick = e => e.target.select();
    share.querySelector('.net-copy-link').onclick = e => this._copy(link, e.target);
  }

  async create() {
    if (this._waiting() || this._busy) return;
    if (this.mode === 'cloud') return this._createCloud();
    if (!this.info) return;
    try {
      const r = await createRoom(this.base);
      this._attachRelay(r, true);
      this._showWaiting(r.code);
      this._status('房间已创建，等待对手加入…', 'ok');
    } catch (err) {
      this._status(`创建房间失败：${esc(err.message)}`, 'warn');
    }
  }

  async _createCloud() {
    this._busy = true;
    try {
      const room = await cloudCreateRoom({ onStatus: t => this._status(esc(t)) });
      this._busy = false;
      if (!this.active) { room.cancel(); return; }
      this.cloudRoom = room;
      this._showWaiting(room.code);
      this._status('房间已创建，等待对手加入…', 'ok');
      const conn = await room.waitForGuest();
      if (this.cloudRoom !== room) { conn.disconnect(); return; }
      this.cloudRoom = null;
      this._connected(conn, true);
    } catch (err) {
      this._busy = false;
      if (this.cloudRoom) { this.cloudRoom = null; }
      this._showActions();
      this._status(`公网房间出错：${esc(err.message)}`, 'warn');
    }
  }

  async join(code, forceMode) {
    code = String(code || '').trim();
    if (forceMode && forceMode !== this.mode) { this.mode = null; this.setMode(forceMode); }
    if (!/^\d{4,6}$/.test(code)) { this._status('请输入 4–6 位数字房间号', 'warn'); return; }
    if (this._waiting() || this._busy) return;
    if (this.mode === 'cloud') {
      this._busy = true;
      try {
        const conn = await cloudJoinRoom(code, { onStatus: t => this._status(esc(t)) });
        this._busy = false;
        this._connected(conn, false);
      } catch (err) {
        this._busy = false;
        this._status(`加入失败：${esc(err.message)}`, 'warn');
      }
      return;
    }
    if (!this.info) { this._status('局域网联机服务不可用', 'warn'); return; }
    this._status(`正在加入房间 ${esc(code)}…`);
    try {
      const r = await joinRoom(this.base, code);
      this._attachRelay(r, false);
    } catch (err) {
      this._status(err.status === 404 ? `房间 ${esc(code)} 不存在或已关闭` : err.status === 409 ? `房间 ${esc(code)} 已满` : `加入失败：${esc(err.message)}`, 'warn');
    }
  }

  _connected(conn, isHost) {
    this._status('✅ 已连接！', 'ok');
    this._showActions();
    this.onConnected({ peerConnection: conn, isHost, localFaction: isHost ? 'WEI' : 'SHU' });
  }

  _attachRelay(r, isHost) {
    this._stopListPolling();
    let done = false;
    const conn = new RelayConnection({ base: this.base, code: r.code, token: r.token, seat: r.seat });
    this.conn = conn;
    conn.once('open', () => {
      done = true;
      this.conn = null;
      this._connected(conn, isHost);
    });
    conn.once('close', ({ reason }) => {
      if (done) return;
      this.conn = null;
      this._showActions();
      this._status(`连接结束：${esc(reason || '')}`, 'warn');
      if (this.active && this.mode === 'lan' && this.info?.list) this._startListPolling();
    });
    conn.start();
  }

  cancel() {
    if (this.conn) { try { this.conn.disconnect(); } catch { /* ignore */ } }
    if (this.cloudRoom) { try { this.cloudRoom.cancel(); } catch { /* ignore */ } }
    this.conn = null;
    this.cloudRoom = null;
    this._showActions();
    if (this.active) { const m = this.mode; this.mode = null; this.setMode(m); }
  }

  _copy(text, btn) {
    const ok = () => { const o = btn.textContent; btn.textContent = '✅ 已复制'; setTimeout(() => { btn.textContent = o; }, 1800); };
    if (globalThis.navigator?.clipboard?.writeText && globalThis.isSecureContext) {
      globalThis.navigator.clipboard.writeText(text).then(ok, () => this._fallbackCopy(text, btn, ok));
    } else this._fallbackCopy(text, btn, ok);
  }
  _fallbackCopy(text, btn, ok) {
    const input = btn.parentElement.querySelector('.net-invite-link');
    input?.select();
    try { if (globalThis.document.execCommand('copy')) { ok(); return; } } catch { /* ignore */ }
    btn.textContent = '请长按上方链接手动复制';
  }
}
