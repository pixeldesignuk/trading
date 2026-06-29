// Promote each zero_live SIGNAL ticker's latest setup (entry/targets/invalidation)
// from its event payload to the ticker-level plan columns, so the ticker shows its
// plan (and commodities with a real setup classify as 'trade' rather than the
// allocation 'hold' default). Layer itself is owned by classify.js (the universe
// rule) — this only fills plan columns. Only touches status='new' signal tickers.
import { query } from '../server/db.js'

const cands = (await query(
  `SELECT symbol FROM tickers WHERE status='new'
     AND symbol IN (SELECT DISTINCT ticker FROM events WHERE source='zero_live')`)).rows.map((r) => r.symbol)

let promoted = 0
for (const sym of cands) {
  const ev = (await query(
    `SELECT payload FROM events
      WHERE ticker=$1 AND source='zero_live' AND kind IN ('grade','status_change')
        AND COALESCE(payload->>'entry','') <> '' AND COALESCE(payload->>'invalidation','') <> ''
      ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT 1`, [sym])).rows[0]
  if (!ev) continue
  const p = ev.payload || {}
  const targets = Array.isArray(p.targets) ? p.targets : []
  await query(
    `UPDATE tickers SET entry_zone=$2, targets=$3, invalidation=$4, updated_at=now() WHERE symbol=$1`,
    [sym, String(p.entry), JSON.stringify(targets), String(p.invalidation)])
  promoted++
}
console.log(`Promoted plan columns on ${promoted} zero_live setup ticker(s)`)
process.exit(0)
