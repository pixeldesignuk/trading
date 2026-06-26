import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessPosture, HOLD_DRAWDOWN } from './posture.js'

test('a HOLD with no plan is never flagged at risk for lacking a stop', () => {
  // The original bug: hold ETFs (no entry/stop by design) read as planless trades.
  const r = assessPosture({ layer: 'hold', state: 'no_plan', grade: 5, held: { value: 1000, pnl: -20 } })
  assert.equal(r.kind, 'ok')
})

test('a HOLD in heavy drawdown vs cost is at risk', () => {
  // value 850, pnl -150 → cost 1000 → -15% exactly at the threshold.
  const r = assessPosture({ layer: 'hold', state: null, held: { value: 850, pnl: -150 } })
  assert.equal(r.kind, 'at_risk')
  assert.match(r.reason, /down -15% vs cost/)
})

test('a shallow hold drawdown is fine', () => {
  const r = assessPosture({ layer: 'hold', held: { value: 950, pnl: -50 } }) // -5%
  assert.equal(r.kind, 'ok')
})

test('a held HOLD with a stand-aside thesis is a watch, not at risk', () => {
  const r = assessPosture({ layer: 'hold', held: { value: 1000, pnl: 10 }, synthesis: { action: 'stand_aside' } })
  assert.equal(r.kind, 'watch')
})

test('a high-grade unheld hold is a candidate worth a look', () => {
  const r = assessPosture({ layer: 'hold', grade: 8, held: null })
  assert.equal(r.kind, 'watch')
  assert.match(r.reason, /grade 8/)
})

test('a TRADE past invalidation is at risk (held vs not)', () => {
  assert.equal(assessPosture({ layer: 'trade', state: 'past_invalidation', held: { value: 500, pnl: -50 } }).reason, 'held below invalidation')
  assert.equal(assessPosture({ layer: 'trade', state: 'past_invalidation', held: null }).reason, 'below invalidation')
})

test('a held TRADE with no levels is at risk; an unheld one just needs levels', () => {
  assert.equal(assessPosture({ layer: 'trade', state: 'no_plan', held: { value: 500, pnl: 0 } }).kind, 'at_risk')
  assert.equal(assessPosture({ layer: 'trade', state: 'no_plan', held: null }).kind, 'watch')
})

test('an unheld TRADE in the buy zone is a watch (opportunity)', () => {
  assert.equal(assessPosture({ layer: 'trade', state: 'in_buy', held: null }).reason, 'in buy zone')
})

test('a quiet drifting trade is ok', () => {
  assert.equal(assessPosture({ layer: 'trade', state: 'drifting', grade: 4, held: null }).kind, 'ok')
})

test('HOLD_DRAWDOWN is the documented threshold', () => {
  assert.equal(HOLD_DRAWDOWN, -0.15)
})
