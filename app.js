// Strat Master P.A — signal-only. No broker connection, no order placement anywhere in this code.
const $ = s => document.querySelector(s), SYMS = ['MES', 'MNQ', 'MGC'], TFS = ['5m', '15m', '30m', '60m', '1d'], TFS_S = { '5m': 300, '15m': 900, '30m': 1800, '60m': 3600, '1d': 86400 };
const RAW = 'https://raw.githubusercontent.com/phillipalvaranga-arch/strat-master-pa/data/', RELAY = '';
const st = JSON.parse(localStorage.smpa || '{}'); const S = Object.assign({ sym: 'MES', tf: '5m', minRR: 1.5, daily: 300, minConf: 55, sound: true, notif: false, log: [], seen: {}, learnOn: true, learnReset: 0 }, st);
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
const htfOf = tf => ({ '5m': '30m', '15m': '60m', '30m': '60m', '60m': '1d', '1d': null })[tf];
async function scan(sym, tf) {
  const d = await load(sym, tf), h = htfOf(tf) ? (await load(sym, htfOf(tf))).closed : null;
  const B = d.closed, i = B.length - 1; if (i < 3) return { sigs: [], d };
  return { sigs: Strat.scanAt(B, i, sym, { minRR: +S.minRR, htf: h }).map(x => ({ ...x, tf })), d };
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
  if (s && S.learnOn && !s.learn) s = Learn.apply(s, S.tf); if (s && !s.ai) s = AIA.apply(s);
  lines.forEach(l => cs.removePriceLine(l)); lines = []; cs.setMarkers([]);
  AIA.levels(S.sym).forEach(([p, c, t]) => lines.push(cs.createPriceLine({ price: p, color: c, lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: t })));
  if (!s) { $('#sigcard').innerHTML = '<div class="now wait"><b>No good trade on ' + S.sym + ' ' + S.tf + ' right now — wait.</b><span>The app checks again every minute.</span></div>'; return; }
  const ln = (p, c, t) => lines.push(cs.createPriceLine({ price: p, color: c, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: t }));
  ln(s.entry, '#3b82f6', 'ENTRY · ' + OT(s).en + ' ' + s.entry.toFixed(s.sym === 'MGC' ? 1 : 2)); ln(s.stop, '#ef4444', 'SL · ' + OT(s).sl + ' ' + s.stop.toFixed(s.sym === 'MGC' ? 1 : 2)); ln(s.target, '#22c55e', 'TP · ' + OT(s).tp + ' ' + s.target.toFixed(s.sym === 'MGC' ? 1 : 2));
  cs.setMarkers([{ time: ctOff(s.t), position: s.dir === 'LONG' ? 'belowBar' : 'aboveBar', color: s.dir === 'LONG' ? '#22c55e' : '#ef4444', shape: s.dir === 'LONG' ? 'arrowUp' : 'arrowDown', text: s.setup }]);
  $('#sigcard').innerHTML = '<div class="note" style="margin:0 0 4px">Trade idea for this chart</div>' + sigHTML(s); bindPlans($('#sigcard'), [s]);
}
const fp = (x, sym) => x.toLocaleString('en-US', { minimumFractionDigits: sym === 'MGC' ? 1 : 2, maximumFractionDigits: sym === 'MGC' ? 1 : 2 });
function sigHTML(s, k) {
  const sp = Strat.SPEC[s.sym], L = s.dir === 'LONG', riskPts = Math.abs(s.entry - s.stop), rewPts = Math.abs(s.target - s.entry);
  const tk = x => Math.round(x / sp.tick), mx = Math.min(S.daily / 2, 150), z = Strat.size(mx, s, s.sym), rt = rating(s.conf), n1 = Math.max(1, z.contracts);
  return `<div class="plan ${L ? 'L' : 'S'}" data-k="${k ?? ''}"><div class="ptop"><span class="pdir ${L ? 'g' : 'r'}">${L ? 'BUY · LONG' : 'SELL · SHORT'} ${s.sym}</span><span class="conf ${rt[1]}">${rt[0]} idea</span></div>
  ${s.ifTxt ? `<div class="iftxt ${L ? 'g' : 'r'}">${s.ifTxt} →</div>` : ''}${s.nonStrat ? '<div class="nonstrat">⚠️ Not a Strat setup — lower odds. Use only if it fits your plan.</div>' : ''}
  ${s.learn ? `<details class="learntag"><summary>🧠 Adjusted by your results${s.learn.delta ? ` (${s.learn.delta > 0 ? '+' : ''}${s.learn.delta})` : ''} — why?</summary><ul>${s.learn.why.map(w => `<li>${w}</li>`).join('')}${s.learn.hideWhy ? `<li class="r">${s.learn.hideWhy} — normally hidden</li>` : ''}</ul></details>` : ''}${s.ai ? `<div class="aitags">${s.ai.map(n => `<span class="aitag ${n.c}">🤖 ${n.t}</span>`).join('')}</div>` : ''}${s.hourWarn ? `<div class="nonstrat">⏰ ${s.hourWarn}</div>` : ''}
  <div class="psub">${Strat.SPEC[s.sym].name} · ${S.tf} chart · ${fmtT(s.t)}</div>
  <div class="money"><span class="g">Win ${money(rewPts * sp.pv)}</span> / <span class="r">Risk ${money(riskPts * sp.pv)}</span> <small>per contract</small></div>
  <div class="pgrid"><div class="pbox e"><span>1 · ENTRY / <em>${OT(s).en}</em></span><b>${fp(s.entry, s.sym)}</b><i>${L ? 'Buy' : 'Sell'} stop order at ${fp(s.entry, s.sym)} (fills when price breaks ${L ? 'above' : 'below'})</i></div>
  <div class="pbox s"><span>2 · STOP LOSS / <em>${OT(s).sl}</em></span><b>${fp(s.stop, s.sym)}</b><i>${tk(riskPts)} ticks · ${riskPts.toFixed(2)} pts · −${money(riskPts * sp.pv)}/contract</i></div>
  <div class="pbox t"><span>3 · TAKE PROFIT / <em>${OT(s).tp}</em></span><b>${fp(s.target, s.sym)}</b><i>${tk(rewPts)} ticks · ${rewPts.toFixed(2)} pts · +${money(rewPts * sp.pv)}/contract</i></div></div>
  <div class="pinfo">Suggested size: <b>${z.contracts}</b> contract(s) → could win <b class="g">${money(z.contracts * rewPts * sp.pv)}</b> or lose <b class="r">${money(z.contracts * riskPts * sp.pv)}</b> (keeps risk under ${money(mx)})</div>
  <details class="pwhy"><summary>How to enter it & why</summary>On your trading platform: <b class="be">${OT(s).en}</b> at <b>${fp(s.entry, s.sym)}</b>, stop loss <b class="r">${OT(s).sl}</b> at <b class="r">${fp(s.stop, s.sym)}</b>, take profit <b class="g">${OT(s).tp}</b> at <b class="g">${fp(s.target, s.sym)}</b>. Only valid if price reaches the entry on the next ${S.tf} bar; otherwise cancel. <br>Why: ${plain(s)}<br><small>Pattern: ${s.setup} · Can win ${s.rr}× the risk · Score ${s.conf}/100</small></details>
  <div class="pbtns"><button class="ghost chartbtn">📈 See on chart</button><button class="primary logbtn">📝 I took this trade</button></div></div>`;
}
const OT = s => s.dir === 'LONG' ? { en: 'BUY STOP', tp: 'SELL LIMIT', sl: 'SELL STOP' } : { en: 'SELL STOP', tp: 'BUY LIMIT', sl: 'BUY STOP' }; // all setups enter on a stop order at the trigger-bar break
const rating = c => c >= 70 ? ['Strong', 'g'] : c >= 55 ? ['Okay', 'a'] : ['Weak', 'r'];
const plain = s => (s.dir === 'LONG' ? 'Price paused, and a move above ' + fp(s.entry, s.sym) + ' would show buyers taking over.' : 'Price paused, and a move below ' + fp(s.entry, s.sym) + ' would show sellers taking over.') + (/agrees/.test(s.why) ? ' The bigger trend agrees (good).' : /disagrees/.test(s.why) ? ' The bigger trend points the other way (be careful).' : '') + ' Take profit is at an earlier price level.';
function bindPlans(root, list) { root.querySelectorAll('.plan').forEach((el, i) => { el.querySelector('.logbtn').onclick = ev => { ev.stopPropagation(); prefillLog(list[i]); }; const cb = el.querySelector('.chartbtn'); if (cb) cb.onclick = ev => { ev.stopPropagation(); active = list[i]; S.sym = active.sym; save(); tab('chart'); renderSegs(); drawChart(); }; }); }
function prefillLog(s) { const f = $('#lf'), z = Strat.size(Math.min(S.daily / 2, 150), s, s.sym); f.sym.value = s.sym; f.dir.value = s.dir; f.qty.value = Math.max(1, z.contracts); f.entry.value = s.entry; f.exit.value = '';
  f.note.value = `${s.setup} ${s.sym} ${S.tf} · Entry ${OT(s).en} ${fp(s.entry, s.sym)} · SL ${OT(s).sl} ${fp(s.stop, s.sym)} · TP ${OT(s).tp} ${fp(s.target, s.sym)} · ${s.rr}:1`; tab('log'); f.exit.focus(); toast('Trade plan copied to the log — add your exit when done'); }
