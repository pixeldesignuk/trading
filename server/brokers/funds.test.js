import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFunds } from './funds.js'

const fakeQ = (rows) => async () => ({ rows })

test('getFunds aggregates broker accounts (total value is the risk basis)', async () => {
  const funds = await getFunds({
    q: fakeQ([
      { id: 'isa', label: 'ISA', currency: 'GBP', cash: '200', invested: '800', total_value: '1000', pnl: '50', error: null, synced_at: 't1' },
      { id: 'jisa', label: 'JISA', currency: 'GBP', cash: '100', invested: '400', total_value: '500', pnl: '-10', error: null, synced_at: 't2' },
    ]),
    fallbackSize: 20000,
  })
  assert.equal(funds.source, 'broker')
  assert.equal(funds.cash, 300)
  assert.equal(funds.invested, 1200)
  assert.equal(funds.totalValue, 1500)      // risk basis = aggregate total value
  assert.equal(funds.pnl, 40)
  assert.equal(funds.accounts.length, 2)
  assert.equal(funds.accounts[0].label, 'ISA')
})

test('getFunds falls back to config account size when no broker connected', async () => {
  const funds = await getFunds({ q: fakeQ([]), fallbackSize: 20000 })
  assert.equal(funds.source, 'config')
  assert.equal(funds.totalValue, 20000)
  assert.equal(funds.cash, 0)
  assert.deepEqual(funds.accounts, [])
})
