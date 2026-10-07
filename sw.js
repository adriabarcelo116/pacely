// Funciona sense connexió: serveix l'app des de la memòria cau i l'actualitza en segon pla.
const CACHE = 'pacely-v14';
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest', './js/app.js', './js/plan.js', './js/vdot.js', './js/library.js', './js/sync.js', './js/config.js', './js/gps.js', './js/hr.js', './js/templates.js', './js/coach.js', './js/motion.js', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then(res => {
        if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes('fonts.g'))) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit || Response.error());
      return hit || net;
    })
  );
});
