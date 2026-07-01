import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchSnapshot, sign, STABLES, avgCostFromFills, fetchAllFills } from './bitget.js'

const creds = { apiKey: 'k', apiSecret: 'sosecret', passphrase: 'pp' }

// A fetch stub that routes by URL and records the requests it received.
function stubFetch(routes) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    for (const [match, body] of routes) {
      if (url.includes(match)) return { ok: true, json: async () => body }
    }
    return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'no route' }
  }
  return { fetch, calls }
}

const ASSETS = {
  code: '00000', msg: 'success', data: [
    { coin: 'BTC', available: '0.5', frozen: '0', locked: '0' },
    { coin: 'ETH', available: '2', frozen: '0', locked: '0' },
    { coin: 'SOL', available: '1', frozen: '1', locked: '0' }, // frozen counts
    { coin: 'USDT', available: '100', frozen: '0', locked: '0' }, // stablecoin → cash
    { coin: 'DOGE', available: '0.0001', frozen: '0', locked: '0' }, // dust → filtered
    { coin: 'ZERO', available: '0', frozen: '0', locked: '0' }, // zero → ignored
  ],
}
const TICKERS = {
  code: '00000', data: [
    { symbol: 'BTCUSDT', lastPr: '60000' },
    { symbol: 'ETHUSDT', lastPr: '3000' },
    { symbol: 'SOLUSDT', lastPr: '100' },
    { symbol: 'DOGEUSDT', lastPr: '0.1' }, // 0.0001 * 0.1 = $0.00001 → dust
  ],
}

test('sign is a deterministic base64 HMAC-SHA256 of the prehash', () => {
  const a = sign('1700000000000', 'GET', '/api/v2/spot/account/assets', '', 'sosecret')
  const b = sign('1700000000000', 'GET', '/api/v2/spot/account/assets', '', 'sosecret')
  assert.equal(a, b)
  assert.match(a, /^[A-Za-z0-9+/]+=*$/) // base64
  assert.notEqual(a, sign('1700000000001', 'GET', '/api/v2/spot/account/assets', '', 'sosecret'))
})

test('USDT/USDC etc are recognised stablecoins', () => {
  assert.ok(STABLES.has('USDT'))
  assert.ok(STABLES.has('USDC'))
  assert.ok(!STABLES.has('BTC'))
})

test('fetchSnapshot builds a GBP snapshot: stablecoin→cash, frozen counted, pnl null', async () => {
  const { fetch } = stubFetch([
    ['/spot/account/assets', ASSETS],
    ['/spot/market/tickers', TICKERS],
  ])
  const snap = await fetchSnapshot(creds, { fetch, usdGbp: 0.8, now: () => 1700000000000 })

  assert.equal(snap.currency, 'GBP')
  // cash = 100 USDT * 0.8 = 80
  assert.equal(snap.cash, 80)

  const bySym = Object.fromEntries(snap.holdings.map((h) => [h.symbol, h]))
  // DOGE dust (worth ~£0) is filtered out; ZERO balance is ignored
  assert.deepEqual(Object.keys(bySym).sort(), ['BTC', 'ETH', 'SOL'])
  // BTC 0.5 * 60000 = 30000 USD * 0.8 = 24000
  assert.equal(bySym.BTC.value, 24000)
  assert.equal(bySym.BTC.quantity, 0.5)
  // SOL (1 + 1 frozen) * 100 = 200 USD * 0.8 = 160
  assert.equal(bySym.SOL.quantity, 2)
  assert.equal(bySym.SOL.value, 160)
  // crypto carries no cost basis
  assert.equal(bySym.BTC.pnl, undefined)
  assert.equal(bySym.BTC.currency, 'GBP')

  // invested = 24000 + 4800 + 160 = 28960 ; total = + cash 80
  assert.equal(snap.invested, 28960)
  assert.equal(snap.totalValue, 29040)
  assert.equal(snap.pnl, null)
})

test('fetchSnapshot sends signed auth headers', async () => {
  const { fetch, calls } = stubFetch([
    ['/spot/account/assets', ASSETS],
    ['/spot/market/tickers', TICKERS],
  ])
  await fetchSnapshot(creds, { fetch, usdGbp: 0.8, now: () => 1700000000000 })
  const signed = calls.find((c) => c.url.includes('/spot/account/assets'))
  const h = signed.init.headers
  assert.equal(h['ACCESS-KEY'], 'k')
  assert.equal(h['ACCESS-PASSPHRASE'], 'pp')
  assert.equal(h['ACCESS-TIMESTAMP'], '1700000000000')
  assert.equal(h['ACCESS-SIGN'], sign('1700000000000', 'GET', '/api/v2/spot/account/assets', '', 'sosecret'))
})

