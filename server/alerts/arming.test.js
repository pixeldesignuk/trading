import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armTickers, ARM_STATUSES } from './arming.js'

const withPlan = (extra) => ({ ladder: [{ price: 10 }], targets: [{ price: 20 }], invalidation: 'below 8', ...extra })

test('arms only watching/in tickers that have a numeric plan', () => {
  const tickers = [
    withPlan({ symbol: 'WATCH', status: 'watching' }),
    withPlan({ symbol: 'HELD', status: 'in' }),
    withPlan({ symbol: 'NEW', status: 'new' }),           // not on the watchlist → excluded
    withPlan({ symbol: 'CLOSED', status: 'closed' }),     // excluded
    { symbol: 'NOPLAN', status: 'watching', thesis: 'vibes' }, // watched but no numeric plan → excluded
  ]
  const armed = armTickers(tickers).map((x) => x.t.symbol)
  assert.deepEqual(armed.sort(), ['HELD', 'WATCH'])
})

test('ARM_STATUSES is watching + in', () => {
  assert.equal(ARM_STATUSES.has('watching'), true)
  assert.equal(ARM_STATUSES.has('in'), true)
  assert.equal(ARM_STATUSES.has('new'), false)
})