function updFeed() {
  const f = $('#feed'); f.textContent = feed.src.split('·')[0] + ' · ' + (feed.age < 120 ? feed.age + 'm old' : 'market closed / stale');
  f.className = 'pill ' + (feed.age <= 15 ? 'g' : feed.age <= 40 ? 'a' : 'r'); f.title = feed.src;
}

// ---- scanner + alerts
async function scanAll() {
  const all = []; for (const s of SYMS) { try { all.push(...(await scan(s, S.tf)).sigs); } catch (e) { console.warn(e); } }
  let ideas = (S.learnOn ? all.map(x => Learn.apply(x, S.tf)) : all).map(AIA.apply); const hid = ideas.filter(x => x.hidden); if (!S.showHidden) ideas = ideas.filter(x => !x.hidden);
  ideas.sort((a, b) => b.conf - a.conf); all.length = 0; all.push(...ideas);
  setTimeout(() => { const hb = $('#hidnote'); if (hb) hb.remove(); if (hid.length) $('#siglist').insertAdjacentHTML('beforeend', `<div id="hidnote" class="note card">🧠 ${hid.length} idea(s) ${S.showHidden ? 'shown even though' : 'hidden because'} your results say they lose (${hid.map(x => x.learn.hideWhy).join('; ')}). <button class="ghost" id="togglehid">${S.showHidden ? 'Hide them' : 'Show anyway'}</button></div>`); const t = $('#togglehid'); if (t) t.onclick = () => { S.showHidden = !S.showHidden; save(); scanAll(); }; }, 0);
  $('#siglist').innerHTML = all.map((x, k) => sigHTML(x, k)).join(''); bindPlans($('#siglist'), all);
  const lim = S.daily + Math.min(0, todayPnl()) <= 0, b = all[0];
  $('#now').className = 'now ' + (lim ? 'stop' : b ? (b.dir === 'LONG' ? 'buy' : 'sell') : 'wait');
  $('#now').innerHTML = lim ? '<b>You hit today\'s money limit — stop trading for today.</b><span>Come back tomorrow fresh.</span>'
    : b ? `<small>WHAT TO DO NOW</small><b>Possible trade on ${b.sym}: Entry <i class="be">${OT(b).en} ${fp(b.entry, b.sym)}</i>, stop loss <i class="r">${OT(b).sl} ${fp(b.stop, b.sym)}</i>, take profit <i class="g">${OT(b).tp} ${fp(b.target, b.sym)}</i>.</b><span>${rating(b.conf)[0]} idea · Win ${money(Math.abs(b.target - b.entry) * Strat.SPEC[b.sym].pv)} / Risk ${money(Math.abs(b.entry - b.stop) * Strat.SPEC[b.sym].pv)} per contract${inSession() ? '' : ' · Outside your 8:30 AM–2:45 PM CT hours'}. Details below.</span>`
    : `<small>WHAT TO DO NOW</small><b>No good trade right now — wait.</b><span>Checked MES, MNQ and MGC on the ${S.tf} chart. Checking again every minute${inSession() ? '' : ' · Outside your 8:30 AM–2:45 PM CT hours'}.</span>`;
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
  $('#riskmini').innerHTML = `<div class="meter"><i style="width:${pct}%;background:${pct < 50 ? '#22c55e' : pct < 85 ? '#f5b942' : '#ef4444'}"></i></div>Today: <b class="${p >= 0 ? 'g' : 'r'}">${money(p)}</b> · You can still lose <b>${money(Math.max(0, left))}</b> before your ${money(S.daily)} daily stop.`; const s = $('#sess'); s.textContent = left <= 0 ? 'DAILY STOP HIT' : inSession() ? 'Session open' : 'Session closed'; s.className = 'pill ' + (left <= 0 ? 'r' : inSession() ? 'g' : 'a');
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
  S.log.push({ ts: Date.now(), day: ctDay(), sym: f.sym, dir: f.dir, qty: q, entry: +f.entry, exit: f.exit === '' ? null : +f.exit, pnl, note: f.note }); save(); e.target.reset(); renderLog(); renderRisk(); refreshLearn(); toast(pnl == null ? 'Saved (open)' : 'Saved: ' + money(pnl));
};
$('#exportlog').onclick = () => { const c = 'time_ct,symbol,side,qty,entry,exit,pnl,note\n' + S.log.map(x => [new Date(x.ts).toLocaleString('en-US', CT).replace(',', ''), x.sym, x.dir, x.qty, x.entry, x.exit ?? '', x.pnl ?? '', '"' + (x.note || '').replace(/"/g, "'") + '"'].join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c], { type: 'text/csv' })); a.download = 'strat-master-trades.csv'; a.click(); };

// ---- ui
function tab(t) { const navT = ['size', 'st', 'signals', 'settings', 'ai'].includes(t) ? 'more' : t; document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === navT)); scrollTo(0, 0); document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === t)); if (t === 'home') scanAll(); if (t === 'paste' && window.pasteInit) pasteInit(); if (t === 'signals') track(); if (t === 'size') renderRisk(); if (t === 'st') loadST(); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => tab(b.dataset.t));
function renderSegs() {
  $('#syms').innerHTML = SYMS.map(s => `<button class="${s === S.sym ? 'on' : ''}">${s}</button>`).join(''); $('#tfs').innerHTML = TFS.map(s => `<button class="${s === S.tf ? 'on' : ''}">${s}</button>`).join('');
  $('#syms').querySelectorAll('button').forEach(b => b.onclick = () => { S.sym = b.textContent; active = null; save(); renderSegs(); drawChart(); });
  $('#tfs2').innerHTML = $('#tfs').innerHTML; $('#tfs2').querySelectorAll('button').forEach(b => b.onclick = () => { S.tf = b.textContent; active = null; save(); renderSegs(); drawChart(); scanAll(); });
  $('#tfs').querySelectorAll('button').forEach(b => b.onclick = () => { S.tf = b.textContent; active = null; save(); renderSegs(); drawChart(); });
}
$('#refresh').onclick = () => { relayOK = null; drawChart(); };
['zsym', 'zent', 'zstp', 'zrisk'].forEach(i => $('#' + i).oninput = calcSize);
const bindSet = (id, k, cb = x => x) => { const el = $('#' + id); if (el.type === 'checkbox') el.checked = S[k]; else el.value = S[k]; el.onchange = () => { S[k] = el.type === 'checkbox' ? el.checked : cb(el.value); save(); $('#rrlbl').textContent = S.minRR; renderRisk(); if (k === 'minRR') drawChart(); }; };
bindSet('sminrr', 'minRR', Number); bindSet('sdaily', 'daily', Number); if (![70, 55, 0].includes(+S.minConf)) S.minConf = 55; bindSet('sminconf', 'minConf', Number); bindSet('ssound', 'sound');
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
document.querySelectorAll('.morebtns [data-go]').forEach(b => b.onclick = () => tab(b.dataset.go)); document.querySelectorAll('.back').forEach(b => b.onclick = () => tab('more'));
const HELP = { tf: 'This is how long each candle on the chart lasts. 5m = 5 minutes. Shorter = more ideas but more noise. 30m and 60m give fewer, slower ideas.',
  risk: 'Your daily stop is the most you allow yourself to lose in one day (default $300). When it is used up, stop trading until tomorrow. Log your trades so this stays accurate.',
  size: 'Type where you will get in and where your stop loss goes. The app tells you how many contracts keep your loss under the amount you choose.',
  log: 'After a trade, write down where you got in and out. The app works out your profit or loss, how often you win, and keeps your daily limit up to date.',
  csv: 'Most accurate way. In TradingView: open your chart → click the arrow next to the chart layout name (top right) → Export chart data… → Export. Open the .csv file here (or open it in Notepad, copy all, paste in the box). Pick the contract, then tap Read my data. No AI key needed.',
  img: 'Paste a screenshot (Ctrl+V on the PC, or choose/take a photo on the phone). An AI reads the candles and price scale, so prices can be off — always check them on your chart. Needs your own AI key in More → Settings (about 1 cent or less per picture).',
  learn: 'The app studies how its ideas did on recent prices, plus trades you log here and in Strat Trader. It then rates ideas higher or lower, hides combos that keep losing (only after 8+ results), and can move the take profit (1.5–3× risk) or stop toward what worked. Your own trades count 3× more. Turn it off or reset it in More → Settings.',
  ai: 'Copy an analysis from the Claude or ChatGPT app and paste it here. The app picks out the direction (long/short, bullish/bearish), entry, stop, target, support/resistance levels, timeframe and rules like "avoid MGC before 9:30". Check and fix anything on the confirm screen, then Apply. Ideas that agree get rated higher, ones that conflict get flagged, and levels are drawn on the chart. It expires when you choose (default: end of today).',
  track: 'This tests the same kind of trade ideas on recent price history. A negative number means they would have lost money if you took every one, so be picky and favor Strong ideas.' };
