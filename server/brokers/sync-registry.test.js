import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncAccount, syncAll } from './sync.js'

// A fake query that records writes and serves no rows.
function fakeQuery() {
  const calls = []
  const q = async (text, params) => { calls.push({ text, params }); return { rows: [] } }
  return { q, calls }
}

test('syncAccount dispatches to the account provider, decrypting its credentials', async () => {
  const { q, calls } = fakeQuery()
  const seen = {}
  const registry = {
    bitget: {
      fetchSnapshot: async (creds) => {
        seen.creds = creds
        return { totalValue: 500, currency: 'GBP', cash: 100, invested: 400, pnl: null,
          holdings: [{ symbol: 'BTC', name: 'BTC', quantity: 0.01, value: 400, currency: 'GBP' }] }
      },
    },
  }
  const account = { id: 'bg1', provider: 'bitget', label: 'Bitget', credentials_enc: { sealed: true } }
  const held = await syncAccount(account, {
    q, registry,
    decryptCreds: (enc) => { assert.deepEqual(enc, { sealed: true }); return { apiKey: 'k', apiSecret: 's', passphrase: 'p' } },
    upsert: async () => {},
  })

  assert.deepEqual(seen.creds, { apiKey: 'k', apiSecret: 's', passphrase: 'p' })
  assert.deepEqual(held, ['BTC'])
  // the account row is written with broker = the provider key
  const insert = calls.find((c) => /INSERT INTO broker_accounts/.test(c.text))
  assert.ok(insert)
  assert.equal(insert.params[1], 'bitget')
})

test('an unknown provider is reported as a per-account error, not a crash', async () => {
  const { q } = fakeQuery()
  const account = { id: 'x', provider: 'nope', label: 'X', credentials_enc: {} }
  const summary = await syncAll({
    accounts: [account], q, registry: {}, decryptCreds: () => ({}),
    reconcile: async () => {}, wait: async () => {},
  })
  assert.equal(summary.errors.length, 1)
  assert.match(summary.errors[0].error, /unknown provider/)
})

test('syncAll spaces each account by its provider rate limit', async () => {
  const waits = []
  const registry = {
    trading212: { rateLimitMs: 1100, fetchSnapshot: async () => snap() },
    bitget: { rateLimitMs: 250, fetchSnapshot: async () => snap() },
  }
  const snap = () => ({ totalValue: 0, currency: 'GBP', cash: 0, invested: 0, pnl: null, holdings: [] })
  const { q } = fakeQuery()
  await syncAll({
    accounts: [
      { id: 'a', provider: 'trading212', credentials_enc: {} },
      { id: 'b', provider: 'bitget', credentials_enc: {} },
    ],
    q, registry, decryptCreds: () => ({}),
    reconcile: async () => {}, wait: async (ms) => { waits.push(ms) }, upsert: async () => {},
  })
  // first account: no wait; second account spaced by bitget's 250ms
  assert.deepEqual(waits, [250])
})
