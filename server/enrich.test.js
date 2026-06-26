import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { reconcilePlan } from './enrich.js'

describe('reconcilePlan', () => {
  it('prefers zero_hub over moneytaur for invalidation and ladder', () => {
    const levels = [
      {
        ladder: [{ price: 11 }],
        targets: [{ price: 28.5 }],
        invalidation: '<11',
        source: 'zero_hub',
        confidence: 0.9,
      },
      {
        targets: [{ price: 30 }],
        source: 'moneytaur',
        confidence: 0.5,
      },
    ]
    const result = reconcilePlan(levels)
    assert.equal(result.invalidation, '<11', 'invalidation from hub')
    assert.deepEqual(result.ladder, [{ price: 11 }], 'ladder from hub')
  })

  it('merges targets from both sources (union by price, no duplicates)', () => {
    const levels = [
      {
        targets: [{ price: 28.5 }],
        invalidation: '<11',
        source: 'zero_hub',
        confidence: 0.9,
      },
      {
        targets: [{ price: 30 }],
        source: 'moneytaur',
        confidence: 0.5,
      },
    ]
    const result = reconcilePlan(levels)
    const prices = result.targets.map((t) => t.price)
    assert.ok(prices.includes(28.5), 'hub target included')
    assert.ok(prices.includes(30), 'moneytaur target included')
    assert.equal(prices.length, 2, 'no duplicates')
  })

  it('dedupes targets by price — hub entry wins on conflict', () => {
    const levels = [
      {
        targets: [{ price: 28.5, label: 'T1-hub' }],
        source: 'zero_hub',
        confidence: 0.9,
      },
      {
        targets: [{ price: 28.5, label: 'T1-mt' }],
        source: 'moneytaur',
        confidence: 0.5,
      },
    ]
    const result = reconcilePlan(levels)
    const t = result.targets.find((x) => x.price === 28.5)
    assert.equal(result.targets.length, 1, 'deduplicated')
    assert.equal(t.label, 'T1-hub', 'hub wins on conflict')
  })

  it('prefers higher confidence within same tier', () => {
    const levels = [
      {
        invalidation: '<10',
        source: 'zero_hub',
        confidence: 0.4,
      },
      {
        invalidation: '<12',
        source: 'zero_live',
        confidence: 0.8,
      },
    ]
    const result = reconcilePlan(levels)
    assert.equal(result.invalidation, '<12', 'higher confidence zero_live wins')
  })

  it('returns empty arrays for ladder/targets when none provided', () => {
    const result = reconcilePlan([{ source: 'manual', confidence: 0.5, invalidation: '<5' }])
    assert.ok(Array.isArray(result.ladder))
    assert.ok(Array.isArray(result.targets))
  })

  it('returns null fields when list is empty', () => {
    const result = reconcilePlan([])
    assert.equal(result.invalidation, null)
    assert.equal(result.entry_zone, null)
    assert.deepEqual(result.ladder, [])
    assert.deepEqual(result.targets, [])
  })
})
