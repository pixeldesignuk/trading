// fx.js — minimal USD→GBP rate for converting non-GBP broker values into the
// book's base currency. Cached per process with a short TTL so a sync run makes
// at most one call. `fetch` is injectable for tests.
let cache = { rate: null, at: 0 }
const TTL_MS = 10 * 60 * 1000 // 10 min

export async function getUsdGbp({ fetch = globalThis.fetch, now = Date.now, ttl = TTL_MS } = {}) {
  if (cache.rate != null && now() - cache.at < ttl) return cache.rate
  // exchangerate.host is free and key-less; fall back to a sane default if it fails.
  const res = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=GBP').catch(() => null)
  const json = res && res.ok ? await res.json().catch(() => null) : null
  const rate = Number(json?.rates?.GBP)
  if (Number.isFinite(rate) && rate > 0) {
    cache = { rate, at: now() }
    return rate
  }
  // Last-resort fallback (keeps the book usable; flagged by callers if needed).
  return cache.rate ?? 0.79
}

// Test seam — reset the module cache.
export function _resetFxCache() {
  cache = { rate: null, at: 0 }
}
