import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMatchMap, matchHeldSymbol } from './fund-match.js'

const universe = {
  core: [{ symbol: 'ISWD.GB' }],
  satellite_etf: [{ symbol: 'SGLN.GB', theme: 'commodities' }, { symbol: 'HIES.GB', theme: 'em' }],
  crypto: [{ symbol: 'BTC', theme: 'crypto' }],
  cash_defensive: [{ symbol: 'CASH' }],
}

test('core fund → core bucket; London root+L resolves', () => {
  const m = buildMatchMap(universe)
  assert.equal(matchHeldSymbol('ISWDL', m).bucket, 'core')
})

test('gold → satellite/commodities/lower; EM → satellite/em/moderate', () => {
  const m = buildMatchMap(universe)
  assert.deepEqual(matchHeldSymbol('SGLNL', m), { bucket: 'satellite', theme: 'commodities', tier: 'lower', source: 'SGLN.GB' })
  assert.equal(matchHeldSymbol('HIESL', m).theme, 'em')
  assert.equal(matchHeldSymbol('HIESL', m).tier, 'moderate')
})

test('crypto → satellite/crypto/high; CASH and unknowns do not match', () => {
  const m = buildMatchMap(universe)
  assert.deepEqual(matchHeldSymbol('BTC', m), { bucket: 'satellite', theme: 'crypto', tier: 'high', source: 'BTC' })
  assert.equal(matchHeldSymbol('CASH', m), null)
  assert.equal(matchHeldSymbol('NVDA', m), null)
})

// C6 tests: core funds carry coreType + incomeKind
const universeC6 = {
  core: [{ symbol: 'ISWD.GB', core_type: 'world' }],
  income: [{ symbol: 'SPSK.GB', core_type: 'quality_income', income_kind: 'sukuk' }],
  satellite_etf: [{ symbol: 'SGLN.GB', theme: 'commodities' }],
}

test('core fund with core_type:world → match carries coreType:world', () => {
  const m = buildMatchMap(universeC6)
  const match = matchHeldSymbol('ISWDL', m)
  assert.equal(match.bucket, 'core')
  assert.equal(match.coreType, 'world')
})

test('income fund with core_type:quality_income, income_kind:sukuk → match carries both', () => {
  const m = buildMatchMap(universeC6)
  const match = matchHeldSymbol('SPSKL', m)
  assert.equal(match.bucket, 'core')
  assert.equal(match.coreType, 'quality_income')
  assert.equal(match.incomeKind, 'sukuk')
})

test('core fund without core_type falls back to world; income fund without core_type falls back to quality_income', () => {
  const m = buildMatchMap({
    core: [{ symbol: 'XCORE' }],
    income: [{ symbol: 'XINC' }],
  })
  assert.equal(matchHeldSymbol('XCORE', m).coreType, 'world')
  assert.equal(matchHeldSymbol('XINC', m).coreType, 'quality_income')
})
