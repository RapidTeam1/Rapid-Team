// Rapid Team: libreria comune (accesso, cifratura, lettura e salvataggio dei dati sul repository).
// I dati stanno in dati/utenti.json, dati/config.json, dati/giri.json.
// Ogni giro è cifrato (AES-GCM) con una chiave casuale consegnata (RSA-OAEP) solo a chi lo può vedere.
"use strict";
window.RT = (() => {
  const REPO = "RapidTeam1/Rapid-Team", BRANCH = "main", API = "https://api.github.com/repos/" + REPO + "/contents/";
  const S = crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
  const ITER = 600000, K = "rt-sess", CACHE_DATI = "rapid-team-dati";
  const COLORI = { accento: "#e41519", scuro: "#0c0c0d" };
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

  /* chi vede un giro: chi lo ha creato, i colleghi con cui è condiviso, chi vede tutti i giri, gli amministratori */
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
    if (tok && navigator.onLine !== false) { try { const x = await daAPI(path, tok); if (x.data) return x.data; } catch (e) {} }
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
  async function giri(ctx) {
    const lista = (await leggi("dati/giri.json", ctx.tok)) || [];
    const out = [];
    for (const b of lista) { try { const G = await apre(b, ctx.pk, ctx.nome); if (G) out.push(G); } catch (e) {} }
    return out;
  }
  function colori(c) {
    c = Object.assign({}, COLORI, c || {});
    const r = document.documentElement.style; r.setProperty("--red", c.accento); r.setProperty("--blk", c.scuro);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", c.scuro);
  }

  /* salva (crea o sostituisce) un giro */
  async function salvaGiro(ctx, G) {
    const dest = destinatariGiro(G, ctx.utenti);
    const busta = Object.assign({ id: G.id }, await chiude(G, dest));
    await modifica("dati/giri.json", ctx.tok, lista => {
      lista = Array.isArray(lista) ? lista : [];
      const i = lista.findIndex(b => b.id === G.id);
      if (i >= 0) lista[i] = busta; else lista.push(busta);
      return lista;
    }, (G.creato === G.modificato ? "Nuovo giro: " : "Giro aggiornato: ") + G.titolo + " (" + ctx.nome + ")");
  }
  async function eliminaGiro(ctx, id, titolo) {
    await modifica("dati/giri.json", ctx.tok, lista => (lista || []).filter(b => b.id !== id), "Giro eliminato: " + titolo + " (" + ctx.nome + ")");
  }

  return { REPO, BRANCH, COLORI, ok, esc, b64, tob64, sess, apriChiave, privata, password, nuovoUtente, chiude, apre, riconsegna,
    destinatariGiro, leggi, daAPI, daSito, modifica, carica, giri, salvaGiro, eliminaGiro, colori };
})();
