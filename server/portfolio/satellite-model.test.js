import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derivePyramid, regimeAim, tiltThemeWeights, normalise, DEFAULT_THEME_SPLITS, DEFAULT_TIER_TARGETS } from './satellite-model.js'

const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0)

test('normalise scales to sum 1 and floors negatives', () => {
  assert.ok(Math.abs(sum(normalise({ a: 2, b: 2 })) - 1) < 1e-9)
  assert.deepEqual(normalise({ a: 0, b: 0 }), {})
  assert.equal(normalise({ a: -1, b: 1 }).a, 0)
})

test('derivePyramid aggregates theme tier-exposures, sums to 1', () => {
  const pyr = derivePyramid(DEFAULT_THEME_SPLITS)
  assert.ok(Math.abs(sum(pyr) - 1) < 1e-9)
  // commodities .20 → defensive .08; only commodities feeds defensive
  assert.ok(Math.abs(pyr.defensive - 0.20 * 0.40) < 1e-9)
  // high = niche(.15) + crypto(.15) + tech .30×.20 = .36
  assert.ok(Math.abs(pyr.high - (0.15 + 0.15 + 0.30 * 0.20)) < 1e-9)
})

test('regimeAim blends 65/35 toward the regime preset', () => {
  const aim = regimeAim('defense', DEFAULT_TIER_TARGETS)
  // defensive: .65*.20 + .35*.30 = .235
  assert.ok(Math.abs(aim.defensive - (0.65 * 0.20 + 0.35 * 0.30)) < 1e-9)
  assert.deepEqual(regimeAim('unknown', DEFAULT_TIER_TARGETS), DEFAULT_TIER_TARGETS)
})

test('defense tilt lifts commodities, cuts crypto, still sums to 1', () => {
  const aim = regimeAim('defense', DEFAULT_TIER_TARGETS)
  const eff = tiltThemeWeights(DEFAULT_THEME_SPLITS, aim)
  assert.ok(Math.abs(sum(eff) - 1) < 1e-9)
  assert.ok(eff.commodities > DEFAULT_THEME_SPLITS.commodities)
  assert.ok(eff.crypto < DEFAULT_THEME_SPLITS.crypto)
})

import { CORE_TYPES, DEFAULT_CORE_TYPE_SPLITS } from './satellite-model.js'
test('core type splits are the normalised 40/15/15', () => {
  const s = DEFAULT_CORE_TYPE_SPLITS
  assert.ok(Math.abs(Object.values(s).reduce((a,b)=>a+b,0) - 1) < 1e-9)
  assert.ok(Math.abs(s.world - 40/70) < 1e-9 && Math.abs(s.us - 15/70) < 1e-9)
  assert.deepEqual(Object.keys(s).sort(), ['quality_income','us','world'])
})
