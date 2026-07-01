// Bitget V2 spot API — read-only snapshot of spot balances for one account.
// Signs requests with the account's apiKey/apiSecret/passphrase (HMAC-SHA256).
// Spot only (halal — own the asset). Stablecoins are treated as account cash;
// every other coin with a balance becomes a holding priced off the public
// {COIN}USDT ticker and FX-converted into GBP (the book's base currency).
//
// The assets endpoint carries no cost basis, so we reconstruct a per-coin entry
// price from the spot fills history (moving-average cost method). This is best-
// effort: Bitget only serves ~90 days of fills, so a position opened earlier —
// or topped up by transfers/airdrops rather than trades — reconstructs from
// partial data and can be skewed. When no usable fills exist the coin stays
// cost-less (null entry, null pnl) rather than showing a false zero.
import crypto from 'node:crypto'
import { getUsdGbp } from './fx.js'

const BASE = 'https://api.bitget.com'
const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : 0
}

export const key = 'bitget'
export const name = 'Bitget'

// Coins treated as cash rather than holdings (≈ 1 USD each).
export const STABLES = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDD', 'BUSD'])

// Spot wallets accumulate sub-penny "dust" (airdrops, trade residue) across dozens
// of coins. Anything below this GBP value isn't a position worth surfacing — skip
// it so it doesn't spawn ticker rows in the pipeline.
export const DUST_GBP = 1

