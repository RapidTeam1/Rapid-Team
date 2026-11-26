// Rapid Team: funzionamento offline. Pagine, script e dati: prima la rete (per avere sempre l'ultima versione), poi la copia salvata.
const CACHE = "rapid-team-v29", DATI = "rapid-team-dati";
const BASE = ["./", "index.html", "giro.html", "rt.js", "genera.js", "importa.js", "manifest.webmanifest", "icona-180.png", "icona-192.png", "icona-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE && n !== DATI).map(n => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  const fresco = r.mode === "navigate" || (r.headers.get("accept") || "").includes("text/html") || /\.(webmanifest|js|json|html)$/.test(u.pathname) || u.pathname.endsWith("/");
  if (fresco) {
    const quale = /\/dati\//.test(u.pathname) ? DATI : CACHE;
    // «no-cache»: il browser ricontrolla sempre con GitHub (altrimenti tiene la copia per 10 minuti e i colleghi vedono la versione vecchia)
    e.respondWith(fetch(new Request(r.url, { cache: "no-cache", credentials: "same-origin" })).then(res => { if (res.ok) { const c = res.clone(); caches.open(quale).then(x => x.put(r, c)); } return res; })
      .catch(() => caches.match(r).then(m => m || caches.match(r, { ignoreSearch: true })).then(m => m || caches.match("index.html"))));
  } else {
    // si salvano solo i file trovati (prima veniva salvato anche il «non trovato», es. il logo non ancora caricato)
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); } return res; })));
  }
});
