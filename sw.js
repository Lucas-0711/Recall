const CACHE = 'recall-v2';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-512.png'];
const OPTIONAL = ['./mathjax-tex-svg.js']; // large; only needed for cards with TeX
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ASSETS);
    for (const u of OPTIONAL) { try { await c.add(u); } catch (err) {} }
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const notifyUpdate = () => setTimeout(async () => {
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'update' });
}, 3000);
// Cache first for instant, offline starts; refresh in the background.
// When the app page itself changed, tell open windows so they can offer a reload.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isPage = e.request.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const old = hit && isPage ? hit.clone() : null;
    const net = fetch(e.request).then(async r => {
      if (!r || !r.ok) return r;
      const fresh = old ? r.clone() : null;
      await c.put(e.request, r.clone());
      if (old && (await old.text()) !== (await fresh.text())) notifyUpdate();
      return r;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
