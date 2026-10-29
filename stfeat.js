// Strat Trader attributes inside Strat Master P.A (client-side).
// Operates on Strat Master's OWN My Trades journal + local settings.
// Suggestions only — never places orders, never writes to Strat Trader.
(function (root) {
  const POINT = { MES: 5, ES: 50, MNQ: 2, NQ: 20, MGC: 10 };
  const rootOf = s => (String(s || '').toUpperCase().match(/(MES|MNQ|MGC|ES|NQ)/) || [])[1] || String(s || '').toUpperCase();
  const COMBOS = ['2-1-2', '3-1-2', '2-2', '1-2-2', '3-2-2'];

  function ctParts(isoOrMs) {
    const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(d);
    const g = k => p.find(x => x.type === k).value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour').replace('24', '00')}:${g('minute')}`, wd: g('weekday') };
  }
  function bucket(isoOrMs) {
    if (isoOrMs == null) return 'unknown';
    const hm = ctParts(isoOrMs).hm;
    return hm < '08:30' ? 'pre-08:30' : hm < '09:30' ? '08:30-09:30' : hm < '11:00' ? '09:30-11:00' : hm < '13:00' ? '11:00-13:00' : hm < '14:50' ? '13:00-14:50' : 'after-14:50';
  }
  function normCombo(x) {
    x = String(x || '');
    if (/3-1-2/.test(x)) return '3-1-2';
    if (/1-2-2/.test(x)) return '1-2-2';
    if (/3-2-2/.test(x)) return '3-2-2';
    if (/2-1-2/.test(x)) return '2-1-2';
    if (/2-2/.test(x)) return '2-2';
    return x || 'unknown';
  }
  function normTf(x) {
    x = String(x || '').toLowerCase();
    if (/^(1d|d|day|1440)/.test(x)) return '1d';
    const m = x.match(/\d+/);
    return m ? (m[0] === '1440' ? '1d' : m[0] + 'm') : 'unknown';
  }

  // Convert Strat Master My Trades log entries → closed trade records for stats/confidence.
  function fromLog(log) {
    return (log || []).filter(x => x.pnl != null).map(x => {
      const note = x.note || '';
      const stopM = note.match(/SL[^\d]*([\d,.]+)/i);
      const stop = x.stop != null ? +x.stop : (stopM ? +stopM[1].replace(/,/g, '') : null);
      const pv = POINT[rootOf(x.sym)] || 1;
      const qty = x.qty || 1;
      let r = null;
      if (stop != null && x.entry != null && x.entry !== stop) r = +(x.pnl / (Math.abs(x.entry - stop) * pv * qty)).toFixed(3);
      else r = Math.sign(x.pnl);
      const combo = x.combo || normCombo(note);
      return {
        id: String(x.ts), taken: true, symbol: rootOf(x.sym), side: x.dir === 'LONG' || /buy/i.test(x.dir) ? 'Buy' : 'Sell',
        combo, timeframe: x.tf || normTf((note.match(/\b(\d+m|1d)\b/) || [])[1]),
        entry: x.entry, stop, target: x.target, qty, pnl: x.pnl, r: Math.max(-5, Math.min(5, r)),
        outcome: x.pnl > 0 ? 'win' : x.pnl < 0 ? 'loss' : 'breakeven',
        cont: x.cont, half: x.half, t: new Date(x.ts).toISOString(), note: x.note, source: 'strat-master'
      };
    });
  }

  function summarize(trades) {
    const n = trades.length; if (!n) return { n: 0, winRate: 0, avgR: null, expectancy: null, expectancyUsd: null, profitFactor: null, totalPnl: 0 };
    const rs = trades.map(t => t.r).filter(Number.isFinite), ps = trades.map(t => t.pnl).filter(Number.isFinite);
    const wins = trades.filter(t => t.outcome === 'win' || (t.pnl ?? t.r) > 0).length;
    const vals = rs.length ? rs : ps;
    const gw = vals.filter(v => v > 0).reduce((a, b) => a + b, 0), gl = -vals.filter(v => v < 0).reduce((a, b) => a + b, 0);
    const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
    return { n, winRate: wins / n, avgR, expectancy: avgR, expectancyUsd: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null,
      profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : null, totalPnl: ps.reduce((a, b) => a + b, 0) };
  }

  const dims = {
    combo: t => t.combo || 'unknown',
    symbol: t => rootOf(t.symbol),
    timeframe: t => t.timeframe || 'unknown',
    timeOfDay: t => bucket(t.t),
    continuity: t => Number.isFinite(t.cont) ? `${t.cont}/3` : 'unknown',
    target: t => t.half === true ? '50% (long candle)' : t.half === false ? 'full' : 'unknown'
  };

  function allStats(trades) {
    const closed = trades.filter(t => t.taken !== false && (Number.isFinite(t.r) || Number.isFinite(t.pnl)));
    const out = { overall: summarize(closed) };
    for (const [name, f] of Object.entries(dims)) {
      const g = {};
      for (const t of closed) { const k = f(t); (g[k] = g[k] || []).push(t); }
      out[name] = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, summarize(v)]));
    }
    return out;
  }

  // Hierarchical Bayesian shrinkage: 0R → all → combo → combo+symbol. Score 0–100.
  function shrink(mean, n, prior = 0, k = 20) { return !n || !Number.isFinite(mean) ? prior : (n * mean + k * prior) / (n + k); }
  function confidence(alert, trades, opts = {}) {
    const k = opts.k ?? 20, minN = opts.minTrades ?? 20, scale = opts.scaleR ?? 0.5;
    const c = trades.filter(t => t.taken !== false && Number.isFinite(t.r));
    const mean = a => a.length ? a.reduce((x, t) => x + t.r, 0) / a.length : NaN;
    const combo = c.filter(t => t.combo === (alert.combo || alert.setup));
    const setup = combo.filter(t => rootOf(t.symbol) === rootOf(alert.sym || alert.symbol));
    const pAll = shrink(mean(c), c.length, 0, k), pCombo = shrink(mean(combo), combo.length, pAll, k), post = shrink(mean(setup), setup.length, pCombo, k);
    let score = 50 + 50 * Math.tanh(post / scale);
    if (setup.length < minN) { const w = 10 + 15 * setup.length / minN; score = Math.max(50 - w, Math.min(50 + w, score)); }
    return { score: Math.round(Math.max(0, Math.min(100, score))), posteriorR: +post.toFixed(3), n: setup.length, strong: setup.length >= minN };
  }

  // Suggestions never auto-applied. Disable weak combo+symbol+tod; tweak long-candle mult.
  function suggestions(trades, settings, dismissed = [], opts = {}) {
    const minN = opts.minTrades ?? 20, k = opts.k ?? 20, out = [];
    const c = trades.filter(t => t.taken !== false && Number.isFinite(t.r));
    const g = {};
    for (const t of c) if (t.combo) { const key = `${t.combo}|${rootOf(t.symbol)}|${bucket(t.t)}`; (g[key] = g[key] || []).push(t); }
    for (const [key, v] of Object.entries(g)) {
      if (v.length < minN) continue;
      const s = summarize(v), post = shrink(s.avgR, v.length, 0, k), [combo, symbol, tod] = key.split('|');
      if ((settings.disabled || []).some(d => d.combo === combo && d.symbol === symbol && d.timeOfDay === tod)) continue;
      if (post < -0.15) out.push({ id: `disable:${key}`, type: 'disable',
        text: `${combo} on ${symbol} ${tod} CT has ${s.avgR.toFixed(2)}R expectancy over ${s.n} trades; consider hiding these ideas`,
        evidence: { ...s, shrunkR: +post.toFixed(3) }, change: { disable: { combo, symbol, timeOfDay: tod } } });
    }
    const bySym = {};
    for (const t of c) if (t.half === true || t.half === false) (bySym[rootOf(t.symbol)] = bySym[rootOf(t.symbol)] || []).push(t);
    for (const [sym, v] of Object.entries(bySym)) {
      const h = v.filter(t => t.half), f = v.filter(t => !t.half);
      if (h.length < 10 || f.length < 10 || v.length < minN) continue;
      const sh = summarize(h), sf = summarize(f), ph = shrink(sh.avgR, h.length, 0, k), pf = shrink(sf.avgR, f.length, 0, k);
      const cur = settings.longCandleMultBySymbol?.[sym] ?? settings.longCandleMult ?? 1.5;
      const ev = { half: sh, full: sf, shrunkHalfR: +ph.toFixed(3), shrunkFullR: +pf.toFixed(3), currentMult: cur };
      if (ph - pf > 0.15) {
        const nv = +Math.max(1.1, cur - 0.2).toFixed(2);
        out.push({ id: `mult:${sym}:${nv}`, type: 'threshold', text: `The 50% target outperforms on ${sym} (${sh.avgR.toFixed(2)}R vs ${sf.avgR.toFixed(2)}R full); try a ${nv}× long-candle threshold`,
          evidence: ev, change: { longCandleMult: { symbol: sym, value: nv } } });
      } else if (pf - ph > 0.15) {
        const nv = +(cur + 0.3).toFixed(2);
        out.push({ id: `mult:${sym}:${nv}`, type: 'threshold', text: `The full target outperforms the 50% target on ${sym} (${sf.avgR.toFixed(2)}R vs ${sh.avgR.toFixed(2)}R); try a ${nv}× long-candle threshold`,
          evidence: ev, change: { longCandleMult: { symbol: sym, value: nv } } });
      }
    }
    return out.filter(s => !dismissed.includes(s.id));
  }

  function applySuggestion(settings, sug) {
    const s = JSON.parse(JSON.stringify(settings || {}));
    if (sug.change?.disable) s.disabled = [...(s.disabled || []), sug.change.disable];
    if (sug.change?.longCandleMult) {
      s.longCandleMultBySymbol = { ...(s.longCandleMultBySymbol || {}), [sug.change.longCandleMult.symbol]: sug.change.longCandleMult.value };
    }
    return s;
  }

  function isDisabled(alert, settings) {
    const combo = alert.combo || alert.setup, symbol = rootOf(alert.sym || alert.symbol);
    const tod = bucket(alert.t ? (typeof alert.t === 'number' && alert.t < 1e12 ? alert.t * 1000 : alert.t) : Date.now());
    return (settings?.disabled || []).find(d => d.combo === combo && d.symbol === symbol && d.timeOfDay === tod);
  }

  // Default Apex 25K EOD reference limits (informational; never places orders).
  const APEX_25K_EOD = {
    plan: '25K-EOD', startBalance: 25000, maxDrawdown: 1000, trailing: 'eod',
    dailyLossLimit: 500, maxMinis: 4, microsPerMini: 10, profitTarget: 1500,
    note: 'Apex forbids automated order placement on evaluation and PA accounts. Strat Master P.A only suggests — you place every trade yourself.'
  };

  root.STFeat = { POINT, rootOf, COMBOS, ctParts, bucket, normCombo, normTf, fromLog, summarize, allStats, dims,
    shrink, confidence, suggestions, applySuggestion, isDisabled, APEX_25K_EOD };
  if (typeof module !== 'undefined') module.exports = root.STFeat;
})(typeof self !== 'undefined' ? self : this);
