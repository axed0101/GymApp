// Simple offline cache for PWA
const CACHE = "gymapp-v113-accordion";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./data.json",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k===CACHE ? null : caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res)=>{
      // cache same-origin GET
      try{
        const url = new URL(req.url);
        if(req.method==="GET" && url.origin===self.location.origin){
          const copy = res.clone();
          caches.open(CACHE).then(cache=>cache.put(req, copy));
        }
      }catch(e){}
      return res;
    }).catch(()=>caches.match("./index.html")))
  );
});
