import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateTargets, effectiveThemeWeights, neutralPyramid, derivedPyramidFor, coreTypeBudgets } from './allocate.js'
import { DEFAULT_TARGETS } from './targets.js'
import { derivePyramid, normalise } from './satellite-model.js'

const T = DEFAULT_TARGETS.personal

test('core budget goes to core holdings; single typed core fund gets its sub-type slice', () => {
  // C5: core is now split by core_type. A world fund gets core_pct × core_type_splits.world.
  const m = allocateTargets([{ symbol: 'ISWDL', asset_class: 'stock', role: 'core', core_type: 'world' }], T)
  const b = coreTypeBudgets(T)
  assert.ok(Math.abs(m.get('ISWDL').targetPct - b.world) < 1e-9) // core_pct × world_fraction
  assert.equal(m.get('ISWDL').bucket, 'core')
})

test('satellite holding gets its theme share of satellite_pct', () => {
  const m = allocateTargets([{ symbol: 'HIESL', asset_class: 'stock', role: 'satellite', satellite_theme: 'em' }], T)
  const w = effectiveThemeWeights(T) // neutral
  assert.ok(Math.abs(m.get('HIESL').targetPct - w.em) < 1e-9)
  assert.equal(m.get('HIESL').theme, 'em')
})

test('effectiveThemeWeights sum to satellite_pct and tilt under defense', () => {
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0)
  const neutral = effectiveThemeWeights(T)
  const defense = effectiveThemeWeights(T, 'defense')
  assert.ok(Math.abs(sum(neutral) - T.satellite_pct) < 1e-9)
  assert.ok(defense.commodities > neutral.commodities)
})

test('trade-layer names are not allocated here (picks handled elsewhere)', () => {
  const m = allocateTargets([{ symbol: 'CRSP', asset_class: 'stock', invalidation: '40', entry_zone: '52' }], T)
  assert.equal(m.has('CRSP'), false)
})

test('unthemed satellite gets targetPct=0, theme=null, needsTheme=true, NOT placed under tech', () => {
  // XXX has no inferable theme: stock with no sector, no satellite_theme, no asset_class hint
  const m = allocateTargets([{ symbol: 'XXX', asset_class: 'stock', role: 'satellite' }], T)
  assert.ok(m.has('XXX'), 'XXX must appear in the allocation map')
  const row = m.get('XXX')
  assert.equal(row.targetPct, 0, 'unthemed satellite must get zero capital')
  assert.equal(row.theme, null, 'unthemed satellite must have theme=null')
  assert.equal(row.needsTheme, true, 'unthemed satellite must have needsTheme=true')
})

test('unthemed satellite does not steal tech budget (tech members unaffected)', () => {
  const holdings = [
    { symbol: 'TECH1', asset_class: 'stock', role: 'satellite', satellite_theme: 'tech' },
    { symbol: 'XXX',   asset_class: 'stock', role: 'satellite' },  // no inferable theme
  ]
  const m = allocateTargets(holdings, T)
  const tech1 = m.get('TECH1')
  const xxx = m.get('XXX')
  // tech1 should have the full tech budget (sole tech member)
  const expected = effectiveThemeWeights(T).tech
  assert.ok(Math.abs(tech1.targetPct - expected) < 1e-9, 'tech member keeps full tech budget')
  assert.equal(xxx.targetPct, 0, 'unthemed XXX gets zero capital')
  assert.equal(xxx.needsTheme, true)
})

test('neutralPyramid uses raw theme splits without regime tilt; differs from effective under defense', () => {
  const neutral = neutralPyramid(T)
  const effective = derivedPyramidFor(T, 'defense')
  // Both should exist and have the four tiers
  assert.ok(neutral && typeof neutral.defensive === 'number')
  assert.ok(effective && typeof effective.defensive === 'number')
  // Under defense, effective tilts toward defensive tier; neutral should differ
  assert.notDeepEqual(neutral, effective)
  // Neutral should match derivePyramid of the raw splits directly
  const expected = derivePyramid(normalise(T.satellite_theme_splits))
  assert.deepEqual(neutral, expected)
})

test('core budget splits by core_type_splits; world holding gets its slice', () => {
  const targets = DEFAULT_TARGETS.personal
  const m = allocateTargets([{ symbol: 'ISWDL', role: 'core', core_type: 'world' }], targets)
  const b = coreTypeBudgets(targets)
  assert.ok(Math.abs(m.get('ISWDL').targetPct - b.world) < 1e-9) // ~0.343
  assert.equal(m.get('ISWDL').coreType, 'world')
})

test('untyped core holding → 0 target + needsType (still core bucket)', () => {
  const m = allocateTargets([{ symbol: 'XCORE', role: 'core' }], DEFAULT_TARGETS.personal)
  assert.equal(m.get('XCORE').targetPct, 0)
  assert.equal(m.get('XCORE').needsType, true)
  assert.equal(m.get('XCORE').bucket, 'core')
})
