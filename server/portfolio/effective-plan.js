import { numericPlan } from '../price-plan.js'

// The plan that actually governs price-vs-plan state: confirmed manual levels win;
// otherwise a synthesised safest_plan stands in as a candidate. Returns the
// numericPlan shape ({ buyLow, buyHigh, targets, invalidation, source }) or null.
// Pure (no node deps) so the client can import it and compute state identically
// to the server — one source of truth for trade state across chat, scan and UI.
export function effectivePlan(ticker) {
  const np = numericPlan(ticker)
  const hasManual = np && (np.buyLow != null || np.buyHigh != null || np.invalidation != null || (np.targets || []).length)
  if (hasManual) return { ...np, source: 'confirmed' }
  const sp = ticker?.synthesis?.safest_plan
  if (sp && sp.entry != null) {
    return {
      buyLow: sp.entry, buyHigh: sp.entry,
      targets: (sp.targets || []).map((t) => (t && typeof t === 'object' ? t.price : t)).filter((x) => x != null),
      invalidation: sp.invalidation ?? null,
      source: 'synthesis_candidate',
    }
  }
  return np ? { ...np, source: 'confirmed' } : null
}
