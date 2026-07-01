import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brokerToHubSymbol, reconcileStages, syncAccount } from './sync.js'

test('brokerToHubSymbol strips the T212 suffix and uppercases', () => {
  assert.equal(brokerToHubSymbol('AAPL_US_EQ'), 'AAPL')
  assert.equal(brokerToHubSymbol('NKE_US_EQ'), 'NKE')
  assert.equal(brokerToHubSymbol('VUSA_EQ'), 'VUSA')
  assert.equal(brokerToHubSymbol('btc'), 'BTC')        // no suffix, normalised
})

// reconcileStages takes an injected query so this never touches a real DB —
// it must promote held tickers to 'in' and demote no-longer-held 'in' to 'closed'.
function fakeQuery() {
  const calls = []
  const q = async (text, params) => { calls.push({ text, params }); return { rows: [] } }
  return { q, calls }
}

test('reconcileStages promotes held to in and demotes unheld in to closed', async () => {
  const { q, calls } = fakeQuery()
  await reconcileStages(['AAPL', 'NKE'], { q })
  const promote = calls.find((c) => /status\s*=\s*'in'/.test(c.text))
  const demote = calls.find((c) => /status\s*=\s*'closed'/.test(c.text))
  assert.ok(promote, 'issues a promote-to-in update')
  assert.deepEqual(promote.params, [['AAPL', 'NKE']])
  assert.ok(demote, 'issues a demote-to-closed update')
  assert.match(demote.text, /status\s*=\s*'in'/)        // only demotes rows currently 'in'
  assert.deepEqual(demote.params, [['AAPL', 'NKE']])
})

// Capture the holdings INSERT that syncAccount emits for one snapshot line.
async function holdingInsertFor(holding) {
  const calls = []
  const q = async (text, params) => { calls.push({ text, params }); return { rows: [] } }
  const snapshot = async () => ({
    currency: 'GBP', cash: 0, invested: holding.value, totalValue: holding.value, pnl: null,
    holdings: [holding],
  })
  await syncAccount({ id: 'A', provider: 'bitget', label: 'Bitget' }, { snapshot, q, upsert: async () => {} })
  return calls.find((c) => /INSERT INTO holdings/.test(c.text))
  // params: [account_id, broker_symbol, ticker, name, quantity, avg_price, value, pnl, currency]
}

test('syncAccount stores null avg_price for a cost-less holding (no false zero entry)', async () => {
  const ins = await holdingInsertFor({ symbol: 'DOGE', name: 'DOGE', quantity: 6258.4812, price: 0.0564, value: 353, cost: undefined, pnl: undefined, currency: 'GBP' })
  assert.ok(ins)
  assert.equal(ins.params[5], null) // avg_price is null, not 0
})

test('syncAccount stores avg_price = cost/qty when the provider gives a cost basis', async () => {
  const ins = await holdingInsertFor({ symbol: 'BTC', name: 'BTC', quantity: 2, price: 60, value: 120, cost: 80, pnl: 40, currency: 'GBP' })
  assert.equal(ins.params[5], 40) // 80 / 2
})

test('reconcileStages with no holdings closes all active tickers', async () => {
  const { q, calls } = fakeQuery()
  await reconcileStages([], { q })
  // no promote when nothing is held; still issues the demote so a fully-exited
  // portfolio empties the Active column
  const demote = calls.find((c) => /status\s*=\s*'closed'/.test(c.text))
  assert.ok(demote)
  assert.deepEqual(demote.params, [[]])
})
