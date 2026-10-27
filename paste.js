// Paste Chart: read TradingView CSV (local scanner) or a screenshot (user's own AI key). Signal-only; never sends orders.
(function () {
  let img = null, inited = false;
  const out = html => { $('#pout').innerHTML = html; $('#pout').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  function showPlans(list, head) { out(head + list.map((x, k) => sigHTML(x, k)).join('')); bindPlans($('#pout'), list); }
  const warn = t => `<div class="warn">${t}</div>`;
  function parseCSV(txt) {
    txt = (txt || '').replace(/^\uFEFF/, '').trim(); if (!txt) throw new Error('The box is empty. Paste the data or open the .csv file first');
    if (/^data:image|<img|\.png|\.jpg/i.test(txt.slice(0, 100))) throw new Error('That looks like a picture, not data. Use Option 2 for pictures');
    const lines = txt.split(/\r?\n/).filter(l => l.trim());
    const sep = lines[0].includes('\t') ? '\t' : (lines[0].split(';').length > lines[0].split(',').length ? ';' : lines[0].includes(',') ? ',' : /\s{2,}|\s/.test(lines[0]) ? /\s+/ : ',');
    const split = l => l.split(sep).map(x => x.replace(/"/g, '').trim()), num = x => +(sep === ';' ? String(x).replace(/\s/g, '').replace(',', '.') : String(x).replace(/[,\s$]/g, ''));
    const hdr = split(lines[0]).map(x => x.toLowerCase()), isHdr = hdr.some(h => /open|high|low|close|time|date/.test(h));
    const fi = re => hdr.findIndex(h => re.test(h));
    let it = 0, io, ih, il, ic;
    if (isHdr) { it = fi(/^(time|date|datetime|timestamp)/); io = fi(/^open/); ih = fi(/^high/); il = fi(/^low/); ic = fi(/^(close|last)/);
      const miss = [['open', io], ['high', ih], ['low', il], ['close', ic]].filter(x => x[1] < 0).map(x => x[0]);
      if (miss.length) throw new Error('Found a header row but no ' + miss.join(', ') + ' column. Columns seen: ' + hdr.slice(0, 8).join(', '));
      if (it < 0) it = -1; } else { const c = split(lines[0]); if (c.length < 5) throw new Error('Each row needs time, open, high, low, close (found ' + c.length + ' columns)'); [io, ih, il, ic] = [1, 2, 3, 4]; }
    const bars = []; let badRows = 0;
    for (const l of lines.slice(isHdr ? 1 : 0)) { const c = split(l), tv = it >= 0 ? c[it] : '';
      let t = /^\d{9,10}(\.\d+)?$/.test(tv) ? Math.floor(+tv) : /^\d{12,13}$/.test(tv) ? Math.floor(+tv / 1000) : Math.floor(Date.parse(tv.replace(/(\d{4}-\d\d-\d\d) (\d)/, '$1T$2')) / 1000);
      const b = { t: Number.isFinite(t) ? t : bars.length * 60, o: num(c[io]), h: num(c[ih]), l: num(c[il]), c: num(c[ic]) };
      if ([b.o, b.h, b.l, b.c].every(Number.isFinite) && b.h >= b.l) bars.push(b); else badRows++; }
    if (bars.length < 3) throw new Error(`Only ${bars.length} usable candle rows (${badRows} rows had missing or non-number prices). Need at least 3`);
    bars.sort((a, b) => a.t - b.t); return bars;
  }
  const tfOf = bars => { const d = bars.length > 2 ? bars[bars.length - 1].t - bars[bars.length - 2].t : 0; return d >= 86400 ? '1d' : d >= 60 ? Math.round(d / 60) + 'm' : '?'; };
  function runScan(bars, sym, label, pre = '') {
    const L = bars[bars.length - 1], plans = Strat.conditional(bars, sym, { minRR: +S.minRR }), hasStrat = plans.some(p => !p.nonStrat);
    const head = pre + `<div class="note">${label}: ${bars.length} candles · ${sym} · ${tfOf(bars)} · last candle ${fmtT(L.t)} (high ${fp(L.h, sym)}, low ${fp(L.l, sym)}, close ${fp(L.c, sym)})</div>
      <div class="now ${hasStrat ? 'buy' : 'wait'}"><small>YOUR PLAN</small><b>${hasStrat ? 'Strat setup found. Use the matching plan below.' : 'No Strat setup on the last candle, so here are both "if" plans.'}</b><span>Place the order only for the side price actually breaks. If price breaks ABOVE ${fp(plans.find(p => p.dir === 'LONG').entry, sym)}, use the BUY plan; if it breaks BELOW ${fp(plans.find(p => p.dir === 'SHORT').entry, sym)}, use the SELL plan. Cancel the other one.</span></div>`;
    showPlans(plans, head);
  }
  async function appChart(sym, tf, pre) { try { const d = await load(sym, tf); runScan(d.closed, sym, `App chart (${feed.src.split('·')[0].trim()})`, pre); } catch (e) { out(pre + warn('Could not load the app\'s chart data: ' + e.message)); } }
  const pickers = () => `<div class="row" style="grid-template-columns:1fr 1fr 1.4fr;align-items:end"><label>Contract<select id="fbsym">${['MES', 'MNQ', 'MGC'].map(x => `<option ${x === $('#pcsym').value ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Timeframe<select id="fbtf">${TFS.map(x => `<option ${x === S.tf ? 'selected' : ''}>${x}</option>`).join('')}</select></label><button id="fbgo" class="primary" style="margin:8px 0">Use the app's live chart</button></div>`;
  function bindPickers(pre) { const go = $('#fbgo'); if (go) go.onclick = () => { $('#pcsym').value = $('#fbsym').value; appChart($('#fbsym').value, $('#fbtf').value, pre()); }; }
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
    if (!a.direction || a.direction === 'NONE' || ![a.entry, a.stop, a.target].every(x => Number.isFinite(+x))) { const tf = TFS.includes(a.timeframe) ? a.timeframe : S.tf; return appChart(sym, tf, head + warn(`The AI found no clear Strat setup in the picture${a.reason ? ' (' + a.reason + ')' : ''}. Below are the "if" plans from the app's live ${sym} ${tf} chart.`)); }
    const s = { sym, dir: a.direction === 'LONG' ? 'LONG' : 'SHORT', setup: a.setup || 'from picture', entry: r(a.entry), stop: r(a.stop), target: r(a.target), conf: Math.max(5, Math.min(90, +a.confidence || 40) - (a.price_read_quality === 'poor' ? 25 : a.price_read_quality === 'fair' ? 10 : 0)), t: Date.now() / 1000, why: (a.reason || '') };
    s.risk = Math.abs(s.entry - s.stop); const L = s.dir === 'LONG';
    if (!s.risk || (L ? !(s.stop < s.entry && s.target > s.entry) : !(s.stop > s.entry && s.target < s.entry))) return appChart(sym, TFS.includes(a.timeframe) ? a.timeframe : S.tf, head + warn('The AI\'s prices didn\'t make a valid trade, so below are plans from the app\'s live chart instead.'));
    s.rr = +(Math.abs(s.target - s.entry) / s.risk).toFixed(2);
    const bad = s.rr < 1.5 ? warn(`⚠️ Not a good trade: take profit is only ${s.rr}× the risk (needs at least 1.5×). Better to skip it.`) : '';
    out(head + warn(`⚠️ Prices were read from a picture by AI (${a.price_read_quality || 'unknown'} quality). Check every price on your chart before placing orders.`) + bad + sigHTML(s, 0)); bindPlans($('#pout'), [s]);
  }
  function setImg(file) { const fr = new FileReader(); fr.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); img = c.toDataURL('image/jpeg', .9); $('#pprev').src = img; $('#pprev').hidden = false; $('#pimggo').click(); }; im.src = fr.result; }; fr.readAsDataURL(file); }
  window.pasteInit = function () {
    $('#pkeynote').innerHTML = S.aiKey ? `Using your ${({ openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI' })[S.aiProv || 'openai']} key (saved on this device only).` : 'No AI key yet. To read pictures: <b>More → Settings → Chart picture reading</b>, pick a service and paste your own key there. Option 1 works without a key.';
    if (inited) return; inited = true;
    document.addEventListener('paste', e => { if (!$('#paste').classList.contains('on')) return; const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); if (it) { e.preventDefault(); setImg(it.getAsFile()); } else if (document.activeElement !== $('#pcsv')) { const t = e.clipboardData.getData('text'); if (t) { $('#pcsv').value = t; $('#pcsvgo').click(); } } });
    const d = $('#pdrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (!f) return; if (f.type.startsWith('image/')) setImg(f); else f.text().then(t => $('#pcsv').value = t); };
    $('#pcsv').addEventListener('paste', () => setTimeout(() => $('#pcsvgo').click(), 50)); $('#pcsv').ondragover = e => e.preventDefault(); $('#pcsv').ondrop = e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) f.text().then(t => $('#pcsv').value = t); };
    $('#pimgfile').onchange = e => e.target.files[0] && setImg(e.target.files[0]);
    $('#pcsvfile').onchange = e => e.target.files[0] && e.target.files[0].text().then(t => { $('#pcsv').value = t; const m = e.target.files[0].name.match(/MES|MNQ|MGC/i); if (m) $('#pcsym').value = m[0].toUpperCase(); });
    $('#pcsvgo').onclick = () => { try { runScan(parseCSV($('#pcsv').value), $('#pcsym').value, 'Your data'); } catch (e) { out(`<div class="bigwarn"><b>Couldn't read that data</b><span>${e.message}. Tap the ? next to Option 1 for how to export from TradingView, or pick below to use the app's live chart.</span></div>` + pickers()); bindPickers(() => pickers()); } };
    $('#pcur').onclick = () => appChart(S.sym, S.tf, '');
    $('#pimggo').onclick = async () => {
      if (!img) return out(warn('Paste, drop or choose a chart picture first.'));
      if (!S.aiKey) { const pre = () => `<div class="bigwarn"><b>🔑 Your picture can't be read yet: no AI key</b><span>Reading a chart picture needs an AI key (More → Settings → Chart picture reading). <b>No key? No problem:</b> pick the contract and timeframe of your picture and the app uses its own live chart. The plans are below.</span></div>`;
        out(pre() + pickers()); bindPickers(() => pre() + pickers()); const o = $('#pout').innerHTML;
        try { const d = await load($('#fbsym').value, $('#fbtf').value); runScan(d.closed, $('#fbsym').value, 'App chart', pre() + pickers()); bindPickers(() => pre() + pickers()); } catch (e) { $('#pout').innerHTML = o + warn('Live chart not available: ' + e.message); }
        return; }
      out('<div class="now"><b>Reading your chart…</b><span>Usually 5–20 seconds.</span></div>');
      try { planFromAI(await callAI(img)); } catch (e) { const pre = () => `<div class="bigwarn"><b>AI reading failed</b><span>${e.message}. Here are plans from the app's live chart instead.</span></div>` + pickers(); appChart($('#pcsym').value, S.tf, pre()).then(() => bindPickers(pre)); }
    };
  };
  window.smpaPlanFromAI = planFromAI;
  // settings fields
  $('#aiprov').value = S.aiProv || 'openai'; $('#aikey').value = S.aiKey || '';
  $('#aiprov').onchange = () => { S.aiProv = $('#aiprov').value; save(); }; $('#aikey').onchange = () => { S.aiKey = $('#aikey').value.trim(); save(); };
})();
