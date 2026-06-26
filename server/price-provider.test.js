import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

// Isolate the on-disk price cache so this test can't pollute (or be polluted
// by) the real data/price-cache.json — otherwise persisted entries make
// getQuotes skip the fetch and the batch assertion flakes across runs.
process.env.PRICE_CACHE_FILE = path.join(os.tmpdir(), `price-cache-test-${process.pid}.json`)
const { yahooSymbol, getQuotes } = await import('./price-provider.js')

test('yahooSymbol maps by asset class', () => {
  assert.equal(yahooSymbol('AAPL', 'stock'), 'AAPL')
  assert.equal(yahooSymbol('BTC', 'crypto'), 'BTC-USD')
  assert.equal(yahooSymbol('ETH/USD', 'crypto'), 'ETH-USD')
  assert.equal(yahooSymbol('GC=F', 'commodity'), 'GC=F')   // real future passes through
  assert.equal(yahooSymbol('CORN', 'commodity'), null)     // tracking-ETF mismatch -> skip
})

test('getQuotes batches one yahoo call for all symbols', async () => {
  let calls = 0
  const yf = { quote: async (syms) => { calls++; return syms.map((s) => ({ symbol: s, regularMarketPrice: s === 'AAPL' ? 200 : 0.5, regularMarketChangePercent: s === 'AAPL' ? 1.2 : -3.4 })) } }
  const out = await getQuotes(
    [{ ticker: 'AAPL', asset_class: 'stock' }, { ticker: 'BTC', asset_class: 'crypto' }],
    { yf, now: 1 },
  )
  assert.equal(calls, 1)
  assert.deepEqual(out.AAPL, { price: 200, changePct: 1.2 })
  assert.deepEqual(out.BTC, { price: 0.5, changePct: -3.4 })
})

test('getQuotes honours a per-pair symbol override (commodity → ETC/spot symbol)', async () => {
  const yf = { quote: async (syms) => syms.map((s) => ({ symbol: s, regularMarketPrice: s === 'PHPD.L' ? 88 : 1234, regularMarketChangePercent: 0 })) }
  const out = await getQuotes(
    [{ ticker: 'PALLADIUM', asset_class: 'commodity', symbol: 'PHPD.L' }],
    { yf, now: 2 },
  )
  // keyed back to the hub ticker, but priced off the override symbol
  assert.equal(out.PALLADIUM.price, 88)
})
