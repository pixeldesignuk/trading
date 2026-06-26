import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setActioned } from '../tickers.js'

test('setActioned(symbol, true) sets actioned_at = now()', async () => {
  let captured
  const q = async (sql, params) => { captured = { sql, params }; return { rows: [] } }
  await setActioned('SGLN', true, { q })
  assert.match(captured.sql, /actioned_at = now\(\)/i)
  assert.deepEqual(captured.params, ['SGLN'])
})

test('setActioned(symbol, false) sets actioned_at = NULL', async () => {
  let captured
  const q = async (sql, params) => { captured = { sql, params }; return { rows: [] } }
  await setActioned('SGLN', false, { q })
  assert.match(captured.sql, /actioned_at = NULL/i)
  assert.deepEqual(captured.params, ['SGLN'])
})
