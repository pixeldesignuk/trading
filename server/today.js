import { numericPlan, priceVsPlan } from './price-plan.js'

export function buildToday(tickers = [], quotes = {}) {
  const withState = tickers.map((t) => ({
    ...t,
    price: quotes[t.symbol] ?? null,
    state: priceVsPlan(quotes[t.symbol] ?? null, numericPlan(t)),
  }))
  const held = withState.filter((t) => t.status === 'watching' || t.status === 'in')
  return {
    newIdeas: withState
      .filter((t) => t.status === 'new' && t.sharia_status === 'compliant')
      .sort((a, b) => (b.top_grade ?? -1) - (a.top_grade ?? -1)),
    enteredBuyZone: held.filter((t) => t.state === 'in_buy'),
    needsAttention: held.filter((t) => t.state === 'near_target' || t.state === 'past_invalidation'),
  }
}
