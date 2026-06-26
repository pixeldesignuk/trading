import { test } from 'node:test'
import assert from 'node:assert/strict'
import { benchmarkSymbol, trailingReturn, bookReturn, periodReturns } from './benchmark.js'

test('periodReturns computes YTD (vs prior year-end) and all-time', () => {
  const d = (y, m, day) => +new Date(Date.UTC(y, m, day))
  const bars = [
    { t: d(2024, 0, 2), c: 100 },   // earliest
    { t: d(2024, 11, 31), c: 150 }, // prior year-end → YTD base
    { t: d(2025, 5, 1), c: 180 },   // latest
  ]
  const r = periodReturns(bars, 2025)
  assert.ok(Math.abs(r.allTime - 0.8) < 1e-9)        // 100→180
  assert.ok(Math.abs(r.ytd - (180 - 150) / 150) < 1e-9) // 150→180
  assert.deepEqual(periodReturns([], 2025), { ytd: null, allTime: null })
})

test('benchmarkSymbol maps known labels, null otherwise', () => {
  assert.equal(benchmarkSymbol('MSCI World Islamic'), 'ISDW.L')
  assert.equal(benchmarkSymbol('Nonexistent'), null)
})

test('trailingReturn over the lookback window', () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 + i) // +1/day
  // 252 days back from the last (399) is index 47 → value 147; last 399.
  assert.ok(Math.abs(trailingReturn(closes, 252) - (399 - 147) / 147) < 1e-9)
  assert.equal(trailingReturn([], 252), null)
  assert.equal(trailingReturn([100], 252), null)
})

test('bookReturn = pnl / cost (cost = value - pnl)', () => {
  assert.ok(Math.abs(bookReturn({ totalValue: 11000, pnl: 1000 }) - 0.1) < 1e-9) // cost 10000
  assert.equal(bookReturn({ totalValue: 0, pnl: 0 }), null)
})
