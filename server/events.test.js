import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupKey, normalizePayload } from './events.js'

test('dedupKey is stable and namespaced by source', () => {
  assert.equal(dedupKey('moneytaur', '12345'), 'moneytaur:12345')
  assert.equal(dedupKey('zero_hub', 'abc'), 'zero_hub:abc')
})

test('normalizePayload whitelists fields and coerces targets to an array', () => {
  const p = normalizePayload({
    entry: '$50', targets: '$60', grade_score: 7, junk: 'drop me',
  })
  assert.deepEqual(p.targets, ['$60'])
  assert.equal(p.entry, '$50')
  assert.equal(p.grade_score, 7)
  assert.equal('junk' in p, false)
})

test('normalizePayload defaults missing fields to null / []', () => {
  const p = normalizePayload({})
  assert.deepEqual(p.targets, [])
  assert.equal(p.entry, null)
  assert.equal(p.grade_score, null)
})
