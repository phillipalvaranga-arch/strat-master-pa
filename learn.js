// "Learn from my results": reads the app's track record, your Trade Log and Strat Trader journal, and adjusts
// ratings / hides losing combos / tunes take-profit & stop. Suggestions only — never places orders.
(function (root) {
  const K = 8, MIN = 8; // shrinkage strength and minimum sample before hiding/tuning
  const hourCT = t => +new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' });
  const hrLbl = h => { const f = x => (x % 12 || 12) + (x < 12 ? ' AM' : ' PM'); return f(h) + '–' + f((h + 1) % 24); };
  const htfOf = w => /disagrees/.test(w || '') ? 'against' : /agrees/.test(w || '') ? 'with' : 'none';
  const normSetup = x => { x = String(x || ''); return /3-1-2/.test(x) ? '3-1-2' : /1-2-2/.test(x) ? '1-2-2' : /3-2-2/.test(x) ? '3-2-2' : /2-1-2/.test(x) ? '2-1-2' : /2-2/.test(x) ? '2-2' : x ? 'other' : 'unknown'; };
  const normTf = x => { x = String(x || '').toLowerCase(); if (/^(1d|d|day|1440)/.test(x)) return '1d'; const m = x.match(/\d+/); return m ? (m[0] === '1440' ? '1d' : m[0] + 'm') : 'unknown'; };
  // ---- records
  function trackRecords(barsBy, htfBy) { // barsBy[sym][tf] = closed bars
    const recs = [], alt = []; for (const sym in barsBy) for (const tf in barsBy[sym]) { const B = barsBy[sym][tf], H = htfBy?.[sym]?.[tf]; let hi = 0; const sp = Strat.SPEC[sym], bdur = B.length > 1 ? B[1].t - B[0].t : 300, hdur = H && H.length > 1 ? H[1].t - H[0].t : 0;
      for (let i = 3; i < B.length - 1; i++) { let htf = null; if (H) { const end = B[i].t; while (hi < H.length - 1 && H[hi + 1].t + hdur <= end + bdur) hi++; htf = H.slice(Math.max(0, hi - 2), hi + 1); }
        for (const s of Strat.scanAt(B, i, sym, { minRR: 1.5, htf })) { const o = Strat.outcome(B, s); if (o !== 'win' && o !== 'loss') continue;
          const r = { src: 'track', w: 1, sym, tf, setup: normSetup(s.setup), dir: s.dir, hour: hourCT(B[i + 1].t), htf: htfOf(s.why), R: o === 'win' ? s.rr : -1, t: B[i].t };
          // alternate targets/stops for tuning
          r.alt = {}; for (const k of [1.5, 2, 2.5, 3]) for (const pad of [0, 2, 4]) { const d = s.dir === 'LONG' ? 1 : -1, stop = s.stop - d * pad * sp.tick, risk = Math.abs(s.entry - stop);
            const o2 = Strat.outcome(B, { ...s, stop, target: s.entry + d * k * risk }); if (o2 === 'win' || o2 === 'loss') r.alt[k + '|' + pad] = o2 === 'win' ? k : -1; }
          recs.push(r); } } }
    return recs;
  }
  function logRecords(log) { return log.filter(x => x.pnl != null).map(x => { const n = x.note || '', st = n.match(/SL[^\d]*([\d,.]+)/), stop = st ? +st[1].replace(/,/g, '') : null, pv = Strat.SPEC[x.sym]?.pv || 1;
    const R = stop && x.entry !== stop ? x.pnl / (Math.abs(x.entry - stop) * pv * (x.qty || 1)) : Math.sign(x.pnl);
    return { src: 'mine', w: 3, sym: x.sym, tf: normTf((n.match(/\b(\d+m|1d)\b/) || [])[1]), setup: normSetup(n), dir: x.dir, hour: hourCT(x.ts / 1000), htf: 'none', R: Math.max(-3, Math.min(5, R)), t: x.ts / 1000 }; }); }
  function stRecords(j) { return (j || []).filter(t => t.taken !== false && (Number.isFinite(t.r) || Number.isFinite(t.pnl))).map(t => ({ src: 'strat-trader', w: 3, sym: String(t.symbol || '').replace(/[A-Z]\d+$/, ''), tf: normTf(t.timeframe), setup: normSetup(t.combo),
    dir: /buy|long/i.test(t.side) ? 'LONG' : 'SHORT', hour: hourCT(Date.parse(t.t) / 1000), htf: 'none', R: Number.isFinite(t.r) ? Math.max(-3, Math.min(5, t.r)) : Math.sign(t.pnl), t: Date.parse(t.t) / 1000 })); }
  // ---- stats
  function agg(recs, keyf) { const m = {}; for (const r of recs) { const k = keyf(r); if (k == null) continue; const a = m[k] = m[k] || { n: 0, nw: 0, w: 0, wins: 0, sumR: 0, mine: 0 }; a.n++; a.w += r.w; a.sumR += r.R * r.w; a.wins += r.R > 0 ? 1 : 0; if (r.src !== 'track') a.mine++; }
    for (const k in m) { const a = m[k]; a.wr = a.wins / a.n; a.exp = a.sumR / (a.w + K); /* shrunk expectancy in R */ } return m; }
  const DIMS = { setup: r => r.setup, sym: r => r.sym, symtf: r => r.sym + ' ' + r.tf, hour: r => r.hour, dir: r => r.dir, htf: r => r.htf, combo: r => r.sym + ' ' + r.tf + ' ' + r.setup };
  let model = null;
  function build(recs) {
    const st = {}; for (const d in DIMS) st[d] = agg(recs, DIMS[d]);
    const tune = {}; // per sym+tf best target multiple / stop pad from track alternates
    const byST = {}; recs.filter(r => r.alt).forEach(r => (byST[r.sym + ' ' + r.tf] = byST[r.sym + ' ' + r.tf] || []).push(r));
    for (const k in byST) { const rs = byST[k]; if (rs.length < 20) continue; let best = null; const base = rs.reduce((a, r) => a + r.R, 0) / rs.length;
      for (const key of Object.keys(rs[0].alt)) { const v = rs.map(r => r.alt[key]).filter(x => x != null); if (v.length < 15) continue; const e = v.reduce((a, b) => a + b, 0) / (v.length + K);
        if (!best || e > best.e) best = { key, e, n: v.length }; }
      if (best && best.e > base * rs.length / (rs.length + K) + 0.05) { const [mult, pad] = best.key.split('|').map(Number); tune[k] = { mult, pad, e: best.e, n: best.n, base }; } }
    return model = { st, tune, n: recs.length, mine: recs.filter(r => r.src !== 'track').length, at: Date.now() };
  }
  // ---- apply to an idea
  function apply(s, tf) {
    if (!model || !s) return s; s = { ...s }; const r = { sym: s.sym, tf, setup: normSetup(s.setup), dir: s.dir, hour: hourCT(s.t + (TFS_S?.[tf] || 300)), htf: htfOf(s.why) };
    const why = []; let delta = 0;
    for (const d of ['combo', 'symtf', 'setup', 'hour', 'dir', 'htf']) { const a = model.st[d][DIMS[d](r)]; if (!a || a.n < 3) continue; const dd = Math.max(-12, Math.min(12, a.exp * 25)); if (Math.abs(dd) < 2) continue; delta += dd;
      const lbl = d === 'hour' ? hrLbl(r.hour) + ' CT' : d === 'htf' ? (r.htf === 'with' ? 'with the bigger trend' : 'against the bigger trend') : DIMS[d](r);
      why.push(`${lbl}: won ${a.wins} of ${a.n} (${a.exp >= 0 ? '+' : ''}${a.exp.toFixed(2)}R avg${a.n < MIN ? ', small sample' : ''})`); }
    delta = Math.max(-25, Math.min(25, delta)); if (why.length) { s.conf = Math.max(5, Math.min(95, Math.round(s.conf + delta))); s.learn = { delta: Math.round(delta), why }; }
    const c = model.st.combo[DIMS.combo(r)]; if (c && c.n >= MIN && c.exp < -0.2) { s.hidden = true; (s.learn = s.learn || { delta: 0, why: [] }).hideWhy = `${DIMS.combo(r)} lost ${c.n - c.wins} of ${c.n}`; }
    const h = model.st.hour[r.hour]; if (h && h.n >= MIN && h.exp < -0.15) s.hourWarn = `Your results at ${hrLbl(r.hour)} CT are weak (won ${h.wins} of ${h.n}).`;
    const tn = model.tune[s.sym + ' ' + tf]; if (tn && !s.nonStrat) { const sp = Strat.SPEC[s.sym], d = s.dir === 'LONG' ? 1 : -1, rnd = x => +(Math.round(x / sp.tick) * sp.tick).toFixed(sp.tick < .25 ? 1 : 2);
      const stop = rnd(s.stop - d * tn.pad * sp.tick), risk = Math.abs(s.entry - stop); s.stop = stop; s.risk = risk; s.target = rnd(s.entry + d * tn.mult * risk); s.rr = tn.mult;
      (s.learn = s.learn || { delta: 0, why: [] }).why.push(`Take profit set to ${tn.mult}× risk${tn.pad ? ` and stop ${tn.pad} ticks wider` : ''} — worked best on ${s.sym} ${tf} history (${tn.n} trades)`); }
    return s;
  }
  function insights() {
    if (!model) return []; const out = [], st = model.st;
    if (!model.n) return [{ c: 'a', t: 'Learning was reset — starting fresh. Ideas use normal ratings until new results come in.' }];
    if (model.mine < 10) out.push({ c: 'a', t: `Only ${model.mine} of your own logged trades so far — most learning comes from the app's price-history record. Log trades to make it personal.` });
    const combos = Object.entries(st.combo).filter(([, a]) => a.n >= MIN).sort((a, b) => b[1].exp - a[1].exp);
    combos.filter(([, a]) => a.exp < -0.2).slice(0, 4).forEach(([k, a]) => out.push({ c: 'r', t: `${k} has lost ${a.n - a.wins} of ${a.n} — hiding these ideas.` }));
    if (combos[0] && combos[0][1].exp > 0.05) out.push({ c: 'g', t: `Best: ${combos[0][0]} (won ${combos[0][1].wins} of ${combos[0][1].n}, +${combos[0][1].exp.toFixed(2)}R avg).` });
    const hrs = Object.entries(st.hour).filter(([h, a]) => a.n >= MIN && +h >= 8 && +h <= 14).sort((a, b) => b[1].exp - a[1].exp);
    if (hrs[0] && hrs[0][1].exp > 0.05) out.push({ c: 'g', t: `Best hour: ${hrLbl(+hrs[0][0])} CT (won ${hrs[0][1].wins} of ${hrs[0][1].n}).` });
    hrs.filter(([, a]) => a.exp < -0.2).slice(-2).forEach(([k, a]) => out.push({ c: 'r', t: `Weak hour: ${hrLbl(+k)} CT (won ${a.wins} of ${a.n}) — ideas then are rated lower.` }));
    const w = st.htf.with, ag = st.htf.against; if (w && ag && w.n >= MIN && ag.n >= MIN) out.push({ c: w.exp > ag.exp ? 'g' : 'a', t: `With the bigger trend: won ${(w.wr * 100).toFixed(0)}% · against it: ${(ag.wr * 100).toFixed(0)}%.` });
    for (const [k, t] of Object.entries(model.tune)) out.push({ c: 'b', t: `${k}: take profit tuned to ${t.mult}× risk${t.pad ? `, stop ${t.pad} ticks wider` : ''} (${t.n} past trades).` });
    if (!combos.length) out.push({ c: 'a', t: 'Not enough results yet to hide or promote anything (needs 8+ per combo).' });
    return out;
  }
  root.Learn = { trackRecords, logRecords, stRecords, build, apply, insights, get model() { return model; }, normSetup, normTf, hrLbl };
})(this);
