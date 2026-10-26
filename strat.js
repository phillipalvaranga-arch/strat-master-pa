// Strat Master P.A setup scanner. Pure functions, suggestions only. bars: [{t,o,h,l,c}] oldest->newest, all CLOSED.
(function (root) {
  const SPEC = { MES: { pv: 5, tick: 0.25, name: 'Micro E-mini S&P 500' }, MNQ: { pv: 2, tick: 0.25, name: 'Micro E-mini Nasdaq-100' }, MGC: { pv: 10, tick: 0.1, name: 'Micro Gold' } };
  const typ = (b, p) => b.h > p.h && b.l < p.l ? 3 : b.h <= p.h && b.l >= p.l ? 1 : b.h > p.h ? '2u' : b.l < p.l ? '2d' : 1;
  const rnd = (x, t) => Math.round(x / t) * t;
  function atr(bars, n = 14) { let s = 0, k = 0; for (let i = Math.max(1, bars.length - n); i < bars.length; i++) { const b = bars[i], p = bars[i - 1]; s += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)); k++; } return k ? s / k : 0; }
  // Find a structural target >= minRR away; returns {target, rr} or null.
  function findTarget(bars, i, dir, entry, risk, minRR, look = 60) {
    const lv = []; for (let j = Math.max(0, i - look); j < i; j++) lv.push(dir > 0 ? bars[j].h : bars[j].l);
    const ok = lv.filter(x => dir > 0 ? x - entry >= minRR * risk : entry - x >= minRR * risk).sort((a, b) => dir > 0 ? a - b : b - a);
    return ok.length ? { target: ok[0], rr: Math.abs(ok[0] - entry) / risk } : null;
  }
  function htfDir(h) { if (!h || h.length < 2) return 0; const b = h[h.length - 1]; return b.c > b.o ? 1 : b.c < b.o ? -1 : 0; }
  // scan last closed bar (or index i) for a Strat setup with a trigger on the NEXT bar.
  function scanAt(bars, i, sym, opt = {}) {
    const minRR = opt.minRR || 1.5, sp = SPEC[sym] || { tick: 0.25, pv: 1 };
    if (i < 3) return [];
    const a = bars[i - 2], p = bars[i - 1], b = bars[i], tp = typ(p, a), tb = typ(b, p), A = atr(bars.slice(0, i + 1));
    const out = [];
    const mk = (dir, name, why, base) => {
      const entry = rnd(dir > 0 ? b.h + sp.tick : b.l - sp.tick, sp.tick), stop = rnd(dir > 0 ? b.l - sp.tick : b.h + sp.tick, sp.tick), risk = Math.abs(entry - stop);
      if (risk <= 0 || (A && risk > 2.5 * A)) return;
      const tg = findTarget(bars, i, dir, entry, risk, minRR); if (!tg) return;
      let conf = base; const why2 = [why];
      const h = opt.htf; if (h) { const d = htfDir(h); if (d === dir) { conf += 15; why2.push('higher timeframe candle agrees'); } else if (d === -dir) { conf -= 15; why2.push('higher timeframe candle disagrees (caution)'); } }
      if (tg.rr >= 2.5) { conf += 8; } if (A && risk < 0.8 * A) { conf += 5; why2.push('tight stop'); }
      out.push({ sym, dir: dir > 0 ? 'LONG' : 'SHORT', setup: name, entry, stop, target: rnd(tg.target, sp.tick), rr: +tg.rr.toFixed(2), risk, conf: Math.max(5, Math.min(95, Math.round(conf))), why: why2.join('; '), t: b.t, i });
    };
    if (tb === 1) {
      if (tp === '2u' || tp === '2d') { mk(1, '2-1-2', 'Inside bar after a directional bar; buy a break above the inside bar high', 55); mk(-1, '2-1-2', 'Inside bar after a directional bar; sell a break below the inside bar low', 55); }
      if (tp === 3) { mk(1, '3-1-2', 'Inside bar after an outside bar; buy the break of the inside bar high', 58); mk(-1, '3-1-2', 'Inside bar after an outside bar; sell the break of the inside bar low', 58); }
    }
    if (tb === '2d' && tp === '2d' && b.c > b.o) mk(1, '2-2 reversal', 'Two lower bars, last one closed green; buy if price takes out its high', 50);
    if (tb === '2u' && tp === '2u' && b.c < b.o) mk(-1, '2-2 reversal', 'Two higher bars, last one closed red; sell if price breaks its low', 50);
    return out;
  }
  // Walk forward: did entry trigger on next bars, then stop or target first? (stop first if same bar)
  function outcome(bars, s, maxBars = 24) {
    const L = s.dir === 'LONG'; let inT = false;
    for (let j = s.i + 1; j < Math.min(bars.length, s.i + 1 + maxBars); j++) { const b = bars[j];
      if (!inT) { if (L ? b.h >= s.entry : b.l <= s.entry) inT = true; else if (j >= s.i + 2) return 'no-fill'; else continue; }
      if (L ? b.l <= s.stop : b.h >= s.stop) return 'loss'; if (L ? b.h >= s.target : b.l <= s.target) return 'win'; }
    return inT ? 'open' : 'no-fill';
  }
  function backtest(bars, sym, opt) { const r = { win: 0, loss: 0, R: 0 }; for (let i = 3; i < bars.length - 1; i++) for (const s of scanAt(bars, i, sym, opt)) { const o = outcome(bars, s); if (o === 'win') { r.win++; r.R += s.rr; } else if (o === 'loss') { r.loss++; r.R -= 1; } } return r; }
  function size(acctRisk, s, sym) { const sp = SPEC[sym]; const perC = s.risk * sp.pv; return { perContract: perC, contracts: Math.max(0, Math.floor(acctRisk / perC)) }; }
  const api = { SPEC, typ, scanAt, outcome, backtest, size, atr };
  if (typeof module !== 'undefined') module.exports = api; else root.Strat = api;
})(this);
