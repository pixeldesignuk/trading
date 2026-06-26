import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sourceView, buildSources, eventsHash, buildPrompt, validateSynthesis, chartList,
} from './synthesize.js'

const ROOT = '/app'

const ev = (id, source, payload, occurred_at = '2026-06-08T00:00:00Z', kind = 'mention') =>
  ({ id, source, kind, occurred_at, payload })

test('sourceView drops content-free events but keeps caption-only charts', () => {
  assert.equal(sourceView(ev(1, 'moneytaur', { entry: null, targets: [], note: null }), ROOT), null)
  const v = sourceView(ev(2, 'zero_live', { caption: 'Grinding down' }, '2026-06-22T00:00:00Z', 'chart'), ROOT)
  assert.equal(v.caption, 'Grinding down')
  assert.equal(v.as_of, '2026-06-22')
})

test('sourceView resolves chart to an absolute path and keeps chart-only events', () => {
  const v = sourceView(ev(3, 'moneytaur', { chart: 'media/moneytaur/x.jpg' }, '2026-06-08T00:00:00Z', 'chart'), ROOT)
  assert.notEqual(v, null) // chart counts as content even with no text
  assert.equal(v.chart, '/app/media/moneytaur/x.jpg')
})

test('chartList returns unique chart paths', () => {
  const sources = buildSources([
    ev(1, 'moneytaur', { note: 'a', chart: 'media/m/x.jpg' }),
    ev(2, 'moneytaur', { chart: 'media/m/x.jpg' }, '2026-06-08T00:00:00Z', 'chart'), // dup chart
    ev(3, 'zero_live', { caption: 'b', chart: 'media/lives/z.png' }, '2026-06-22T00:00:00Z', 'chart'),
  ], ROOT)
  assert.deepEqual(chartList(sources), ['/app/media/m/x.jpg', '/app/media/lives/z.png'])
})

test('buildSources maps + filters', () => {
  const out = buildSources([
    ev(1, 'moneytaur', { note: 'range play', entry: 'RL $110', targets: ['RH $190'] }),
    ev(2, 'moneytaur', { entry: null, targets: [], note: null }), // empty → dropped
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].source, 'moneytaur')
})

test('eventsHash is stable regardless of input order and changes with payload', () => {
  const a = [ev(1, 'm', { note: 'x' }), ev(2, 'z', { note: 'y' })]
  const b = [ev(2, 'z', { note: 'y' }), ev(1, 'm', { note: 'x' })]
  assert.equal(eventsHash(a), eventsHash(b))
  const c = [ev(1, 'm', { note: 'CHANGED' }), ev(2, 'z', { note: 'y' })]
  assert.notEqual(eventsHash(a), eventsHash(c))
})

test('buildPrompt replaces every placeholder', () => {
  const tpl = '{{SYMBOL}} {{NAME}} {{ASSET_CLASS}} {{PRICE}} {{OUT_PATH}}\n{{SOURCES_JSON}}'
  const out = buildPrompt(tpl, {
    ticker: { symbol: 'MSTR', name: 'Strategy', asset_class: 'stock' },
    price: 123.4, sources: [{ source: 'm' }], outPath: '/tmp/MSTR.json',
  })
  assert.ok(!out.includes('{{'))
  assert.ok(out.includes('MSTR') && out.includes('123.4') && out.includes('/tmp/MSTR.json'))
})

const good = () => ({
  conviction: 2, contested: true, action: 'wait',
  safest_plan: { entry: 78, entry_basis: 'Zero zone (estimated)', targets: [{ price: 190, basis: 'MT RH' }], invalidation: 60, stop_basis: 'below zone' },
  stance_by_source: [{ source: 'moneytaur', as_of: '2026-06-08', stance: 'bullish', timeframe: 'HTF', summary: 'buy' }],
  conflicts: ['newer call breaks the entry'], plain_english: 'Wait.',
})

test('validateSynthesis accepts a well-formed object', () => {
  assert.deepEqual(validateSynthesis(good()), { ok: true, errors: [] })
})

test('validateSynthesis enforces the contested→low-conviction guard', () => {
  const o = { ...good(), contested: true, conviction: 7 }
  const r = validateSynthesis(o)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('conviction ≤ 3')))
})

test('validateSynthesis rejects bad enums and types', () => {
  assert.equal(validateSynthesis({ ...good(), action: 'buy' }).ok, false)
  assert.equal(validateSynthesis({ ...good(), conviction: 11 }).ok, false)
  assert.equal(validateSynthesis({ ...good(), stance_by_source: [] }).ok, false)
  assert.equal(validateSynthesis({ ...good(), safest_plan: { entry: 'cheap', targets: [] } }).ok, false)
  assert.equal(validateSynthesis({ ...good(), plain_english: '' }).ok, false)
})

test('validateSynthesis allows null levels (no invented precision)', () => {
  const o = good()
  o.contested = false; o.conviction = 6
  o.safest_plan = { entry: null, entry_basis: 'no agreed level', targets: [], invalidation: null, stop_basis: 'n/a' }
  assert.equal(validateSynthesis(o).ok, true)
})
