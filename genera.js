// Rapid Team: «Genera giro». Ordina i clienti di una lista, li divide per giorni e propone gli orari
// rispettando gli orari di apertura (da Google) e gli appuntamenti fissati. Il risultato è una proposta.
//
// GEN.pianifica(o) con
//   o.clienti  [{ azienda, periodi:[[giorno 0-6, apre min, chiude min]], appuntamento, app_data "AAAA-MM-GG", app_ora "H:MM", app_ora_a "H:MM" (fine della fascia, facoltativa) }]
//   o.tempo    (i, j) => minuti di viaggio tra il punto i e il punto j (0 = partenza, 1..n = clienti)
//   o.dal "AAAA-MM-GG", o.ora "H:MM" (partenza), o.durata (min), o.max (visite al giorno), o.fine "H:MM" (ultima visita finita entro),
//   o.sabato (true = si lavora anche il sabato), o.giorni (giorni del giro scelti da chi lo prepara, predefinito 1),
//   o.orari (true = gli orari di apertura sono un vincolo; false = solo indicativi: la visita fuori orario viene segnalata con «chiuso»)
// restituisce { giorni:[{ iso, visite:[{ k, arrivo, inizio, fine, viaggio, attesa, ritardo, fisso, m, z, chiuso }], partenza, rientro }], fuori:[{ k, motivo }], avvisi:[] }
// Gli appuntamenti con giorno e ora sono l'unico vincolo fisso; con un solo giorno basta l'ora.
// Appuntamento con fascia (26/11/2026, «passi dalle… alle…»): m = inizio fascia, z = fine fascia; la visita inizia tra m e z.
//
// Ordine delle visite (26/11/2026): l'ultimo giorno conta anche il viaggio di rientro alla partenza, così il giro non finisce
// lontano da casa a zig-zag; a parità di tempo (entro 15 min) si parte dal cliente più vicino alla città di partenza
// e ci si allontana a scaletta, rientrando dal più lontano.
"use strict";
(function (root) {
  const MARGINE = 5; // minuti in più per ogni spostamento (parcheggio, ingresso)
  const TOLLERANZA = 15; // minuti: entro questa differenza si preferisce l'ordine «dal più vicino alla partenza»
  const min = s => { const m = String(s || "").match(/^(\d{1,2})[:.](\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const hhmm = m => Math.floor(m / 60) + ":" + String(Math.round(m) % 60).padStart(2, "0");
  const dt = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  // fine della fascia (null se l'appuntamento è a ora precisa o se la fascia non ha senso)
  const fineFascia = (c, m) => { const z = min(c.app_ora_a); return z != null && m != null && z > m ? z : null; };
  const limite = f => f.z != null ? f.z : f.m; // ultimo orario utile per iniziare la visita

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
    const n = o.clienti.length, dur = +o.durata || 30, max = Math.max(1, +o.max || 99);
    const p0 = min(o.ora) ?? 510, fine = min(o.fine) ?? 1110, N = Math.max(1, Math.min(14, +o.giorni || 1)), rispetta = !!o.orari;
    const IU = (c, wd, arr) => rispetta ? inizioUtile(c, wd, arr, dur) : arr;
    const T = (i, j) => i === j ? 0 : o.tempo(i, j) + MARGINE;
    const avvisi = [], fuori = [], fatti = new Set();
    // appuntamenti fissati (giorno + ora o fascia)
    const fissi = {};
    o.clienti.forEach((c, i) => {
      const k = i + 1;
      if (!c.appuntamento || !c.app_data) return;
      if (c.app_data < o.dal) { avvisi.push(`${c.azienda}: l'appuntamento del ${c.app_data.split("-").reverse().join("/")} è prima dell'inizio del giro, la visita è trattata come normale.`); return; }
      const m = min(c.app_ora);
      if (m == null) return; // solo il giorno: gestito come preferenza del giorno
      (fissi[c.app_data] = fissi[c.app_data] || []).push({ k, m, z: fineFascia(c, m) });
    });
    // giro di un giorno: un appuntamento con l'ora ma senza giorno vale per quel giorno
    if (N === 1) o.clienti.forEach((c, i) => { const m = min(c.app_ora); if (c.appuntamento && !c.app_data && m != null) (fissi[o.dal] = fissi[o.dal] || []).push({ k: i + 1, m, z: fineFascia(c, m) }); });
    Object.values(fissi).forEach(l => l.sort((a, b) => limite(a) - limite(b) || a.m - b.m));
    const soloGiorno = {}; // appuntamento con giorno ma senza ora
    o.clienti.forEach((c, i) => { if (c.appuntamento && c.app_data && c.app_data >= o.dal && min(c.app_ora) == null) (soloGiorno[c.app_data] = soloGiorno[c.app_data] || new Set()).add(i + 1); });
    const vincolati = new Set([...Object.values(fissi).flat().map(f => f.k), ...Object.values(soloGiorno).flatMap(s => [...s])]);
    const ultimaData = [...Object.keys(fissi), ...Object.keys(soloGiorno)].sort().pop() || o.dal;

    // i clienti aperti in pochi giorni della settimana passano avanti quando sono aperti
    const raro = [0].concat(o.clienti.map(c => { if (!rispetta) return 0; const lav = o.sabato ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
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
      if (giorni.length >= N || (d - dt(o.dal)) / 864e5 > 20) break; // i giorni li decide chi prepara il giro
      const F = (fissi[I] || []).slice(), SG = soloGiorno[I] || new Set();
      // clienti divisi in modo equilibrato sui giorni che restano
      const quota = Math.min(max, Math.ceil(restano.filter(k => !vincolati.has(k) || SG.has(k)).length / (N - giorni.length)) + F.length);
      let cur = pos, t = p0; const V = [];
      while (true) {
        const prossimo = F[0];
        // un appuntamento con fascia già raggiungibile adesso si fa subito, così non si sfora la fascia
        if (prossimo && prossimo.z != null && t + T(cur, prossimo.k) >= prossimo.m) {
          F.shift(); const arr = t + T(cur, prossimo.k), s = Math.max(arr, prossimo.m);
          V.push({ k: prossimo.k, arrivo: arr, inizio: s, fine: s + dur, viaggio: T(cur, prossimo.k), attesa: s - arr, ritardo: Math.max(0, arr - limite(prossimo)), fisso: true, m: prossimo.m, z: prossimo.z });
          cur = prossimo.k; t = s + dur; continue;
        }
        // candidati: clienti liberi + quelli con appuntamento solo per oggi
        let best = null;
        if (V.length + 1 + F.length <= quota) {
          for (const k of restano) {
            if (fatti.has(k) || V.some(v => v.k === k)) continue;
            if (vincolati.has(k) && !SG.has(k)) continue;
            const c = o.clienti[k - 1], arr = t + T(cur, k), s = IU(c, wd, arr);
            if (s == null || s + dur > fine) continue;
            if (prossimo && s + dur + T(k, prossimo.k) > limite(prossimo)) continue;
            // costo: viaggio + attesa, con il viaggio che pesa di più (con la stessa attesa, es. pausa pranzo, vince il più vicino);
            // i clienti con appuntamento oggi passano avanti
            const costo = (s - t) + 0.5 * T(cur, k) - (SG.has(k) ? 600 : 0) - raro[k] * 30;
            if (!best || costo < best.costo) best = { k, arr, s, costo };
          }
        }
        if (best) { V.push({ k: best.k, arrivo: best.arr, inizio: best.s, fine: best.s + dur, viaggio: T(cur, best.k), attesa: best.s - best.arr }); cur = best.k; t = best.s + dur; continue; }
        if (prossimo) {
          F.shift(); const arr = t + T(cur, prossimo.k), s = Math.max(arr, prossimo.m);
          V.push({ k: prossimo.k, arrivo: arr, inizio: s, fine: s + dur, viaggio: T(cur, prossimo.k), attesa: s - arr, ritardo: Math.max(0, arr - limite(prossimo)), fisso: true, m: prossimo.m, z: prossimo.z });
          cur = prossimo.k; t = s + dur; continue;
        }
        break;
      }
      // ultimo giorno (dopo oggi non resta nessuno): nell'ordine conta anche il rientro alla partenza
      const ultimo = giorni.length === N - 1 || restano.every(k => V.some(v => v.k === k) || SG.has(k));
      migliora(V, pos, p0, wd, o, T, dur, fine, ultimo ? 0 : null, rispetta);
      // orari indicativi: si segnala la visita che cade quando di solito il cliente è chiuso
      V.forEach(v => { const f = finestre(o.clienti[v.k - 1], wd); v.chiuso = f !== null && !f.some(([a, z]) => v.inizio >= a && v.inizio + dur <= z); });
      // appuntamenti «solo giorno» non entrati: restano fuori con avviso
      for (const k of SG) if (!V.some(v => v.k === k)) { fuori.push({ k, motivo: "appuntamento del " + I.split("-").reverse().join("/") + ": non ci sta negli orari o nel numero massimo di visite" }); fatti.add(k); }
      // il giro va avanti a giorni consecutivi: se oggi non entra nessuno ci si ferma (salvo appuntamenti più avanti)
      if (!V.length) { if (I >= ultimaData) break; continue; }
      V.forEach(v => { fatti.add(v.k); if (v.ritardo > 0) avvisi.push(`${o.clienti[v.k - 1].azienda}: con il percorso proposto si arriva circa ${v.ritardo} min dopo ${v.z != null ? "la fine della fascia dell'appuntamento" : "l'orario dell'appuntamento"}.`); });
      giorni.push({ iso: I, partenza: pos, visite: V });
      pos = V[V.length - 1].k;
    }
    for (let k = 1; k <= n; k++) if (!fatti.has(k)) {
      const c = o.clienti[k - 1];
      const ug = giorni.length ? giorni[giorni.length - 1].iso : o.dal;
      fuori.push({ k, motivo: c.appuntamento && c.app_data && c.app_data > ug ? "appuntamento del " + c.app_data.split("-").reverse().join("/") + ", dopo l'ultimo giorno del giro"
        : c.appuntamento && !c.app_data && min(c.app_ora) != null ? "appuntamento alle " + c.app_ora + " senza giorno: indica il giorno nella lista"
        : rispetta && c.periodi && c.periodi.length === 0 ? "risulta sempre chiuso"
        : "non entra in " + N + (N === 1 ? " giorno" : " giorni") + " entro l'orario di fine: aumenta i giorni o sposta l'ultima visita più tardi" });
    }
    if (giorni.length) { const u = giorni[giorni.length - 1], l = u.visite[u.visite.length - 1]; u.rientro = { viaggio: T(l.k, 0), ora: l.fine + T(l.k, 0) }; }
    return { giorni, fuori, avvisi };
  }

  // migliora l'ordine del giorno: inverte tratti del giro (2-opt) e sposta singole visite; tiene la soluzione se costa meno
  // e rispetta orari e appuntamenti. ritorno = 0: l'ultimo giorno si conta anche il rientro alla partenza.
  function migliora(V, p, t0, wd, o, T, dur, fine, ritorno, rispetta) {
    if (V.length < 2) return;
    const sim = seq => {
      let cur = p, t = t0, viaggio = 0; const out = [];
      for (const v of seq) {
        const c = o.clienti[v.k - 1], arr = t + T(cur, v.k);
        let s;
        if (v.fisso) { if (arr > limite(v)) return null; s = Math.max(arr, v.m); }
        else s = rispetta ? inizioUtile(c, wd, arr, dur) : arr;
        if (s == null || s + dur > fine) return null;
        viaggio += T(cur, v.k);
        out.push(Object.assign({}, v, { arrivo: arr, inizio: s, fine: s + dur, viaggio: T(cur, v.k), attesa: s - arr, ritardo: 0 }));
        cur = v.k; t = s + dur;
      }
      if (ritorno != null) { const r = T(cur, ritorno); t += r; viaggio += r; }
      return { out, costo: t + viaggio * 0.5 };
    };
    if (V.some(v => v.ritardo > 0)) return; // se c'è già un ritardo non si tocca l'ordine
    let base = sim(V); if (!base) return;
    const prova = s => { const r = sim(s); if (r && r.costo < base.costo - 0.5) { base = r; V.splice(0, V.length, ...r.out); return true; } return false; };
    for (let giro = 0, meglio = true; meglio && giro < 30; giro++) {
      meglio = false;
      for (let i = 0; i < V.length - 1; i++) for (let j = i + 1; j < V.length; j++)
        if (prova(V.slice(0, i).concat(V.slice(i, j + 1).reverse(), V.slice(j + 1)))) meglio = true;
      for (let i = 0; i < V.length; i++) for (let j = 0; j < V.length; j++) { if (i === j) continue;
        const s = V.slice(); const [x] = s.splice(i, 1); s.splice(j, 0, x); if (prova(s)) meglio = true; }
    }
    // giro con rientro: se il verso opposto costa poco di più, si parte dal cliente più vicino alla partenza
    if (ritorno != null && V.length > 1) {
      const inv = sim(V.slice().reverse());
      if (inv && T(p, V[V.length - 1].k) < T(p, V[0].k) && inv.costo <= base.costo + TOLLERANZA) V.splice(0, V.length, ...inv.out);
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
  if (typeof module !== "undefined") module.exports = root.GEN;
})(typeof window !== "undefined" ? window : globalThis);
