// Cambia este número cada vez que publiques cambios en la página, para que el teléfono tome la versión nueva.
const CACHE = 'precios-v10';
const APP = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mismo = url.origin === location.origin;
  // Página y precios: primero internet (siempre lo más nuevo); sin conexión, la última copia guardada.
  if (req.mode === 'navigate' || (mismo && url.pathname.includes('/data/'))) {
    const clave = req.mode === 'navigate' ? './index.html' : url.pathname;
    e.respondWith(fetch(req)
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(clave, copy)); } return res; })
      .catch(() => caches.match(clave)));
    return;
  }
  // Íconos y fuentes: primero la copia guardada. Las fotos de productos van directo a internet.
  if (!mismo && !url.host.includes('fonts.g')) return;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
