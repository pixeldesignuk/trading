import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncAccount, syncAll, quoteSymbolFor } from './sync.js'

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

test('syncAccount folds a held commodity ETC onto its commodity ticker, not a standalone line', async () => {
  const { q, calls } = fakeQuery()
  const upserts = []
  const registry = {
    trading212: {
      fetchSnapshot: async () => ({
        totalValue: 500, currency: 'GBP', cash: 0, invested: 500, pnl: null,
        // T212's London silver ETC line — brokerToHubSymbol collapses it to SSLNL.
        holdings: [{ symbol: 'SSLNl_EQ', name: 'SSLNl', quantity: 11.8, value: 500, currency: 'GBP' }],
      }),
    },
  }
  const account = { id: 't1', provider: 'trading212', label: 'T212', credentials_enc: {} }
  const held = await syncAccount(account, {
    q, registry, decryptCreds: () => ({}),
    upsert: async (sym, opts) => { upserts.push({ sym, opts }) },
  })

  // Held set + ticker upsert use the commodity ticker, never the SSLNL vehicle code.
  assert.deepEqual(held, ['SILVER'])
  assert.deepEqual(upserts, [{ sym: 'SILVER', opts: { name: null, asset_class: 'commodity' } }])
  // The commodity key + actually-held vehicle are locked on the SILVER ticker.
  const lock = calls.find((c) => /UPDATE tickers SET commodity_key/.test(c.text))
  assert.ok(lock, 'locks commodity_key/vehicle')
  assert.deepEqual(lock.params, ['SILVER', 'silver', 'SSLN'])
  // The holdings row keeps the raw broker symbol but files under SILVER.
  const ins = calls.find((c) => /INSERT INTO holdings/.test(c.text))
  assert.equal(ins.params[1], 'SSLNl_EQ')  // broker_symbol (audit trail)
  assert.equal(ins.params[2], 'SILVER')    // ticker (folded)
})

test('quoteSymbolFor resolves an LSE yahoo symbol from the fund universe or the L suffix', () => {
  // Curated fund-universe line (authoritative).
  assert.equal(quoteSymbolFor('ISWDl_EQ'), 'ISWD.L')
  assert.equal(quoteSymbolFor('HIESl_EQ'), 'HIES.L')
  // Unknown London line → derived from the lowercase-l venue suffix.
  assert.equal(quoteSymbolFor('ZZZZl_EQ'), 'ZZZZ.L')
  // A US line (no London suffix) gets no override — priced off its bare root.
  assert.equal(quoteSymbolFor('AAPL_US_EQ'), null)
})

test('syncAccount gives a synced LSE line a resolvable yahoo quote_symbol', async () => {
  const { q, calls } = fakeQuery()
  const registry = {
    trading212: {
      fetchSnapshot: async () => ({
        totalValue: 100, currency: 'GBP', cash: 0, invested: 100, pnl: null,
        holdings: [{ symbol: 'ISWDl_EQ', name: 'iShares World', quantity: 2, value: 100, currency: 'GBP' }],
      }),
    },
  }
  const account = { id: 't2', provider: 'trading212', label: 'T212', credentials_enc: {} }
  const held = await syncAccount(account, { q, registry, decryptCreds: () => ({}), upsert: async () => {} })

  assert.deepEqual(held, ['ISWDL'])
  const setQs = calls.find((c) => /SET quote_symbol/.test(c.text))
  assert.ok(setQs, 'sets quote_symbol on the LSE line')
  assert.deepEqual(setQs.params, ['ISWDL', 'ISWD.L'])
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
