import { test } from 'node:test'
import assert from 'node:assert/strict'

const gated = process.env.DATABASE_URL ? test : test.skip

// Fake broker symbol → fake hub ticker (ZZZTEST) so this never collides with or
// deletes a real tracked ticker. reconcile is stubbed so the global pipeline
// reconciliation can't demote real 'in' tickers (e.g. MSTR) during the test.
gated('syncAll persists accounts + holdings, auto-creates tickers, isolates errors', async () => {
  const { init, query, pool } = await import('../db.js')
  const { syncAll } = await import('./sync.js')
  await init()

  const cleanup = async () => {
    await query("DELETE FROM broker_accounts WHERE id IN ('TEST_A','TEST_B')")
    await query("DELETE FROM tickers WHERE symbol='ZZZTEST'")
  }
  await cleanup()

  const accounts = [{ id: 'TEST_A', label: 'Acct A' }, { id: 'TEST_B', label: 'Acct B' }]
  const snapshot = async (acct) => {
    if (acct.id === 'TEST_B') throw new Error('bad key')
    return {
      totalValue: 1000, currency: 'GBP', cash: 200, invested: 800, pnl: 50,
      holdings: [{ symbol: 'ZZZTEST_US_EQ', name: 'ZZZTEST', quantity: 4, price: 200, value: 800, cost: 600, pnl: 50, currency: 'GBP' }],
    }
  }
  let reconciledWith = null
  const reconcile = async (held) => { reconciledWith = held }

  const summary = await syncAll({ accounts, snapshot, reconcile, spacing: 0, wait: async () => {} })

  // error isolation: one account failed, the other persisted
  assert.equal(summary.errors.length, 1)
  assert.equal(summary.errors[0].id, 'TEST_B')

  const a = (await query("SELECT * FROM broker_accounts WHERE id='TEST_A'")).rows[0]
  assert.equal(a.error, null)
  assert.equal(Number(a.cash), 200)
  assert.equal(Number(a.total_value), 1000)

  const b = (await query("SELECT * FROM broker_accounts WHERE id='TEST_B'")).rows[0]
  assert.match(b.error, /bad key/)

  const h = (await query("SELECT * FROM holdings WHERE account_id='TEST_A'")).rows[0]
  assert.equal(h.broker_symbol, 'ZZZTEST_US_EQ')
  assert.equal(h.ticker, 'ZZZTEST')
  assert.equal(Number(h.avg_price), 150)            // cost 600 / qty 4
  assert.equal(Number(h.value), 800)

  // auto-created hub ticker + reconcile got the held union
  const t = (await query("SELECT * FROM tickers WHERE symbol='ZZZTEST'")).rows[0]
  assert.ok(t, 'auto-created the hub ticker')
  assert.deepEqual(reconciledWith, ['ZZZTEST'])

  await cleanup()
  await pool.end()
})
