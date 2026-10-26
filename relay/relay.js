// Strat Master P.A local data relay (PC only). READ-ONLY: fetches delayed Yahoo candles so the app gets fresher charts. No broker, no orders.
const http = require('http'), https = require('https');
const OK = /^(MES|MNQ|MGC)=F$/, TF = { '5m': '5d', '15m': '1mo', '60m': '3mo', '1d': '1y' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname === '/ping') return res.end('ok');
  const s = u.searchParams.get('s'), tf = u.searchParams.get('tf');
  if (u.pathname !== '/bars' || !OK.test(s) || !TF[tf]) { res.statusCode = 400; return res.end('bad'); }
  https.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=${tf}&range=${TF[tf]}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(b); });
  }).on('error', () => { res.statusCode = 502; res.end('err'); });
}).listen(8790, '127.0.0.1');
