// Trading 212 public API (https://docs.trading212.com/api), ported from the
// finance app's investments/trading212.ts and parameterised per account so the
// hub can hold several accounts. Basic auth (keyId:secret). Parses defensively
// so both the current (account/summary, positions) and legacy (account/cash,
// portfolio) shapes work. 1 req/s rate limit — callers space requests.
const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : 0
}

function friendlyName(ticker) {
  return ticker.split('_')[0] || ticker
}

function authHeader({ keyId, secret }) {
  return 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64')
}

export const key = 'trading212'
export const name = 'Trading 212'

// Fetch a normalised snapshot for one account. `fetch` is injectable for tests.
export async function fetchSnapshot(creds, { fetch = globalThis.fetch } = {}) {
  const base = creds.baseUrl.replace(/\/$/, '')
  const get = async (path) => {
    const res = await fetch(`${base}/api/v0${path}`, { headers: { Authorization: authHeader(creds) } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Trading 212 ${path} → ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
    return res.json()
  }

  const summary = await get('/equity/account/summary').catch(() => null)
    ?? await get('/equity/account/cash') // legacy fallback
  const cashObj = summary.cash
  const inv = summary.investments ?? {}
  const cash = cashObj && typeof cashObj === 'object'
    ? num(cashObj.availableToTrade) + num(cashObj.inPies) + num(cashObj.reservedForOrders)
    : num(summary.free) + num(summary.inPies)
  const invested = num(inv.currentValue ?? summary.invested)
  const pnl = num(inv.unrealizedProfitLoss ?? summary.ppl)
  const totalValue = num(summary.totalValue ?? summary.total ?? cash + invested)
  const currency = summary.currency ?? 'GBP'

  const positions = await get('/equity/positions').catch(() => get('/equity/portfolio'))
  const holdings = (positions ?? []).map((p) => {
    const ticker = p.instrument?.ticker ?? p.ticker ?? '?'
    const quantity = num(p.quantity)
    const price = num(p.currentPrice)
    const wallet = p.walletImpact
    const value = num(wallet?.currentValue ?? quantity * price)
    // value/pnl come from walletImpact, which T212 reports in the ACCOUNT (wallet)
    // currency — not the instrument's native currency. Only the price-derived
    // fallback is instrument-denominated. Tag the money fields accordingly so we
    // don't render a GBP amount with a US$ symbol (instrument.currency).
    const moneyCurrency = wallet?.currentValue != null
      ? currency
      : (p.instrument?.currency ?? p.currencyCode ?? currency)
    return {
      symbol: ticker,
      name: friendlyName(ticker),
      quantity,
      price,
      value,
      cost: num(p.averagePricePaid ?? p.averagePrice) * quantity || undefined,
      pnl: num(wallet?.unrealizedProfitLoss ?? p.ppl) || undefined,
      currency: moneyCurrency,
    }
  })

  return { totalValue, currency, cash, invested, pnl, holdings }
}
