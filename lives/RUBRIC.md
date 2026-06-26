# Live-setup extraction rubric (compact)

You convert ONE chart's evidence (label + transcript narration + noisy OCR of the chart) into a
structured trade setup, graded against Zero's method and Sharia-screened. Educational only.

## Extraction rules
- **`symbol` must be the clean investable ticker**, not the chart's CFD/pair string: `BTC` not
  `BTCUSD`/`BTCUSD.P`, `ETH` not `ETHUSDT`, `BRK.B` not `BRKB`. For a commodity with no direct
  spot ticker, use the common ETF/ETC proxy (gold→`SGLN`/`IAU` per Sharia rules; oil→leave as the
  energy equity Zero names, e.g. `COP`) and put the raw chart symbol in `note`. If it's a pure
  macro/dominance read (BTC.D, USDT.D, BVOL) with no investable single asset, keep it `kind:"context"`.
- The **transcript is Zero speaking** — he says the levels, the bias, what invalidates it. Trust it first.
- **OCR is noisy** chart text (symbol header, price axis, annotation labels). Use it to confirm exact
  numbers and the symbol/timeframe. Ignore garbage tokens.
- Preserve **exact prices/levels**. If a number is ambiguous between transcript and OCR, prefer the
  transcript; note the uncertainty in `note`.
- **Spot-first.** If the instrument is a CFD/future/perp/leverage read (e.g. `TVC:GOLD`, `…USDT.P`),
  record the read but set `bias` to the spot expression and flag it in `note`.
- If a chart is just macro context (BTC.D, USDT.D, seasonality) with no actionable single-asset
  setup, set `kind:"context"` and leave entry/targets empty.

## §20 grade (score the setup, 10 checks; output 0–10 = count of checks it plausibly passes)
1 Direction vs EQ (long in HTF discount / short in premium) · 2 Valid zone (OB/HOB/demand/FVG/fib) ·
3 Liquidity sweep before entry · 4 Structure (BOS/CHoCH in direction) · 5 HTF closure confirmation ·
6 Not a chase (pullback/retest) · 7 Structure-based stop · 8 R:R ≥2:1 · 9 Macro confluence
(BTC/BTC.D/USDT.D/funding) · 10 Defined sizing/TPs.
Verdict: **8–10 = textbook**, **5–7 = partial** (name missing pillars), **≤4 = weak/not-his-method**.
Grade only on what the evidence supports; if a check is unknowable from the evidence, don't credit it.

## Sharia screen (deterministic first)
- Spot ownership of shares / physical-allocated commodity / spot crypto → **halal**.
- CFD / future / option / spread-bet / margin / short-borrow → **haram** (record the spot expression instead).
- Gold & silver: the *spot* expression is permissible via a **physically-backed allocated ETC**
  (UK: SGLN/SGLP/PHGP · US: IAU/SGOL/GLDM), so **`sharia_status` is ALWAYS `"halal"` for gold/silver**,
  even when the chart shown is a CFD/`TVC:` ticker. Put the "chart is a CFD, buy the ETC instead"
  caveat in `spot_note` and name the ETC in `sharia_note`. Do NOT mark gold/silver `haram`.
- Individual stocks: `sharia_status:"questionable"` unless clearly halal sector — note "verify business + debt screen (Zoya/Musaffa)".
- Use `halal` / `questionable` / `haram`.

## Output: JSON array, one object per chart, in chart order
```json
{
  "chart_index": 1,
  "symbol": "NKE",
  "name": "Nike, Inc.",
  "asset_class": "stock|crypto|commodity|fx|index",
  "kind": "setup|context",
  "bias": "long|short|spot|neutral",
  "entry": "exact level or zone, or ''",
  "targets": ["TP1 …", "TP2 …"],
  "invalidation": "what voids it (level/close), or ''",
  "key_levels": ["…"],
  "timeframe": "e.g. 1W / 3M / 4h",
  "rationale": "1–3 sentences in plain English: where vs EQ, liquidity, the Zero rule it obeys/breaks",
  "grade_score": 0,
  "grade_verdict": "textbook|partial|weak|context",
  "sharia_status": "halal|questionable|haram",
  "sharia_note": "spot expression / ETC / verify-debt etc.",
  "spot_note": "leverage/CFD/perp flag + spot vehicle, or ''",
  "confidence": 0.0
}
```
Return ONLY the JSON array. No prose.
