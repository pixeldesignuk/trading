// Macro rotation engine (Zero masterclass "Big 6" + rotation strategy).
// Reads the relative trend of three S&P sector-ETF ratios to infer where in the
// cycle we are, and which pyramid tiers to favour. Pure — closes are passed in.
//
//   XLY/XLP — consumer strength vs defense
//   XLK/XLU — growth vs safety
//   XLF/XLV — cyclical vs defensive
//
// All three rising → risk-on expansion (money bottom→top of the pyramid).
// All three falling → defensive rotation (capital to the base).
// Mixed → late-cycle / fragile (be selective, favour quality).

import { regimeAim, REGIME_TIER_PRESETS } from './satellite-model.js'
export { REGIME_TIER_PRESETS }
export const aimForRegime = (regime, tierTargets) => regimeAim(regime, tierTargets)

export const BIG6 = ['XLY', 'XLP', 'XLK', 'XLU', 'XLF', 'XLV']
export const RATIOS = [
  { name: 'XLY/XLP', num: 'XLY', den: 'XLP', gauges: 'consumer strength vs defense' },
  { name: 'XLK/XLU', num: 'XLK', den: 'XLU', gauges: 'growth vs safety' },
  { name: 'XLF/XLV', num: 'XLF', den: 'XLV', gauges: 'cyclical vs defensive' },
]

function ratioTrend(a, b, lookback) {
  if (!a?.length || !b?.length || a.length < lookback + 1 || b.length < lookback + 1) {
    return { value: null, prior: null, changePct: null, trend: 'unknown' }
  }
  const cur = a[a.length - 1] / b[b.length - 1]
  const prior = a[a.length - 1 - lookback] / b[b.length - 1 - lookback]
  const changePct = prior ? ((cur - prior) / prior) * 100 : null
  const trend = changePct == null ? 'unknown' : changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'flat'
  return { value: cur, prior, changePct, trend }
}

// closesBySymbol: { XLY: [oldest…newest closes], … }. lookback in trading days.
export function computeRotation(closesBySymbol, { lookback = 20 } = {}) {
  const ratios = RATIOS.map((r) => ({ ...r, ...ratioTrend(closesBySymbol[r.num], closesBySymbol[r.den], lookback) }))
  const known = ratios.filter((r) => r.trend !== 'unknown')
  const ups = ratios.filter((r) => r.trend === 'up').length

  let regime, label, favorTiers, direction
  if (!known.length) {
    regime = 'unknown'; label = 'No signal'; favorTiers = []; direction = 'sector data unavailable'
  } else if (ups >= 3) {
    regime = 'expansion'; label = 'Expansion ↑'; favorTiers = ['moderate', 'high']
    direction = 'risk-on — money flows bottom→top (staples→discretionary)'
  } else if (ups === 0) {
    regime = 'defense'; label = 'Defensive ↓'; favorTiers = ['defensive', 'lower']
    direction = 'risk-off — capital rotating to the base (staples/utilities/cash)'
  } else {
    regime = 'late_cycle'; label = 'Late cycle / mixed'; favorTiers = ['lower', 'moderate']
    direction = 'fragile — be selective, favour quality'
  }
  return { regime, label, favorTiers, direction, ups, ratios }
}
