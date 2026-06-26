import { test } from 'node:test'
import assert from 'node:assert/strict'

const gated = process.env.DATABASE_URL ? test : test.skip

gated('init creates tickers + events tables', async () => {
  const { init, query, pool } = await import('./db.js')
  await init()
  const r = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_name IN ('tickers','events')",
  )
  assert.equal(r.rows.length, 2)
  await pool.end()
})
