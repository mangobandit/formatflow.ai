// FormatFlow service worker — instant repeat loads + offline shell.
// Strategy:
//   * Static assets (HTML, icons, manifest): stale-while-revalidate.
//   * API routes (/api/*): never cached — always network.
//   * Installer downloads (*.exe): never cached — always network.
//   * Navigations offline: fall back to the cached home page.
// Bump VERSION on release: activate() drops every cache from an older version,
// so returning visitors stop being served assets from a previous deploy.
const VERSION = "ff-v4";
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/og-image.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache API calls.
  if (url.pathname.startsWith("/api/")) return;

  // Never cache installer downloads. They are multi-megabyte binaries, so
  // storing them evicts the small assets the cache exists for, and a stale
  // copy would defeat the SHA-256 we publish for the current build.
  if (url.pathname.endsWith(".exe")) return;

  // Don't try to cache cross-origin (CDN/analytics) — let the network handle it.
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
