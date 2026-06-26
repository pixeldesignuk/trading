import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildToday } from './today.js'

const T = (o) => ({ ladder: [], targets: [], ...o })

test('buildToday buckets tickers by status + price-vs-plan', () => {
  const tickers = [
    T({ symbol: 'NEW1', status: 'new', sharia_status: 'compliant', top_grade: 8 }),
    T({ symbol: 'NEW2', status: 'new', sharia_status: 'non_compliant', top_grade: 9 }),
    T({ symbol: 'CRSP', status: 'watching', sharia_status: 'compliant', ladder: [{ price: 42 }, { price: 51 }], targets: [{ price: 60 }] }),
    T({ symbol: 'NIO', status: 'in', sharia_status: 'compliant', targets: [{ price: 8 }], ladder: [{ price: 4 }] }),
  ]
  const quotes = { CRSP: 48, NIO: 7.8 }
  const out = buildToday(tickers, quotes)
  assert.deepEqual(out.newIdeas.map((t) => t.symbol), ['NEW1'])     // compliant only
  assert.deepEqual(out.enteredBuyZone.map((t) => t.symbol), ['CRSP'])
  assert.deepEqual(out.needsAttention.map((t) => t.symbol), ['NIO']) // near 8
})
