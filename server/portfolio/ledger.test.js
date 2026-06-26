// ledger.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLedger } from './ledger.js'
import { DEFAULT_TARGETS } from './targets.js'

const targets = DEFAULT_TARGETS.personal

test('aggregates current vs target weight and add/trim per ticker', () => {
  const tickers = [
    // core_type:'world' required — untyped core gets targetPct=0 under the sub-type model (C5)
    { symbol: 'WLDI', name: 'World Islamic', asset_class: 'stock', layer: 'hold', role: 'core', core_type: 'world', pyramid_tier: 'defensive', top_grade: 9 },
    // NVDA has a known tech theme via satellite_theme so it gets a non-zero target
    { symbol: 'NVDA', name: 'Nvidia', asset_class: 'stock', layer: 'hold', role: 'satellite', satellite_theme: 'tech', pyramid_tier: 'moderate', top_grade: 8 },
  ]
  const holdings = [
    { ticker: 'WLDI', value: 10000 },
    { ticker: 'NVDA', value: 400 },
  ]
  const led = buildLedger({ book: 'personal', targets, holdings, tickers, bookValue: 20000 })
  const wldi = led.rows.find((r) => r.symbol === 'WLDI')
  assert.equal(wldi.currentPct, 0.50)
  // sole world-typed core holder gets world budget: 0.60 × (40/70) ≈ 0.343 — NOT the full 0.60
  // target_pin removed from fixture; equal-weight gives the full world budget to the sole member
  assert.ok(wldi.targetPct > 0, 'typed core holder gets a positive targetPct')
  assert.equal(wldi.coreType, 'world', 'core row carries coreType')
  assert.notEqual(wldi.action, 'trim', 'core row action is never trim (guidance model)')
  const nvda = led.rows.find((r) => r.symbol === 'NVDA')
  assert.equal(nvda.currentPct, 0.02)
  assert.equal(nvda.action, 'add')          // target ~0.048 > 0.02
  assert.equal(led.dryPowderPct.toFixed(2), '0.48')
})

test('unthemed satellite gets targetPct=0 and needsTheme=true in ledger rows', () => {
  const tickers = [
    { symbol: 'WLDI', name: 'World Islamic', asset_class: 'stock', layer: 'hold', role: 'core', pyramid_tier: 'defensive', top_grade: 9 },
    // ANON: no satellite_theme, no sector, no asset_class hint → unthemed
    { symbol: 'ANON', name: 'Unknown', asset_class: 'stock', layer: 'hold', role: 'satellite', top_grade: 7 },
  ]
  const holdings = [
    { ticker: 'WLDI', value: 10000 },
    { ticker: 'ANON', value: 200 },
  ]
  const led = buildLedger({ book: 'personal', targets, holdings, tickers, bookValue: 20000 })
  const anon = led.rows.find((r) => r.symbol === 'ANON')
  assert.ok(anon, 'ANON must appear in the rows')
  assert.equal(anon.targetPct, 0, 'unthemed satellite gets zero capital')
  assert.equal(anon.theme, null, 'unthemed satellite has theme=null')
  assert.equal(anon.action, 'trim', 'currently held at 1% but target is 0 → trim')
})

test('open risk sums active-trade exposure', () => {
  const tickers = [{ symbol: 'TSLA', asset_class: 'stock', layer: 'trade', entry_zone: '100', invalidation: '90', targets: [{ price: 130 }] }]
  const holdings = [{ ticker: 'TSLA', value: 1000 }]
  const led = buildLedger({ book: 'personal', targets, holdings, tickers, bookValue: 20000 })
  // picks-model: capitalCap=20000×0.12=2400, riskCap=20000×0.02=400; stopDist=0.10; riskSize=400/0.10=4000 capped to capRemain=2400 → openRisk=240
  assert.equal(Math.round(led.openRisk), 240)
})

