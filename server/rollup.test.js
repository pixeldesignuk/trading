import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recomputeRollupFrom } from './rollup.js'

const ev = (payload, occurred_at) => ({ payload, occurred_at })

test('top_grade is the max grade_score across events, with its verdict', () => {
  const out = recomputeRollupFrom([
    ev({ grade_score: 4, grade_verdict: 'partial' }, '2026-06-19'),
    ev({ grade_score: 8, grade_verdict: 'pass' }, '2026-06-20'),
    ev({ grade_score: null }, '2026-06-21'),
  ])
  assert.equal(out.top_grade, 8)
  assert.equal(out.top_grade_verdict, 'pass')
})

test('sharia comes from the most recent event that has a status', () => {
  const out = recomputeRollupFrom([
    ev({ sharia_status: 'compliant', sharia_note: 'ok' }, '2026-06-21'),
    ev({ sharia_status: 'questionable' }, '2026-06-19'),
  ])
  assert.equal(out.sharia_status, 'compliant')
  assert.equal(out.sharia_note, 'ok')
})

test('empty events yield nulls and unknown sharia', () => {
  const out = recomputeRollupFrom([])
  assert.equal(out.top_grade, null)
  assert.equal(out.sharia_status, 'unknown')
})