// base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secret)).
export function sign(timestamp, method, requestPath, body, secret) {
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body || ''}`
  return crypto.createHmac('sha256', secret).update(prehash).digest('base64')
}

// Reconstruct the average entry price (in the fills' quote currency, USDT≈USD)
// for the quantity still held, by replaying fills oldest→newest with the moving-
// average cost method: a buy raises total cost and quantity; a sell removes the
// sold units at the *current* average, leaving the remainder's average untouched.
// Fees are ignored (a small, second-order effect on entry price). Returns
// { qty, avgPriceUsd } for the surviving position, or null if nothing remains
// (net-flat, sells-only, or no buys) — i.e. no reliable basis to show.
export function avgCostFromFills(fills) {
  const sorted = [...(fills || [])].sort((a, b) => num(a.cTime) - num(b.cTime))
  let qty = 0
  let cost = 0
  for (const f of sorted) {
    const size = num(f.size)
    const px = num(f.priceAvg ?? f.price)
    if (size <= 0) continue
    if (String(f.side).toLowerCase() === 'buy') {
      qty += size
      cost += size * px
    } else {
      if (qty <= 0) continue
      const avg = cost / qty
      const sold = Math.min(size, qty)
      qty -= sold
      cost -= avg * sold
    }
  }
  if (qty <= 0) return null
  return { qty, avgPriceUsd: cost / qty }
}

function authHeaders(creds, timestamp, method, requestPath, body) {
  return {
    'ACCESS-KEY': creds.apiKey,
    'ACCESS-SIGN': sign(timestamp, method, requestPath, body, creds.apiSecret),
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': creds.passphrase,
    'Content-Type': 'application/json',
    locale: 'en-US',
  }
}

// Page through the spot fills history (newest→oldest via the idLessThan=tradeId
// cursor) and return the flat list. `getSigned(path)` returns the response's
// `data` array. Stops at the first short/empty page or the maxPages safety cap
// (Bitget serves at most ~90 days regardless). Fills carry a `symbol` (COINUSDT).
export async function fetchAllFills(getSigned, { maxPages = 20 } = {}) {
  const all = []
  let cursor = null
  for (let p = 0; p < maxPages; p++) {
    const page = await getSigned(`/api/v2/spot/trade/fills?limit=100${cursor ? `&idLessThan=${cursor}` : ''}`)
    if (!Array.isArray(page) || page.length === 0) break
    all.push(...page)
    if (page.length < 100) break
    cursor = page[page.length - 1]?.tradeId
    if (!cursor) break
  }
  return all
}

// Group fills by their bare coin (BTCUSDT → BTC); non-USDT-quoted pairs are
// dropped since holdings are priced/valued off the {COIN}USDT market.
function groupFillsByCoin(fills) {
  const byCoin = new Map()
  for (const f of fills || []) {
    const sym = String(f.symbol || '').toUpperCase()
    if (!sym.endsWith('USDT')) continue
    const coin = sym.slice(0, -4)
    if (!byCoin.has(coin)) byCoin.set(coin, [])
    byCoin.get(coin).push(f)
  }
  return byCoin
}

// Fetch a normalised GBP snapshot for one Bitget account.
// opts.usdGbp lets callers/tests inject the FX rate; otherwise fx.js is used.
export async function fetchSnapshot(creds, { fetch = globalThis.fetch, now = Date.now, usdGbp, dustGbp = DUST_GBP, maxFillPages = 20 } = {}) {
  const rate = usdGbp != null ? usdGbp : await getUsdGbp({ fetch })

  const getSigned = async (path) => {
    const ts = String(now())
    const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: authHeaders(creds, ts, 'GET', path, '') })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Bitget ${path} → ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 160)}` : ''}`)
    }
    const json = await res.json()
    if (json.code && json.code !== '00000') throw new Error(`Bitget ${path} → ${json.code} ${json.msg || ''}`.trim())
    return json.data
  }

  const getPublic = async (path) => {
    const res = await fetch(`${BASE}${path}`)
    if (!res.ok) throw new Error(`Bitget ${path} → ${res.status} ${res.statusText}`)
    const json = await res.json()
    return json.data
  }

  const [assets, tickers] = await Promise.all([
    getSigned('/api/v2/spot/account/assets'),
    getPublic('/api/v2/spot/market/tickers'),
  ])

  // {COIN}USDT → last price (USD).
  const priceUsd = new Map()
  for (const t of tickers || []) {
    if (typeof t.symbol === 'string' && t.symbol.endsWith('USDT')) {
      priceUsd.set(t.symbol.slice(0, -4), num(t.lastPr ?? t.close ?? t.last))
    }
  }

  let cashGbp = 0
  const holdings = []
  for (const a of assets || []) {
    const coin = String(a.coin || '').toUpperCase()
    const qty = num(a.available) + num(a.frozen) + num(a.locked)
    if (qty <= 0) continue
    if (STABLES.has(coin)) {
      const px = priceUsd.get(coin) || 1 // stables ≈ $1
      cashGbp += qty * px * rate
      continue
    }
    const px = priceUsd.get(coin)
    if (!px) continue // can't price it → skip rather than mis-value the book
    const value = qty * px * rate
    if (value < dustGbp) continue // dust — not a position worth surfacing
    holdings.push({
      symbol: coin,
      name: coin,
      quantity: qty,
      price: px * rate,
      value,
      cost: undefined, // backfilled from fills history below (null if unknown)
      pnl: undefined,
      currency: 'GBP',
    })
  }

  // Backfill cost basis + pnl from the fills history. Best-effort: if the fills
  // call fails (permissions, rate limit, outage) leave every coin cost-less
  // rather than fail the whole snapshot.
  if (holdings.length) {
    try {
      const byCoin = groupFillsByCoin(await fetchAllFills(getSigned, { maxPages: maxFillPages }))
      for (const h of holdings) {
        const rec = avgCostFromFills(byCoin.get(h.symbol) || [])
        if (!rec) continue
        h.cost = rec.avgPriceUsd * h.quantity * rate // GBP cost for the held qty
        h.pnl = h.value - h.cost
      }
    } catch { /* fills unavailable → costs stay unknown */ }
  }

  const invested = holdings.reduce((s, h) => s + h.value, 0)
  return {
    totalValue: cashGbp + invested,
    currency: 'GBP',
    cash: cashGbp,
    invested,
    pnl: null,
    holdings,
  }
}
