import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlan } from './resolve-plan.js'

test('synthesis.safest_plan (the reconciled verdict) wins per-field over the raw ladder', () => {
  const p = resolvePlan({
    // raw ladder says buy $110 / target $190 …
    ladder: [{ price: 110 }], targets: [{ price: 190 }], invalidation: 'drop to RL',
    // …but the editor's verdict is the deeper $75 zone, stop $65.
    synthesis: { safest_plan: { entry: 75, targets: [{ price: 190 }, { price: null }], invalidation: 65 } },
  }, { pointBand: 0.01 })
  assert.equal(p.buyLow, 74.25)  // 75 * 0.99  (synthesis wins, NOT the $110 ladder rung)
  assert.equal(p.buyHigh, 75.75) // 75 * 1.01
  assert.equal(p.entryLow, 75)   // display entry is the point, NOT the ±band
  assert.equal(p.entryHigh, 75)
  assert.deepEqual(p.targets, [190])
  assert.equal(p.invalidation, 65)
})

test('falls back to the raw ladder/targets/invalidation when there is no synthesis', () => {
  const p = resolvePlan({
    ladder: [{ price: 46 }, { price: 42 }, { price: 51 }],
    targets: [{ price: 60 }, { price: 91 }],
    invalidation: '<$30 weekly close',
  })
  assert.deepEqual(p, { buyLow: 42, buyHigh: 51, entryLow: 42, entryHigh: 51, targets: [60, 91], invalidation: 30 })
})

test('per-field fill: synthesis entry used, ladder supplies targets synthesis lacks', () => {
  const p = resolvePlan({
    targets: [{ price: 20 }],
    synthesis: { safest_plan: { entry: 11, targets: [], invalidation: 8 } },
  }, { pointBand: 0.01 })
  assert.equal(p.buyLow, 10.89)  // 11 * 0.99 (synthesis entry)
  assert.equal(p.buyHigh, 11.11)
  assert.deepEqual(p.targets, [20]) // synthesis had no targets → ladder's
  assert.equal(p.invalidation, 8)
})

test('returns null when there are no numeric levels anywhere', () => {
  assert.equal(resolvePlan({ thesis: 'vibes only' }), null)
  assert.equal(resolvePlan({ synthesis: { safest_plan: { entry: null, targets: [], invalidation: null } } }), null)
})
