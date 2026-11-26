// Rapid Team: «Importa file» (Excel/CSV). Riconosce da solo, riga per riga, i dati dei clienti
// (nello stesso foglio possono esserci righe con formati diversi). Qui solo funzioni senza Google:
// la ricerca delle posizioni la fa index.html, che usa IMP.valuta per giudicare il risultato.
"use strict";
(function (root) {
  const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
  const PROV = new Set(("AG AL AN AO AP AQ AR AT AV BA BG BI BL BN BO BR BS BT BZ CA CB CE CH CL CN CO CR CS CT CZ EN FC FE FG FI FM FR GE GO GR IM IS KR LC LE LI LO LT LU MB MC ME MI MN MO MS MT NA NO NU OR PA PC PD PE PG PI PN PO PR PT PU PV PZ RA RC RE RG RI RM RN RO SA SI SO SP SR SS SU SV TA TE TN TO TP TR TS TV UD VA VB VC VE VI VR VT VV FO PS SM").split(" "));
  const VIE = ["via", "viale", "v\\.\\s?le", "vle", "v\\.", "corso", "c\\.\\s?so", "piazza", "piazzale", "piazzetta", "p\\.\\s?zza", "p\\.\\s?za", "p\\.\\s?le", "strada", "str\\.", "s\\.\\s?s\\.", "ss", "s\\.\\s?p\\.", "sp", "localit[aà]'?", "loc\\.", "loc", "largo", "l\\.go", "vicolo", "contrada", "c\\.\\s?da", "frazione", "fraz\\.", "fraz", "borgo", "lungomare", "circonvallazione", "zona\\s+(?:industriale|artigianale)", "z\\.\\s?i\\.", "z\\.\\s?a\\.", "traversa", "salita", "calata", "rione", "galleria", "stradello", "stradone", "alzaia", "regione",
    "rue", "avenue", "boulevard", "bd", "chemin", "route", "impasse", "place", "calle", "avenida", "plaza", "carrer", "paseo"];
  const RE_VIA = new RegExp("^(?:" + VIE.join("|") + ")(?=[\\s\\d,.'\"]|$)", "i");
  const RE_VIA_DE = /\S(stra(ss|ß)e|weg|platz|gasse|allee)\s*\d/i;
  const RE_DATA = /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/;
  const RE_DATA_IN = /\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}/;

  /* intestazioni riconosciute (se nel foglio c'è una riga di titoli, vale per le righe sotto) */
  const INTEST = { azienda: "azienda", "ragione sociale": "azienda", cliente: "azienda", ditta: "azienda", nominativo: "azienda", denominazione: "azienda", nome: "azienda", rivenditore: "azienda",
    indirizzo: "indirizzo", via: "indirizzo", cap: "cap", "c.a.p.": "cap", comune: "comune", "città": "comune", citta: "comune", "località": "comune", localita: "comune", paese: "comune",
    provincia: "provincia", prov: "provincia", "prov.": "provincia", pr: "provincia", telefono: "telefono", tel: "telefono", "tel.": "telefono", cellulare: "telefono", cell: "telefono", "cell.": "telefono",
    email: "email", "e-mail": "email", mail: "email", pec: "email", referente: "referente", contatto: "referente", note: "note", nota: "note", descrizione: "note",
    sigla: "sigla", data: "data", "data nota": "data", orari: "orari", "orari di apertura": "orari", "tipo visita": "tipo", tipo: "tipo", giorno: "giorno", ora: "ora", orario: "ora" };
  const intest = v => { if (v == null || v instanceof Date || typeof v === "number") return null;
    const s = String(v).toLowerCase().replace(/[:*]+$/, "").replace(/\s+/g, " ").trim();
    if (INTEST[s]) return INTEST[s];
    if (/^(telefono|tel\.?|cell)/.test(s) && s.length < 20) return "telefono";
    if (/^note/.test(s) && s.length < 20) return "note";
    return null; };

  const due = n => String(n).padStart(2, "0");
  const dataIt = d => due(d.getDate()) + "/" + due(d.getMonth() + 1) + "/" + d.getFullYear();
  const isoDa = v => { if (v instanceof Date) return v.getFullYear() + "-" + due(v.getMonth() + 1) + "-" + due(v.getDate());
    const m = String(v || "").match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/); if (!m) return "";
    const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + due(m[2]) + "-" + due(m[1]); };
  const oraDa = v => { if (v instanceof Date) return v.getHours() + ":" + due(v.getMinutes());
    if (typeof v === "number" && v < 1) { const m = Math.round(v * 1440); return Math.floor(m / 60) + ":" + due(m % 60); }
    const m = String(v || "").match(/^(\d{1,2})[:.](\d{2})/); return m ? +m[1] + ":" + m[2] : ""; };

  /* numeri di telefono in un testo: gruppi di cifre uniti finché formano un numero (9-11 cifre) */
  function numeri(s) {
    const out = []; let cur = [], len = 0;
    const flush = () => { if (len >= 6) out.push(cur.join(" ")); cur = []; len = 0; };
    const re = /(\+?\d+)|([A-Za-zÀ-ÿ]+)/g; let m;
    while ((m = re.exec(s))) {
      if (m[2]) { flush(); continue; }
      cur.push(m[1]); len += m[1].replace(/\D/g, "").length;
      if (len >= 9) flush();
    }
    flush(); return out;
  }
  function eTel(s) {
    const d = s.replace(/\D/g, ""); if (d.length < 6 || s.length > 70) return false;
    if ((s.match(/[A-Za-zÀ-ÿ]/g) || []).length > d.length) return false;
    return numeri(s).length > 0;
  }

  /* una riga del foglio → dati grezzi del cliente */
  function riga(celle, mappa) {
    const r = { azienda: "", indirizzo: "", cap: "", comune: "", provincia: "", tel: [], email: [], web: [], referente: "", note: [], data: "", orari: "", tipo: "", app_data: "", app_ora: "", _ic: -1, _ip: -1 };
    const testi = [];
    const dai = (tipo, v, s, i) => {
      if (tipo === "sigla") return;
      if (tipo === "telefono") { if (s) r.tel.push(s); return; }
      if (tipo === "email") { r.email.push(s); return; }
      if (tipo === "note") { r.note.push(s); return; }
      if (tipo === "data") { r.data = v instanceof Date ? dataIt(v) : s; return; }
      if (tipo === "giorno") { r.app_data = isoDa(v); return; }
      if (tipo === "ora") { r.app_ora = oraDa(v); return; }
      if (tipo === "cap") { r.cap = s.replace(/\D/g, "").padStart(5, "0").slice(0, 5); r._ic = i; return; }
      if (tipo === "provincia") { r.provincia = s.replace(/[()]/g, "").toUpperCase(); r._ip = i; return; }
      if (tipo === "comune") { comune(r, s); return; }
      if (tipo === "azienda") { if (!r.azienda) r.azienda = s; else r.note.push(s); return; }
      r[tipo] = r[tipo] ? r[tipo] + " · " + s : s;
    };
    celle.forEach((v, i) => {
      if (v == null) return;
      const s = v instanceof Date ? dataIt(v) : String(v).replace(/\s+/g, " ").trim();
      if (!s) return;
      if (mappa && mappa[i]) { dai(mappa[i], v, s, i); return; }
      if (v instanceof Date) { if (!r.data) r.data = s; else r.note.push(s); return; }
      if (typeof v === "number") {
        const t = String(Math.round(v));
        if (/^\d{5}$/.test(t) && !r.cap) { r.cap = t; r._ic = i; return; }
        if (t.length >= 6) { r.tel.push(t); return; }
        testi.push([i, t]); return;
      }
      if (/^\d{5}$/.test(s) && !r.cap) { r.cap = s; r._ic = i; return; }
      let m = s.match(/^(\d{5})\s+([A-Za-zÀ-ÿ'][^\d]*)$/);
      if (m && !r.cap && !r.comune) { r.cap = m[1]; r._ic = i; comune(r, m[2]); return; }
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) { r.email.push(s); return; }
      if (/^(https?:\/\/|www\.)/i.test(s)) { r.web.push(s); return; }
      if (RE_DATA.test(s)) { if (!r.data) r.data = s; else r.note.push(s); return; }
      if ((RE_VIA.test(s) || RE_VIA_DE.test(s)) && s.length <= 90 && !r.indirizzo) { r.indirizzo = s; return; }
      if (eTel(s)) { r.tel.push(s); return; }
      m = s.match(/^\(?([A-Za-z]{2})\)?$/);
      if (m && /^\(?[A-Z]{2}\)?$/.test(s) && PROV.has(m[1].toUpperCase()) && !r.provincia) { r.provincia = m[1].toUpperCase(); r._ip = i; return; }
      if (/^[A-Za-z]{1,3}\.?$/.test(s)) return; // sigla di chi ha visitato: si ignora
      testi.push([i, s]);
    });
    // testi: la prima cella di testo che non è una nota è l'azienda; i testi lunghi sono note; i brevi possono essere il comune
    const nota = s => s.length > 80 || RE_DATA_IN.test(s) || s.split(" ").length > 8;
    let k0 = -1;
    if (!r.azienda) { k0 = testi.findIndex(([, s]) => !nota(s)); if (k0 >= 0) r.azienda = testi[k0][1]; }
    const corti = [];
    testi.forEach(([i, s], k) => { if (k === k0) return; if (nota(s) || s.length > 40) r.note.push(s); else corti.push([i, s]); });
    if (!r.comune && corti.length) {
      const luogo = s => /^[A-Za-zÀ-ÿ' .\-()]+$/.test(s);
      let j = corti.findIndex(([i, s]) => luogo(s) && ((r._ip >= 0 && i === r._ip - 1) || (r._ic >= 0 && i === r._ic + 1)));
      if (j < 0) j = corti.findIndex(([, s]) => luogo(s) && s.split(" ").length <= 4);
      if (j >= 0) { comune(r, corti[j][1]); corti.splice(j, 1); }
    }
    corti.forEach(([, s]) => r.note.push(s));
    return r;
  }
  function comune(r, s) {
    let m = s.match(/^(.+?)\s*\(([A-Za-z]{2})\)$/) || s.match(/^(.+?)\s+([A-Z]{2})$/);
    if (m && PROV.has(m[2].toUpperCase())) { r.comune = m[1].trim(); if (!r.provincia) r.provincia = m[2].toUpperCase(); }
    else r.comune = s.trim();
  }

  /* dati grezzi → cliente pronto per l'anteprima */
  function cliente(r) {
    const loc = [r.cap, r.comune, r.provincia].filter(Boolean).join(" ");
    const indirizzo = [r.indirizzo, loc].filter(Boolean).join(", ");
    const altri = [];
    let telefono = "";
    r.tel.forEach((t, k) => { const N = numeri(t);
      if (k === 0 && N.length) { telefono = N[0]; if (N.length > 1 || /[A-Za-zÀ-ÿ]/.test(t)) altri.push(t); }
      else if (t !== telefono) altri.push(t); });
    if (!telefono) { const m = r.note.join(" ").match(/\b(?:cell|cel|tel|telefono|cellulare)\.?\s*:?\s*(\+?\d[\d\s\/.]{7,}\d)/i); if (m) { const N = numeri(m[1]); if (N.length) telefono = N[0]; } }
    const note = [[r.data, r.note.join(" · ")].filter(Boolean).join(" "),
      altri.length ? "Altri numeri: " + altri.join(", ") : "", r.email.length ? "Email: " + r.email.join(", ") : "", r.web.length ? "Sito: " + r.web.join(", ") : ""].filter(Boolean).join(" · ");
    const appuntamento = /appunt/i.test(r.tipo) || !!(r.app_data && r.app_ora);
    return { azienda: r.azienda, via: r.indirizzo, cap: r.cap, comune: r.comune, provincia: r.provincia, indirizzo, telefono, referente: r.referente, orari: r.orari, note,
      appuntamento, app_data: appuntamento ? r.app_data : "", app_ora: appuntamento ? r.app_ora : "", query: [r.azienda, indirizzo].filter(Boolean).join(", ") };
  }

  /* tutti i fogli → clienti riconosciuti e righe saltate */
  function analizza(fogli) {
    const clienti = [], saltate = [], visti = new Set(); let righe = 0, nf = 0;
    for (const F of fogli) {
      if (/leggimi|istruzioni|readme/i.test(F.nome)) continue;
      nf++; let mappa = null;
      F.righe.forEach((celle, n) => {
        const piene = celle.filter(v => v != null && String(v).trim() !== "");
        if (!piene.length) return;
        righe++;
        const tit = celle.map(intest), nt = tit.filter(Boolean).length;
        if (nt >= 2 && nt >= piene.length / 2) { mappa = tit; return; }
        const testo = piene.map(v => v instanceof Date ? dataIt(v) : String(v).trim()).join(" | ").slice(0, 90);
        if (piene.length < 2) { saltate.push({ foglio: F.nome, riga: n + 1, motivo: "una sola cella (titolo o riga incompleta)", testo }); return; }
        const c = cliente(riga(celle, mappa));
        if (!c.azienda) { saltate.push({ foglio: F.nome, riga: n + 1, motivo: "non trovo il nome dell'azienda", testo }); return; }
        const k = chiave(c.azienda, c.comune);
        if (visti.has(k)) { saltate.push({ foglio: F.nome, riga: n + 1, motivo: "doppione di una riga precedente", testo }); return; }
        visti.add(k); c.foglio = F.nome; c.riga = n + 1; clienti.push(c);
      });
    }
    return { clienti, saltate, righe, fogli: nf };
  }

  /* ---------- confronto con il risultato di Google ---------- */
  const STOP = new Set("srl srls snc sas spa sapa ss sc scarl di de del della dello dei degli delle e ed c co f lli flli fratelli figli ditta il lo la le gli i the and gruppo group societa soc coop unipersonale".split(" "));
  const DEBOLI = new Set("ferramenta infissi infisso serramenti serramento porte porta finestre finestra casa edilizia edil serrande tende sistemi italia centro commerciale materiali costruzioni impresa studio service servizi chiusure tecniche".split(" "));
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b[a-z](?:\.[a-z])+\.?/g, m => m.replace(/\./g, "")).replace(/[^a-z0-9]+/g, " ").trim();
  const parole = s => norm(s).split(" ").filter(w => w.length >= 2 && !STOP.has(w));
  const chiave = (az, com) => parole(az).join(" ") + "|" + norm(com);
  function nomeOk(a, b) {
    const A0 = parole(a), B0 = parole(b); if (!A0.length || !B0.length) return false;
    const forti = X => { const f = X.filter(w => !DEBOLI.has(w)); return f.length ? f : X; };
    const A = forti(A0), B = forti(B0);
    const ug = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)));
    const n = A.filter(x => B.some(y => ug(x, y))).length;
    return n >= 1 && n / Math.min(A.length, B.length) >= 0.5;
  }
  function luogoOk(c, ind) {
    const a = " " + norm(ind) + " ";
    if (c.cap && a.includes(" " + c.cap + " ")) return true;
    if (c.comune && a.includes(" " + norm(c.comune) + " ")) return true;
    return c.cap || c.comune ? false : null;
  }
  // places: [{ id, nome, indirizzo, pos, maps, stato, tel, orari, periodi }]
  function valuta(c, places) {
    if (!places || !places.length) return { stato: "no", best: null, usaPos: false, usaInfo: false, motivo: "Google non ha trovato niente: correggi la ricerca e riprova, oppure aggiungilo senza posizione." };
    const P = places.map((p, i) => { const n = nomeOk(c.azienda, p.nome), l = luogoOk(c, p.indirizzo); return { p, n, l, s: (n ? 2 : 0) + (l === true ? 1 : l === null ? 0.5 : 0) - i * 0.01 }; });
    P.sort((x, y) => y.s - x.s);
    const { p, n, l } = P[0];
    let v;
    if (n && l === true) v = { stato: "ok", usaPos: true, usaInfo: true, motivo: "" };
    else if (n && l === null) v = { stato: "ck", usaPos: true, usaInfo: true, motivo: "Nel file manca il comune: controlla che sia l'azienda giusta." };
    else if (n) v = { stato: "ck", usaPos: false, usaInfo: false, motivo: "Google ha trovato «" + p.nome + "» ma in un'altra zona: controlla." };
    else if (l === true) v = { stato: "ck", usaPos: !!c.via, usaInfo: false, motivo: c.via ? "Google ha trovato l'indirizzo ma con un altro nome («" + p.nome + "»): la posizione dovrebbe essere giusta, orari e telefono non presi." : "Google ha trovato «" + p.nome + "» nello stesso comune, con un altro nome: controlla." };
    else v = { stato: "ck", usaPos: false, usaInfo: false, motivo: "Il risultato di Google non sembra il cliente: controlla o cerca di nuovo." };
    if (p.stato === "CLOSED_PERMANENTLY") { v.stato = "ck"; v.motivo = ("Google la segnala come chiusa definitivamente. " + v.motivo).trim(); }
    else if (p.stato === "CLOSED_TEMPORARILY") { v.stato = "ck"; v.motivo = ("Google la segnala come chiusa temporaneamente. " + v.motivo).trim(); }
    return Object.assign(v, { best: p });
  }

  /* ---------- lettura del file nel browser ---------- */
  function carica() {
    if (root.XLSX) return Promise.resolve(root.XLSX);
    if (carica.p) return carica.p;
    return carica.p = new Promise((ok, ko) => { const s = document.createElement("script"); s.src = SHEETJS; s.async = true;
      s.onload = () => root.XLSX ? ok(root.XLSX) : ko(new Error("x")); s.onerror = () => { carica.p = null; ko(new Error("Non riesco a scaricare il lettore dei file Excel: controlla la rete. In alternativa salva il foglio come CSV.")); };
      document.head.appendChild(s); });
  }
  function csv(t) {
    const prima = t.split(/\r?\n/)[0] || "", sep = [";", "\t", ","].map(c => [c, prima.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const R = []; let row = [], cell = "", q = false;
    for (let i = 0; i < t.length; i++) { const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cell); R.push(row); row = []; cell = ""; }
      else cell += ch; }
    if (cell || row.length) { row.push(cell); R.push(row); }
    return R.map(r => r.map(v => v === "" ? null : v));
  }
  async function leggiFile(file) {
    const nome = file.name || "file", buf = await file.arrayBuffer();
    if (/\.(csv|txt)$/i.test(nome)) {
      let t; try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { t = new TextDecoder("windows-1252").decode(buf); }
      return [{ nome: "CSV", righe: csv(t.replace(/^﻿/, "")) }];
    }
    if (!/\.(xlsx|xlsm|xls|ods)$/i.test(nome)) throw new Error("Formato non riconosciuto: carica un file Excel (.xlsx, .xls), .ods oppure .csv.");
    const X = await carica();
    let wb; try { wb = X.read(new Uint8Array(buf), { type: "array", cellDates: true }); } catch (e) { throw new Error("Il file non si apre: è un Excel valido? Prova a salvarlo di nuovo o come CSV."); }
    return wb.SheetNames.map(n => { const ws = wb.Sheets[n]; if (!ws || !ws["!ref"]) return { nome: n, righe: [] };
      const R = X.utils.decode_range(ws["!ref"]), righe = [];
      for (let y = 0; y <= R.e.r; y++) { const row = [];
        for (let x = 0; x <= R.e.c; x++) { const c = ws[X.utils.encode_cell({ r: y, c: x })];
          if (!c || c.v == null || c.t === "e") { row.push(null); continue; }
          if (c.t === "d" || c.v instanceof Date) row.push(c.v);
          else if (c.t === "n") row.push(c.w && /^0\d{4}$/.test(c.w) ? c.w : c.v); // CAP con lo zero davanti
          else row.push(String(c.v)); }
        righe.push(row); }
      return { nome: n, righe }; });
  }

  root.IMP = { analizza, valuta, leggiFile, chiave, norm, nomeOk, luogoOk, numeri, csv };
  if (typeof module !== "undefined") module.exports = root.IMP;
})(typeof window !== "undefined" ? window : globalThis);
