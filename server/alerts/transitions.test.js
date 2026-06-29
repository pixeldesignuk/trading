import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transitionFor, nearestTarget, levelFor, formatLine, buildMessage } from './transitions.js'

test('notable transitions fire only on a genuine change into the state', () => {
  assert.equal(transitionFor('below_buy', 'in_buy').kind, 'entered_buy')
  assert.equal(transitionFor('drifting', 'near_target').kind, 'near_target')
  assert.equal(transitionFor('in_buy', 'past_invalidation').kind, 'invalidation')
})

test('no fire when state is unchanged or not notable', () => {
  assert.equal(transitionFor('in_buy', 'in_buy'), null)        // unchanged
  assert.equal(transitionFor('in_buy', 'below_buy'), null)     // left the zone — silent
  assert.equal(transitionFor('drifting', 'no_plan'), null)
  assert.equal(transitionFor('below_buy', 'drifting'), null)
})

test('nearestTarget picks the closest target to price', () => {
  assert.equal(nearestTarget(118, [120, 130]), 120)
  assert.equal(nearestTarget(128, [120, 130]), 130)
})

test('levelFor returns the crossed level per transition', () => {
  const plan = { buyLow: 42, buyHigh: 51, targets: [60, 91], invalidation: 30 }
  assert.deepEqual(levelFor(plan, 45, { kind: 'entered_buy' }), { buyLow: 42, buyHigh: 51 })
  assert.equal(levelFor(plan, 59, { kind: 'near_target' }), 60)
  assert.equal(levelFor(plan, 29, { kind: 'invalidation' }), 30)
})

test('formatLine includes grade/sharia context', () => {
  const ticker = { symbol: 'COP', top_grade: 8, sharia_status: 'questionable' }
  const plan = { buyLow: 42, buyHigh: 51, targets: [60], invalidation: 30 }
  assert.match(formatLine(ticker, plan, 45, { kind: 'entered_buy' }), /^🟢 COP entered buy zone 42–51 · now 45 · grade 8\/10 · ☪ questionable$/)
  assert.match(formatLine(ticker, plan, 29, { kind: 'invalidation' }), /^🔴 COP breached invalidation 30/)
})

test('formatLine omits context when grade/sharia absent or unknown', () => {
  const ticker = { symbol: 'FOO', sharia_status: 'unknown' }
  const plan = { buyLow: 5, buyHigh: 5, targets: [], invalidation: null }
  assert.equal(formatLine(ticker, plan, 5, { kind: 'entered_buy' }), '🟢 FOO entered buy zone 5 · now 5')
})

test('buildMessage batches lines under a header (no disclaimer)', () => {
  const msg = buildMessage(['🟢 A …', '🔴 B …'])
  assert.match(msg, /^🥷 Trading Hub alerts — 2 hit/)
  assert.match(msg, /🟢 A …\n🔴 B …$/)
  assert.doesNotMatch(msg, /not financial advice/)
})
