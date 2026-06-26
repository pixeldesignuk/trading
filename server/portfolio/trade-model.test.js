// trade-model.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tradeModel } from './trade-model.js'

test('position size = risk / stop-distance, bounded by the sleeve budget', () => {
  // account 20000, risk 1% = £200; entry 100, stop 90 → stopDist 0.10 → raw £2000
  const t = { entry_zone: '100', invalidation: '90', targets: [{ price: 130 }] }
  const r = tradeModel(t, { account: 20000, sleeveBudget: 5000, riskPct: 0.01 })
  assert.equal(r.hasStop, true)
  assert.equal(r.positionSize, 2000)
  assert.equal(r.capped, false)
  assert.equal(r.rr, 3)               // top target (130-100)/(100-90)
  assert.equal(Math.round(r.openRisk), 200)
})

test('sleeve budget caps the position', () => {
  const t = { entry_zone: '100', invalidation: '95', targets: [{ price: 130 }] } // stopDist .05 → raw £4000
  const r = tradeModel(t, { account: 20000, sleeveBudget: 1500, riskPct: 0.01 })
  assert.equal(r.positionSize, 1500)
  assert.equal(r.capped, true)
})

test('no usable stop → not sizeable', () => {
  const r = tradeModel({ entry_zone: '100', invalidation: null, targets: [] }, { account: 20000, sleeveBudget: 5000 })
  assert.equal(r.hasStop, false)
  assert.equal(r.positionSize, null)
})
