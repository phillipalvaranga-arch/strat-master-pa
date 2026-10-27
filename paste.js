// Paste Chart: read TradingView CSV (local scanner) or a screenshot (user's own AI key). Signal-only; never sends orders.
(function () {
  let img = null, inited = false;
  const out = html => { $('#pout').innerHTML = html; $('#pout').scrollIntoView({ behavior: 'smooth' }); };
  const warn = t => `<div class="warn">${t}</div>`;
  function parseCSV(txt) {
    const lines = txt.trim().split(/\r?\n/).filter(l => l.trim()); if (lines.length < 5) throw new Error('Need at least 5 rows of data');
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    let hdr = lines[0].split(sep).map(x => x.trim().toLowerCase().replace(/"/g, '')), start = 1;
    const fi = n => hdr.findIndex(h => h === n || h.startsWith(n));
    let it = fi('time') >= 0 ? fi('time') : fi('date'), io = fi('open'), ih = fi('high'), il = fi('low'), ic = fi('close');
    if ([io, ih, il, ic].some(x => x < 0)) { it = 0; io = 1; ih = 2; il = 3; ic = 4; start = isNaN(+lines[0].split(sep)[1]) ? 1 : 0; }
    const bars = [];
    for (const l of lines.slice(start)) { const c = l.split(sep).map(x => x.replace(/"/g, '').trim()); const tv = c[it];
      let t = /^\d{9,10}$/.test(tv) ? +tv : /^\d{12,13}$/.test(tv) ? Math.floor(+tv / 1000) : Math.floor(Date.parse(tv) / 1000);
      const b = { t: isNaN(t) ? bars.length * 60 : t, o: +c[io], h: +c[ih], l: +c[il], c: +c[ic] }; if ([b.o, b.h, b.l, b.c].every(Number.isFinite)) bars.push(b); }
    bars.sort((a, b) => a.t - b.t); if (bars.length < 5) throw new Error('Could not find open/high/low/close numbers'); return bars;
  }
  function showPlans(list, head) { out(head + list.map((x, k) => sigHTML(x, k)).join('')); bindPlans($('#pout'), list); }
  function runScan(bars, sym, label) {
    const tfSec = bars.length > 2 ? bars[bars.length - 1].t - bars[bars.length - 2].t : 0;
    const tfTxt = tfSec >= 86400 ? '1d' : tfSec >= 60 ? Math.round(tfSec / 60) + 'm' : '?';
    let sigs = Strat.scanAt(bars, bars.length - 1, sym, { minRR: +S.minRR });
    const L = bars[bars.length - 1];
    const head = `<div class="note">${label}: ${bars.length} candles · ${sym} · ${tfTxt} · last candle ${fmtT(L.t)} (close ${fp(L.c, sym)})</div>`;
    if (sigs.length) return showPlans(sigs, head);
    out(head + `<div class="now wait"><b>No good trade on the last candle — wait.</b><span>No Strat setup with a take profit at least ${S.minRR}× the risk. Paste again after the next candle closes.</span></div>`);
  }
  // ---- image reading
  const PROMPT = `You are reading a futures candlestick chart screenshot for a trader who uses "The Strat" (candle types 1 inside, 2 directional, 3 outside; setups like 2-1-2, 3-1-2, 2-2 reversal). Read the price axis carefully.
Return ONLY JSON: {"symbol":"MES|MNQ|MGC|other|unknown","timeframe":"e.g. 5m or unknown","last_candles":"short description of the last 3-4 candles with approximate OHLC","setup":"Strat setup name or none","direction":"LONG|SHORT|NONE","entry":number,"stop":number,"target":number,"reason":"one plain-English sentence","confidence":0-100,"price_read_quality":"good|fair|poor"}
Rules: entry = 1 tick beyond the trigger (last closed) candle's high for LONG or low for SHORT (a stop order); stop = other side of the trigger candle; target = a prior visible high (LONG) or low (SHORT) at least 1.5x the risk away. If no valid setup, direction NONE. Prices must be numbers read from the chart's price scale.`;
  async function callAI(dataUrl) {
    const prov = S.aiProv || 'openai', key = S.aiKey; const b64 = dataUrl.split(',')[1], mime = dataUrl.slice(5, dataUrl.indexOf(';'));
    let r, txt;
    if (prov === 'anthropic') {
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 600, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: PROMPT }] }] }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || r.status); txt = j.content.map(c => c.text || '').join('');
    } else {
      const url = prov === 'xai' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions', model = prov === 'xai' ? 'grok-4' : 'gpt-4o-mini';
      r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }] }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || r.status); txt = j.choices[0].message.content;
    }
    const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('AI did not return a readable answer'); return JSON.parse(m[0]);
  }
  window.smpaReadAI = callAI; // test hook
  function planFromAI(a) {
    const sym = ['MES', 'MNQ', 'MGC'].includes(a.symbol) ? a.symbol : $('#pcsym').value, sp = Strat.SPEC[sym], r = x => +(Math.round(+x / sp.tick) * sp.tick).toFixed(sp.tick < .25 ? 1 : 2);
    const head = `<div class="note">AI read: ${a.symbol || '?'} · ${a.timeframe || '?'} · ${a.last_candles || ''}</div>`;
    if (!a.direction || a.direction === 'NONE' || ![a.entry, a.stop, a.target].every(x => Number.isFinite(+x))) return out(head + `<div class="now wait"><b>No clear trade in this picture — wait.</b><span>${a.reason || ''}</span></div>`);
    const s = { sym, dir: a.direction === 'LONG' ? 'LONG' : 'SHORT', setup: a.setup || 'from picture', entry: r(a.entry), stop: r(a.stop), target: r(a.target), conf: Math.max(5, Math.min(90, +a.confidence || 40) - (a.price_read_quality === 'poor' ? 25 : a.price_read_quality === 'fair' ? 10 : 0)), t: Date.now() / 1000, why: (a.reason || '') };
    s.risk = Math.abs(s.entry - s.stop); const L = s.dir === 'LONG';
    if (!s.risk || (L ? !(s.stop < s.entry && s.target > s.entry) : !(s.stop > s.entry && s.target < s.entry))) return out(head + warn('The AI\'s prices don\'t make a valid trade (stop/target on the wrong side). Try a clearer screenshot or use Option 1.'));
    s.rr = +(Math.abs(s.target - s.entry) / s.risk).toFixed(2);
    const bad = s.rr < 1.5 ? warn(`⚠️ Not a good trade: take profit is only ${s.rr}× the risk (needs at least 1.5×). Better to skip it.`) : '';
    out(head + warn(`⚠️ Prices were read from a picture by AI (${a.price_read_quality || 'unknown'} quality). Check every price on your chart before placing orders.`) + bad + sigHTML(s, 0)); bindPlans($('#pout'), [s]);
  }
  function setImg(file) { const fr = new FileReader(); fr.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); img = c.toDataURL('image/jpeg', .9); $('#pprev').src = img; $('#pprev').hidden = false; }; im.src = fr.result; }; fr.readAsDataURL(file); }
  window.pasteInit = function () {
    $('#pkeynote').innerHTML = S.aiKey ? `Using your ${({ openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI' })[S.aiProv || 'openai']} key (saved on this device only).` : 'No AI key yet. To read pictures: <b>More → Settings → Chart picture reading</b>, pick a service and paste your own key there. Option 1 works without a key.';
    if (inited) return; inited = true;
    document.addEventListener('paste', e => { if (!$('#paste').classList.contains('on')) return; const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); if (it) { e.preventDefault(); setImg(it.getAsFile()); } else if (document.activeElement !== $('#pcsv')) { const t = e.clipboardData.getData('text'); if (t) $('#pcsv').value = t; } });
    const d = $('#pdrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (!f) return; if (f.type.startsWith('image/')) setImg(f); else f.text().then(t => $('#pcsv').value = t); };
    $('#pcsv').ondragover = e => e.preventDefault(); $('#pcsv').ondrop = e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) f.text().then(t => $('#pcsv').value = t); };
    $('#pimgfile').onchange = e => e.target.files[0] && setImg(e.target.files[0]);
    $('#pcsvfile').onchange = e => e.target.files[0] && e.target.files[0].text().then(t => { $('#pcsv').value = t; const m = e.target.files[0].name.match(/MES|MNQ|MGC/i); if (m) $('#pcsym').value = m[0].toUpperCase(); });
    $('#pcsvgo').onclick = () => { try { runScan(parseCSV($('#pcsv').value), $('#pcsym').value, 'Your data'); } catch (e) { out(warn('Could not read that data: ' + e.message + '. Tap ? for how to export it from TradingView.')); } };
    $('#pcur').onclick = async () => { try { const d = cache[S.sym + S.tf] || await load(S.sym, S.tf); runScan(d.closed, S.sym, 'App chart'); } catch (e) { out(warn('Chart data not available: ' + e.message)); } };
    $('#pimggo').onclick = async () => {
      if (!img) return out(warn('Paste, drop or choose a chart picture first.'));
      if (!S.aiKey) return out(warn('Reading pictures needs your own AI key. Go to <b>More → Settings → Chart picture reading</b>, pick OpenAI, Anthropic or xAI, and paste your key. It stays on this device. Or use Option 1 (no key).'));
      out('<div class="now"><b>Reading your chart…</b><span>Usually 5–20 seconds.</span></div>');
      try { planFromAI(await callAI(img)); } catch (e) { out(warn('AI reading failed: ' + e.message)); }
    };
  };
  window.smpaPlanFromAI = planFromAI;
  // settings fields
  $('#aiprov').value = S.aiProv || 'openai'; $('#aikey').value = S.aiKey || '';
  $('#aiprov').onchange = () => { S.aiProv = $('#aiprov').value; save(); }; $('#aikey').onchange = () => { S.aiKey = $('#aikey').value.trim(); save(); };
})();
