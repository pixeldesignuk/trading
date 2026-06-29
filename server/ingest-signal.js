import { upsertTicker, setCommodityKey, setVehicle } from './tickers.js'
import { vehicleToCommodity, getCommodity } from './commodities.js'
import { appendEvent } from './events.js'
import { recomputeRollup } from './rollup.js'
import { enqueueSynth } from './synth-queue.js'

// Does this event carry enough of a setup to be worth auto-synthesizing? A bare
// community idea ("someone floated WATER") has only a note/text — synthesizing
// that produces garbage. We only auto-synth tickers that arrive with real plan
// material: an entry, targets, or a grade.
function hasSetupData(payload = {}) {
  return Boolean(
    payload.entry ||
    (Array.isArray(payload.targets) && payload.targets.length) ||
    payload.grade_score != null ||
    payload.invalidation,
  )
}

// The single entry point every feeder calls. Creates/updates the ticker spine,
// appends the source event (deduped), then recomputes the ticker rollup. When a
// BRAND-NEW ticker arrives with setup data, it's queued for background AI
// synthesis (serial, non-blocking — see synth-queue.js).
export async function ingestSignal(signal) {
  let { symbol, name, asset_class } = signal
  const { source, kind, occurred_at, native_id, payload } = signal
  if (!symbol || !source) throw new Error('ingestSignal: symbol and source are required')
  // Vehicle-code guard: if a feeder labelled a commodity setup with its ETC code
  // (e.g. gold as "SGLN"), remap onto the canonical commodity ticker so we never
  // mint a duplicate vehicle ticker. The commodity reference owns the label.
  const remap = vehicleToCommodity(symbol)
  if (remap) {
    symbol = remap.symbol
    asset_class = 'commodity'
    name = getCommodity(remap.key)?.label || name
  }
  const ticker = await upsertTicker(symbol, { name, asset_class })
  // Use the CANONICAL symbol (upsertTicker may rewrite e.g. ETH.D→ETH-D, BRK.B→BRK-B)
  // for the event + rollup, else the events.ticker FK won't match the tickers row.
  const canon = ticker.symbol
  if (remap) {
    await setCommodityKey(canon, remap.key)
    // Lock the read's vehicle only when none is set — never override a user lock.
    if (!ticker.commodity_vehicle) await setVehicle(canon, remap.vehicle)
  }
  await appendEvent({ ticker: canon, source, kind, occurred_at, native_id, payload })
  await recomputeRollup(canon)

  let synth_queued = false
  if (ticker.inserted && hasSetupData(payload)) {
    enqueueSynth(canon)
    synth_queued = true
  }
  return { ok: true, symbol: canon, inserted: Boolean(ticker.inserted), synth_queued }
}
