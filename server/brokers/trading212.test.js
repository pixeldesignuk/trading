import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchSnapshot } from './trading212.js'

const creds = { keyId: 'KID', secret: 'SEC', baseUrl: 'https://live.trading212.com' }

// A fake fetch that routes by path and records the requests it received.
function fakeFetch(routes) {
  const calls = []
  const fetch = async (url, opts) => {
    calls.push({ url, opts })
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v0/, '')
    const route = routes[path]
    if (!route) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '', json: async () => ({}) }
    return { ok: true, status: 200, statusText: 'OK', json: async () => route, text: async () => JSON.stringify(route) }
  }
  return { fetch, calls }
}

test('fetchSnapshot normalises summary + positions (current shape)', async () => {
  const { fetch } = fakeFetch({
    '/equity/account/summary': {
      currency: 'GBP',
      cash: { availableToTrade: 100, inPies: 50, reservedForOrders: 0 },
      investments: { currentValue: 300, unrealizedProfitLoss: 25 },
      totalValue: 450,
    },
    '/equity/positions': [
      { instrument: { ticker: 'AAPL_US_EQ', currency: 'USD' }, quantity: 2, currentPrice: 100,
        averagePricePaid: 90, walletImpact: { currentValue: 200, unrealizedProfitLoss: 20 } },
    ],
  })
  const snap = await fetchSnapshot(creds, { fetch })
  assert.equal(snap.cash, 150)            // 100 + 50 + 0
  assert.equal(snap.invested, 300)
  assert.equal(snap.pnl, 25)
  assert.equal(snap.totalValue, 450)
  assert.equal(snap.currency, 'GBP')
  assert.equal(snap.holdings.length, 1)
  assert.deepEqual(snap.holdings[0], {
    symbol: 'AAPL_US_EQ', name: 'AAPL', quantity: 2, price: 100,
    // value/pnl come from walletImpact → reported in the ACCOUNT currency (GBP),
    // so the money currency is GBP even though the instrument is USD-listed.
    value: 200, cost: 180, pnl: 20, currency: 'GBP',
  })
})

test('fetchSnapshot sends Basic auth and hits the configured base URL', async () => {
  const { fetch, calls } = fakeFetch({ '/equity/account/summary': { cash: {} }, '/equity/positions': [] })
  await fetchSnapshot(creds, { fetch })
  const expected = 'Basic ' + Buffer.from('KID:SEC').toString('base64')
  assert.equal(calls[0].opts.headers.Authorization, expected)
  assert.ok(calls[0].url.startsWith('https://live.trading212.com/api/v0'))
})

test('fetchSnapshot falls back to legacy endpoints when current 404s', async () => {
  const { fetch, calls } = fakeFetch({
    '/equity/account/cash': { free: 80, inPies: 20, invested: 200, ppl: 5, total: 300 },
    '/equity/portfolio': [{ ticker: 'NKE_US_EQ', quantity: 1, currentPrice: 50, averagePrice: 40, ppl: 10 }],
  })
  const snap = await fetchSnapshot(creds, { fetch })
  assert.equal(snap.cash, 100)            // 80 + 20
  assert.equal(snap.holdings[0].symbol, 'NKE_US_EQ')
  assert.equal(snap.holdings[0].name, 'NKE')
  // tried current summary first, then legacy cash
  assert.ok(calls.some((c) => c.url.includes('/equity/account/summary')))
  assert.ok(calls.some((c) => c.url.includes('/equity/account/cash')))
})
