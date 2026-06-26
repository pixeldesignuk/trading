// plan-math.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePrice, entryPrice, stopPrice, targetPrices, topRR } from './plan-math.js'

test('parsePrice pulls the first number', () => {
  assert.equal(parsePrice('1,500.5 area'), 1500.5)
  assert.equal(parsePrice(42), 42)
  assert.equal(parsePrice(null), null)
})

test('entryPrice takes the midpoint of a zone', () => {
  assert.equal(entryPrice({ entry_zone: '100-110' }), 105)
  assert.equal(entryPrice({ entry_zone: '250' }), 250)
  assert.equal(entryPrice({ entry_zone: null }), null)
})

test('topRR = (max target - entry) / (entry - stop)', () => {
  const t = { entry_zone: '100', invalidation: '90', targets: [{ price: 130 }, { price: 120 }] }
  assert.equal(topRR(t), 3)            // (130-100)/(100-90)
})

test('topRR is null when stop is not below entry', () => {
  assert.equal(topRR({ entry_zone: '100', invalidation: '110', targets: [{ price: 130 }] }), null)
})

test('levels fall back to synthesis.safest_plan when the manual columns are empty', () => {
  const t = { synthesis: { safest_plan: { entry: 43, invalidation: 38, targets: [{ price: 50 }, { price: 130 }] } } }
  assert.equal(entryPrice(t), 43)
  assert.equal(stopPrice(t), 38)
  assert.deepEqual(targetPrices(t), [50, 130])
  assert.equal(topRR(t), (130 - 43) / (43 - 38)) // R:R sizes off the synthesised plan
})

test('manual plan columns take precedence over the synthesis', () => {
  const t = {
    entry_zone: '100', invalidation: '90', targets: [{ price: 130 }],
    synthesis: { safest_plan: { entry: 43, invalidation: 38, targets: [{ price: 50 }] } },
  }
  assert.equal(entryPrice(t), 100)
  assert.equal(stopPrice(t), 90)
  assert.deepEqual(targetPrices(t), [130])
})

test('safest_plan with a null entry stays null (no false sizing)', () => {
  assert.equal(entryPrice({ synthesis: { safest_plan: { entry: null, targets: [{ price: 50 }] } } }), null)
})