document.querySelectorAll('.help').forEach(b => b.onclick = ev => { ev.stopPropagation(); showModal([HELP[b.dataset.h]]); });
const GUIDE = ['<h2>Welcome to Strat Master P.A 👋</h2><p>This app <b>suggests</b> trades on MES, MNQ and MGC. It never trades for you — <b>you</b> place every trade yourself on your platform.</p>',
  '<h2>Home tells you what to do</h2><p>The top box says in one sentence: <b>wait</b>, or a possible trade with exact prices.</p><p><span class="be">Blue = get in</span> · <span class="r">Red = stop loss</span> · <span class="g">Green = take profit</span></p>',
  '<h2>Every idea has a plan</h2><p>1 · <b class="be">Get in at</b> — 2 · <b class="r">Stop loss</b> — 3 · <b class="g">Take profit</b>.</p><p>Ideas are rated <b class="g">Strong</b>, <b class="a">Okay</b> or <b class="r">Weak</b>, and show what you could <b class="g">win</b> vs <b class="r">risk</b>.</p>',
  '<h2>Stay safe</h2><p>Prices are about <b>10–25 minutes delayed</b> — always check the live price on your platform first.</p><p>After each trade tap <b>📝 I took this trade</b> so your results and $300 daily stop stay up to date. Tap <b>?</b> anywhere for help.</p>'];
