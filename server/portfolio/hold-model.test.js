// hold-model.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { holdModel } from './hold-model.js'

test('pinned ticker returns its pin verbatim', () => {
  const r = holdModel({ asset_class: 'crypto', target_pin: 0.10 })
  assert.equal(r.pinned, true)
  assert.equal(r.targetPct, 0.10)
})

test('grade places the weight inside the tier ceiling', () => {
  // moderate ceiling 0.06, grade 5 → 0.06*0.5*1 = 0.03 (no R:R → tilt 1)
  const r = holdModel({ asset_class: 'stock', top_grade: 5 })
  assert.equal(r.tier, 'moderate')
  assert.equal(r.targetPct, 0.03)
})

test('R:R tilts the weight up within the band', () => {
  // grade 10, moderate ceiling 0.06, rr 4 → tilt 0.85+(4-2)*0.1=1.05 → 0.06*1*1.05=0.063
  const t = { asset_class: 'stock', top_grade: 10, entry_zone: '100', invalidation: '90', targets: [{ price: 140 }] }
  const r = holdModel(t)
  assert.ok(Math.abs(r.targetPct - 0.063) < 1e-9)
  assert.equal(r.rr, 4)
})

test('high-tier name stays capped however high the grade', () => {
  const r = holdModel({ asset_class: 'crypto', top_grade: 10 }) // high ceiling 0.10, grade 1.0, tilt 1
  assert.equal(r.targetPct, 0.10)
})
