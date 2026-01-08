// Simple offline cache for PWA
const CACHE = "gymapp-v11.3.7-premium-delta";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js?v1132",
  "./data.json",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin GET requests
  if (req.method !== "GET" || url.origin !== location.origin) return;

  const isNav = req.mode === "navigate";
  const isCore = url.pathname.endsWith("/index.html") || url.pathname.endsWith("/app.js") || url.pathname.endsWith("/data.json");

  // Network-first for navigations and core files (helps iOS update the app)
  if (isNav || isCore) {
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