function showModal(pages, done) { let i = 0; const m = $('#modal'); const draw = () => { $('#mtxt').innerHTML = pages[i]; $('#mnext').textContent = i < pages.length - 1 ? 'Next' : 'Got it'; $('#mskip').hidden = pages.length < 2 || i === pages.length - 1; }; draw(); m.hidden = false;
  $('#mnext').onclick = () => { if (++i < pages.length) draw(); else { m.hidden = true; done && done(); } }; $('#mskip').onclick = () => { m.hidden = true; done && done(); }; }
$('#guideagain').onclick = () => showModal(GUIDE);
if (!S.guided) showModal(GUIDE, () => { S.guided = true; save(); });
// ---- Learn from my results
let learnBusy = false;
async function refreshLearn() {
  if (learnBusy) return; learnBusy = true;
  try {
    const barsBy = {}, htfBy = {};
    for (const sym of SYMS) { barsBy[sym] = {}; htfBy[sym] = {}; for (const tf of ['5m', '15m', '30m', '60m']) { try { barsBy[sym][tf] = (cache[sym + tf] || await load(sym, tf)).closed; const h = htfOf(tf); if (h) htfBy[sym][tf] = (cache[sym + h] || await load(sym, h)).closed; } catch { } } }
    let j = []; if (S.stUrl && S.stKey) { try { j = await stGet('/api/journal'); } catch { } }
    const since = (S.learnReset || 0) / 1000, recs = [...Learn.trackRecords(barsBy, htfBy), ...Learn.logRecords(S.log), ...Learn.stRecords(j)].filter(r => r.t >= since);
    Learn.build(recs); renderLearn();
  } finally { learnBusy = false; }
}
function renderLearn() {
  const el = $('#learned'); if (!el) return;
  if (!S.learnOn) { el.innerHTML = '<span class="note">Learning is off (More → Settings).</span>'; return; }
  const m = Learn.model; if (!m) { el.innerHTML = '<span class="note">Studying your results…</span>'; return; }
  el.innerHTML = `<ul class="learnlist">${AIA.active().filter(a => a.kind === 'item' && a.dir).map(a => `<li class="b">From ${a.src}: ${a.sym} ${a.dir === 'LONG' ? 'bullish' : 'bearish'} — matching ideas rated higher, opposite ones flagged.</li>`).join('')}${Learn.insights().map(i => `<li class="${i.c}">${i.t}</li>`).join('')}</ul><div class="note">Based on ${m.n} results (${m.mine} your own trades, the rest from the app's price-history record${S.learnReset ? ', since your last reset ' + new Date(S.learnReset).toLocaleDateString('en-US', CT) : ''}). Small samples are pulled toward "no effect" so a few trades can't swing things.</div>`;
}
$('#slearn').checked = S.learnOn; $('#slearn').onchange = () => { S.learnOn = $('#slearn').checked; save(); renderLearn(); scanAll(); };
$('#lreset').onclick = () => { if (!confirm('Reset learning? The app will ignore all results before now (your trade log is kept).')) return; S.learnPrev = S.learnReset; S.learnReset = Date.now(); save(); Learn.build([]); refreshLearn().then(scanAll); toast('Learning reset'); };
$('#lundo').onclick = () => { if (S.learnPrev == null) return toast('Nothing to undo'); S.learnReset = S.learnPrev; S.learnPrev = null; save(); refreshLearn().then(scanAll); toast('Reset undone'); };
setTimeout(() => refreshLearn().then(scanAll), 2500); setInterval(refreshLearn, 10 * 60000);
// ---- AI Analysis UI
let aiDraft = null; const DT = x => new Date(x).toLocaleString('en-US', { ...CT, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
$('#goai').onclick = () => tab('ai');
$('#aiparse').onclick = () => { const txt = $('#aitxt').value; if (!txt.trim()) return toast('Paste the analysis first'); aiDraft = AIA.parse(txt, $('#aisrc').value); renderAIConfirm(); };
function renderAIConfirm() {
  const d = aiDraft, el = $('#aiconfirm'); if (!d) { el.innerHTML = ''; return; }
  if (!d.items.length && !d.rules.length) { el.innerHTML = '<div class="bigwarn"><b>I couldn\'t find prices or a direction in that text.</b><span>Make sure it mentions an instrument (MES, MNQ, MGC, ES, NQ, Gold) and words like long/short, entry, stop, target, support or resistance. Or add one below by hand.</span></div><button id="aiadd" class="ghost">+ Add an instrument by hand</button>'; $('#aiadd').onclick = () => { d.items.push({ sym: S.sym, src: d.src || 'AI', dir: null, tf: null, entry: null, stop: null, target: null, support: [], resistance: [] }); renderAIConfirm(); }; return; }
  const v = x => x == null ? '' : x, sel = (n, o, cur) => `<select data-f="${n}">${o.map(([k, l]) => `<option value="${k}"${k === (cur || '') ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="card"><h3>✅ Here's what I understood — fix anything, then Apply</h3><div class="note">Source: ${sel('src', [['Claude', 'Claude'], ['ChatGPT', 'ChatGPT'], ['AI', 'Other']], d.src)}</div>` +
    d.items.map((it, i) => `<div class="aiitem" data-i="${i}">${it.warn ? `<div class="nonstrat">⚠️ ${it.warn}</div>` : ''}<div class="row2">
      <label>Instrument${sel('sym', [['MES', 'MES'], ['MNQ', 'MNQ'], ['MGC', 'MGC']], it.sym)}</label><label>Direction${sel('dir', [['', '— none —'], ['LONG', 'Long / Buy'], ['SHORT', 'Short / Sell']], it.dir)}</label>
      <label>Timeframe${sel('tf', [['', 'Any'], ['5m', '5m'], ['15m', '15m'], ['30m', '30m'], ['60m', '60m'], ['1d', 'Daily']], it.tf)}</label>
      <label>Entry<input data-f="entry" inputmode="decimal" value="${v(it.entry)}"></label><label>Stop loss<input data-f="stop" inputmode="decimal" value="${v(it.stop)}"></label><label>Take profit<input data-f="target" inputmode="decimal" value="${v(it.target)}"></label>
      <label>Support levels<input data-f="support" value="${it.support.join(', ')}" placeholder="e.g. 6005, 5990"></label><label>Resistance levels<input data-f="resistance" value="${it.resistance.join(', ')}"></label></div>
      <button class="ghost aidel">Remove</button></div>`).join('') +
    (d.rules.length ? `<h4>Rules found</h4>` + d.rules.map((r, i) => `<div class="airule" data-r="${i}">${r.kind === 'avoid' ? '🚫' : '⭐'} ${r.kind === 'setup' ? `Prefer ${r.setup} setups` : `${r.kind === 'avoid' ? 'Avoid' : 'Prefer'} ${r.sym || 'all'} ${AIA.fmtMin(r.from)}–${AIA.fmtMin(Math.min(r.to, 1439))} CT`} <span class="note">“${r.text}”</span> <button class="ghost airdel">✕</button></div>`).join('') : '') +
    `<div class="pbtns"><button id="aiapply" class="big">Apply to my ideas</button><button id="aiadd" class="ghost">+ Add instrument</button><button id="aicancel" class="ghost">Cancel</button></div></div>`;
  const read = () => { d.src = el.querySelector('[data-f=src]').value; el.querySelectorAll('.aiitem').forEach(n => { const it = d.items[n.dataset.i], g = f => n.querySelector(`[data-f=${f}]`).value.trim(), nb = f => g(f) === '' ? null : +g(f).replace(/,/g, '');
    Object.assign(it, { sym: g('sym'), dir: g('dir') || null, tf: g('tf') || null, entry: nb('entry'), stop: nb('stop'), target: nb('target'), support: (g('support').match(/[\d,]*\d(?:\.\d+)?/g) || []).map(x => +x.replace(/,/g, '')), resistance: (g('resistance').match(/[\d,]*\d(?:\.\d+)?/g) || []).map(x => +x.replace(/,/g, '')) }); }); };
  el.querySelectorAll('.aidel').forEach(b => b.onclick = () => { read(); d.items.splice(b.closest('.aiitem').dataset.i, 1); renderAIConfirm(); });
  el.querySelectorAll('.airdel').forEach(b => b.onclick = () => { read(); d.rules.splice(b.closest('.airule').dataset.r, 1); renderAIConfirm(); });
  $('#aiadd').onclick = () => { read(); d.items.push({ sym: S.sym, dir: null, tf: null, entry: null, stop: null, target: null, support: [], resistance: [] }); renderAIConfirm(); };
  $('#aicancel').onclick = () => { aiDraft = null; renderAIConfirm(); };
  $('#aiapply').onclick = () => { read(); const at = Date.now(), exp = AIA.expiry($('#aiexp').value), gid = at.toString(36); S.ai = S.ai || [];
    d.items.forEach(it => S.ai.push({ ...it, kind: 'item', src: d.src, at, exp, gid })); d.rules.forEach(r => S.ai.push({ ...r, src: d.src, at, exp, gid })); save();
    aiDraft = null; $('#aitxt').value = ''; renderAIConfirm(); renderAI(); scanAll(); drawChart().catch(() => { }); toast(`Applied — from ${d.src}`); };
}
function renderAI() {
  const all = (S.ai || []).slice().sort((a, b) => b.at - a.at), now = Date.now();
  const desc = a => a.kind === 'item' ? `${a.sym}${a.tf ? ' ' + a.tf : ''} ${a.dir ? (a.dir === 'LONG' ? '📈 bullish' : '📉 bearish') : ''}${a.entry ? ' · entry ' + a.entry : ''}${a.stop ? ' · stop ' + a.stop : ''}${a.target ? ' · target ' + a.target : ''}${a.support.length ? ' · support ' + a.support.join(', ') : ''}${a.resistance.length ? ' · resistance ' + a.resistance.join(', ') : ''}` : a.kind === 'setup' ? `Prefer ${a.setup} setups` : `${a.kind === 'avoid' ? '🚫 Avoid' : '⭐ Prefer'} ${a.sym || 'all'} ${AIA.fmtMin(a.from)}–${AIA.fmtMin(Math.min(a.to, 1439))} CT`;
  $('#aihist').innerHTML = all.length ? all.map(a => `<div class="aih ${a.exp > now ? '' : 'old'}"><b>From ${a.src}</b> <span class="note">${DT(a.at)} · ${a.exp > now ? 'active until ' + DT(a.exp) : 'expired'}</span><div>${desc(a)}</div><button class="ghost aihdel" data-k="${a.at}|${S.ai.indexOf(a)}">Delete</button></div>`).join('') + '<button id="aiclear" class="ghost">Delete all</button>' : 'None yet.';
  $('#aihist').querySelectorAll('.aihdel').forEach(b => b.onclick = () => { S.ai.splice(+b.dataset.k.split('|')[1], 1); save(); renderAI(); scanAll(); drawChart().catch(() => { }); });
  const c = $('#aiclear'); if (c) c.onclick = () => { if (confirm('Delete all saved analyses?')) { S.ai = []; save(); renderAI(); scanAll(); drawChart().catch(() => { }); } };
  const act = AIA.active(); $('#aiactive').innerHTML = act.length ? `<div class="card aion"><b>🤖 Using ${act.length} item(s) from ${[...new Set(act.map(a => a.src))].join(' & ')}</b><ul>${act.slice(0, 5).map(a => `<li>${desc(a)}</li>`).join('')}</ul><span class="note">Until ${DT(Math.min(...act.map(a => a.exp)))} · manage in More → AI Analysis</span></div>` : '';
}
renderAI(); setInterval(renderAI, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
