import { numericPlan } from '../price-plan.js'

// Resolve a ticker's numeric alert plan. The skeptical-editor's
// synthesis.safest_plan is the conflict-aware VERDICT (it already weighed the
// ladder, charts and source disagreements), so it wins per-field; the raw
// ladder/targets/invalidation columns only fill what synthesis leaves empty. Its
// point entry is widened to a ±pointBand band so `in_buy` can trigger. Returns
// null when the ticker has no usable numeric levels at all → not armed.
export function resolvePlan(ticker = {}, { pointBand = 0.01 } = {}) {
  const structured = numericPlan(ticker)
  const sp = ticker.synthesis?.safest_plan || null
  const synEntry = typeof sp?.entry === 'number' ? sp.entry : null
  const synTargets = Array.isArray(sp?.targets)
    ? sp.targets.map((t) => (typeof t?.price === 'number' ? t.price : null)).filter((n) => n != null)
    : []
  const synInval = typeof sp?.invalidation === 'number' ? sp.invalidation : null

  // buyLow/buyHigh are the TRIGGER band (used by priceVsPlan to detect in_buy).
  // entryLow/entryHigh are the real plan entry for DISPLAY — a synthesis point
  // entry stays a point here rather than being shown as a fake ±band zone.
  let buyLow, buyHigh, entryLow, entryHigh
  if (synEntry != null) {
    buyLow = synEntry * (1 - pointBand)
    buyHigh = synEntry * (1 + pointBand)
    entryLow = entryHigh = synEntry
  } else {
    buyLow = entryLow = structured.buyLow
    buyHigh = entryHigh = structured.buyHigh
  }
  const targets = synTargets.length ? synTargets : structured.targets
  const invalidation = synInval != null ? synInval : structured.invalidation

  if (buyLow == null && targets.length === 0 && invalidation == null) return null
  return { buyLow, buyHigh, entryLow, entryHigh, targets, invalidation }
}
