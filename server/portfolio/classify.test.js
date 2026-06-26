import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TIER_CEILING, defaultClassification, classify, tierFrom } from './classify.js'

test('tier ceilings match the masterclass bands', () => {
  assert.equal(TIER_CEILING.high, 0.10)
  assert.equal(TIER_CEILING.moderate, 0.06)
})

test('defaults derive from asset_class', () => {
  assert.deepEqual(defaultClassification({ asset_class: 'crypto' }), { layer: 'hold', role: 'satellite', pyramidTier: 'high' })
  assert.deepEqual(defaultClassification({ asset_class: 'commodity' }), { layer: 'hold', role: 'satellite', pyramidTier: 'lower' })
  assert.deepEqual(defaultClassification({ asset_class: 'stock' }), { layer: 'hold', role: 'satellite', pyramidTier: 'moderate' })
})

test('explicit overrides win over defaults', () => {
  const t = { asset_class: 'stock', layer: 'trade', pyramid_tier: 'high' }
  assert.deepEqual(classify(t), { layer: 'trade', role: 'satellite', pyramidTier: 'high', bucket: 'picks', theme: null, coreType: null })
})

test('tierFrom uses sector then market cap', () => {
  assert.equal(tierFrom({ sector: 'Utilities' }), 'defensive')
  assert.equal(tierFrom({ sector: 'Healthcare' }), 'defensive')
  assert.equal(tierFrom({ sector: 'Consumer Defensive' }), 'lower')
  assert.equal(tierFrom({ sector: 'Technology', market_cap: 8e8 }), 'high')    // micro
  assert.equal(tierFrom({ sector: 'Technology', market_cap: 5e9 }), 'moderate') // mid
  assert.equal(tierFrom({ sector: 'Technology', market_cap: 5e11 }), 'lower')   // mega
  assert.equal(tierFrom({}), 'moderate')                                        // unknown
})

test('layer defaults to trade when a stock carries a structure stop + entry', () => {
  assert.equal(defaultClassification({ asset_class: 'stock', invalidation: '90', entry_zone: '100' }).layer, 'trade')
  assert.equal(defaultClassification({ asset_class: 'stock', entry_zone: '100' }).layer, 'hold')
  assert.equal(defaultClassification({ asset_class: 'crypto', invalidation: '90', entry_zone: '100' }).layer, 'hold')
})

test('market-cap + sector drive the default tier', () => {
  assert.equal(defaultClassification({ asset_class: 'stock', sector: 'Utilities' }).pyramidTier, 'defensive')
  assert.equal(defaultClassification({ asset_class: 'stock', market_cap: 9e8 }).pyramidTier, 'high')
})

import { bucketOf, themeOf } from './classify.js'

test('trade-layer stock → picks bucket; crypto → satellite/crypto theme', () => {
  assert.equal(bucketOf({ asset_class: 'stock', invalidation: '100', entry_zone: '110' }), 'picks')
  assert.equal(bucketOf({ asset_class: 'crypto' }), 'satellite')
  assert.equal(themeOf({ asset_class: 'crypto' }), 'crypto')
  assert.equal(bucketOf({ asset_class: 'stock', role: 'core' }), 'core')
})

test('themeOf honours satellite_theme override, else infers commodity→commodities', () => {
  assert.equal(themeOf({ asset_class: 'commodity' }), 'commodities')
  assert.equal(themeOf({ satellite_theme: 'tech' }), 'tech')
})

test('classify returns bucket + theme alongside layer/role/tier', () => {
  const c = classify({ symbol: 'HIESL', asset_class: 'stock', satellite_theme: 'em', role: 'satellite' })
  assert.equal(c.bucket, 'satellite'); assert.equal(c.theme, 'em'); assert.equal(c.layer, 'hold')
  assert.equal(c.pyramidTier, 'moderate') // EM ETF tiers by theme, not market-cap
})

test('a synthesised setup (numeric stop below entry) auto-classifies Trade', () => {
  const t = { asset_class: 'stock', synthesis: { safest_plan: { entry: 42, invalidation: 29.79, targets: [{ price: 86 }] } } }
  assert.equal(classify(t).layer, 'trade')
  assert.equal(classify(t).bucket, 'picks')
  // no usable stop → stays Hold (e.g. safest_plan with a null entry)
  assert.equal(classify({ asset_class: 'stock', synthesis: { safest_plan: { entry: null, invalidation: 30 } } }).layer, 'hold')
  // a bare ETF/stock with no setup stays Hold
  assert.equal(classify({ asset_class: 'stock' }).layer, 'hold')
  // explicit layer still overrides the auto-detection
  assert.equal(classify({ asset_class: 'stock', layer: 'hold', synthesis: { safest_plan: { entry: 42, invalidation: 30 } } }).layer, 'hold')
})

test('themed satellite ETFs tier by theme, not market cap', () => {
  // a small-AUM EM/tech fund must not fall through to the micro-cap → high rule
  assert.equal(classify({ symbol: 'HIESL', satellite_theme: 'em', market_cap: 8e8 }).pyramidTier, 'moderate')
  assert.equal(classify({ symbol: 'NICHE', satellite_theme: 'niche' }).pyramidTier, 'high')
  assert.equal(classify({ symbol: 'GLD', satellite_theme: 'commodities' }).pyramidTier, 'lower')
  // an explicit stored tier still wins over the theme default
  assert.equal(classify({ satellite_theme: 'em', pyramid_tier: 'high' }).pyramidTier, 'high')
})

import { coreTypeOf } from './classify.js'

test('core holding carries coreType; non-core is null', () => {
  assert.equal(coreTypeOf({ core_type: 'world' }), 'world')
  assert.equal(classify({ symbol:'ISWDL', role:'core', core_type:'world' }).coreType, 'world')
  assert.equal(classify({ asset_class:'crypto' }).coreType, null)
})
