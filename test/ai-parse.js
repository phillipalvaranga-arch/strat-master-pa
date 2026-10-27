global.S={sym:'MES'};global.Learn={normSetup:x=>x};new Function(require('fs').readFileSync(__dirname+'/../ai.js','utf8')).call(global);const AIA=global.AIA;
const samples={
claude:`Here's my read on MES for today (Claude):

**Bias: Bearish** on the 15-minute chart. Price rejected resistance at 6,072.50 and 6,085.

- **Entry:** Sell stop at 6,048.25 on a break of the inside bar
- **Stop loss:** 6,061.00
- **Target 1:** 6,021.50, Target 2: 6,005
- Key support: 6,021.50 and 6,005.00

Avoid MGC before 9:30 AM CT. Best window is 9:30 - 11:00 AM.`,
gpt:`ChatGPT analysis

1. NQ (MNQ) – Bullish 5m
Long above 21,450.75, SL 21,410, TP 21,530. Support 21,400 / 21,380, resistance 21,530.

2. Gold (MGC) – bearish below 2,655.4. Short entry 2,654.9, stop 2,661.2, take profit 2,640.0.

Prefer 2-1-2 setups. Don't trade after 2:00 pm.`,
mixed:`ES looks heavy. resistance 5,980 - I'd short 5,972 with a stop at 5,985 and target 5,945. Gold is choppy, no trades until 9:45.`};
for(const k in samples)console.log(k,JSON.stringify(AIA.parse(samples[k])));