test('actioned-but-unheld hold ticker appears as a pending row with currentPct 0', () => {
  const tickers = [
    { symbol: 'WLDI', name: 'World Islamic', asset_class: 'stock', layer: 'hold', role: 'core', pyramid_tier: 'defensive', target_pin: 0.50, top_grade: 9, actioned_at: null },
    { symbol: 'SGLN', name: 'iShares Gold ETF', asset_class: 'commodity', layer: 'hold', role: 'satellite', pyramid_tier: 'defensive', top_grade: 7, actioned_at: '2026-06-24T10:00:00Z' },
  ]
  const holdings = [
    { ticker: 'WLDI', value: 10000 },
    // SGLN is NOT held — actioned intent only
  ]
  const led = buildLedger({ book: 'personal', targets, holdings, tickers, bookValue: 20000 })

  const sgln = led.rows.find((r) => r.symbol === 'SGLN')
  assert.ok(sgln, 'SGLN pending row must exist')
  assert.equal(sgln.action, 'pending')
  assert.equal(sgln.pending, true)
  assert.equal(sgln.currentPct, 0)
  assert.ok(sgln.targetPct > 0, 'pending row should have a positive targetPct from allocation')
  assert.equal(sgln.deltaPct, sgln.targetPct)

  // Existing held rows must still be correct and carry pending: false
  const wldi = led.rows.find((r) => r.symbol === 'WLDI')
  assert.ok(wldi, 'WLDI held row must exist')
  assert.equal(wldi.pending, false)
  assert.equal(wldi.currentPct, 0.50)
})

import { DEFAULT_TARGETS as DT } from './targets.js'
import { coreTypeBudgets } from './allocate.js'

const T = DT.personal

test('coreCoverage: world core holding covered; us/quality_income need buy; world row action !== trim', () => {
  // ISWDL held at 20% of a 60k book (value=12000), core_type=world
  // core_pct=0.60 → world budget ≈ 0.60 × 0.571 ≈ 0.343
  // currentPct for world = 12000/60000 = 0.20, which is < 0.343 → needsBuy for world
  // us and quality_income have 0 current → needsBuy too
  // But the IMPORTANT assertion: the world row action must NOT be 'trim'
  const tickers = [
    { symbol: 'ISWDL', name: 'iShares World Islamic', asset_class: 'stock', layer: 'hold', role: 'core', core_type: 'world', pyramid_tier: 'defensive', top_grade: 9 },
  ]
  const holdings = [{ ticker: 'ISWDL', value: 12000 }]
  const led = buildLedger({ book: 'personal', targets: T, holdings, tickers, bookValue: 60000 })

  // coreCoverage must exist
  assert.ok(Array.isArray(led.coreCoverage), 'coreCoverage is an array')

  const worldEntry = led.coreCoverage.find((e) => e.coreType === 'world')
  assert.ok(worldEntry, 'world entry present in coreCoverage')
  assert.ok(worldEntry.held.includes('ISWDL'), 'world entry holds ISWDL')
  assert.ok(typeof worldEntry.targetPct === 'number', 'world entry has targetPct')
  assert.ok(typeof worldEntry.currentPct === 'number', 'world entry has currentPct')

  const usEntry = led.coreCoverage.find((e) => e.coreType === 'us')
  assert.ok(usEntry, 'us entry present in coreCoverage')
  assert.equal(usEntry.needsBuy, true, 'us has nothing held → needsBuy')

  const qiEntry = led.coreCoverage.find((e) => e.coreType === 'quality_income')
  assert.ok(qiEntry, 'quality_income entry present in coreCoverage')
  assert.equal(qiEntry.needsBuy, true, 'quality_income has nothing held → needsBuy')

  // The held world core row must NOT show trim
  const iswdlRow = led.rows.find((r) => r.symbol === 'ISWDL')
  assert.ok(iswdlRow, 'ISWDL row present')
  assert.notEqual(iswdlRow.action, 'trim', 'core row action is never trim')

  // Row carries coreType
  assert.equal(iswdlRow.coreType, 'world', 'core row carries coreType')
})

test('ledger emits buckets, a derived pyramid, and a defense cash advisory', () => {
  const led = buildLedger({
    book: 'personal', targets: T, bookValue: 10000, regime: 'defense',
    tickers: [{ symbol: 'ISWDL', role: 'core' }, { symbol: 'CRSP', asset_class: 'stock', invalidation: '40', entry_zone: '52' }],
    holdings: [{ ticker: 'ISWDL', value: 5000 }, { ticker: 'CRSP', value: 1500 }],
  })
  const core = led.rows.find((r) => r.symbol === 'ISWDL')
  assert.equal(core.bucket, 'core')
  const pick = led.rows.find((r) => r.symbol === 'CRSP')
  assert.equal(pick.bucket, 'picks')
  assert.ok('suggestedPct' in pick)
  assert.ok(led.pyramid && led.pyramid.effective)
  assert.ok(typeof led.cashAdvisory === 'string') // defense regime
})
