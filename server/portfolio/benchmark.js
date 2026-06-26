// Benchmark scorecard (Zero masterclass Concept 4: "beat the index or it's
// guessing"). Maps the per-book benchmark label to a tradeable Yahoo symbol and
// computes its trailing return; the ledger compares the book's return to it.
export const BENCHMARK_SYMBOLS = {
  'MSCI World Islamic': 'ISDW.L',   // iShares MSCI World Islamic UCITS ETF
  'MSCI USA Islamic': 'ISUS.L',
  'FTSE All-World': 'VWRL.L',
}

export function benchmarkSymbol(label) {
  return BENCHMARK_SYMBOLS[label] || null
}

// closes: oldest→newest daily closes. Trailing return over `lookback` bars
// (~252 trading days ≈ 1y). Null when there isn't enough history.
export function trailingReturn(closes, lookback = 252) {
  if (!Array.isArray(closes) || closes.length < 2) return null
  const last = closes[closes.length - 1]
  const base = closes[Math.max(0, closes.length - 1 - lookback)]
  if (!base || !last) return null
  return (last - base) / base
}

// bars: [{ t: epochMs, c: close }] ascending. YTD = vs the last close of the
// previous calendar year; allTime = vs the earliest available bar.
export function periodReturns(bars, year) {
  if (!Array.isArray(bars) || bars.length < 2) return { ytd: null, allTime: null }
  const last = bars[bars.length - 1].c
  const first = bars[0].c
  const allTime = first ? (last - first) / first : null
  let base = null
  for (const b of bars) {
    if (new Date(b.t).getFullYear() < year) base = b.c
    else break
  }
  if (base == null) base = first
  const ytd = base ? (last - base) / base : null
  return { ytd, allTime }
}

// Book's unrealised return from synced funds (pnl over cost basis = value − pnl).
export function bookReturn({ totalValue, pnl } = {}) {
  const cost = Number(totalValue || 0) - Number(pnl || 0)
  if (!cost) return null
  return Number(pnl || 0) / cost
}
