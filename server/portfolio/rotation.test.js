import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeRotation, BIG6, RATIOS } from './rotation.js'

// helper: a rising series ends higher than it started; falling the reverse.
const rising = (n = 25) => Array.from({ length: n }, (_, i) => 100 + i)
const falling = (n = 25) => Array.from({ length: n }, (_, i) => 100 - i)
const flat = (n = 25) => Array.from({ length: n }, () => 100)

test('all three ratios rising → expansion, favour moderate/high', () => {
  const closes = { XLY: rising(), XLP: flat(), XLK: rising(), XLU: flat(), XLF: rising(), XLV: flat() }
  const r = computeRotation(closes, { lookback: 20 })
  assert.equal(r.regime, 'expansion')
  assert.equal(r.ups, 3)
  assert.deepEqual(r.favorTiers, ['moderate', 'high'])
})

test('all three ratios falling → defensive', () => {
  const closes = { XLY: falling(), XLP: flat(), XLK: falling(), XLU: flat(), XLF: falling(), XLV: flat() }
  const r = computeRotation(closes, { lookback: 20 })
  assert.equal(r.regime, 'defense')
  assert.deepEqual(r.favorTiers, ['defensive', 'lower'])
})

test('mixed → late cycle', () => {
  const closes = { XLY: rising(), XLP: flat(), XLK: falling(), XLU: flat(), XLF: flat(), XLV: flat() }
  const r = computeRotation(closes, { lookback: 20 })
  assert.equal(r.regime, 'late_cycle')
})

test('missing data → unknown regime, no false signal', () => {
  const r = computeRotation({}, { lookback: 20 })
  assert.equal(r.regime, 'unknown')
  assert.equal(r.ratios.length, 3)
  assert.ok(r.ratios.every((x) => x.trend === 'unknown'))
})

test('exports the canonical Big 6 + three ratios', () => {
  assert.equal(BIG6.length, 6)
  assert.equal(RATIOS.length, 3)
})

import { aimForRegime } from './rotation.js'

test('aimForRegime in defense leans the pyramid toward lower/defensive', () => {
  const aim = aimForRegime('defense', { high: .10, moderate: .30, lower: .40, defensive: .20 })
  assert.ok(aim.defensive > 0.20 && aim.high < 0.10)
})