test('avgCostFromFills weights buys and is order-independent', () => {
  const rec = avgCostFromFills([
    { side: 'buy', size: '1', priceAvg: '200', cTime: '2' },
    { side: 'buy', size: '1', priceAvg: '100', cTime: '1' },
  ])
  assert.equal(rec.qty, 2)
  assert.equal(rec.avgPriceUsd, 150)
})

test('avgCostFromFills keeps the remainder average across a partial sell', () => {
  const rec = avgCostFromFills([
    { side: 'buy', size: '2', priceAvg: '100', cTime: '1' },
    { side: 'sell', size: '1', priceAvg: '400', cTime: '2' }, // realises profit, basis unchanged
  ])
  assert.equal(rec.qty, 1)
  assert.equal(rec.avgPriceUsd, 100)
})

test('avgCostFromFills returns null when nothing remains or there are no buys', () => {
  assert.equal(avgCostFromFills([]), null)
  assert.equal(avgCostFromFills([{ side: 'sell', size: '1', priceAvg: '100', cTime: '1' }]), null)
  assert.equal(avgCostFromFills([
    { side: 'buy', size: '1', priceAvg: '100', cTime: '1' },
    { side: 'sell', size: '1', priceAvg: '200', cTime: '2' },
  ]), null)
})

test('fetchAllFills pages via idLessThan until a short page', async () => {
  const pages = [
    { code: '00000', data: Array.from({ length: 100 }, (_, i) => ({ tradeId: String(200 - i), symbol: 'BTCUSDT', side: 'buy', size: '0.01', priceAvg: '50000', cTime: String(200 - i) })) },
    { code: '00000', data: [{ tradeId: '99', symbol: 'BTCUSDT', side: 'buy', size: '0.01', priceAvg: '40000', cTime: '99' }] },
  ]
  let call = 0
  const getSigned = async (path) => {
    const body = call === 0 ? pages[0] : pages[1]
    // second page must be requested with the last tradeId of the first as cursor
    if (call === 1) assert.match(path, /idLessThan=101/)
    call++
    return body.data
  }
  const all = await fetchAllFills(getSigned)
  assert.equal(all.length, 101)
  assert.equal(call, 2)
})

test('fetchSnapshot reconstructs cost basis + pnl from fills, cost-less coins stay null', async () => {
  const { fetch } = stubFetch([
    ['/spot/account/assets', ASSETS],
    ['/spot/market/tickers', TICKERS],
    ['/spot/trade/fills', { code: '00000', data: [
      { symbol: 'BTCUSDT', side: 'buy', size: '0.5', priceAvg: '40000', tradeId: '1', cTime: '1' },
      // ETH & SOL have no fills → no reconstructed basis
    ] }],
  ])
  const snap = await fetchSnapshot(creds, { fetch, usdGbp: 0.8, now: () => 1700000000000 })
  const bySym = Object.fromEntries(snap.holdings.map((h) => [h.symbol, h]))
  // BTC: entry 40000 USD, held 0.5 → cost 0.5*40000*0.8 = 16000 GBP
  assert.equal(bySym.BTC.cost, 16000)
  // value 24000 - cost 16000 = 8000 pnl
  assert.equal(bySym.BTC.pnl, 8000)
  // coins without fills carry no basis (not a false zero)
  assert.equal(bySym.ETH.cost, undefined)
  assert.equal(bySym.ETH.pnl, undefined)
  // account-level pnl stays null (partial/unknown basis across coins)
  assert.equal(snap.pnl, null)
})

test('fetchSnapshot survives a failing fills call — costs stay unknown', async () => {
  const { fetch } = stubFetch([
    ['/spot/account/assets', ASSETS],
    ['/spot/market/tickers', TICKERS],
    // no /spot/trade/fills route → 404 → caught, snapshot still builds
  ])
  const snap = await fetchSnapshot(creds, { fetch, usdGbp: 0.8, now: () => 1700000000000 })
  const btc = snap.holdings.find((h) => h.symbol === 'BTC')
  assert.equal(btc.value, 24000) // balances untouched
  assert.equal(btc.cost, undefined)
})

test('a non-zero Bitget code throws', async () => {
  const { fetch } = stubFetch([
    ['/spot/account/assets', { code: '40001', msg: 'bad key', data: null }],
    ['/spot/market/tickers', TICKERS],
  ])
  await assert.rejects(() => fetchSnapshot(creds, { fetch, usdGbp: 0.8 }), /bitget|40001|bad key/i)
})
