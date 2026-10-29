// Strat Master P.A setup scanner. Pure functions, suggestions only. bars: [{t,o,h,l,c}] oldest->newest, all CLOSED.
// Combos match Strat Trader: 2-1-2, 3-1-2, 2-2, 1-2-2, 3-2-2 + long-candle 50% target + multi-TF continuity.
(function (root) {
  const SPEC = { MES: { pv: 5, tick: 0.25, name: 'Micro E-mini S&P 500' }, MNQ: { pv: 2, tick: 0.25, name: 'Micro E-mini Nasdaq-100' }, MGC: { pv: 10, tick: 0.1, name: 'Micro Gold' } };
  const ALL_COMBOS = ['2-1-2', '3-1-2', '2-2', '1-2-2', '3-2-2'];
  const typ = (b, p) => b.h > p.h && b.l < p.l ? 3 : b.h <= p.h && b.l >= p.l ? 1 : b.h > p.h ? '2u' : b.l < p.l ? '2d' : 1;
  const rnd = (x, t) => +(Math.round(x / t) * t).toFixed(t < 0.25 ? 1 : 2);
  function atr(bars, n = 14) { let s = 0, k = 0; for (let i = Math.max(1, bars.length - n); i < bars.length; i++) { const b = bars[i], p = bars[i - 1]; s += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)); k++; } return k ? s / k : 0; }
  function avgRange(bars, n = 20) { const s = bars.slice(-n); return s.length ? s.reduce((a, c) => a + c.h - c.l, 0) / s.length : 0; }
  // Find a structural target >= minRR away; returns {target, rr} or null.
  function findTarget(bars, i, dir, entry, risk, minRR, look = 60) {
    const lv = []; for (let j = Math.max(0, i - look); j < i; j++) lv.push(dir > 0 ? bars[j].h : bars[j].l);
    const ok = lv.filter(x => dir > 0 ? x - entry >= minRR * risk : entry - x >= minRR * risk).sort((a, b) => dir > 0 ? a - b : b - a);
    return ok.length ? { target: ok[0], rr: Math.abs(ok[0] - entry) / risk } : null;
  }
  function htfDir(h) { if (!h || h.length < 2) return 0; const b = h[h.length - 1]; return b.c > b.o ? 1 : b.c < b.o ? -1 : 0; }
  // Continuity: count of higher-TF bars where price is on the same side of that bar's open. Returns {dir:'up'|'down'|null, score:0-3}.
  function continuity(contBars, price) {
    if (!contBars || !contBars.length) return { dir: null, score: 0 };
    let up = 0, dn = 0;
    for (const b of contBars) { if (!b || b.o == null) continue; if (price > b.o) up++; else if (price < b.o) dn++; }
    const n = contBars.filter(b => b && b.o != null).length;
    if (up === n && n > 0) return { dir: 'up', score: up };
    if (dn === n && n > 0) return { dir: 'down', score: dn };
    return { dir: null, score: Math.max(up, dn) };
  }
  // Long-candle target: if prior bar range > mult * avg range, use its 50% (half); else full prior high/low.
  function longCandleTarget(bars, i, dir, mult = 1.5, lookback = 20) {
    if (i < 1) return { target: null, half: false };
    const tc = bars[i - 1], hist = bars.slice(Math.max(0, i - 1 - lookback), i - 1);
    const avg = hist.length ? avgRange(hist, lookback) : (tc.h - tc.l);
    const half = avg > 0 && (tc.h - tc.l) > mult * avg;
    const target = half ? (tc.h + tc.l) / 2 : (dir > 0 ? tc.h : tc.l);
    return { target, half };
  }
  // scan last closed bar (or index i) for a Strat setup with a trigger on the NEXT bar.
  function scanAt(bars, i, sym, opt = {}) {
    const minRR = opt.minRR || 1.5, sp = SPEC[sym] || { tick: 0.25, pv: 1 };
    const combos = opt.combos || ALL_COMBOS;
    const longMult = opt.longCandleMult ?? 1.5;
    const requireCont = !!opt.requireCont;
    if (i < 3) return [];
    const a = bars[i - 2], p = bars[i - 1], b = bars[i], tp = typ(p, a), tb = typ(b, p), A = atr(bars.slice(0, i + 1));
    const price = b.c;
    const cont = continuity(opt.contBars, price);
    const out = [];
    const mk = (dir, name, why, base) => {
      if (combos.indexOf(name) < 0 && combos.indexOf(name.replace(' reversal', '')) < 0) return;
      const comboKey = name.replace(' reversal', '');
      if (combos.indexOf(comboKey) < 0 && combos.indexOf(name) < 0) return;
      if (requireCont && cont.dir) {
        if ((dir > 0 && cont.dir !== 'up') || (dir < 0 && cont.dir !== 'down')) return;
      }
      const entry = rnd(dir > 0 ? b.h + sp.tick : b.l - sp.tick, sp.tick), stop = rnd(dir > 0 ? b.l - sp.tick : b.h + sp.tick, sp.tick), risk = Math.abs(entry - stop);
      if (risk < 4 * sp.tick || (A && (risk > 2.5 * A || risk < 0.3 * A))) return;
      // Prefer Strat Trader long-candle rule; fall back to structural level if RR too low.
      const lc = longCandleTarget(bars, i, dir, longMult, opt.rangeLookback || 20);
      let target = lc.target != null ? rnd(lc.target, sp.tick) : null, half = !!lc.half, rr = target != null ? Math.abs(target - entry) / risk : 0;
      if (!target || rr < minRR || (dir > 0 && target <= entry) || (dir < 0 && target >= entry)) {
        const tg = findTarget(bars, i, dir, entry, risk, minRR); if (!tg) return;
        target = rnd(tg.target, sp.tick); rr = tg.rr; half = false;
      } else { rr = +rr.toFixed(2); }
      let conf = base; const why2 = [why];
      const h = opt.htf; if (h) { const d = htfDir(h); if (d === dir) { conf += 15; why2.push('higher timeframe candle agrees'); } else if (d === -dir) { conf -= 15; why2.push('higher timeframe candle disagrees (caution)'); } }
      if (cont.dir === (dir > 0 ? 'up' : 'down')) { conf += 5 + cont.score * 3; why2.push(`continuity ${cont.score}/3 with higher timeframes`); }
      else if (cont.dir && cont.dir !== (dir > 0 ? 'up' : 'down')) { conf -= 10; why2.push('continuity against this direction'); }
      if (half) { why2.push('long candle → 50% target'); conf += 3; }
      if (rr >= 2.5) { conf += 8; } if (A && risk < 0.8 * A) { conf += 5; why2.push('tight stop'); }
      out.push({ sym, dir: dir > 0 ? 'LONG' : 'SHORT', setup: comboKey === '2-2' && name.includes('reversal') ? '2-2' : comboKey, combo: comboKey === '2-2' ? '2-2' : comboKey,
        entry, stop, target, rr: +(+rr).toFixed(2), risk, conf: Math.max(5, Math.min(95, Math.round(conf))), why: why2.join('; '), t: b.t, i, half, cont: cont.score, contDir: cont.dir });
    };
    // 2-1-2 / 3-1-2: inside bar after 2 or 3
    if (tb === 1) {
      if (tp === '2u' || tp === '2d') { mk(1, '2-1-2', 'Inside bar after a directional bar; buy a break above the inside bar high', 55); mk(-1, '2-1-2', 'Inside bar after a directional bar; sell a break below the inside bar low', 55); }
      if (tp === 3) { mk(1, '3-1-2', 'Inside bar after an outside bar; buy the break of the inside bar high', 58); mk(-1, '3-1-2', 'Inside bar after an outside bar; sell the break of the inside bar low', 58); }
    }
    // 2-2 reversal: two same-direction 2s, last closed opposite color
    if (tb === '2d' && tp === '2d' && b.c > b.o) mk(1, '2-2', 'Two lower bars, last one closed green; buy if price takes out its high', 50);
    if (tb === '2u' && tp === '2u' && b.c < b.o) mk(-1, '2-2', 'Two higher bars, last one closed red; sell if price breaks its low', 50);
    // 1-2-2: inside then two directional (trigger is second 2)
    if (tb === '2d' && tp === 1) mk(1, '1-2-2', 'Inside bar then a lower bar; buy a break of the lower bar high (reversal)', 52);
    if (tb === '2u' && tp === 1) mk(-1, '1-2-2', 'Inside bar then a higher bar; sell a break of the higher bar low (reversal)', 52);
    // 3-2-2: outside then directional 2
    if (tb === '2d' && tp === 3) mk(1, '3-2-2', 'Outside bar then a lower bar; buy a break of the lower bar high', 54);
    if (tb === '2u' && tp === 3) mk(-1, '3-2-2', 'Outside bar then a higher bar; sell a break of the higher bar low', 54);
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
  // Always-available conditional plans from the last closed candle: break above / break below.
  function conditional(bars, sym, opt = {}) {
    const minRR = opt.minRR || 1.5, sp = SPEC[sym] || { tick: 0.25, pv: 1 }; bars = bars.slice(); while (bars.length > 3 && bars[bars.length - 1].h - bars[bars.length - 1].l < sp.tick) bars.pop(); const i = bars.length - 1; if (i < 1) return [];
    const b = bars[i], strat = i >= 3 ? scanAt(bars, i, sym, opt) : [], A = atr(bars), out = [];
    for (const dir of [1, -1]) {
      const hit = strat.find(x => (x.dir === 'LONG') === (dir > 0));
      const ifTxt = `IF price breaks ${dir > 0 ? 'ABOVE' : 'BELOW'} ${(dir > 0 ? rnd(b.h + sp.tick, sp.tick) : rnd(b.l - sp.tick, sp.tick)).toFixed(sp.tick < 0.25 ? 1 : 2)}`;
      if (hit) { out.push({ ...hit, ifTxt }); continue; }
      const entry = rnd(dir > 0 ? b.h + sp.tick : b.l - sp.tick, sp.tick); let stop = rnd(dir > 0 ? b.l - sp.tick : b.h + sp.tick, sp.tick);
      if (Math.abs(entry - stop) < 4 * sp.tick) stop = rnd(entry - dir * 4 * sp.tick, sp.tick);
      const risk = Math.abs(entry - stop), tg = findTarget(bars, i, dir, entry, risk, minRR);
      const target = tg ? rnd(tg.target, sp.tick) : rnd(entry + dir * 2 * risk, sp.tick), rr = +(Math.abs(target - entry) / risk).toFixed(2);
      const typ1 = i >= 1 ? typ(b, bars[i - 1]) : '?', big = A && risk > 2.5 * A;
      const notes = ['Not a Strat setup — this is just a break of the last candle (' + (typ1 === 1 ? 'inside bar' : typ1 === 3 ? 'outside bar' : 'directional bar') + ')'];
      if (!tg) notes.push('no earlier price level far enough, so take profit is set at 2× the risk');
      if (big) notes.push('the stop is unusually wide for this market');
      out.push({ sym, dir: dir > 0 ? 'LONG' : 'SHORT', setup: 'last-candle break', combo: 'other', entry, stop, target, rr, risk, conf: big ? 25 : 40, why: notes.join('; '), t: b.t, i, ifTxt, nonStrat: true, half: false, cont: 0 });
    }
    return out.sort((x, y) => y.conf - x.conf);
  }
  const api = { conditional, findTarget, SPEC, typ, scanAt, outcome, backtest, size, atr, continuity, longCandleTarget, avgRange, ALL_COMBOS };
  if (typeof module !== 'undefined') module.exports = api; else root.Strat = api;
})(this);
