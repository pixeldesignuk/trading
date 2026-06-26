import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inCooldown } from './state.js'

const HOUR = 3600 * 1000
const now = 1_000_000_000_000

test('no cooldown without a prior fire', () => {
  assert.equal(inCooldown(null, 'entered_buy', 6, now), false)
  assert.equal(inCooldown({ last_fired_at: null }, 'entered_buy', 6, now), false)
})

test('cooldown applies only to the SAME transition within the window', () => {
  const row = { last_transition: 'entered_buy', last_fired_at: new Date(now - 2 * HOUR).toISOString() }
  assert.equal(inCooldown(row, 'entered_buy', 6, now), true)   // 2h < 6h → suppressed
  assert.equal(inCooldown(row, 'invalidation', 6, now), false) // different transition → allowed
})

test('cooldown expires after the window', () => {
  const row = { last_transition: 'entered_buy', last_fired_at: new Date(now - 7 * HOUR).toISOString() }
  assert.equal(inCooldown(row, 'entered_buy', 6, now), false)  // 7h > 6h → allowed
})
