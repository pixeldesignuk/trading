// plan-math.js
export function parsePrice(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

// The structure levels can live in two places: the manual plan columns
// (entry_zone/invalidation/targets, written by setPlan) OR the AI synthesis
// (synthesis.safest_plan, the universe-model output). Manual columns take
// precedence — a hand edit always wins — and the synthesis fills the gaps so a
// freshly-synthesised ticker still sizes without re-typing its levels.
const safestPlan = (ticker) => ticker?.synthesis?.safest_plan || null

export function entryPrice(ticker) {
  const z = ticker?.entry_zone
  if (z) {
    const nums = String(z).replace(/,/g, '').match(/\d+(\.\d+)?/g)
    if (nums && nums.length) {
      return nums.length === 1 ? Number(nums[0]) : (Number(nums[0]) + Number(nums[1])) / 2
    }
  }
  return parsePrice(safestPlan(ticker)?.entry)
}

export function stopPrice(ticker) {
  return parsePrice(ticker?.invalidation) ?? parsePrice(safestPlan(ticker)?.invalidation)
}

export function targetPrices(ticker) {
  const legacy = Array.isArray(ticker?.targets) ? ticker.targets : []
  const arr = legacy.length ? legacy : (safestPlan(ticker)?.targets || [])
  return arr.map((t) => parsePrice(t?.price)).filter((p) => p != null).sort((a, b) => a - b)
}

export function topRR(ticker) {
  const entry = entryPrice(ticker)
  const stop = stopPrice(ticker)
  const tps = targetPrices(ticker)
  if (entry == null || stop == null || !tps.length || stop >= entry) return null
  return (tps[tps.length - 1] - entry) / (entry - stop)
}
