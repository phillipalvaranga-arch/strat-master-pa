// Strat Master P.A local relay (PC only). READ-ONLY: serves the app from GitHub Pages and fetches delayed Yahoo candles
// so the desktop gets fresher charts. No broker connection, no orders.
const http = require('http'), https = require('https');
const OK = /^(MES|MNQ|MGC)=F$/, TF = { '5m': '5d', '15m': '1mo', '30m': '1mo', '60m': '3mo', '1d': '1y' };
const get = (url, res, type) => https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
  res.statusCode = r.statusCode; res.setHeader('Content-Type', type || r.headers['content-type'] || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-cache'); r.pipe(res);
}).on('error', () => { res.statusCode = 502; res.end('err'); });
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/ping') return res.end('ok');
  if (u.pathname === '/bars') { const s = u.searchParams.get('s'), tf = u.searchParams.get('tf');
    if (!OK.test(s) || !TF[tf]) { res.statusCode = 400; return res.end('bad'); }
    return get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=${tf}&range=${TF[tf]}`, res, 'application/json'); }
  get('https://phillipalvaranga-arch.github.io/strat-master-pa' + (u.pathname === '/' ? '/index.html' : u.pathname), res);
}).listen(8795, '127.0.0.1');
