// satellite-model.js — the nested satellite math. Theme is the only capital
// axis; the tier pyramid is DERIVED from per-theme tier-exposures, so the
// displayed pyramid can never disagree with where capital actually sits.
export const THEMES = ['tech', 'em', 'commodities', 'niche', 'crypto']

export const THEME_TIER_EXPOSURE = {
  commodities: { defensive: 0.40, lower: 0.60 },
  em:          { moderate: 1 },
  tech:        { moderate: 0.80, high: 0.20 },
  niche:       { high: 1 },
  crypto:      { high: 1 },
}

export const REGIME_TIER_PRESETS = {
  expansion:  { high: 0.20, moderate: 0.45, lower: 0.25, defensive: 0.10 },
  late_cycle: { high: 0.08, moderate: 0.32, lower: 0.40, defensive: 0.20 },
  defense:    { high: 0.03, moderate: 0.22, lower: 0.45, defensive: 0.30 },
}

export const DEFAULT_THEME_SPLITS = { tech: 0.30, em: 0.20, commodities: 0.20, niche: 0.15, crypto: 0.15 }
export const DEFAULT_TIER_TARGETS = { high: 0.10, moderate: 0.30, lower: 0.40, defensive: 0.20 }

export const CORE_TYPES = ['world', 'us', 'quality_income']
export const DEFAULT_CORE_TYPE_SPLITS = normalise({ world: 40, us: 15, quality_income: 15 })

const TILT_STRENGTH = 0.35

export function normalise(obj = {}) {
  const out = {}
  let total = 0
  for (const [k, v] of Object.entries(obj)) { const n = Math.max(0, Number(v) || 0); out[k] = n; total += n }
  if (total <= 0) return {}
  for (const k of Object.keys(out)) out[k] /= total
  return out
}

export function derivePyramid(themeWeights = {}) {
  const tiers = { high: 0, moderate: 0, lower: 0, defensive: 0 }
  for (const [theme, w] of Object.entries(themeWeights)) {
    const exp = THEME_TIER_EXPOSURE[theme]
    if (!exp) continue
    for (const [tier, frac] of Object.entries(exp)) tiers[tier] += (Number(w) || 0) * frac
  }
  return tiers
}

export function regimeAim(regime, tierTargets = DEFAULT_TIER_TARGETS) {
  const preset = REGIME_TIER_PRESETS[regime]
  if (!preset) return { ...tierTargets }
  const out = {}
  for (const tier of ['high', 'moderate', 'lower', 'defensive']) {
    out[tier] = (1 - TILT_STRENGTH) * (Number(tierTargets[tier]) || 0) + TILT_STRENGTH * preset[tier]
  }
  return out
}

function affinity(theme, aim) {
  const exp = THEME_TIER_EXPOSURE[theme] || {}
  let a = 0
  for (const [tier, frac] of Object.entries(exp)) a += frac * (Number(aim[tier]) || 0)
  return a
}

export function tiltThemeWeights(baseThemeSplits = {}, aim = DEFAULT_TIER_TARGETS) {
  const scored = {}
  for (const [theme, w] of Object.entries(baseThemeSplits)) scored[theme] = (Number(w) || 0) * affinity(theme, aim)
  return normalise(scored)
}
