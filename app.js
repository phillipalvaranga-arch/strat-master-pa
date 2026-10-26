// Strat Master P.A — signal-only. No broker connection, no order placement anywhere in this code.
const $ = s => document.querySelector(s), SYMS = ['MES', 'MNQ', 'MGC'], TFS = ['5m', '15m', '60m', '1d'], TFS_S = { '5m': 300, '15m': 900, '60m': 3600, '1d': 86400 };
const RAW = 'https://raw.githubusercontent.com/phillipalvaranga-arch/strat-master-pa/data/', RELAY = '';
const st = JSON.parse(localStorage.smpa || '{}'); const S = Object.assign({ sym: 'MES', tf: '5m', minRR: 1.5, daily: 300, minConf: 60, sound: true, notif: false, log: [], seen: {} }, st);
const save = () => localStorage.smpa = JSON.stringify(S);
const CT = { timeZone: 'America/Chicago' };
const fmtT = t => new Date(t * 1000).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
const ctMin = (d = new Date()) => { const p = new Intl.DateTimeFormat('en-US', { ...CT, hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(d); const g = k => p.find(x => x.type === k).value; return { m: +g('hour') * 60 + +g('minute'), wd: g('weekday') }; };
const ctDay = (d = new Date()) => d.toLocaleDateString('en-CA', CT);
const money = x => (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2);
const toast = m => { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 3000); };
let cache = {}, feed = { src: '', age: 0 }, relayOK = null, active = null;

async function relayUp() { if (location.hostname !== '127.0.0.1') return false; if (relayOK !== null) return relayOK; try { const c = new AbortController(); setTimeout(() => c.abort(), 1200); relayOK = (await fetch(RELAY + '/ping', { signal: c.signal })).ok; } catch { relayOK = false; } return relayOK; }
function parseYahoo(j) { const r = j.chart.result[0], q = r.indicators.quote[0]; return r.timestamp.map((t, i) => [t, q.open[i], q.high[i], q.low[i], q.close[i]]).filter(b => b.every(x => x != null)); }
async function load(sym, tf) {
  let rows, src;
  if (await relayUp()) { try { rows = parseYahoo(await (await fetch(`${RELAY}/bars?s=${sym}%3DF&tf=${tf}`)).json()); src = 'PC relay · Yahoo ~10 min delay'; } catch { } }
  if (!rows) { const j = await (await fetch(`${RAW}${sym}_${tf}.json?x=${Math.floor(Date.now() / 60000)}`)).json(); rows = j.bars; src = 'Cloud sync · Yahoo ~15–25 min delay'; }
  const bars = rows.map(b => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4] }));
  const now = Date.now() / 1000, closed = bars.filter(b => b.t + TFS_S[tf] <= now + 1);
  feed = { src, age: bars.length ? Math.round((now - bars[bars.length - 1].t) / 60) : 0 };
  return cache[sym + tf] = { bars, closed };
}
const htfOf = tf => ({ '5m': '60m', '15m': '60m', '60m': '1d', '1d': null })[tf];
async function scan(sym, tf) {
  const d = await load(sym, tf), h = htfOf(tf) ? (await load(sym, htfOf(tf))).closed : null;
  const B = d.closed, i = B.length - 1; if (i < 3) return { sigs: [], d };
  return { sigs: Strat.scanAt(B, i, sym, { minRR: +S.minRR, htf: h }), d };
}

