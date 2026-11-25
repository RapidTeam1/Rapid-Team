// Rapid Team: «Genera giro». Ordina i clienti di una lista, li divide per giorni e propone gli orari
// rispettando gli orari di apertura (da Google) e gli appuntamenti fissati. Il risultato è una proposta.
//
// GEN.pianifica(o) con
//   o.clienti  [{ azienda, periodi:[[giorno 0-6, apre min, chiude min]], appuntamento, app_data "AAAA-MM-GG", app_ora "H:MM" }]
//   o.tempo    (i, j) => minuti di viaggio tra il punto i e il punto j (0 = partenza, 1..n = clienti)
//   o.dal "AAAA-MM-GG", o.ora "H:MM" (partenza), o.durata (min), o.max (visite al giorno), o.fine "H:MM" (ultima visita finita entro),
//   o.sabato (true = si lavora anche il sabato), o.maxGiorni (giorni di lavoro, predefinito 10)
// restituisce { giorni:[{ iso, visite:[{ k, arrivo, inizio, fine, viaggio, attesa, ritardo }], partenza, rientro }], fuori:[{ k, motivo }], avvisi:[] }
"use strict";
(function (root) {
  const MARGINE = 5; // minuti in più per ogni spostamento (parcheggio, ingresso)
  const min = s => { const m = String(s || "").match(/^(\d{1,2})[:.](\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const hhmm = m => Math.floor(m / 60) + ":" + String(Math.round(m) % 60).padStart(2, "0");
  const dt = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  // finestre di apertura di un giorno della settimana, in minuti dalla mezzanotte
  function finestre(c, wd) {
    if (!c.periodi || !c.periodi.length) return null; // orari sconosciuti
    const f = [];
    for (const [d, a, z] of c.periodi) {
      if (d === wd) f.push([a, z]);
      else if (z > 1440 && (d + 1) % 7 === wd) f.push([0, z - 1440]); // aperto dalla sera prima
    }
    return f.sort((x, y) => x[0] - y[0]);
  }
  // primo orario utile per iniziare la visita (null = non si può quel giorno)
  function inizioUtile(c, wd, arrivo, durata) {
    const f = finestre(c, wd);
    if (f === null) return arrivo;
    for (const [a, z] of f) { const s = Math.max(arrivo, a); if (s + durata <= z) return s; }
    return null;
  }

  function pianifica(o) {
    const n = o.clienti.length, dur = +o.durata || 30, max = Math.max(1, +o.max || 6);
    const p0 = min(o.ora) ?? 510, fine = min(o.fine) ?? 1110, maxG = o.maxGiorni || 10;
    const T = (i, j) => i === j ? 0 : o.tempo(i, j) + MARGINE;
    const avvisi = [], fuori = [], fatti = new Set();
    // appuntamenti fissati (giorno + ora)
    const fissi = {};
    o.clienti.forEach((c, i) => {
      const k = i + 1;
      if (!c.appuntamento || !c.app_data) return;
      if (c.app_data < o.dal) { avvisi.push(`${c.azienda}: l'appuntamento del ${c.app_data.split("-").reverse().join("/")} è prima dell'inizio del giro, la visita è trattata come normale.`); return; }
      const m = min(c.app_ora);
      if (m == null) return; // solo il giorno: gestito come preferenza del giorno
      (fissi[c.app_data] = fissi[c.app_data] || []).push({ k, m });
    });
    Object.values(fissi).forEach(l => l.sort((a, b) => a.m - b.m));
    const soloGiorno = {}; // appuntamento con giorno ma senza ora
    o.clienti.forEach((c, i) => { if (c.appuntamento && c.app_data && c.app_data >= o.dal && min(c.app_ora) == null) (soloGiorno[c.app_data] = soloGiorno[c.app_data] || new Set()).add(i + 1); });
    const vincolati = new Set([...Object.values(fissi).flat().map(f => f.k), ...Object.values(soloGiorno).flatMap(s => [...s])]);
    const ultimaData = [...Object.keys(fissi), ...Object.keys(soloGiorno)].sort().pop() || o.dal;

    // i clienti aperti in pochi giorni della settimana passano avanti quando sono aperti
    const raro = [0].concat(o.clienti.map(c => { const lav = o.sabato ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
      const ap = lav.filter(w => { const f = finestre(c, w); return f === null || f.length; }).length; return Math.max(0, lav.length - ap); }));
    const giorni = [];
    let pos = 0;
    const d = dt(o.dal);
    for (let guard = 0; guard < 60; guard++, d.setDate(d.getDate() + 1)) {
      const I = iso(d), wd = d.getDay();
      const restano = [...Array(n).keys()].map(i => i + 1).filter(k => !fatti.has(k));
      if (!restano.length) break;
      const lavorativo = (wd !== 0 && (wd !== 6 || o.sabato)) || fissi[I] || soloGiorno[I];
      if (!lavorativo) continue;
      if ((giorni.length >= maxG && I > ultimaData) || (d - dt(o.dal)) / 864e5 > 13) break; // al massimo due settimane di calendario
      const F = (fissi[I] || []).slice(), SG = soloGiorno[I] || new Set();
      let cur = pos, t = p0; const V = [];
      while (true) {
        const prossimo = F[0];
        // candidati: clienti liberi + quelli con appuntamento solo per oggi
        let best = null;
        if (V.length + 1 + F.length <= max) {
          for (const k of restano) {
            if (fatti.has(k) || V.some(v => v.k === k)) continue;
            if (vincolati.has(k) && !SG.has(k)) continue;
            const c = o.clienti[k - 1], arr = t + T(cur, k), s = inizioUtile(c, wd, arr, dur);
            if (s == null || s + dur > fine) continue;
            if (prossimo && s + dur + T(k, prossimo.k) > prossimo.m) continue;
            // costo: viaggio + attesa; i clienti con appuntamento oggi passano avanti
            const costo = (s - t) - (SG.has(k) ? 600 : 0) - raro[k] * 30;
            if (!best || costo < best.costo) best = { k, arr, s, costo };
          }
        }
        if (best) { V.push({ k: best.k, arrivo: best.arr, inizio: best.s, fine: best.s + dur, viaggio: T(cur, best.k), attesa: best.s - best.arr }); cur = best.k; t = best.s + dur; continue; }
        if (prossimo) {
          F.shift(); const arr = t + T(cur, prossimo.k), s = Math.max(arr, prossimo.m);
          V.push({ k: prossimo.k, arrivo: arr, inizio: s, fine: s + dur, viaggio: T(cur, prossimo.k), attesa: s - arr, ritardo: Math.max(0, arr - prossimo.m), fisso: true, m: prossimo.m });
          cur = prossimo.k; t = s + dur; continue;
        }
        break;
      }
      migliora(V, pos, p0, wd, o, T, dur, fine);
      // appuntamenti «solo giorno» non entrati: restano fuori con avviso
      for (const k of SG) if (!V.some(v => v.k === k)) { fuori.push({ k, motivo: "appuntamento del " + I.split("-").reverse().join("/") + ": non ci sta negli orari o nel numero massimo di visite" }); fatti.add(k); }
      // il giro va avanti a giorni consecutivi: se oggi non entra nessuno ci si ferma (salvo appuntamenti più avanti)
      if (!V.length) { if (I >= ultimaData) break; continue; }
      V.forEach(v => { fatti.add(v.k); if (v.ritardo > 0) avvisi.push(`${o.clienti[v.k - 1].azienda}: con il percorso proposto si arriva circa ${v.ritardo} min dopo l'orario dell'appuntamento.`); });
      giorni.push({ iso: I, partenza: pos, visite: V });
      pos = V[V.length - 1].k;
    }
    for (let k = 1; k <= n; k++) if (!fatti.has(k)) {
      const c = o.clienti[k - 1];
      fuori.push({ k, motivo: c.periodi && c.periodi.length === 0 ? "risulta sempre chiuso" : giorni.length >= maxG ? "superato il numero massimo di giorni" : c.app_data && c.app_data > iso(new Date(dt(o.dal).getTime() + 13 * 864e5)) ? "appuntamento oltre due settimane dall'inizio del giro" : "non entra nei giorni del giro con i suoi orari di apertura (controlla gli orari o aumenta le visite al giorno)" });
    }
    if (giorni.length) { const u = giorni[giorni.length - 1], l = u.visite[u.visite.length - 1]; u.rientro = { viaggio: T(l.k, 0), ora: l.fine + T(l.k, 0) }; }
    return { giorni, fuori, avvisi };
  }

  // prova a invertire tratti del giro del giorno (2-opt): tiene la soluzione se costa meno e rispetta orari e appuntamenti
  function migliora(V, p, t0, wd, o, T, dur, fine) {
    if (V.length < 3) return;
    const sim = seq => {
      let cur = p, t = t0, viaggio = 0; const out = [];
      for (const v of seq) {
        const c = o.clienti[v.k - 1], arr = t + T(cur, v.k);
        let s;
        if (v.fisso) { if (arr > v.m) return null; s = v.m; }
        else s = inizioUtile(c, wd, arr, dur);
        if (s == null || s + dur > fine) return null;
        viaggio += T(cur, v.k);
        out.push(Object.assign({}, v, { arrivo: arr, inizio: s, fine: s + dur, viaggio: T(cur, v.k), attesa: s - arr, ritardo: 0 }));
        cur = v.k; t = s + dur;
      }
      return { out, costo: t + viaggio * 0.5 };
    };
    if (V.some(v => v.ritardo > 0)) return; // se c'è già un ritardo non si tocca l'ordine
    let base = sim(V); if (!base) return;
    for (let giro = 0, meglio = true; meglio && giro < 20; giro++) {
      meglio = false;
      for (let i = 0; i < V.length - 1; i++) for (let j = i + 1; j < V.length; j++) {
        const s = V.slice(0, i).concat(V.slice(i, j + 1).reverse(), V.slice(j + 1));
        const r = sim(s);
        if (r && r.costo < base.costo - 0.5) { base = r; V.splice(0, V.length, ...r.out); meglio = true; }
      }
    }
  }

  // stima in linea d'aria (solo se Google non risponde): km × 1,3 a 60 km/h
  function stimaMinuti(a, b) {
    const R = 6371, r = x => x * Math.PI / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.3);
  }

  // periodi Google (Places API New) → [[giorno, apre, chiude]] in minuti; chiude > 1440 se oltre mezzanotte
  function daPeriodiGoogle(periods) {
    if (!periods) return null;
    return periods.map(p => {
      const o = p.open || {}, c = p.close;
      if (!c) return [o.day ?? 0, 0, 2880];
      const a = (o.hour || 0) * 60 + (o.minute || 0);
      let z = ((c.day - o.day + 7) % 7) * 1440 + (c.hour || 0) * 60 + (c.minute || 0);
      if (z <= a) z += 7 * 1440;
      return [o.day, a, z];
    });
  }

  root.GEN = { pianifica, stimaMinuti, daPeriodiGoogle, hhmm, min, MARGINE };
})(typeof window !== "undefined" ? window : globalThis);
