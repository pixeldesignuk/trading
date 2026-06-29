// One-off: reconcile the mis-canonicalised SGLN ticker into GOLD.
//
// The lives back-catalogue extractor labelled gold setups with the halal VEHICLE
// code `SGLN` instead of the commodity symbol `GOLD` (vehicle = SGLN). That
// created a duplicate `SGLN` ticker holding the Mar–May Zero-live gold history +
// its promoted plan, while the canonical `GOLD` ticker (sourced from the Jun-5
// msg 1879 mini-update, which carried no numeric entry/invalidation) showed an
// empty plan. This moves SGLN's events onto GOLD, deletes the duplicate, and
// re-synthesises GOLD across the full history so its plan reflects every read.
//
// Run: node --env-file-if-exists=.env lives/merge-sgln-into-gold.mjs
import { query } from '../server/db.js'
import { recomputeRollup } from '../server/rollup.js'
import { synthesize } from '../server/synthesize.js'

const show = async (label) => {
  const t = (await query(`SELECT symbol, status, commodity_key, commodity_vehicle, entry_zone,
      targets, invalidation, (synthesis IS NOT NULL) has_synth FROM tickers WHERE symbol=ANY($1)`,
    [['GOLD', 'SGLN']])).rows
  const ev = (await query(`SELECT ticker, count(*) n FROM events WHERE ticker=ANY($1) GROUP BY ticker`,
    [['GOLD', 'SGLN']])).rows
  console.log(`\n== ${label} ==`)
  for (const r of t) console.log('  ticker', JSON.stringify(r))
  for (const r of ev) console.log('  events', r.ticker, r.n)
}

await show('BEFORE')

// 1) Move SGLN's events onto GOLD. Dedup keys carry a `:SGLN` suffix so there is
//    no collision with GOLD's own (zero_live:1879:3) events.
const moved = await query(`UPDATE events SET ticker='GOLD' WHERE ticker='SGLN'`)
console.log(`\nmoved ${moved.rowCount} event(s) SGLN → GOLD`)

// 2) Make sure GOLD owns the vehicle key (it already does, but be explicit/idempotent).
await query(`UPDATE tickers SET commodity_key='gold',
   commodity_vehicle=COALESCE(commodity_vehicle,'SGLN'), updated_at=now() WHERE symbol='GOLD'`)

// 3) Delete the duplicate ticker (no other table references SGLN).
const del = await query(`DELETE FROM tickers WHERE symbol='SGLN'`)
console.log(`deleted ${del.rowCount} duplicate ticker(s)`)

// 4) Rebuild GOLD's rollup, then re-synthesise across the full merged history.
await recomputeRollup('GOLD')
console.log('\nre-synthesising GOLD (spawns Claude CLI)…')
const out = await synthesize('GOLD', { force: true })
console.log('synthesis verdict:', out?.verdict ?? '(see below)')

const sp = (await query(`SELECT synthesis->'safest_plan' sp FROM tickers WHERE symbol='GOLD'`)).rows[0]?.sp
console.log('GOLD safest_plan:', JSON.stringify(sp))

await show('AFTER')
process.exit(0)
