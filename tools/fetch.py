# Read-only market data sync: pulls delayed futures candles from Yahoo Finance into data/*.json. Never trades.
import json, os, time, urllib.request
SYMS = {"MES": "MES=F", "MNQ": "MNQ=F", "MGC": "MGC=F"}
TFS = {"5m": "5d", "15m": "1mo", "30m": "1mo", "60m": "3mo", "1d": "1y"}
os.makedirs("data", exist_ok=True)
meta = {"updated": int(time.time()), "source": "Yahoo Finance (CME delayed)", "files": {}}
for s, y in SYMS.items():
    for tf, rng in TFS.items():
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{y}?interval={tf}&range={rng}"
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20))["chart"]["result"][0]
            q = r["indicators"]["quote"][0]; out = []
            for i, t in enumerate(r["timestamp"]):
                o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
                if None in (o, h, l, c): continue
                out.append([t, round(o, 2), round(h, 2), round(l, 2), round(c, 2), q["volume"][i] or 0])
            json.dump({"sym": s, "tf": tf, "bars": out, "last": r["meta"].get("regularMarketPrice")}, open(f"data/{s}_{tf}.json", "w"), separators=(",", ":"))
            meta["files"][f"{s}_{tf}"] = len(out)
        except Exception as e:
            print("fail", s, tf, e)
json.dump(meta, open("data/meta.json", "w"))
print(meta)
