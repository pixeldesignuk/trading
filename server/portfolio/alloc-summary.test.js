// alloc-summary.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLedger } from './ledger.js'
import { DEFAULT_TARGETS } from './targets.js'
import { formatAllocation } from './alloc-summary.js'

const targets = DEFAULT_TARGETS.personal

// A realistic mini-book: a core world ETF, a commodities satellite (silver), and
// an active pick — so every bucket and the commodities theme have something to say.
function memo() {
  const tickers = [
    { symbol: 'WLDS', name: 'World', asset_class: 'stock', layer: 'hold', role: 'core', core_type: 'world', pyramid_tier: 'defensive', top_grade: 9 },
    { symbol: 'SGLN', name: 'Silver', asset_class: 'commodity', commodity_key: 'silver', layer: 'hold', role: 'satellite', satellite_theme: 'commodities', pyramid_tier: 'defensive', top_grade: 7 },
    { symbol: 'MSTR', name: 'MicroStrategy', asset_class: 'stock', layer: 'trade', role: 'pick', top_grade: 8 },
  ]
  const holdings = [
    { ticker: 'WLDS', value: 10000 },
    { ticker: 'SGLN', value: 1400, pnl: -64 },
    { ticker: 'MSTR', value: 2600 },
  ]
  const led = buildLedger({ book: 'personal', targets, holdings, tickers, bookValue: 20000, regime: 'neutral' })
  return { led, targets, regime: 'neutral', favorTiers: [], benchmark: { label: 'ACWI', return1y: 0.12 }, bookReturnPct: 0.05 }
}

test('formatAllocation surfaces buckets with held vs target and £ room', () => {
  const out = formatAllocation(memo())
  assert.match(out, /# ALLOCATION/)
  // Satellites bucket: held (silver £1,400 = 7%) vs the 20% target, with room to add.
  assert.match(out, /Satellites: 7% \(£1,400\) \/ 20% tgt \(£4,000\) · room \+£2,600/)
  // Picks bucket: held £2,600 = 13% vs the 12% target → slightly over.
  assert.match(out, /Picks: 13% \(£2,600\) \/ 12% tgt/)
  // Cash shows dry powder, no "room" suffix.
  assert.match(out, /Cash: /)
})

test('formatAllocation breaks satellites down by theme incl. commodities room', () => {
  const out = formatAllocation(memo())
  assert.match(out, /## Satellite themes/)
  // Commodities theme carries the silver hold and a real £ figure (room, or over if past target).
  assert.match(out, /commodities: \d+% held \/ \d+% tgt · (room|over) £[\d,]+/)
  // The block explicitly tells the agent metals are sized from theme room.
  assert.match(out, /gold, silver, palladium/)
})

test('formatAllocation renders the regime-tilted satellite pyramid', () => {
  const out = formatAllocation(memo())
  assert.match(out, /## Satellite pyramid/)
  for (const tier of ['high', 'moderate', 'lower', 'defensive']) {
    assert.match(out, new RegExp(`- ${tier}: \\d+% / \\d+%`))
  }
})

test('formatAllocation returns empty string without a ledger', () => {
  assert.equal(formatAllocation(null), '')
  assert.equal(formatAllocation({ targets }), '')
  assert.equal(formatAllocation({ led: {} }), '')
})
