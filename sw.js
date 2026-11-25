// Rapid Team: funzionamento offline. Pagine dei giri: prima la rete (per avere sempre l'ultima versione), poi la copia salvata.
const CACHE = "rapid-team-v8";
const BASE = ["./", "index.html", "manifest.webmanifest", "icona-180.png", "icona-192.png", "icona-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  const html = r.mode === "navigate" || (r.headers.get("accept") || "").includes("text/html") || /\.(webmanifest|js)$/.test(new URL(r.url).pathname);
  if (html) {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match("index.html"))));
  } else {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); return res; })));
  }
});
