// hold-model.js
import { classify, TIER_CEILING } from './classify.js'
import { topRR } from './plan-math.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const round = (v, dp) => Number(v.toFixed(dp))

export function holdModel(ticker) {
  const { pyramidTier } = classify(ticker)
  const ceiling = TIER_CEILING[pyramidTier] ?? 0.06
  if (ticker?.target_pin != null) {
    return { targetPct: Number(ticker.target_pin), pinned: true, ceiling, grade: null, rr: null, tier: pyramidTier }
  }
  const grade = ticker?.top_grade ?? 5
  const gradeFrac = clamp(grade / 10, 0, 1)
  const rr = topRR(ticker)
  const rrTilt = rr == null ? 1 : clamp(0.85 + (rr - 2) * 0.1, 0.85, 1.15)
  const targetPct = round(ceiling * gradeFrac * rrTilt, 4)
  return { targetPct, pinned: false, ceiling, grade, rr, tier: pyramidTier }
}
