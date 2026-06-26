import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setClassification } from '../tickers.js'

test('setClassification with all fields writes full UPDATE', async () => {
  const calls = []
  const q = async (sql, params) => { calls.push({ sql, params }); return { rows: [] } }
  await setClassification('NVDA', { layer: 'hold', role: 'satellite', pyramid_tier: 'moderate', target_pin: null, sleeve: null, satellite_theme: null }, { q })
  assert.equal(calls.length, 1)
  const { sql, params } = calls[0]
  assert.match(sql, /UPDATE tickers SET/i)
  // Should contain all six fields + updated_at
  assert.match(sql, /layer=/)
  assert.match(sql, /role=/)
  assert.match(sql, /pyramid_tier=/)
  assert.match(sql, /satellite_theme=/)
  assert.match(sql, /updated_at=now\(\)/)
  assert.equal(params[0], 'NVDA')
})

test('setClassification with only pyramid_tier sets ONLY that field', async () => {
  const calls = []
  const q = async (sql, params) => { calls.push({ sql, params }); return { rows: [] } }
  await setClassification('AAPL', { pyramid_tier: 'high' }, { q })
  assert.equal(calls.length, 1)
  const { sql, params } = calls[0]
  assert.match(sql, /UPDATE tickers SET/i)
  assert.match(sql, /pyramid_tier=/)
  assert.doesNotMatch(sql, /layer=/)
  assert.doesNotMatch(sql, /role=/)
  assert.doesNotMatch(sql, /sleeve=/)
  assert.doesNotMatch(sql, /satellite_theme=/)
  assert.match(sql, /updated_at=now\(\)/)
  // params: symbol + pyramid_tier value only
  assert.equal(params[0], 'AAPL')
  assert.equal(params[1], 'high')
  assert.equal(params.length, 2)
})

test('setClassification with only satellite_theme sets ONLY that field', async () => {
  const calls = []
  const q = async (sql, params) => { calls.push({ sql, params }); return { rows: [] } }
  await setClassification('HIESL', { satellite_theme: 'em' }, { q })
  assert.equal(calls.length, 1)
  const { sql, params } = calls[0]
  assert.match(sql, /satellite_theme=/)
  assert.doesNotMatch(sql, /layer=/)
  assert.doesNotMatch(sql, /pyramid_tier=/)
  assert.match(sql, /updated_at=now\(\)/)
  assert.equal(params[0], 'HIESL')
  assert.equal(params[1], 'em')
  assert.equal(params.length, 2)
})

test('setClassification with no whitelisted keys is a no-op', async () => {
  const calls = []
  const q = async (sql, params) => { calls.push({ sql, params }); return { rows: [] } }
  await setClassification('XYZ', { unknown_field: 'foo' }, { q })
  assert.equal(calls.length, 0, 'no SQL should be issued for unknown fields')
})

test('setClassification with empty patch is a no-op', async () => {
  const calls = []
  const q = async (sql, params) => { calls.push({ sql, params }); return { rows: [] } }
  await setClassification('XYZ', {}, { q })
  assert.equal(calls.length, 0, 'no SQL should be issued for empty patch')
})

test('setClassification partial patch preserves other fields (SQL only touches patched ones)', async () => {
  const calls = []
  const q = async (sql, params) => { calls.push({ sql, params }); return { rows: [] } }
  // Simulates: user edits layer only, satellite_theme must NOT be wiped
  await setClassification('SGLN', { layer: 'hold', role: 'satellite' }, { q })
  assert.equal(calls.length, 1)
  const { sql } = calls[0]
  assert.match(sql, /layer=/)
  assert.match(sql, /role=/)
  assert.doesNotMatch(sql, /satellite_theme=/)
  assert.doesNotMatch(sql, /pyramid_tier=/)
})
