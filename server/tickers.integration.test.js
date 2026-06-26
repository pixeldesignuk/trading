import { test } from 'node:test'
import assert from 'node:assert/strict'

const gated = process.env.DATABASE_URL ? test : test.skip

gated('upsertTicker is idempotent and never clobbers status', async () => {
  const { init, query } = await import('./db.js')
  const { upsertTicker, setStatus, getTicker } = await import('./tickers.js')
  await init()
  await query("DELETE FROM tickers WHERE symbol='TEST'")
  await upsertTicker('TEST', { name: 'Test Co', asset_class: 'stock' })
  await setStatus('TEST', 'watching')
  await upsertTicker('TEST', { name: 'Ignored' })       // second upsert
  const t = await getTicker('TEST')
  assert.equal(t.status, 'watching')                     // not reset
  assert.equal(t.name, 'Test Co')                        // not clobbered
  await query("DELETE FROM tickers WHERE symbol='TEST'")
})

gated('setPlan round-trips ladder and targets as JSONB arrays', async () => {
  const { init, query, pool } = await import('./db.js')
  const { upsertTicker, setPlan, getTicker } = await import('./tickers.js')
  await init()
  await query("DELETE FROM tickers WHERE symbol='PLANTEST'")
  await upsertTicker('PLANTEST', { name: 'Plan Test', asset_class: 'stock' })
  await setPlan('PLANTEST', {
    entry_zone: '$10',
    ladder: [{ level: 'a', price: 8 }, { level: 'b', price: 6 }],
    targets: [{ level: 't1', price: 20 }],
    invalidation: '<$5',
    thesis: 'test',
  })
  const t = await getTicker('PLANTEST')
  assert.ok(Array.isArray(t.ladder), 'ladder should be an array')
  assert.equal(t.ladder.length, 2)
  assert.equal(t.ladder[0].price, 8)
  assert.ok(Array.isArray(t.targets), 'targets should be an array')
  assert.equal(t.targets[0].price, 20)
  await query("DELETE FROM tickers WHERE symbol='PLANTEST'")
  await pool.end()
})
