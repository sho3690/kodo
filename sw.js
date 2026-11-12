// Keeps a copy of the app's files so it opens offline (the network is always tried first).
const CACHE = 'kodo-v1';
const SHELL = ['./', './index.html', './style.css', './app.js', './charts.js', './store.js', './sample.js', './importer.js', './worker.js', './zip.js', './parse.js', './vendor/echarts.min.js', './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // Other apps live on the same sho3690.github.io address: only remove our own old copies.
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('kodo-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith(new URL('./', location).pathname)) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && !u.search) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true }))));
});
