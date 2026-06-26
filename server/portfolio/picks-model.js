// picks-model.js — sizes the active picks book under TWO caps: a capital cap
// (% of book notional) and a risk cap (% of book lost-at-stop). Each candidate
// takes min(riskBasedSize, capitalRemaining); held over-cap positions suggest a
// trim. Deterministic order so results are stable/testable.
import { tradeModel } from './trade-model.js'
import { topRR } from './plan-math.js'

const orderKey = (t) => [-(Number(t.top_grade) || 0), -(topRR(t) || 0), t.symbol]
function byPriority(a, b) {
  const ka = orderKey(a), kb = orderKey(b)
  for (let i = 0; i < ka.length; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1 }
  return 0
}

export function sizePicks(trades, { bookValue = 0, picksPct = 0.12, riskCapPct = 0.02 } = {}) {
  const capitalCap = bookValue * picksPct
  const riskCap = bookValue * riskCapPct
  let capRemain = capitalCap, riskRemain = riskCap
  const sorted = [...trades].sort(byPriority)
  const out = []
  for (const t of sorted) {
    const currentVal = Number(t.value || 0)
    const currentPct = bookValue ? currentVal / bookValue : 0
    const tm = tradeModel(t, { account: bookValue, sleeveBudget: capRemain, riskPct: riskCapPct })
    const needsLevels = !tm.hasStop
    const overCap = currentVal > capitalCap + 1e-9

    let suggestedVal
    if (overCap || capRemain <= 0) suggestedVal = 0
    else if (needsLevels) suggestedVal = Math.max(0, capRemain)            // capital-only fallback
    else {
      const riskSize = riskRemain > 0 ? riskRemain / tm.stopDist : 0       // notional that risks riskRemain
      suggestedVal = Math.max(0, Math.min(riskSize, capRemain))
      riskRemain -= suggestedVal * tm.stopDist
    }
    capRemain -= Math.max(currentVal, suggestedVal)                        // existing positions consume the cap too
    out.push({
      symbol: t.symbol, currentPct, suggestedPct: bookValue ? suggestedVal / bookValue : 0,
      rr: tm.rr, openRisk: tm.openRisk, needsLevels, overCap,
    })
  }
  return out
}
