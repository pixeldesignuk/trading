// alloc-summary.js — compact text summary of the allocation ledger for the
// Portfolio desk chat. The chat scope previously got only a per-ticker roster, so
// the agent had no idea of the bucket/theme/pyramid structure (it answered hold
// sizing with a generic stop-based % of capital). This serialises the SAME numbers
// the Allocation UI shows (AllocationLedger.jsx) so the agent sizes holds/satellites
// by their actual room, not a guess.
//
// Rollup semantics mirror the UI exactly:
//   bucket current% = sum of its held rows' currentPct  (cash = dry powder)
//   bucket target%  = the L1 bucket target              (NOT the sum of row targets)
//   pyramid held%   = a tier's held / the satellite target  (% of the satellite sleeve)
//   theme target%   = effectiveThemeWeights              (fraction of the whole book)
import { effectiveThemeWeights } from './allocate.js'
import { THEMES } from './satellite-model.js'

const pct0 = (f) => (f == null || !Number.isFinite(f)) ? '—' : `${Math.round(f * 100)}%`
const gbp = (n) => (n == null || !Number.isFinite(n)) ? '—' : `£${Math.round(n).toLocaleString('en-GB')}`
const sign1 = (n) => (n == null || !Number.isFinite(n)) ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}`

// [ledger bucket key, targets %-field, label, one-line how-it's-sized note]
const BUCKETS = [
  ['core', 'core_pct', 'Core', 'long-term base (world / US / quality-income ETFs) — sized by allocation'],
  ['satellite', 'satellite_pct', 'Satellites', 'thematic ETF boosters — sized by theme budget, NOT by a stop'],
  ['picks', 'picks_pct', 'Picks', 'active trade book — sized by risk ÷ stop, capped'],
  ['cash', 'cash_pct', 'Cash', 'dry powder'],
]

// memo: { led, targets, regime, favorTiers?, benchmark?, bookReturnPct? } as built
// by chat.js#bookLedger. Returns a markdown block, or '' if the ledger is absent.
export function formatAllocation(memo) {
  if (!memo?.led || !memo?.targets) return ''
  const { led, targets, regime, benchmark, bookReturnPct, favorTiers } = memo
  const bv = led.bookValue || 0
  const rows = led.rows || []
  const L = ['# ALLOCATION (book-wide — your ACTUAL structure; size holds & satellites from THIS room, not a generic % of capital)']
  L.push(`Book ${gbp(bv)} · deployed ${pct0(led.deployedPct)} · dry powder ${pct0(led.dryPowderPct)} · regime ${regime || 'unknown'}${favorTiers?.length ? ` (favour ${favorTiers.join('/')})` : ''}.`)
  if (benchmark) {
    L.push(`Open risk ${gbp(led.openRisk)}${bv ? ` (${pct0(led.openRisk / bv)} of book)` : ''} · benchmark ${benchmark.label || '?'} ${benchmark.return1y != null ? sign1(benchmark.return1y * 100) + '% 1y' : 'n/a'} · book ${bookReturnPct != null ? sign1(bookReturnPct * 100) + '%' : 'n/a'}.`)
  }

  // Buckets: held vs target with £ room to target.
  L.push('\n## Buckets (held / target · room to target)')
  for (const [key, tgtKey, label, note] of BUCKETS) {
    const cur = key === 'cash'
      ? (led.dryPowderPct ?? 0)
      : rows.filter((r) => r.bucket === key).reduce((s, r) => s + (r.currentPct || 0), 0)
    const tgt = Number(targets[tgtKey] ?? 0)
    const room = (tgt - cur) * bv
    const roomStr = key === 'cash' ? '' : ` · ${room >= 0 ? `room +${gbp(room)}` : `over ${gbp(-room)}`}`
    L.push(`- ${label}: ${pct0(cur)} (${gbp(cur * bv)}) / ${pct0(tgt)} tgt (${gbp(tgt * bv)})${roomStr} — ${note}`)
  }

  const satTgt = Number(targets.satellite_pct ?? 0)
  const satRows = rows.filter((r) => r.bucket === 'satellite')

  // Satellite pyramid — held vs target as a fraction of the satellite sleeve.
  if (led.pyramid?.effective && satTgt > 0) {
    const heldByTier = {}
    for (const r of satRows) if ((r.currentPct || 0) > 0 && r.tier) heldByTier[r.tier] = (heldByTier[r.tier] || 0) + r.currentPct
    L.push('\n## Satellite pyramid (held / target, as % of the satellite sleeve — tilted by regime)')
    for (const t of ['high', 'moderate', 'lower', 'defensive']) {
      L.push(`- ${t}: ${pct0((heldByTier[t] || 0) / satTgt)} / ${pct0(led.pyramid.effective[t] || 0)}`)
    }
  }

  // Satellite themes — held vs target as % of the whole book, with £ room. This is
  // where a metal sizing question gets its real answer.
  const themeW = effectiveThemeWeights(targets, regime)
  const heldByTheme = {}
  for (const r of satRows) if ((r.currentPct || 0) > 0 && r.theme) heldByTheme[r.theme] = (heldByTheme[r.theme] || 0) + r.currentPct
  L.push('\n## Satellite themes (held / target as % of whole book · £ room). A spot metal — gold, silver, palladium — belongs to the COMMODITIES theme: size it from this theme room, split across the names you want, NOT each at a full trade risk.')
  for (const th of THEMES) {
    const tgt = themeW[th] || 0
    const held = heldByTheme[th] || 0
    const room = (tgt - held) * bv
    L.push(`- ${th}: ${pct0(held)} held / ${pct0(tgt)} tgt · ${room >= 0 ? `room ${gbp(room)}` : `over ${gbp(-room)}`}`)
  }

  const thin = (led.coreCoverage || []).filter((c) => c.needsBuy).map((c) => c.coreType)
  if (thin.length) L.push(`\nCore sub-sleeves still thin (need buying): ${thin.join(', ')}.`)

  return L.join('\n')
}
