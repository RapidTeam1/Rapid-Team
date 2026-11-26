// Rapid Team: libreria comune (accesso, cifratura, lettura e salvataggio dei dati sul repository).
// I dati stanno in dati/utenti.json, dati/config.json, dati/giri.json, dati/liste.json (liste clienti della raccolta).
// Ogni giro e ogni lista sono cifrati (AES-GCM) con una chiave casuale consegnata (RSA-OAEP) solo a chi li può vedere.
"use strict";
window.RT = (() => {
  const REPO = "RapidTeam1/Rapid-Team", BRANCH = "main", API = "https://api.github.com/repos/" + REPO + "/contents/";
  const S = crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
  const ITER = 600000, K = "rt-sess", CACHE_DATI = "rapid-team-dati";
  const COLORI = { accento: "#e41519", scuro: "#0c0c0d" };
  // dati/spunte.json: avanzamento dei giri (visite fatte), una busta per giro con gli stessi destinatari del giro
  const SPUNTE = "dati/spunte.json";
  const BUSTE = ["dati/giri.json", "dati/liste.json", SPUNTE];
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const tob64 = buf => { const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const ok = !!(window.crypto && crypto.subtle);

  /* ---------- sessione ---------- */
  const sess = {
    get() { try { return JSON.parse(sessionStorage.getItem(K) || localStorage.getItem(K) || "null"); } catch (e) { return null; } },
    set(v, ricorda) { try { const j = JSON.stringify(v); sessionStorage.setItem(K, j); if (ricorda) localStorage.setItem(K, j); localStorage.setItem("rt-nome", JSON.stringify(v.nome)); } catch (e) {} },
    del() { try { sessionStorage.removeItem(K); localStorage.removeItem(K); } catch (e) {} }
  };

  /* ---------- chiavi ---------- */
  async function apriChiave(u, pass) {
    const km = await S.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    const k = await S.deriveKey({ name: "PBKDF2", salt: b64(u.salt), iterations: u.it, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pk = await S.importKey("pkcs8", await S.decrypt({ name: "AES-GCM", iv: b64(u.iv) }, k, b64(u.ct)), { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]);
    return S.exportKey("jwk", pk);
  }
  const privata = jwk => S.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  const pubblica = u => S.importKey("spki", b64(u.pub), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);

  function password() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; let p = "";
    const r = rnd(28); for (let i = 0; i < 14; i++) p += A[(r[2 * i] * 256 + r[2 * i + 1]) % A.length];
    return p.slice(0, 5) + "-" + p.slice(5, 10) + "-" + p.slice(10);
  }
  async function nuovoUtente(nome, pass, extra) {
    const kp = await S.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    const pub = await S.exportKey("spki", kp.publicKey), priv = await S.exportKey("pkcs8", kp.privateKey);
    const salt = rnd(16), iv = rnd(12);
    const km = await S.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    const k = await S.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const ct = await S.encrypt({ name: "AES-GCM", iv }, k, priv);
    return Object.assign({ nome, admin: false, tutti: false }, extra || {}, { it: ITER, salt: tob64(salt), iv: tob64(iv), ct: tob64(ct), pub: tob64(pub) });
  }

  // nuova password: ricifra la stessa chiave privata (le chiavi pubbliche e i giri non cambiano)
  async function ricifraChiave(jwk, pass) {
    const pk = await S.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]);
    const priv = await S.exportKey("pkcs8", pk), salt = rnd(16), iv = rnd(12);
    const km = await S.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    const k = await S.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    return { it: ITER, salt: tob64(salt), iv: tob64(iv), ct: tob64(await S.encrypt({ name: "AES-GCM", iv }, k, priv)) };
  }

  /* ---------- buste cifrate: { wraps: {nome: chiave cifrata}, iv, ct } ---------- */
  async function chiude(obj, destinatari) {
    const k = await S.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const raw = await S.exportKey("raw", k), iv = rnd(12), wraps = {};
    for (const u of destinatari) wraps[u.nome] = tob64(await S.encrypt({ name: "RSA-OAEP" }, await pubblica(u), raw));
    const ct = await S.encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(obj)));
    return { wraps, iv: tob64(iv), ct: tob64(ct) };
  }
  async function chiaveBusta(b, pk, nome) {
    const w = b && b.wraps && b.wraps[nome]; if (!w) return null;
    return new Uint8Array(await S.decrypt({ name: "RSA-OAEP" }, pk, b64(w)));
  }
  async function apre(b, pk, nome) {
    const raw = await chiaveBusta(b, pk, nome); if (!raw) return null;
    const k = await S.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    return JSON.parse(dec.decode(await S.decrypt({ name: "AES-GCM", iv: b64(b.iv) }, k, b64(b.ct))));
  }
  // riconsegna la stessa busta a un altro elenco di persone (senza ricifrare il contenuto)
  async function riconsegna(b, pk, nome, destinatari) {
    const raw = await chiaveBusta(b, pk, nome); if (!raw) return b;
    const wraps = {};
    for (const u of destinatari) wraps[u.nome] = tob64(await S.encrypt({ name: "RSA-OAEP" }, await pubblica(u), raw));
    return Object.assign({}, b, { wraps });
  }

  /* chi vede un giro o una lista: chi l'ha creato, i colleghi con cui è condiviso, chi vede tutti i giri, gli amministratori */
  const destinatariGiro = (G, utenti) => utenti.filter(u => u.admin || u.tutti || u.nome === G.autore || (G.condiviso || []).includes(u.nome));

  /* ---------- lettura dati ---------- */
  const utf8b64 = s => tob64(enc.encode(s));
  async function salvaCache(path, testo) { try { const c = await caches.open(CACHE_DATI); await c.put(new Request(path), new Response(testo, { headers: { "Content-Type": "application/json" } })); } catch (e) {} }
  async function daSito(path) {
    try { const r = await fetch(path, { cache: "no-cache" }); if (r.ok) { const t = await r.text(); salvaCache(path, t); return JSON.parse(t); } } catch (e) {}
    try { const c = await caches.open(CACHE_DATI); const m = await c.match(new Request(path)); if (m) return JSON.parse(await m.text()); } catch (e) {}
    return null;
  }
  const hdr = tok => ({ Authorization: "Bearer " + tok, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  async function daAPI(path, tok) {
    const r = await fetch(API + path + "?ref=" + BRANCH + "&t=" + Date.now(), { headers: hdr(tok), cache: "no-store" });
    if (r.status === 404) return { data: null, sha: null };
    if (!r.ok) throw errore(r.status);
    const j = await r.json(); let testo;
    if (j.content && j.encoding === "base64") testo = dec.decode(b64(j.content.replace(/\n/g, "")));
    else { const r2 = await fetch(API + path + "?ref=" + BRANCH + "&t=" + Date.now(), { headers: Object.assign(hdr(tok), { Accept: "application/vnd.github.raw+json" }), cache: "no-store" });
      if (!r2.ok) throw errore(r2.status); testo = await r2.text(); }
    salvaCache(path, testo);
    return { data: JSON.parse(testo), sha: j.sha };
  }
  // legge dalla API (sempre aggiornata) se c'è la chiave GitHub, altrimenti dal sito o dalla copia sul telefono
  async function leggi(path, tok) {
    if (tok && navigator.onLine !== false) { try { const x = await daAPI(path, tok); if (x.data) return x.data; if (x.sha === null) return []; } catch (e) {} }
    return daSito(path);
  }
  function errore(st) {
    const m = st === 401 ? "La chiave GitHub non è valida o è scaduta: l'amministratore deve inserirne una nuova."
      : st === 403 || st === 404 ? "La chiave GitHub non ha il permesso di scrivere sul repository Rapid-Team."
      : st === 422 ? "GitHub ha rifiutato il salvataggio (dati non validi)."
      : "Salvataggio non riuscito (errore " + st + "). Controlla la rete e riprova.";
    const e = new Error(m); e.status = st; return e;
  }
  // legge-modifica-scrive con controllo delle modifiche contemporanee (riprova se un collega ha salvato nel frattempo)
  async function modifica(path, tok, fn, messaggio) {
    if (!tok) throw new Error("Manca la chiave GitHub: l'amministratore deve inserirla nelle impostazioni.");
    for (let i = 0; i < 5; i++) {
      const { data, sha } = await daAPI(path, tok);
      const nuovo = await fn(data);
      const testo = JSON.stringify(nuovo, null, 1);
      const body = { message: messaggio, content: utf8b64(testo), branch: BRANCH }; if (sha) body.sha = sha;
      const r = await fetch(API + path, { method: "PUT", headers: Object.assign(hdr(tok), { "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (r.ok) { salvaCache(path, testo); return nuovo; }
      if (r.status === 409 || (r.status === 422 && i < 4)) { await new Promise(x => setTimeout(x, 400 + 600 * i)); continue; }
      throw errore(r.status);
    }
    throw new Error("Un collega sta salvando nello stesso momento: riprova tra qualche secondo.");
  }

  /* ---------- avvio comune: utenti, impostazioni, chiave GitHub, giri visibili ---------- */
  async function carica(s) {
    const utenti = (await daSito("dati/utenti.json")) || [];
    const config = (await daSito("dati/config.json")) || {};
    const io = utenti.find(u => u.nome === s.nome);
    if (!io) throw new Error("utente sconosciuto");
    const pk = await privata(s.jwk);
    let tok = null; try { if (config.gh) tok = (await apre(config.gh, pk, s.nome)) || null; } catch (e) {}
    const ctx = { utenti, config, io, pk, tok, nome: s.nome, admin: !!io.admin, tutti: !!(io.admin || io.tutti) };
    // controllo: la chiave pubblica salvata deve corrispondere a quella privata appena aperta
    try { const pub = await S.importKey("jwk", { kty: "RSA", n: s.jwk.n, e: s.jwk.e, alg: "RSA-OAEP-256", ext: true }, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
      ctx.pubGiusta = tob64(await S.exportKey("spki", pub)); ctx.pubErrata = ctx.pubGiusta !== io.pub; } catch (e) { ctx.pubErrata = false; }
    colori(config.colori);
    return ctx;
  }
  async function buste(ctx, path) {
    const lista = (await leggi(path, ctx.tok)) || [];
    const out = [];
    for (const b of lista) { try { const G = await apre(b, ctx.pk, ctx.nome); if (G) out.push(G); } catch (e) {} }
    return out;
  }
  const giri = ctx => buste(ctx, "dati/giri.json");
  const liste = ctx => buste(ctx, "dati/liste.json");
  function colori(c) {
    c = Object.assign({}, COLORI, c || {});
    const r = document.documentElement.style; r.setProperty("--red", c.accento); r.setProperty("--blk", c.scuro);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", c.scuro);
  }

  /* salva (crea o sostituisce) un oggetto cifrato in un elenco di buste.
     base = «modificato» della versione che si era aperta: se nel frattempo un collega ha salvato una versione diversa,
     il salvataggio si ferma con e.conflitto = { da, quando } (chi chiama decide se sovrascrivere passando base = null). */
  async function salvaBusta(ctx, path, G, messaggio, base) {
    const dest = destinatariGiro(G, ctx.utenti);
    const busta = Object.assign({ id: G.id }, await chiude(G, dest));
    await modifica(path, ctx.tok, async lista => {
      lista = Array.isArray(lista) ? lista : [];
      const i = lista.findIndex(b => b.id === G.id);
      if (base != null && i >= 0) {
        let cur = null; try { cur = await apre(lista[i], ctx.pk, ctx.nome); } catch (e) {}
        if (cur && String(cur.modificato || "") !== String(base)) {
          const e = new Error("Nel frattempo " + (cur.modificato_da || "un collega") + " ha salvato una versione più recente.");
          e.conflitto = { da: cur.modificato_da || "", quando: cur.modificato || "" }; throw e;
        }
      }
      if (i >= 0) lista[i] = busta; else lista.push(busta);
      return lista;
    }, messaggio);
  }
  async function salvaGiro(ctx, G, base) {
    await salvaBusta(ctx, "dati/giri.json", G, (G.creato === G.modificato ? "Nuovo giro: " : "Giro aggiornato: ") + G.titolo + " (" + ctx.nome + ")", base);
    try { await destSpunte(ctx, G); } catch (e) {} // l'avanzamento segue la condivisione del giro
  }
  const salvaLista = (ctx, L, base) => salvaBusta(ctx, "dati/liste.json", L, (L.creato === L.modificato ? "Nuova lista clienti: " : "Lista clienti aggiornata: ") + L.titolo + " (" + ctx.nome + ")", base);
  async function eliminaGiro(ctx, id, titolo) {
    await modifica("dati/giri.json", ctx.tok, lista => (lista || []).filter(b => b.id !== id), "Giro eliminato: " + titolo + " (" + ctx.nome + ")");
    try { const { data } = await daAPI(SPUNTE, ctx.tok); if (Array.isArray(data) && data.some(b => b.id === id))
      await modifica(SPUNTE, ctx.tok, lista => (lista || []).filter(b => b.id !== id), "Avanzamento eliminato: " + titolo + " (" + ctx.nome + ")"); } catch (e) {}
  }

  /* ---------- avanzamento condiviso del giro (visite fatte) ----------
     Ogni visita ha una chiave stabile: t.uid (assegnato al salvataggio del giro) oppure, per i giri vecchi, indirizzo + azienda.
     Contenuto della busta: { id, autore, per, condiviso, spunte: { chiave: { da, quando } }, modificato, modificato_da }.
     Le spunte toccate si mettono in una coda sul dispositivo (funziona anche senza rete) e si inviano appena possibile. */
  const chiaveContenuto = t => "p:" + String(t.place_id || t.indirizzo || t.ricerca || "").trim().toLowerCase() + "|" + String(t.azienda || "").trim().toLowerCase();
  const chiaveVisita = t => t.uid || chiaveContenuto(t);
  let SP_ETAG = null, SP_ULT = null;
  function apriSpunte(lista, ctx) {
    return (async () => { const out = {};
      for (const b of (Array.isArray(lista) ? lista : [])) { try { const x = await apre(b, ctx.pk, ctx.nome); if (x) out[b.id] = x.spunte || {}; } catch (e) {} }
      return out; })();
  }
  // legge l'avanzamento di tutti i giri visibili: { idGiro: { chiave: { da, quando } } }.
  // Con la chiave GitHub usa la richiesta «condizionata» (se non è cambiato nulla GitHub risponde 304 e non conta nel limite orario).
  async function spunte(ctx, forza) {
    if (ctx.tok && navigator.onLine !== false) {
      try {
        const h = hdr(ctx.tok); if (SP_ETAG && SP_ULT && !forza) h["If-None-Match"] = SP_ETAG;
        const r = await fetch(API + SPUNTE + "?ref=" + BRANCH, { headers: h, cache: "no-store" });
        if (r.status === 304 && SP_ULT) return SP_ULT;
        if (r.status === 404) { SP_ETAG = null; SP_ULT = {}; return SP_ULT; }
        if (r.ok) {
          const j = await r.json(); let testo;
          if (j.content && j.encoding === "base64") testo = dec.decode(b64(j.content.replace(/\n/g, "")));
          else { const r2 = await fetch(API + SPUNTE + "?ref=" + BRANCH + "&t=" + Date.now(), { headers: Object.assign(hdr(ctx.tok), { Accept: "application/vnd.github.raw+json" }), cache: "no-store" }); if (!r2.ok) throw errore(r2.status); testo = await r2.text(); }
          salvaCache(SPUNTE, testo);
          SP_ULT = await apriSpunte(JSON.parse(testo), ctx); SP_ETAG = r.headers.get("ETag"); return SP_ULT;
        }
      } catch (e) {}
    }
    const d = await daSito(SPUNTE); if (d) SP_ULT = await apriSpunte(d, ctx);
    return SP_ULT || {};
  }
  // aggiunge (v: true) o toglie (v: false) le spunte della coda e restituisce l'avanzamento aggiornato del giro
  async function salvaSpunte(ctx, G, ops) {
    const dest = destinatariGiro(G, ctx.utenti); let fin = {};
    await modifica(SPUNTE, ctx.tok, async lista => {
      lista = Array.isArray(lista) ? lista : [];
      const i = lista.findIndex(b => b.id === G.id);
      let cur = null; if (i >= 0) { try { cur = await apre(lista[i], ctx.pk, ctx.nome); } catch (e) {} }
      // avanzamento già salvato ma non leggibile da me: non lo sovrascrivo (si perderebbero le spunte dei colleghi)
      if (i >= 0 && !cur) { const e = new Error("L'avanzamento di questo giro non è ancora condiviso con " + ctx.nome + ": chiedi a chi ha creato il giro di salvarlo di nuovo."); e.bloccato = true; throw e; }
      const S =Object.assign({}, cur && cur.spunte);
      for (const o of ops) { if (o.v) S[o.k] = { da: o.da, quando: o.quando }; else delete S[o.k]; }
      fin = S;
      const obj = { id: G.id, autore: G.autore || "", per: G.per || [], condiviso: G.condiviso || [], spunte: S, modificato: new Date().toISOString(), modificato_da: ctx.nome };
      const b = Object.assign({ id: G.id }, await chiude(obj, dest));
      if (i >= 0) lista[i] = b; else lista.push(b);
      return lista;
    }, "Avanzamento: " + (G.titolo || G.id) + " (" + ctx.nome + ")");
    SP_ETAG = null; if (SP_ULT) SP_ULT[G.id] = fin;
    return fin;
  }
  // dopo il salvataggio di un giro: se è cambiato chi lo vede, l'avanzamento viene riconsegnato alle stesse persone
  async function destSpunte(ctx, G) {
    const { data } = await daAPI(SPUNTE, ctx.tok); if (!Array.isArray(data)) return;
    const b = data.find(x => x.id === G.id); if (!b) return;
    const dest = destinatariGiro(G, ctx.utenti).map(u => u.nome).sort();
    if (JSON.stringify(Object.keys(b.wraps || {}).sort()) === JSON.stringify(dest)) return;
    await salvaSpunte(ctx, G, []);
  }
  // coda delle spunte non ancora inviate, sul dispositivo: { idGiro: [ { k, v, da, quando } ] }
  const CODA = "rt-coda-spunte";
  const coda = {
    tutte() { try { return JSON.parse(localStorage.getItem(CODA) || "{}") || {}; } catch (e) { return {}; } },
    get(id) { return this.tutte()[id] || []; },
    set(id, ops) { try { const c = this.tutte(); if (ops && ops.length) c[id] = ops; else delete c[id]; localStorage.setItem(CODA, JSON.stringify(c)); } catch (e) {} }
  };
  const applica = (S, ops) => { const o = Object.assign({}, S || {}); for (const x of (ops || [])) { if (x.v) o[x.k] = { da: x.da, quando: x.quando }; else delete o[x.k]; } return o; };
  // quante visite del giro risultano fatte (avanzamento condiviso + spunte di questo dispositivo non ancora inviate)
  const fatteGiro = (G, M) => { const S = applica((M || {})[G.id], coda.get(G.id));
    return (G.giorni || []).reduce((n, d) => n + (d.tappe || []).filter(t => S[chiaveVisita(t)]).length, 0); };
  const eliminaLista = (ctx, id, titolo) => modifica("dati/liste.json", ctx.tok, lista => (lista || []).filter(b => b.id !== id), "Lista clienti eliminata: " + titolo + " (" + ctx.nome + ")");

  return { REPO, BRANCH, COLORI, BUSTE, ok, esc, b64, tob64, sess, apriChiave, privata, password, nuovoUtente, ricifraChiave, chiude, apre, riconsegna,
    destinatariGiro, leggi, daAPI, daSito, modifica, carica, giri, liste, salvaGiro, salvaLista, eliminaGiro, eliminaLista, colori,
    SPUNTE, chiaveVisita, chiaveContenuto, spunte, salvaSpunte, coda, applica, fatteGiro };
})();
