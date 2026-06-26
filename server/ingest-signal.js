import { upsertTicker } from './tickers.js'
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
  const { symbol, name, asset_class, source, kind, occurred_at, native_id, payload } = signal
  if (!symbol || !source) throw new Error('ingestSignal: symbol and source are required')
  const ticker = await upsertTicker(symbol, { name, asset_class })
  await appendEvent({ ticker: symbol, source, kind, occurred_at, native_id, payload })
  await recomputeRollup(symbol)

  let synth_queued = false
  if (ticker.inserted && hasSetupData(payload)) {
    enqueueSynth(symbol)
    synth_queued = true
  }
  return { ok: true, symbol, inserted: Boolean(ticker.inserted), synth_queued }
}
