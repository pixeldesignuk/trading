// Parse the first number out of a string/number (e.g. "<$30 weekly" -> 30).
function firstNum(v) {
  if (typeof v === 'number') return v
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

export function numericPlan(ticker = {}) {
  const ladder = (ticker.ladder || []).map((l) => firstNum(l.price)).filter((n) => n != null)
  const targets = (ticker.targets || []).map((t) => firstNum(t.price)).filter((n) => n != null)
  return {
    buyLow: ladder.length ? Math.min(...ladder) : null,
    buyHigh: ladder.length ? Math.max(...ladder) : null,
    targets,
    invalidation: firstNum(ticker.invalidation),
  }
}

export const NEAR = 0.05 // within 5% of a target counts as "near"

export function priceVsPlan(price, plan = {}, near = NEAR) {
  if (price == null) return 'no_price'
  const hasPlan = plan.buyLow != null || (plan.targets && plan.targets.length) || plan.invalidation != null
  if (!hasPlan) return 'no_plan'
  if (plan.invalidation != null && price < plan.invalidation) return 'past_invalidation'
  if (plan.buyLow != null && plan.buyHigh != null) {
    if (price < plan.buyLow) return 'below_buy'
    if (price <= plan.buyHigh) return 'in_buy'
  }
  for (const t of plan.targets || []) {
    if (t !== 0 && Math.abs(price - t) / t <= near) return 'near_target'
  }
  return 'drifting'
}
