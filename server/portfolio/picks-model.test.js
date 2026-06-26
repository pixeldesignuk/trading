import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sizePicks } from './picks-model.js'

const book = 10000, picksPct = 0.12, riskCapPct = 0.02

test('a clean setup is sized by min(risk, capital) and reports rr', () => {
  const t = { symbol: 'AAA', top_grade: 8, entry_zone: '100', invalidation: '90', targets: [{ price: 130 }] }
  const [r] = sizePicks([t], { bookValue: book, picksPct, riskCapPct })
  assert.ok(r.suggestedPct > 0 && r.suggestedPct <= picksPct)
  assert.ok(r.rr != null)
})

test('no entry/stop → needsLevels and capital-only fallback, never negative', () => {
  const t = { symbol: 'BBB', top_grade: 6 }
  const [r] = sizePicks([t], { bookValue: book, picksPct, riskCapPct })
  assert.equal(r.needsLevels, true)
  assert.ok(r.suggestedPct >= 0)
})

test('already over the capital cap → suggest nothing, flag overCap, no negative', () => {
  const t = { symbol: 'CCC', top_grade: 9, value: 2000 } // 20% of book, cap is 12%
  const [r] = sizePicks([t], { bookValue: book, picksPct, riskCapPct })
  assert.equal(r.overCap, true)
  assert.equal(r.suggestedPct, 0)
})

test('multiple trades share the caps in deterministic (grade desc) order', () => {
  const a = { symbol: 'A', top_grade: 5, entry_zone: '100', invalidation: '95', targets: [{ price: 120 }] }
  const b = { symbol: 'B', top_grade: 9, entry_zone: '100', invalidation: '95', targets: [{ price: 120 }] }
  const out = sizePicks([a, b], { bookValue: book, picksPct, riskCapPct })
  assert.equal(out[0].symbol, 'B') // higher grade first
  const total = out.reduce((s, r) => s + r.suggestedPct, 0)
  assert.ok(total <= picksPct + 1e-9)
})

test('equal grade: higher R:R sorts first (R:R tiebreak)', () => {
  // Both grade 7, but different R:R via different target prices
  // a: entry=100, stop=90 (10% stop), target=130 → R:R = (130-100)/(100-90) = 3
  const a = { symbol: 'A', top_grade: 7, entry_zone: '100', invalidation: '90', targets: [{ price: 130 }] }
  // b: entry=100, stop=90 (10% stop), target=115 → R:R = (115-100)/(100-90) = 1.5
  const b = { symbol: 'B', top_grade: 7, entry_zone: '100', invalidation: '90', targets: [{ price: 115 }] }
  const out = sizePicks([b, a], { bookValue: book, picksPct, riskCapPct }) // note: b passed first to verify sort
  assert.equal(out[0].symbol, 'A', 'higher R:R (A=3 vs B=1.5) should sort first')
  assert.equal(out[1].symbol, 'B')
})
