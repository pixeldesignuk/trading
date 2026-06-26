// trade-model.js
import { entryPrice, stopPrice, targetPrices } from './plan-math.js'

export function tradeModel(ticker, { account, sleeveBudget = Infinity, riskPct = 0.01 } = {}) {
  const entry = entryPrice(ticker)
  const stop = stopPrice(ticker)
  const hasStop = entry != null && stop != null && stop < entry
  const base = { hasStop, stop, entry, stopDist: null, riskAmount: null, positionSize: null, capped: false, rr: null, openRisk: null, targets: [] }
  if (!hasStop) return base

  const stopDist = (entry - stop) / entry
  const riskAmount = account * riskPct
  const rawSize = riskAmount / stopDist
  const positionSize = Math.min(rawSize, sleeveBudget)
  const capped = positionSize < rawSize - 1e-9
  const openRisk = positionSize * stopDist

  const tps = targetPrices(ticker).filter((p) => p > entry)
  const targets = tps.map((p) => ({ price: p, rr: (p - entry) / (entry - stop), profitPct: ((p - entry) / entry) * 100 }))
  const rr = targets.length ? targets[targets.length - 1].rr : null

  return { ...base, stopDist, riskAmount, positionSize, capped, rr, openRisk, targets }
}
