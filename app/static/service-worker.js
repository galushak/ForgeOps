const CACHE_NAME = 'forgeops-v2-print-packets-v2';
const APP_SHELL = [
  '/',
  '/static/styles.css?v=0.8.12-phase2',
  '/static/shell.css?v=0.8.12-phase2',
  '/static/phase2.css?v=0.8.12-phase2-polish',
  '/static/phase3-quotes.css?v=0.8.12-phase3-quotes-v2',
  '/static/phase4-invoices.css?v=0.8.12-phase4-invoices-mobile-fix',
  '/static/phase5-labor.css?v=0.8.12-phase5-labor-final',
  '/static/phase6-ledger.css?v=0.8.12-sales-tax-period-controls',
  '/static/phase7-reports.css?v=0.8.12-phase7-reports',
  '/static/phase8-settings.css?v=0.8.12-phase8-settings',
  '/static/forgeopsv2-final.css?v=0.8.12-forgeopsv2-final',
  '/static/forgeops-packets.css?v=0.8.12-print-packets',
  '/static/js/app.js?v=0.8.12-print-packets-v2',
  '/static/js/packet-renderers.js?v=0.8.12-print-packets',
  '/static/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  // Network-first prevents stale app shells from getting stuck after Docker updates.
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.ok && url.origin === location.origin) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/')))
  );
});
