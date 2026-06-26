import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAccounts } from './accounts.js'

test('parseAccounts returns [] for missing/empty/malformed input', () => {
  assert.deepEqual(parseAccounts(undefined), [])
  assert.deepEqual(parseAccounts(''), [])
  assert.deepEqual(parseAccounts('not json'), [])
  assert.deepEqual(parseAccounts('{}'), [])      // object, not array
})

test('parseAccounts normalises a valid account list', () => {
  const out = parseAccounts(JSON.stringify([
    { id: 'isa', label: 'ISA', keyId: 'k1', secret: 's1' },
    { id: 'jisa', keyId: 'k2', secret: 's2', baseUrl: 'https://demo.trading212.com/' },
  ]))
  assert.deepEqual(out, [
    { id: 'isa', label: 'ISA', keyId: 'k1', secret: 's1', baseUrl: 'https://live.trading212.com' },
    // label defaults to id; trailing slash stripped from baseUrl
    { id: 'jisa', label: 'jisa', keyId: 'k2', secret: 's2', baseUrl: 'https://demo.trading212.com' },
  ])
})

test('parseAccounts drops entries missing id, keyId, or secret', () => {
  const out = parseAccounts(JSON.stringify([
    { id: 'ok', keyId: 'k', secret: 's' },
    { label: 'no id', keyId: 'k', secret: 's' },
    { id: 'no-key', secret: 's' },
    { id: 'no-secret', keyId: 'k' },
  ]))
  assert.deepEqual(out.map((a) => a.id), ['ok'])
})
