import fs from 'node:fs'
import path from 'node:path'
import YahooFinance from 'yahoo-finance2'
import { DATA_DIR } from './config.js'

// yahoo-finance2 v3 is a class — must be instantiated (v2 used a bare default
// export). Suppress the survey/validation notices for clean server logs.
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

const TTL_MS = 10 * 60 * 1000
const CACHE_FILE = process.env.PRICE_CACHE_FILE || path.join(DATA_DIR, 'price-cache.json')

// Real futures symbols contain '=F'; tracking ETFs for commodities mis-price
// vs the futures entry, so skip plain commodity tickers (also non-compliant).
export function yahooSymbol(ticker, assetClass) {
  if (!ticker) return null
  if (assetClass === 'crypto') {
    return ticker.includes('/') ? ticker.replace('/', '-') : `${ticker}-USD`
  }
  if (assetClass === 'commodity') return ticker.includes('=F') ? ticker : null
  return ticker
}

const cache = new Map()
try {
  for (const [s, v] of Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')))) cache.set(s, v)
} catch { /* no cache yet */ }
function persist() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache))) } catch { /* best effort */ }
}

// Daily price history (for the chart). Cached longer — daily bars barely move.
const HIST_TTL = 6 * 60 * 60 * 1000
const HIST_FILE = process.env.PRICE_HIST_FILE || path.join(DATA_DIR, 'price-history.json')
const histCache = new Map()
try {
  for (const [s, v] of Object.entries(JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')))) histCache.set(s, v)
} catch { /* none yet */ }
function persistHist() {
  try { fs.writeFileSync(HIST_FILE, JSON.stringify(Object.fromEntries(histCache))) } catch { /* best effort */ }
}

// ticker -> [{ t: epoch ms, c: close }] daily closes over ~`months`.
export async function getHistory(ticker, assetClass, { yf = yahooFinance, now = Date.now(), months = 38, symbol } = {}) {
  // `symbol` override lets a commodity chart off its reference future (PA=F) since
  // the bare commodity ticker has no resolvable yahoo symbol.
  const sym = symbol || yahooSymbol(ticker, assetClass)
  if (!sym) return []
  const cached = histCache.get(sym)
  if (cached && now - cached.ts < HIST_TTL) return cached.data
  try {
    const period1 = new Date(now - months * 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const r = await yf.chart(sym, { period1, interval: '1d' })
    const data = (r.quotes || []).filter((q) => q.close != null).map((q) => ({ t: +new Date(q.date), c: q.close }))
    histCache.set(sym, { data, ts: now })
    persistHist()
    return data
  } catch {
    return cached?.data || []
  }
}

// pairs: [{ticker, asset_class}] -> {ticker: {price, changePct}|null-ish}.
// changePct is the regular-session % change vs the PREVIOUS close (the normal
// ticker change), not relative to any plan entry. One batched yahoo call.
export async function getQuotes(pairs, { yf = yahooFinance, now = Date.now() } = {}) {
  const symByTicker = new Map()
  for (const p of pairs || []) {
    // `symbol` override lets a commodity ticker be priced off an arbitrary yahoo
    // symbol (its locked ETC or reference future) while staying keyed by the hub ticker.
    const s = p.symbol || yahooSymbol(p.ticker, p.asset_class)
    if (s) symByTicker.set(p.ticker, s)
  }
  const stale = [...new Set(symByTicker.values())].filter((s) => {
    const c = cache.get(s); return !c || now - c.ts > TTL_MS
  })
  if (stale.length) {
    try {
      const quotes = await yf.quote(stale)
      const arr = Array.isArray(quotes) ? quotes : [quotes]
      const got = new Set()
      for (const q of arr) {
        if (q?.symbol) {
          // LSE lines quote in pence (currency 'GBp'); normalise to pounds so the
          // price reads consistently with GBP-denominated holdings (e.g. ISWD.L
          // 5028 GBp → £50.28). Percentage change is unit-independent.
          let price = q.regularMarketPrice ?? null
          if (price != null && q.currency === 'GBp') price = price / 100
          cache.set(q.symbol, { price, changePct: q.regularMarketChangePercent ?? null, ts: now })
          got.add(q.symbol)
        }
      }
      for (const s of stale) if (!got.has(s)) cache.set(s, { price: null, changePct: null, ts: now })
      persist()
    } catch { /* leave stale; retried next call */ }
  }
  const out = {}
  for (const [t, s] of symByTicker) {
    const c = cache.get(s)
    out[t] = { price: c?.price ?? null, changePct: c?.changePct ?? null }
  }
  return out
}
