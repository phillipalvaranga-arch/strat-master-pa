// AI Analysis: paste a write-up from Claude or ChatGPT; the app parses it (no key needed), you confirm, then it's applied.
(function (root) {
  const SYM = { MES: 'MES', ES: 'MES', SPX: 'MES', 'S&P': 'MES', MNQ: 'MNQ', NQ: 'MNQ', NASDAQ: 'MNQ', MGC: 'MGC', GC: 'MGC', GOLD: 'MGC' };
  const symRe = /\b(MES|MNQ|MGC|ES|NQ|GC|SPX|S&P|NASDAQ|GOLD)(?:[FGHJKMNQUVXZ]\d{1,2}|=F|1!)?\b/gi;
  const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  const num = s => +String(s).replace(/,/g, '');
  const RANGE = { MES: [2000, 12000], MNQ: [8000, 40000], MGC: [800, 8000] };
  const ok = (sym, p) => Number.isFinite(p) && (!RANGE[sym] || (p >= RANGE[sym][0] && p <= RANGE[sym][1]));
  const firstNum = (txt, re, sym) => { const m = txt.match(re); if (!m) return null; const ns = (m[m.length - 1].match(new RegExp(NUM, 'g')) || []).map(num).filter(p => ok(sym, p)); return ns.length ? ns[0] : null; };
  function timeCT(s) { const m = String(s).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i); if (!m) return null; let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12; if (ap.startsWith('a') && h === 12) h = 0; if (!ap && h < 7) h += 12; return h * 60 + mi; }
  const fmtMin = m => { const h = Math.floor(m / 60), mi = m % 60; return `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  function dirOf(t) { const b = (t.match(/\b(long|buy|bullish|bull|upside|calls?|go long|buying)\b/gi) || []).length, s = (t.match(/\b(short|sell|bearish|bear|downside|puts?|go short|selling)\b/gi) || []).length;
    return b > s ? 'LONG' : s > b ? 'SHORT' : null; }
  function tfOf(t) { const m = t.match(/\b(\d{1,3})\s*-?\s*(m|min|mins|minute|minutes)\b/i); if (m) return m[1] + 'm'; if (/\b(1h|60m|hourly|1-hour|one hour)\b/i.test(t)) return '60m'; if (/\b(daily|1d|day chart)\b/i.test(t)) return '1d'; return null; }
  function listNums(t, word, sym) { const re = new RegExp(word + '(?:[^\\n;.]|\\.(?=\\d)){0,70}', 'gi'), out = []; for (const m0 of t.matchAll(re)) { const seg = m0[0].replace(/^\S+/, '').split(/\b(?:support|resistance|demand|supply|stop|target|entry|enter|SL|TP|PT|short|long|buy|sell|I'?d)\b/i)[0]; for (const n of (seg.match(new RegExp(NUM, 'g')) || [])) { const p = num(n); if (ok(sym, p) && !out.includes(p)) out.push(p); } } return out; }
  function parse(text, src) {
    text = String(text || '').replace(/\r/g, '').replace(/[*_`#>]/g, '').replace(/[–—]/g, '-');
    src = src || (/claude|anthropic/i.test(text) ? 'Claude' : /chatgpt|gpt|openai/i.test(text) ? 'ChatGPT' : 'AI');
    // split into blocks by instrument mention (paragraph or heading level)
    const paras = text.split(/\n\s*\n|\n(?=\s*(?:\d+[.)]|-|•)?\s*(?:MES|MNQ|MGC|ES|NQ|GC|Gold|Nasdaq)\b)/i); const blocks = {}; let cur = null;
    const allSyms = [...new Set([...text.matchAll(symRe)].map(m => SYM[m[1].toUpperCase()]))];
    for (const p of paras) { const ss = [...new Set([...p.matchAll(symRe)].map(m => SYM[m[1].toUpperCase()]))]; if (ss.length === 1) cur = ss[0]; else if (ss.length > 1) cur = null; const k = cur || (allSyms.length === 1 ? allSyms[0] : (ss[0] || allSyms[0] || S.sym)); (blocks[k] = blocks[k] || []).push(p); }
    const items = [], rules = [];
    for (const sym in blocks) { const t = blocks[sym].join('\n');
      const entry = firstNum(t, new RegExp('(?:entry|enter|entries|buy|sell|long|short)(?:\\s+(?:stop|limit|zone|price|at|around|near|above|below|on a break of|over|under))*[^\\d\\n]{0,20}' + NUM, 'i'), sym);
      const stop = firstNum(t, new RegExp('(?<!(?:buy|sell)\\s)(?:stop[- ]?loss|stop|\\bSL\\b|invalidation|risk to)[^\\d\\n]{0,20}' + NUM, 'i'), sym);
      const target = firstNum(t, new RegExp('(?:target|\\bTP|\\bPT|take[- ]?profit|objective)(?:\\s*\\d(?=\\s*[:)-]))?[^\\d\\n]{0,20}' + NUM, 'i'), sym);
      const it = { sym, src, dir: dirOf(t), tf: tfOf(t), entry, stop, target, support: listNums(t, '(?:support|demand|floor)', sym), resistance: listNums(t, '(?:resistance|supply|ceiling)', sym) };
      if (it.entry && it.stop && !it.dir) it.dir = it.stop < it.entry ? 'LONG' : 'SHORT';
      if (it.dir && it.entry && it.stop && ((it.dir === 'LONG') !== (it.stop < it.entry))) it.warn = 'Stop is on the wrong side of entry — please check.';
      if (it.dir || it.entry || it.support.length || it.resistance.length) items.push(it); }
    for (const m of text.matchAll(/\b(avoid|no trades?|don'?t trade|stay out of|skip)\b([^.\n]{0,80})/gi)) { const seg = m[2], sm = seg.match(symRe), tm = seg.match(/\b(before|after|until|between)\s+([\d:]+\s*(?:am|pm|a\.m\.|p\.m\.)?)(?:\s*(?:and|-|to)\s*([\d:]+\s*(?:am|pm)?))?/i);
      if (tm) { const a = timeCT(tm[2]), b = tm[3] ? timeCT(tm[3]) : null; rules.push({ kind: 'avoid', src, sym: sm ? SYM[sm[0].toUpperCase().replace(/[FGHJKMNQUVXZ]\d+$|=F|1!/, '')] || null : null, from: /after/i.test(tm[1]) ? a : /between/i.test(tm[1]) ? a : 0, to: /after/i.test(tm[1]) ? 24 * 60 : /between/i.test(tm[1]) ? (b ?? a + 60) : a, text: m[0].trim() }); } }
    for (const m of text.matchAll(/\b(best|prefer|focus on|favor|only trade)\b([^.\n]{0,80})/gi)) { const tm = m[2].replace(/\b[23]-[12](?:-2)?\b/g, '').match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|and)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i); const st = m[2].match(/\b(2-1-2|3-1-2|2-2)\b/);
      if (tm) rules.push({ kind: 'prefer', src, from: timeCT(tm[1]), to: timeCT(tm[2]), text: m[0].trim() }); if (st) rules.push({ kind: 'setup', src, setup: st[1], text: m[0].trim() }); }
    return { src, items, rules };
  }
  const nowMin = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })); return d.getHours() * 60 + d.getMinutes(); };
  const active = () => (S.ai || []).filter(x => x.exp > Date.now());
  function apply(s) { if (!s) return s; const notes = []; let d = 0; const day = x => new Date(x.at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
    for (const a of active()) { if (a.kind === 'item' && a.sym === s.sym && a.dir && (!a.tf || a.tf === s.tf)) { if (a.dir === s.dir) { d += 10; notes.push({ c: 'g', t: `From ${a.src} (${day(a)}): ${a.dir === 'LONG' ? 'bullish' : 'bearish'} — agrees` }); } else { d -= 15; notes.push({ c: 'r', t: `From ${a.src} (${day(a)}): ${a.dir === 'LONG' ? 'bullish' : 'bearish'} — conflicts with this idea` }); } }
      if (a.kind === 'item' && a.sym === s.sym) { const lv = s.dir === 'LONG' ? a.resistance : a.support; const blk = (lv || []).find(p => s.dir === 'LONG' ? p > s.entry && p < s.target : p < s.entry && p > s.target); if (blk) notes.push({ c: 'a', t: `From ${a.src}: ${s.dir === 'LONG' ? 'resistance' : 'support'} at ${blk} sits before your take profit` }); }
      if (a.kind === 'avoid' && (!a.sym || a.sym === s.sym)) { const n = nowMin(); if (n >= a.from && n < a.to) { d -= 20; notes.push({ c: 'r', t: `From ${a.src} rule: "${a.text}"` }); } }
      if (a.kind === 'prefer') { const n = nowMin(); if (n >= a.from && n < a.to) { d += 5; notes.push({ c: 'g', t: `From ${a.src}: inside preferred time ${fmtMin(a.from)}–${fmtMin(a.to)} CT` }); } }
      if (a.kind === 'setup' && Learn.normSetup(s.setup) === a.setup) { d += 5; notes.push({ c: 'g', t: `From ${a.src}: preferred setup ${a.setup}` }); } }
    if (!notes.length) return s; return { ...s, conf: Math.max(5, Math.min(95, Math.round(s.conf + Math.max(-30, Math.min(20, d))))), ai: notes }; }
  function levels(sym) { const out = []; for (const a of active()) if (a.kind === 'item' && a.sym === sym) { a.support.forEach(p => out.push([p, '#22c55e', `${a.src} support`])); a.resistance.forEach(p => out.push([p, '#ef4444', `${a.src} resistance`]));
      if (a.entry) out.push([a.entry, '#a78bfa', `${a.src} entry`]); if (a.stop) out.push([a.stop, '#f97316', `${a.src} stop`]); if (a.target) out.push([a.target, '#facc15', `${a.src} target`]); } return out; }
  function expiry(v) { const now = Date.now(); if (v === 'eod') { const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })); const left = ((23 - ct.getHours()) * 60 + (59 - ct.getMinutes())) * 60000; return now + left; } return now + { '4h': 4, '1d': 24, '1w': 168 }[v] * 3600000; }
  root.AIA = { parse, apply, levels, active, expiry, fmtMin, timeCT };
})(this);
