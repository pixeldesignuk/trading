import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSnapshot } from './snaptrade.js'

// SnapTrade positions nest the instrument under symbol.symbol; the account carries
// the authoritative balance.
const ACCOUNT = { id: 'acc1', name: 'JISA', balance: { total: { amount: 5200, currency: 'GBP' } } }
const POSITIONS = [
  { symbol: { symbol: { symbol: 'ISWD', description: 'iShares MSCI World Islamic', currency: { code: 'GBP' } } }, units: 100, price: 40, open_pnl: 200, average_purchase_price: 38 },
  { symbol: { symbol: { symbol: 'SGLN', description: 'iShares Physical Gold', currency: { code: 'GBP' } } }, units: 20, price: 50, open_pnl: -10 },
]

test('normalizeSnapshot maps nested GBP positions into the snapshot contract', async () => {
  const snap = await normalizeSnapshot(ACCOUNT, POSITIONS, { usdGbp: 1 })
  assert.equal(snap.currency, 'GBP')
  assert.equal(snap.totalValue, 5200) // authoritative account balance

  const bySym = Object.fromEntries(snap.holdings.map((h) => [h.symbol, h]))
  assert.deepEqual(Object.keys(bySym).sort(), ['ISWD', 'SGLN'])
  assert.equal(bySym.ISWD.value, 4000) // 100 * 40
  assert.equal(bySym.ISWD.quantity, 100)
  assert.equal(bySym.ISWD.pnl, 200)
  assert.equal(bySym.ISWD.name, 'iShares MSCI World Islamic')
  assert.equal(bySym.SGLN.value, 1000) // 20 * 50

  assert.equal(snap.invested, 5000)
  assert.equal(snap.cash, 200) // total - invested
  assert.equal(snap.pnl, 190)
})

test('normalizeSnapshot FX-converts non-GBP (USD) positions to GBP', async () => {
  const usdAccount = { balance: { total: { amount: 800, currency: 'GBP' } } }
  const usdPositions = [
    { symbol: { symbol: { symbol: 'TSLA', description: 'Tesla', currency: { code: 'USD' } } }, units: 10, price: 100, open_pnl: 50 },
  ]
  const snap = await normalizeSnapshot(usdAccount, usdPositions, { usdGbp: 0.8 })
  // 10 * 100 = $1000 → £800 ; pnl 50 → £40
  assert.equal(snap.holdings[0].value, 800)
  assert.equal(snap.holdings[0].pnl, 40)
  assert.equal(snap.holdings[0].currency, 'GBP')
})

test('normalizeSnapshot tolerates an empty account (no positions)', async () => {
  const snap = await normalizeSnapshot({ balance: { total: { amount: 0, currency: 'GBP' } } }, [], { usdGbp: 1 })
  assert.equal(snap.invested, 0)
  assert.equal(snap.holdings.length, 0)
  assert.equal(snap.pnl, null)
})
