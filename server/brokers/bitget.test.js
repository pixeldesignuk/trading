import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchSnapshot, sign, STABLES } from './bitget.js'

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

test('a non-zero Bitget code throws', async () => {
  const { fetch } = stubFetch([
    ['/spot/account/assets', { code: '40001', msg: 'bad key', data: null }],
    ['/spot/market/tickers', TICKERS],
  ])
  await assert.rejects(() => fetchSnapshot(creds, { fetch, usdGbp: 0.8 }), /bitget|40001|bad key/i)
})
