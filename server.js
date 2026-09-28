/**
 * 三国KARDS 服务端：静态文件 + 联机房间中转（HTTP 轮询）
 *
 * 本机单人：   node server.js
 * 局域网开房： node server.js --lan          （同一 WiFi 的手机/电脑用浏览器打开显示的地址）
 * 公网部署：   HOST=0.0.0.0 PORT=8088 node server.js   （建议前面加 nginx/caddy 做 https）
 *
 * 环境变量：PORT、HOST、ROOM_LIST=1（公开房间列表，局域网模式默认开启）、
 *           CORS_ORIGIN（静态页与服务端分开部署时填页面域名，或 *）
 * 无第三方依赖。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const LAN = process.argv.includes('--lan') || process.env.LAN === '1';
const PORT = Number(process.env.PORT) || 8088;
const HOST = process.env.HOST || (LAN ? '0.0.0.0' : '127.0.0.1');
const ROOM_LIST = process.env.ROOM_LIST ? process.env.ROOM_LIST === '1' : LAN;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const ROOT = path.resolve(__dirname);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
};
// 服务端源码与启动脚本不对外提供
const BLOCKED = new Set(['server.js', 'start-game.ps1']);

// ---------------- 房间中转 ----------------
const MAX_ROOMS = 300;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_QUEUE = 500;
const ROOM_IDLE_MS = 15 * 60 * 1000;
const PRESENCE_MS = 10 * 1000;
const rooms = new Map();

const newCode = () => {
  for (let i = 0; i < 50; i++) {
    const c = String(crypto.randomInt(1000, 10000));
    if (!rooms.has(c)) return c;
  }
  return String(crypto.randomInt(100000, 1000000));
};
const newToken = () => crypto.randomBytes(12).toString('hex');
const seatOf = (room, token) => (token && room.host.token === token ? 'host' : token && room.guest?.token === token ? 'guest' : null);
const other = s => (s === 'host' ? 'guest' : 'host');

function sweep() {
  const now = Date.now();
  for (const [code, r] of rooms) if (now - r.touched > ROOM_IDLE_MS || (r.closed && now - r.touched > 30000)) rooms.delete(code);
}
setInterval(sweep, 30000).unref();

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}/`);
  }
  return out;
}

function corsHeaders() {
  return CORS_ORIGIN ? { 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } : {};
}
function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders() });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); res.end(); return; }
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const now = Date.now();
  try {
    if (parts[1] === 'ping') return reply(res, 200, { ok: true, lan: LAN, list: ROOM_LIST, urls: LAN ? lanAddresses() : [] });
    if (parts[1] !== 'rooms') return reply(res, 404, { error: 'not found' });

    if (parts.length === 2) {
      if (req.method === 'GET') {
        if (!ROOM_LIST) return reply(res, 200, { rooms: [] });
        const list = [...rooms.values()].filter(r => !r.guest && !r.closed && now - r.host.seen < PRESENCE_MS)
          .map(r => ({ code: r.code, name: r.name, age: Math.round((now - r.created) / 1000) }));
        return reply(res, 200, { rooms: list });
      }
      if (req.method === 'POST') {
        sweep();
        if (rooms.size >= MAX_ROOMS) return reply(res, 503, { error: '服务器房间已满，请稍后再试' });
        const body = await readBody(req);
        const code = newCode();
        const room = { code, name: String(body.name || '').slice(0, 20), created: now, touched: now, closed: false,
          host: { token: newToken(), seen: now, inbox: [], seq: 0 }, guest: null };
        rooms.set(code, room);
        return reply(res, 200, { code, token: room.host.token, seat: 'host' });
      }
      return reply(res, 405, { error: 'method' });
    }

    const room = rooms.get(parts[2]);
    const action = parts[3];
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (!room || room.closed) return reply(res, 404, { error: '房间不存在或已关闭' });
    room.touched = now;

    if (action === 'join' && req.method === 'POST') {
      if (room.guest) return reply(res, 409, { error: '房间已满' });
      room.guest = { token: newToken(), seen: now, inbox: [], seq: 0 };
      return reply(res, 200, { code: room.code, token: room.guest.token, seat: 'guest' });
    }

    const token = req.method === 'GET' ? url.searchParams.get('token') : body.token;
    const seat = seatOf(room, token);
    if (!seat) return reply(res, 403, { error: '身份无效' });
    const me = room[seat];
    const peer = room[other(seat)];
    me.seen = now;

    if (action === 'poll' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since')) || 0;
      me.inbox = me.inbox.filter(m => m.i > since);
      return reply(res, 200, { msgs: me.inbox, peer: Boolean(peer && !peer.left && now - peer.seen < PRESENCE_MS), peerLeft: Boolean(peer?.left) });
    }
    if (action === 'send' && req.method === 'POST') {
      if (!peer) return reply(res, 409, { error: '对手尚未加入' });
      const items = Array.isArray(body.batch) ? body.batch : [body.data];
      for (const data of items) {
        if (typeof data !== 'string') continue;
        if (peer.inbox.length >= MAX_QUEUE) return reply(res, 429, { error: '消息积压过多' });
        peer.inbox.push({ i: ++peer.seq, d: data });
      }
      return reply(res, 200, { ok: true });
    }
    if (action === 'leave' && req.method === 'POST') {
      me.left = true;
      room.closed = true;
      return reply(res, 200, { ok: true });
    }
    return reply(res, 404, { error: 'not found' });
  } catch (err) {
    return reply(res, 400, { error: String(err.message || err) });
  }
}

// ---------------- 静态文件 ----------------
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.resolve(ROOT, '.' + path.posix.normalize('/' + rel));
  const inside = filePath.startsWith(ROOT + path.sep);
  const hidden = filePath.slice(ROOT.length).split(path.sep).some(p => p.startsWith('.'));
  if (!inside || hidden || BLOCKED.has(path.basename(filePath))) { res.writeHead(403); res.end(); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); res.end(); return; }
  if (url.pathname.startsWith('/api/')) { handleApi(req, res, url); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log('\n🏯 三国KARDS 已启动');
  console.log(`   本机打开: http://localhost:${PORT}/`);
  if (LAN || HOST === '0.0.0.0') {
    console.log('   同一 WiFi/局域网 的朋友（手机也行）打开：');
    for (const u of lanAddresses()) console.log('     ' + u);
  }
  console.log('   关闭本窗口即停止。\n');
});
