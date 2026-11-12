const CACHE = 'recall-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-512.png'];
const ZSTD = 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => { await c.addAll(ASSETS); try { await c.add(ZSTD); } catch (err) {} }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !/^https?:/.test(e.request.url)) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }));
});
