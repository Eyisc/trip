/* 九州旅程 — offline cache for the encrypted trip page.
 * The page is fetched fresh when online; offline, or when the network is too slow, the last copy
 * is used. Only caches named "trip-…" are touched, because the interpreter app shares this origin. */
const CACHE = 'trip-v1';
const FILES = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const NET_WAIT_MS = 6000;

const timeout = (ms) => {
  const p = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  p.catch(() => {}); // the race may already be over; don't log it
  return p;
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(['./'].concat(FILES).map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('trip-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // weather forecast and map links go straight to the network

  if (req.mode === 'navigate') {
    // Resolves only after the whole page is downloaded and saved, so a stalled download falls back too.
    const fresh = caches.open(CACHE).then((cache) =>
      fetch(url.origin + url.pathname, { cache: 'no-cache' }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const clean = res.redirected
          ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
          : res;
        return cache.put('./', clean.clone()).then(() => clean);
      }));
    event.waitUntil(fresh.catch(() => {}));
    event.respondWith(
      Promise.race([fresh, timeout(NET_WAIT_MS)])
        .catch(() => caches.open(CACHE).then((cache) => cache.match('./')).then((hit) => hit || fresh)),
    );
    return;
  }

  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  }));
});
