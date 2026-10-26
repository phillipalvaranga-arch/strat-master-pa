const S = require('../strat.js'), fs = require('fs'), assert = require('assert');
const bars = n => JSON.parse(fs.readFileSync(`data/${n}.json`)).bars.map(b => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4] }));
let n = 0, bad = 0;
for (const s of ['MES', 'MNQ', 'MGC']) { const B = bars(s + '_5m'); for (let i = 3; i < B.length; i++) for (const x of S.scanAt(B, i, s)) { n++; if (x.rr < 1.5) bad++; assert(x.dir === 'LONG' ? x.stop < x.entry && x.target > x.entry : x.stop > x.entry && x.target < x.entry); }
  const r = S.backtest(B, s), t = r.win + r.loss; console.log(s, '5m', 'trades', t, 'win%', (r.win / t * 100).toFixed(1), 'netR', r.R.toFixed(1)); }
assert.strictEqual(bad, 0); console.log('signals', n, 'all >=1.5R');
const z = S.size(300, { risk: 4 }, 'MES'); assert.strictEqual(z.contracts, 15); console.log('OK');
for (const s of ['MES','MNQ','MGC']) { const B = bars(s+'_5m'), t = S.SPEC[s].tick; for (let i=3;i<B.length;i++) for (const x of S.scanAt(B,i,s)) for (const v of [x.entry,x.stop,x.target]) assert(Math.abs(v/t - Math.round(v/t)) < 1e-6, s+' off-tick '+v); }
console.log('all prices on valid ticks');
