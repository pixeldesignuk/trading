import { test } from 'node:test'
import assert from 'node:assert/strict'

const gated = process.env.DATABASE_URL ? test : test.skip

gated('ingestSignal creates ticker, event, and rollup; re-ingest dedupes', async () => {
  const { init, query, pool } = await import('./db.js')
  const { ingestSignal } = await import('./ingest-signal.js')
  const { getTicker } = await import('./tickers.js')
  await init()
  await query("DELETE FROM tickers WHERE symbol='ZZZ'")
  const sig = {
    symbol: 'ZZZ', name: 'Zed', asset_class: 'stock', source: 'moneytaur',
    kind: 'grade', occurred_at: '2026-06-20', native_id: 'tweet1',
    payload: { entry: '$5', grade_score: 8, grade_verdict: 'pass', sharia_status: 'compliant' },
  }
  await ingestSignal(sig)
  await ingestSignal(sig)                                    // same native_id
  const ev = await query("SELECT COUNT(*)::int n FROM events WHERE ticker='ZZZ'")
  assert.equal(ev.rows[0].n, 1)                              // deduped
  const t = await getTicker('ZZZ')
  assert.equal(t.top_grade, 8)
  assert.equal(t.sharia_status, 'compliant')
  await query("DELETE FROM tickers WHERE symbol='ZZZ'")
  await pool.end()
})