// ---- chart
let chart, cs, lines = [];
function initChart() {
  chart = LightweightCharts.createChart($('#chartbox'), { layout: { background: { color: '#0b0f17' }, textColor: '#8b96ad' }, grid: { vertLines: { color: '#151c2b' }, horzLines: { color: '#151c2b' } }, rightPriceScale: { borderColor: '#243049' }, timeScale: { borderColor: '#243049', timeVisible: true, secondsVisible: false }, crosshair: { mode: 0 },
    localization: { timeFormatter: t => new Date(t * 1000).toLocaleString('en-US', { ...CT, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } });
  cs = chart.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', borderVisible: false });
  // shift axis labels to Central: lightweight-charts shows UTC, so offset bar times
  new ResizeObserver(() => chart.applyOptions({ width: $('#chartbox').clientWidth, height: $('#chartbox').clientHeight })).observe($('#chartbox'));
}
const ctOff = t => { const d = new Date(t * 1000); const u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })), c = new Date(d.toLocaleString('en-US', CT)); return t + (c - u) / 1000; };
async function drawChart() {
  const { sigs, d } = await scan(S.sym, S.tf);
  chart.applyOptions({ localization: { timeFormatter: t => new Date(t * 1000).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' } });
  cs.setData(d.bars.map(b => ({ time: ctOff(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
  const L = d.bars[d.bars.length - 1], P = d.bars[d.bars.length - 2] || L, ch = L.c - P.c;
  $('#quote').innerHTML = `<b>${L.c.toFixed(2)}</b><span class="${ch >= 0 ? 'g' : 'r'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}</span> · ${Strat.SPEC[S.sym].name} · last bar ${fmtT(L.t)}`;
  updFeed(); showSig(active && active.sym === S.sym ? active : sigs[0] || null);
}
function showSig(s) {
  lines.forEach(l => cs.removePriceLine(l)); lines = []; cs.setMarkers([]);
  if (!s) { $('#sigcard').innerHTML = '<div class="note">No qualifying setup on the last closed bar for this chart. Scanner rechecks every minute.</div>'; return; }
  const ln = (p, c, t) => lines.push(cs.createPriceLine({ price: p, color: c, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: t }));
  ln(s.entry, '#3b82f6', 'ENTRY'); ln(s.stop, '#ef4444', 'STOP'); ln(s.target, '#22c55e', 'TARGET');
  cs.setMarkers([{ time: ctOff(s.t), position: s.dir === 'LONG' ? 'belowBar' : 'aboveBar', color: s.dir === 'LONG' ? '#22c55e' : '#ef4444', shape: s.dir === 'LONG' ? 'arrowUp' : 'arrowDown', text: s.setup }]);
  $('#sigcard').innerHTML = sigHTML(s);
}
function sigHTML(s) {
  const z = Strat.size(Math.min(S.daily / 2, 150), s, s.sym), c = s.conf >= 70 ? 'g' : s.conf >= 55 ? 'a' : 'r';
  return `<div class="sig ${s.dir[0] === 'L' ? 'L' : 'S'}" data-k="${s.sym}|${s.setup}|${s.dir}"><div class="top"><span class="${s.dir === 'LONG' ? 'g' : 'r'}">${s.dir} ${s.sym} · ${s.setup} · ${S.tf}</span><span class="conf ${c}">${s.conf}% confidence</span></div>
  <div class="lv"><div><span>Entry (stop order)</span>${s.entry.toFixed(2)}</div><div><span>Stop</span><b class="r">${s.stop.toFixed(2)}</b></div><div><span>Target</span><b class="g">${s.target.toFixed(2)}</b></div><div><span>Reward:Risk</span>${s.rr}:1</div></div>
  <div class="why">${s.why}. Risk ${money(z.perContract)} per contract · up to ${z.contracts} contract(s) at $150 risk. Signal bar ${fmtT(s.t)}. Only valid if price triggers on the next bar.</div></div>`;
}
function updFeed() {
  const f = $('#feed'); f.textContent = feed.src.split('·')[0] + ' · ' + (feed.age < 120 ? feed.age + 'm old' : 'market closed / stale');
  f.className = 'pill ' + (feed.age <= 15 ? 'g' : feed.age <= 40 ? 'a' : 'r'); f.title = feed.src;
}

// ---- scanner + alerts
async function scanAll() {
  const all = []; for (const s of SYMS) { try { all.push(...(await scan(s, S.tf)).sigs); } catch (e) { console.warn(e); } }
  all.sort((a, b) => b.conf - a.conf);
  $('#siglist').innerHTML = all.length ? all.map(sigHTML).join('') : '<div class="card note">No setups with ≥' + S.minRR + ':1 reward:risk right now. That is normal — waiting is a position.</div>';
  $('#siglist').querySelectorAll('.sig').forEach((el, k) => el.onclick = () => { active = all[k]; S.sym = active.sym; save(); tab('chart'); renderSegs(); drawChart(); });
  const sess = inSession();
  for (const s of all) { const k = `${s.sym}${S.tf}${s.t}${s.dir}`; if (S.seen[k] || s.conf < S.minConf) continue; S.seen[k] = 1; if (sess) alertSig(s); }
  const ks = Object.keys(S.seen); if (ks.length > 300) ks.slice(0, 100).forEach(k => delete S.seen[k]); save(); updFeed();
}
function beep() { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.setValueAtTime(.25, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .6); o.start(); o.stop(a.currentTime + .6); } catch { } }
function alertSig(s) {
  const m = `${s.dir} ${s.sym} ${s.setup}: entry ${s.entry}, stop ${s.stop}, target ${s.target} (${s.rr}:1, ${s.conf}%)`;
  toast(m); if (S.sound) beep();
  if (S.notif && 'Notification' in window && Notification.permission === 'granted') navigator.serviceWorker.ready.then(r => r.showNotification('Strat Master P.A', { body: m, icon: 'icons/icon-192.png', tag: m })).catch(() => new Notification('Strat Master P.A', { body: m }));
}
function inSession() { const { m, wd } = ctMin(); return !['Sat', 'Sun'].includes(wd) && m >= 510 && m < 885; }

// ---- backtest track record
async function track() {
  const rows = []; for (const s of SYMS) { try { const d = cache[s + S.tf] || await load(s, S.tf); const r = Strat.backtest(d.closed, s, { minRR: +S.minRR }), n = r.win + r.loss; rows.push(`<tr><td>${s}</td><td>${n}</td><td>${n ? (r.win / n * 100).toFixed(0) : 0}%</td><td class="${r.R >= 0 ? 'g' : 'r'}">${r.R.toFixed(1)}R</td></tr>`); } catch { } }
  $('#track').innerHTML = `<table><tr><th>Contract</th><th>Setups filled</th><th>Win rate</th><th>Net (in R)</th></tr>${rows.join('')}</table><p>Computed on the bars loaded now (${S.tf}, all hours, no fees). Net in R = total reward minus risk units. A negative number means these setups have recently lost money if every one were taken — be selective. Past results don't guarantee future results.</p>`;
}

// ---- risk + size
function todayPnl() { const d = ctDay(); return S.log.filter(x => x.day === d && x.pnl != null).reduce((a, x) => a + x.pnl, 0); }
function renderRisk() {
  const p = todayPnl(), used = Math.max(0, -p), pct = Math.min(100, used / S.daily * 100), left = S.daily - used;
  $('#riskbox').innerHTML = `<div class="statg"><div><span>Today P&L</span><b class="${p >= 0 ? 'g' : 'r'}">${money(p)}</b></div><div><span>Loss limit</span><b>${money(S.daily)}</b></div><div><span>Room left</span><b class="${left > S.daily * .3 ? 'g' : 'r'}">${money(Math.max(0, left))}</b></div></div>
  <div class="meter"><i style="width:${pct}%;background:${pct < 50 ? '#22c55e' : pct < 85 ? '#f5b942' : '#ef4444'}"></i></div>${left <= 0 ? '<b class="r">Daily stop hit — done trading for today.</b>' : `<span class="note">Hours: 8:30 AM–2:45 PM CT weekdays. ${inSession() ? 'Session open.' : 'Outside your trading hours.'}</span>`}`;
  const s = $('#sess'); s.textContent = left <= 0 ? 'DAILY STOP HIT' : inSession() ? 'Session open' : 'Session closed'; s.className = 'pill ' + (left <= 0 ? 'r' : inSession() ? 'g' : 'a');
}
function calcSize() {
  const sym = $('#zsym').value, e = +$('#zent').value, s = +$('#zstp').value, r = +$('#zrisk').value; if (!e || !s || e === s) { $('#zout').innerHTML = '<span class="note">Enter entry and stop.</span>'; return; }
  const z = Strat.size(r, { risk: Math.abs(e - s) }, sym), room = S.daily + Math.min(0, todayPnl());
  $('#zout').innerHTML = `${z.contracts} contract(s)<div class="note">${money(z.perContract)} risk per contract · ${Math.abs(e - s).toFixed(2)} pts · 1.5R target ${(e + (e > s ? 1 : -1) * 1.5 * Math.abs(e - s)).toFixed(2)} · 2R ${(e + (e > s ? 1 : -1) * 2 * Math.abs(e - s)).toFixed(2)}${z.contracts * z.perContract > room ? `<br><b class="r">Exceeds today's remaining room (${money(room)})</b>` : ''}</div>`;
}

// ---- log
function renderLog() {
  const done = S.log.filter(x => x.pnl != null), w = done.filter(x => x.pnl > 0), l = done.filter(x => x.pnl < 0), net = done.reduce((a, x) => a + x.pnl, 0);
  const gw = w.reduce((a, x) => a + x.pnl, 0), gl = -l.reduce((a, x) => a + x.pnl, 0);
  $('#stats').innerHTML = `<div class="statg"><div><span>Trades</span><b>${done.length}</b></div><div><span>Win rate</span><b>${done.length ? (w.length / done.length * 100).toFixed(0) : 0}%</b></div><div><span>Net P&L</span><b class="${net >= 0 ? 'g' : 'r'}">${money(net)}</b></div><div><span>Avg win</span><b class="g">${money(w.length ? gw / w.length : 0)}</b></div><div><span>Avg loss</span><b class="r">${money(l.length ? -gl / l.length : 0)}</b></div><div><span>Profit factor</span><b>${gl ? (gw / gl).toFixed(2) : '—'}</b></div></div>`;
  $('#loglist').innerHTML = S.log.length ? `<div class="card"><table><tr><th>When (CT)</th><th>Trade</th><th>In → Out</th><th>P&L</th><th></th></tr>${S.log.slice().reverse().map(x => `<tr><td>${new Date(x.ts).toLocaleString('en-US', { ...CT, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td>${x.dir} ${x.qty} ${x.sym}<div class="note">${x.note || ''}</div></td><td>${x.entry} → ${x.exit ?? 'open'}</td><td class="${x.pnl > 0 ? 'g' : x.pnl < 0 ? 'r' : ''}">${x.pnl == null ? '—' : money(x.pnl)}</td><td><button data-id="${x.ts}">✕</button></td></tr>`).join('')}</table></div>` : '';
  $('#loglist').querySelectorAll('button').forEach(b => b.onclick = () => { if (confirm('Delete this trade?')) { S.log = S.log.filter(x => x.ts != b.dataset.id); save(); renderLog(); renderRisk(); } });
}
$('#lf').onsubmit = e => {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const pv = Strat.SPEC[f.sym].pv, q = +f.qty || 1;
  const pnl = f.exit === '' ? null : +(((+f.exit - +f.entry) * (f.dir === 'LONG' ? 1 : -1) * pv * q) - (+f.fees || 0) * q).toFixed(2);
  S.log.push({ ts: Date.now(), day: ctDay(), sym: f.sym, dir: f.dir, qty: q, entry: +f.entry, exit: f.exit === '' ? null : +f.exit, pnl, note: f.note }); save(); e.target.reset(); renderLog(); renderRisk(); toast(pnl == null ? 'Saved (open)' : 'Saved: ' + money(pnl));
};
$('#exportlog').onclick = () => { const c = 'time_ct,symbol,side,qty,entry,exit,pnl,note\n' + S.log.map(x => [new Date(x.ts).toLocaleString('en-US', CT).replace(',', ''), x.sym, x.dir, x.qty, x.entry, x.exit ?? '', x.pnl ?? '', '"' + (x.note || '').replace(/"/g, "'") + '"'].join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c], { type: 'text/csv' })); a.download = 'strat-master-trades.csv'; a.click(); };

// ---- ui
function tab(t) { document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === t)); if (t === 'signals') { scanAll(); track(); } if (t === 'size') renderRisk(); if (t === 'st') loadST(); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => tab(b.dataset.t));
function renderSegs() {
  $('#syms').innerHTML = SYMS.map(s => `<button class="${s === S.sym ? 'on' : ''}">${s}</button>`).join(''); $('#tfs').innerHTML = TFS.map(s => `<button class="${s === S.tf ? 'on' : ''}">${s}</button>`).join('');
  $('#syms').querySelectorAll('button').forEach(b => b.onclick = () => { S.sym = b.textContent; active = null; save(); renderSegs(); drawChart(); });
  $('#tfs').querySelectorAll('button').forEach(b => b.onclick = () => { S.tf = b.textContent; active = null; save(); renderSegs(); drawChart(); });
}
$('#refresh').onclick = () => { relayOK = null; drawChart(); };
['zsym', 'zent', 'zstp', 'zrisk'].forEach(i => $('#' + i).oninput = calcSize);
const bindSet = (id, k, cb = x => x) => { const el = $('#' + id); if (el.type === 'checkbox') el.checked = S[k]; else el.value = S[k]; el.onchange = () => { S[k] = el.type === 'checkbox' ? el.checked : cb(el.value); save(); $('#rrlbl').textContent = S.minRR; renderRisk(); if (k === 'minRR') drawChart(); }; };
bindSet('sminrr', 'minRR', Number); bindSet('sdaily', 'daily', Number); bindSet('sminconf', 'minConf', Number); bindSet('ssound', 'sound');
bindSet('snotif', 'notif'); $('#snotif').addEventListener('change', e => { if (e.target.checked && 'Notification' in window) Notification.requestPermission().then(p => { if (p !== 'granted') { toast('Notifications blocked by the browser'); S.notif = false; e.target.checked = false; save(); } }); });
$('#rrlbl').textContent = S.minRR;
// ---- Strat Trader link: GET-only reads of /api/journal, /api/suggestions. Never calls any POST/order endpoint.
$('#sturl').value = S.stUrl || ''; $('#stkey').value = S.stKey || '';
$('#sturl').onchange = () => { S.stUrl = $('#sturl').value.trim().replace(/\/+$/, ''); save(); }; $('#stkey').onchange = () => { S.stKey = $('#stkey').value; save(); };
$('#sttest').onclick = () => { $('#sturl').onchange(); $('#stkey').onchange(); tab('st'); };
const stGet = async p => { const r = await fetch(S.stUrl + p, { headers: { 'x-dashboard-key': S.stKey || '' }, cache: 'no-store' }); if (r.status === 401) throw new Error('wrong dashboard password'); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
function analyze(trades) {
  const P = t => t.symbol ? t.symbol.replace(/[A-Z]\d+$/, '') : t.sym;
  const cl = trades.filter(t => t.taken !== false && (Number.isFinite(t.pnl) || Number.isFinite(t.r)));
  const hourCT = t => new Date(t.t).toLocaleString('en-US', { ...CT, hour: 'numeric' });
  const prr = t => (Number.isFinite(t.entry) && Number.isFinite(t.stop) && Number.isFinite(t.target) && t.entry !== t.stop) ? Math.abs(t.target - t.entry) / Math.abs(t.entry - t.stop) : null;
  const sum = arr => { const w = arr.filter(t => (t.pnl ?? t.r) > 0).length, pnl = arr.reduce((a, t) => a + (t.pnl || 0), 0), rs = arr.map(t => t.r).filter(Number.isFinite); return { n: arr.length, wr: arr.length ? w / arr.length * 100 : 0, pnl, avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null }; };
  const by = f => { const m = {}; cl.forEach(t => { const k = f(t) || '—'; (m[k] = m[k] || []).push(t); }); return Object.entries(m).map(([k, v]) => ({ k, ...sum(v) })).sort((a, b) => b.pnl - a.pnl); };
  const rrs = trades.map(prr).filter(x => x != null);
  return { all: sum(cl), avgPlanRR: rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : null, lowRR: rrs.filter(x => x < 1.5).length, nRR: rrs.length,
    sym: by(P), combo: by(t => t.combo || t.setup), hour: by(hourCT), tf: by(t => t.timeframe), src: by(t => t.source) };
}
const tbl = (title, rows) => rows.length ? `<h4 style="margin:12px 0 4px">${title}</h4><table><tr><th></th><th>Trades</th><th>Win %</th><th>Avg R</th><th>P&L</th></tr>${rows.map(r => `<tr><td>${r.k}</td><td>${r.n}</td><td>${r.wr.toFixed(0)}%</td><td>${r.avgR == null ? '—' : r.avgR.toFixed(2)}</td><td class="${r.pnl >= 0 ? 'g' : 'r'}">${money(r.pnl)}</td></tr>`).join('')}</table>` : '';
async function loadST() {
  const c = $('#stconn');
  const local = S.log.filter(x => x.pnl != null).map(x => ({ t: new Date(x.ts).toISOString(), sym: x.sym, side: x.dir, entry: x.entry, pnl: x.pnl, taken: true, source: 'Strat Master log', combo: (x.note || '').match(/\d-\d(-\d)?/)?.[0] }));
  let j = [], sg = [];
  if (!S.stUrl || !S.stKey) c.innerHTML = 'Not linked yet. In <b>Settings → Strat Trader link</b>, enter your Strat Trader URL and dashboard password. Showing this app\'s own log only.';
  else { c.textContent = 'Loading from Strat Trader…'; try { [j, sg] = await Promise.all([stGet('/api/journal'), stGet('/api/suggestions').catch(() => [])]); c.innerHTML = `<span class="g">Linked (read-only)</span> · ${j.length} records from Strat Trader · ${new Date().toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' })} CT`; }
    catch (e) { c.innerHTML = `<span class="r">Could not reach Strat Trader: ${e.message}.</span> If it's on Render's free plan it may be asleep — wait 1 minute and reopen this tab.`; } }
  const A = analyze([...j, ...local]), s = A.all;
  $('#stana').innerHTML = `<div class="statg"><div><span>Closed trades</span><b>${s.n}</b></div><div><span>Win rate</span><b>${s.wr.toFixed(0)}%</b></div><div><span>Net P&L</span><b class="${s.pnl >= 0 ? 'g' : 'r'}">${money(s.pnl)}</b></div><div><span>Avg R per trade</span><b>${s.avgR == null ? '—' : s.avgR.toFixed(2)}</b></div><div><span>Avg planned R:R</span><b class="${A.avgPlanRR >= 1.5 ? 'g' : 'r'}">${A.avgPlanRR == null ? '—' : A.avgPlanRR.toFixed(2) + ':1'}</b></div></div>` + tbl('By instrument', A.sym) + tbl('By setup', A.combo) + tbl('By hour (CT)', A.hour) + tbl('By timeframe', A.tf) + tbl('By source', A.src);
  const tips = [];
  if (s.n < 20) tips.push(`Only ${s.n} closed trades — results need 20–30+ before trusting any pattern.`);
  if (A.nRR && A.lowRR / A.nRR > .3) tips.push(`${A.lowRR} of ${A.nRR} alerts had a target under 1.5:1 reward:risk. Skip those or use a farther target — this is why a 67% win rate broke even.`);
  if (s.wr > 55 && s.avgR != null && s.avgR <= 0.05) tips.push('High win rate but ~0R average: losses are bigger than wins. Widen targets or tighten stops.');
  for (const [name, arr] of [['setup', A.combo], ['instrument', A.sym], ['hour', A.hour]]) { const q = arr.filter(r => r.n >= 5); if (q.length > 1) { tips.push(`Best ${name}: <b class="g">${q[0].k}</b> (${q[0].n} trades, ${money(q[0].pnl)}). Weakest: <b class="r">${q[q.length - 1].k}</b> (${q[q.length - 1].n} trades, ${money(q[q.length - 1].pnl)}).`); } }
  (Array.isArray(sg) ? sg : []).slice(0, 5).forEach(x => tips.push('Strat Trader: ' + (x.text || JSON.stringify(x))));
  $('#stsug').innerHTML = tips.length ? '<ul>' + tips.map(t => `<li>${t}</li>`).join('') + '</ul>' : '<span class="note">Not enough data yet.</span>';
  const al = j.filter(t => t.source === 'alert').sort((a, b) => (b.t || '').localeCompare(a.t || '')).slice(0, 25);
  $('#stalerts').innerHTML = al.length ? `<table><tr><th>When (CT)</th><th>Alert</th><th>Entry/Stop/Target</th><th>R:R</th><th>Result</th></tr>${al.map(t => { const rr = t.target && t.stop && t.entry !== t.stop ? Math.abs(t.target - t.entry) / Math.abs(t.entry - t.stop) : null; return `<tr><td>${new Date(t.t).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td class="${/buy|long/i.test(t.side) ? 'g' : 'r'}">${t.side || ''} ${t.symbol || ''} ${t.combo || ''} ${t.timeframe || ''}</td><td>${t.entry ?? '—'} / ${t.stop ?? '—'} / ${t.target ?? '—'}</td><td class="${rr >= 1.5 ? 'g' : 'r'}">${rr ? rr.toFixed(2) : '—'}</td><td>${t.taken === false ? 'skipped' : t.outcome ? t.outcome + (Number.isFinite(t.pnl) ? ' ' + money(t.pnl) : '') : 'not logged'}</td></tr>`; }).join('')}</table>` : '<span class="note">No alerts received yet.</span>';
}
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' }) + ' CT'; }, 1000);
initChart(); renderSegs(); drawChart().catch(e => toast('Data load failed: ' + e.message)); renderLog(); renderRisk();
setInterval(() => { drawChart().catch(() => { }); scanAll(); renderRisk(); }, 60000); setTimeout(scanAll, 3000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
