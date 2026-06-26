import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numericPlan, priceVsPlan } from './price-plan.js'

test('numericPlan extracts buy zone from ladder, targets, invalidation', () => {
  const p = numericPlan({
    ladder: [{ price: 46 }, { price: 42 }, { price: 51 }],
    targets: [{ price: 60 }, { price: 91 }],
    invalidation: '<$30 weekly close',
  })
  assert.equal(p.buyLow, 42)
  assert.equal(p.buyHigh, 51)
  assert.deepEqual(p.targets, [60, 91])
  assert.equal(p.invalidation, 30)
})

test('priceVsPlan classifies price against the plan', () => {
  const plan = { buyLow: 42, buyHigh: 51, targets: [60, 91], invalidation: 30 }
  assert.equal(priceVsPlan(25, plan), 'past_invalidation')
  assert.equal(priceVsPlan(40, plan), 'below_buy')
  assert.equal(priceVsPlan(48, plan), 'in_buy')
  assert.equal(priceVsPlan(58, plan), 'near_target')   // within 5% of 60
  assert.equal(priceVsPlan(55, plan), 'drifting')
})

test('priceVsPlan handles missing data', () => {
  assert.equal(priceVsPlan(null, { buyLow: 1 }), 'no_price')
  assert.equal(priceVsPlan(10, {}), 'no_plan')
})
