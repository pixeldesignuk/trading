// allocate.js — 4-bucket nested reconciliation. Theme is the only satellite
// capital axis; the tier pyramid is derived (see satellite-model.js). Picks
// (trade-layer) are NOT allocated here — picks-model.js owns their sizing.
import { classify, TIER_CEILING } from './classify.js'
import { tiltThemeWeights, regimeAim, derivePyramid, THEMES, normalise } from './satellite-model.js'
import { topRR } from './plan-math.js'

// Conviction score to split a bucket/theme budget across its members.
export function rawScore(ticker) {
  const { pyramidTier } = classify(ticker)
  const ceiling = TIER_CEILING[pyramidTier] ?? 0.06
  const grade = ticker?.top_grade ?? 5
  const rr = topRR(ticker)
  const tilt = rr == null ? 1 : Math.max(0.85, Math.min(1.15, 0.85 + (rr - 2) * 0.1))
  return ceiling * Math.max(0, Math.min(1, grade / 10)) * tilt
}

// Flat score for core ETFs: equal-weight (pins handled separately).
function corePinOrEqual() { return 1 }

// Effective per-theme capital weight (fraction of PORTFOLIO), tilted by regime.
export function effectiveThemeWeights(targets, regime) {
  const aim = regimeAim(regime, targets?.satellite_tier_targets)
  const tilted = tiltThemeWeights(targets?.satellite_theme_splits || {}, aim) // sums to 1 within satellite
  const sat = Number(targets?.satellite_pct ?? 0)
  const out = {}
  for (const [theme, w] of Object.entries(tilted)) out[theme] = w * sat
  return out
}

// Absolute portfolio weight for each core sub-type: core_pct × core_type_splits[type].
export function coreTypeBudgets(targets) {
  const corePct = Number(targets?.core_pct ?? 0)
  const splits = targets?.core_type_splits ?? {}
  const out = {}
  for (const [type, frac] of Object.entries(splits)) out[type] = corePct * Number(frac)
  return out
}

export function derivedPyramidFor(targets, regime) {
  const w = effectiveThemeWeights(targets, regime)
  const sat = Number(targets?.satellite_pct ?? 0) || 1
  const within = {}
  for (const [theme, cap] of Object.entries(w)) within[theme] = cap / sat
  return derivePyramid(within)
}

// Neutral pyramid: raw theme splits with NO regime/reference tilt.
export function neutralPyramid(targets) {
  return derivePyramid(normalise(targets?.satellite_theme_splits || {}))
}

// Generalised sub-type budget splitter used by both satellites (by theme) and
// core (by core_type). subtypeBudgets is {subtype: absolutePortfolioWeight}.
// subOf(member) → the member's sub-type key (or null/undefined for unknown).
// scoreFn(member) → conviction weight (use rawScore for satellites, corePinOrEqual for core).
// Returns Map<symbol, {targetPct, pinned, score, needsType?}> — callers spread their
// bucket-specific meta (bucket, theme/coreType, tier) on top.
export function splitBucketBySubtype(members, subtypeBudgets, subOf, scoreFn) {
  const out = new Map()
  // Group members by their sub-type key.
  const bySubtype = new Map()
  for (const t of members) {
    const key = subOf(t)
    if (key != null && key in subtypeBudgets) {
      if (!bySubtype.has(key)) bySubtype.set(key, [])
      bySubtype.get(key).push(t)
    } else {
      // Sub-type unknown or not covered → zero capital, flag for UI.
      out.set(t.symbol, { targetPct: 0, pinned: false, score: scoreFn(t), needsType: true })
    }
  }
  // For each known sub-type, split its budget: pinned members first, then score-weighted remainder.
  for (const [subtype, group] of bySubtype) {
    const budget = Number(subtypeBudgets[subtype] ?? 0)
    const pinned = group.filter((t) => t.target_pin != null)
    const unpinned = group.filter((t) => t.target_pin == null)
    // Assign pinned members their explicit target_pin values.
    let usedByPins = 0
    for (const t of pinned) {
      const p = Number(t.target_pin)
      out.set(t.symbol, { targetPct: p, pinned: true, score: scoreFn(t) })
      usedByPins += p
    }
    // Remaining budget split among unpinned members by score share.
    const remainder = Math.max(0, budget - usedByPins)
    const totalScore = unpinned.reduce((s, t) => s + scoreFn(t), 0)
    for (const t of unpinned) {
      const share = totalScore > 0 ? scoreFn(t) / totalScore : (unpinned.length ? 1 / unpinned.length : 0)
      out.set(t.symbol, { targetPct: remainder * share, pinned: false, score: scoreFn(t) })
    }
  }
  return out
}

// holdings: hold-layer universe for one book. Returns Map<symbol, {bucket,theme?,coreType?,tier,targetPct,pinned,score,needsType?,needsTheme?}>.
export function allocateTargets(holdings, targets, { regime } = {}) {
  const out = new Map()
  const coreMembers = [], satMembers = []
  for (const t of holdings) {
    const c = classify(t)
    if (c.bucket === 'core') coreMembers.push(t)
    else if (c.bucket === 'satellite') satMembers.push(t)
    // picks (trade) and cash: skipped here
  }

  // Satellites: each theme's effective capital, split across its holds.
  const satResult = splitBucketBySubtype(
    satMembers,
    effectiveThemeWeights(targets, regime),
    (t) => classify(t).theme,
    rawScore,
  )
  for (const [sym, row] of satResult) {
    const t = satMembers.find((m) => m.symbol === sym)
    const tier = classify(t).pyramidTier
    const theme = classify(t).theme
    if (row.needsType) {
      // Unthemed satellite: mirror the legacy needsTheme field for UI/test compatibility.
      out.set(sym, { bucket: 'satellite', theme: null, tier, ...row, needsTheme: true, needsType: undefined })
    } else {
      out.set(sym, { bucket: 'satellite', theme, tier, ...row, needsTheme: false })
    }
  }

  // Core: split each core sub-type's budget across its holds (equal-weight, pins first).
  const coreResult = splitBucketBySubtype(
    coreMembers,
    coreTypeBudgets(targets),
    (t) => classify(t).coreType,
    corePinOrEqual,
  )
  for (const [sym, row] of coreResult) {
    const t = coreMembers.find((m) => m.symbol === sym)
    const tier = classify(t).pyramidTier
    const coreType = classify(t).coreType
    if (row.needsType) {
      out.set(sym, { bucket: 'core', coreType: null, theme: null, tier, ...row })
    } else {
      out.set(sym, { bucket: 'core', coreType, theme: null, tier, ...row, needsType: undefined })
    }
  }

  return out
}
