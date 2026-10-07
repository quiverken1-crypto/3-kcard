/* 三国KARDS 离线缓存：卡图/音频缓存优先（改资源时请把 VERSION 加一），代码网络优先、断网回落缓存 */
const VERSION = 'sgk-v62-ios-home-background';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (req.headers.has('range')) return; // 音频分段请求交给浏览器
  const isAsset = /\/assets\//.test(url.pathname);
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (isAsset) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
