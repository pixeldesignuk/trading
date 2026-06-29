import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME_TIER_EXPOSURE } from './satellite-model.js'

// Dominant tier of a theme (the tier with the largest exposure share).
function tierForTheme(theme) {
  const exp = THEME_TIER_EXPOSURE[theme]
  if (!exp) return 'moderate'
  return Object.entries(exp).sort((a, b) => b[1] - a[1])[0][0]
}

export function buildMatchMap(universe) {
  const map = new Map()
  for (const [section, list] of Object.entries(universe || {})) {
    if (!Array.isArray(list)) continue
    for (const f of list) {
      if (!f?.symbol || f.symbol === 'CASH') continue
      const isCore = section === 'core' || section === 'income'
      const theme = isCore ? null : (f.theme || (section === 'crypto' ? 'crypto' : 'tech'))
      const entry = isCore
        ? { bucket: 'core', theme: null, tier: 'lower', source: f.symbol,
            coreType: f.core_type || (section === 'income' ? 'quality_income' : 'world'),
            incomeKind: f.income_kind || undefined }
        : { bucket: 'satellite', theme, tier: tierForTheme(theme), source: f.symbol }
      // Exact match key: the hub form of the real T212 ticker (strip at the first
      // underscore, uppercase — mirrors brokerToHubSymbol). Authoritative, and it
      // catches non-London venues the root+L heuristic misses (e.g. the Amsterdam
      // line SKUKa_EQ → SKUKA, which would never match SKUK/SKUKL).
      if (f.t212) {
        const hub = String(f.t212).split('_')[0].toUpperCase()
        if (hub && !map.has(hub)) map.set(hub, entry)
      }
      // Display-symbol fallback (covers entries without a t212 ticker): the bare
      // root plus root+'L' for London (.GB/.L) lines.
      const root = String(f.symbol).toUpperCase().replace(/[^A-Z0-9].*$/, '')
      if (!root) continue
      for (const key of [root, root + 'L']) if (!map.has(key)) map.set(key, entry)
    }
  }
  return map
}

export function matchHeldSymbol(hubSymbol, map) {
  if (!hubSymbol || !map) return null
  return map.get(String(hubSymbol).toUpperCase()) || null
}

let _cached = null
export function fundMatchMap() {
  if (_cached) return _cached
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const file = path.join(dir, '..', 'reference', 'fund-universe.json')
    _cached = buildMatchMap(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch { _cached = new Map() }
  return _cached
}
