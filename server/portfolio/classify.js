import { entryPrice, stopPrice } from './plan-math.js'

export const TIER_CEILING = { high: 0.10, moderate: 0.06, lower: 0.20, defensive: 0.30 }

// Pyramid tier from sector + market cap (Zero masterclass): defensive sectors
// (utilities/healthcare/staples) anchor the base; otherwise size-by-cap —
// micro/small = High, mid = Moderate, large = Lower. Unknown → Moderate.
export function tierFrom({ sector, market_cap } = {}) {
  const sec = String(sector || '').toLowerCase()
  if (sec.includes('utilit') || sec.includes('health')) return 'defensive'
  if (sec.includes('staple') || sec.includes('consumer defensive')) return 'lower'
  const cap = Number(market_cap) || 0
  if (cap > 0 && cap < 2e9) return 'high'        // micro / small cap
  if (cap >= 2e9 && cap < 1e10) return 'moderate' // mid cap
  if (cap >= 1e10) return 'lower'                 // large cap
  return 'moderate'                               // unknown
}

// Dominant pyramid tier per satellite theme (the majority tier of THEME_TIER_EXPOSURE):
// tech/EM sit at moderate, commodities anchor the lower base, niche/crypto are high.
// A themed satellite ETF takes its theme's tier — market-cap tiering is for individual
// stock picks, not for a broad themed fund (an EM ETF is not a high-risk microcap).
const THEME_TIER = { tech: 'moderate', em: 'moderate', commodities: 'lower', niche: 'high', crypto: 'high' }

// Layer: ETF/fund and long-term holds → Hold; a stock carrying a structure
// stop + entry (an active setup) → Trade. The setup can come from the manual plan
// columns (legacy truthy heuristic) OR a synthesised safest_plan that resolves to a
// usable numeric stop below entry — so a freshly-synthesised pick auto-shows Trade
// mode (R:R + sizing) without a manual toggle. An explicit `layer` still overrides.
// The UNIVERSE decides 'hold': core long-term holdings (and commodities, by default)
// are allocation-sized holds; everything else — satellite picks, crypto, stocks — is a
// trade idea. A concrete setup (manual plan or synthesised stop<entry) is always a trade.
function defaultLayer(ticker) {
  const ac = String(ticker?.asset_class || '').toLowerCase()
  if (ticker?.role === 'core' || ticker?.core_type) return 'hold'  // core = allocation hold
  if (ticker?.invalidation && ticker?.entry_zone) return 'trade'   // explicit setup
  const entry = entryPrice(ticker), stop = stopPrice(ticker)
  if (entry != null && stop != null && stop < entry) return 'trade'
  if (ac === 'commodity') return 'hold'                            // gold/silver etc. default to allocation
  return 'trade'                                                    // satellite picks / crypto / stocks
}

export function defaultClassification(ticker) {
  const ac = String(ticker?.asset_class || '').toLowerCase()
  if (ac === 'crypto') return { layer: defaultLayer(ticker), role: 'satellite', pyramidTier: 'high' }
  if (ac === 'commodity') return { layer: defaultLayer(ticker), role: 'satellite', pyramidTier: 'lower' }
  return { layer: defaultLayer(ticker), role: 'satellite', pyramidTier: tierFrom(ticker) }
}

// Theme inference: explicit override wins, else from asset class / sector.
export function themeOf(ticker) {
  if (ticker?.satellite_theme) return ticker.satellite_theme
  const ac = String(ticker?.asset_class || '').toLowerCase()
  if (ac === 'crypto') return 'crypto'
  if (ac === 'commodity') return 'commodities'
  const sec = String(ticker?.sector || '').toLowerCase()
  if (sec.includes('tech') || sec.includes('semis') || sec.includes('software')) return 'tech'
  if (sec.includes('emerging')) return 'em'
  if (sec.includes('biotech') || sec.includes('clean') || sec.includes('gaming')) return 'niche'
  return null // unknown satellite theme → caller decides
}

// Bucket: trade-layer → picks; core role → core; otherwise satellite.
// (cash is a notional bucket — held positions are never 'cash'.)
export function bucketOf(ticker) {
  const d = defaultClassification(ticker)
  const layer = ticker?.layer || d.layer
  const role = ticker?.role || d.role
  if (layer === 'trade') return 'picks'
  if (role === 'core') return 'core'
  return 'satellite'
}

export function coreTypeOf(ticker) { return ticker?.core_type || null }

export function classify(ticker) {
  const d = defaultClassification(ticker)
  const layer = ticker?.layer || d.layer
  const role = ticker?.role || d.role
  const bucket = bucketOf(ticker)
  const theme = bucket === 'satellite' ? themeOf(ticker) : null
  return {
    layer, role,
    // explicit override → themed-satellite tier → cap/sector default (picks & untyped stocks)
    pyramidTier: ticker?.pyramid_tier || (theme && THEME_TIER[theme]) || d.pyramidTier,
    bucket,
    theme,
    coreType: bucket === 'core' ? coreTypeOf(ticker) : null,
  }
}
