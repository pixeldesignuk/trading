import React, { useMemo } from 'react'

// Shared ticker list — the quant-terminal row (identity + plan rail + data
// cluster) used by both the Tickers tab and the Portfolio tab so they match.

const num = (v) => {
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

// When the skeptical editor has run, ITS safest plan governs the row — same
// override as the detail page, so the list reflects the synthesized plan and
// not the (often empty) raw single-source levels.
function effectivePlan(t) {
  const sp = t.synthesis?.safest_plan
  if (!sp) return t
  return {
    ...t,
    entry_zone: sp.entry != null ? String(sp.entry) : null,
    ladder: sp.entry != null ? [{ price: sp.entry }] : [],
    targets: (sp.targets || []).filter((x) => x?.price != null).map((x) => ({ price: x.price })),
    invalidation: sp.invalidation != null ? String(sp.invalidation) : null,
  }
}

export function planView(rawT, price) {
  const t = effectivePlan(rawT)
  const ladder = (t.ladder || []).map((l) => num(l.price)).filter((n) => n != null)
  const targets = (t.targets || []).map((x) => num(x.price)).filter((n) => n != null)
  const buyLo = ladder.length ? Math.min(...ladder) : num(t.entry_zone)
  const buyHi = ladder.length ? Math.max(...ladder) : num(t.entry_zone)
  const target = targets.length ? Math.max(...targets) : null
  const inval = num(t.invalidation)

  if (price == null) return { state: 'no_price' }
  if (buyLo == null && target == null) return { state: 'no_plan' }

  let state = 'drifting'
  if (inval != null && price < inval) state = 'past_invalidation'
  else if (buyLo != null && buyHi != null && price >= buyLo && price <= buyHi) state = 'in_buy'
  else if (target != null && Math.abs(price - target) / target <= 0.05) state = 'near_target'
  else if (buyLo != null && price < buyLo) state = 'below_buy'

  const pts = [inval, buyLo, buyHi, target, price].filter((n) => n != null)
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const span = hi - lo || 1
  const pct = (v) => (v == null ? null : Math.max(0, Math.min(100, ((v - lo) / span) * 100)))
  return {
    state, pricePct: pct(price), buyLoPct: pct(buyLo), buyHiPct: pct(buyHi),
    targetPct: pct(target), invalPct: pct(inval),
  }
}

export const STATE = {
  in_buy:            { label: 'In buy zone', dot: '#34d399', live: true },
  below_buy:         { label: 'Below buy',   dot: '#38bdf8', live: false },
  near_target:       { label: 'Near TP',     dot: '#fbbf24', live: true },
  past_invalidation: { label: 'Invalidated', dot: '#f87171', live: true },
  drifting:          { label: 'Mid-range',   dot: '#a1a1aa', live: false },
  no_plan:           { label: 'No plan',     dot: '#52525b', live: false },
  no_price:          { label: 'No price',    dot: '#52525b', live: false },
}
const ORDER = { in_buy: 0, near_target: 1, past_invalidation: 2, below_buy: 3, drifting: 4, no_plan: 5, no_price: 6 }

const ASSET = { stock: '#38bdf8', crypto: '#a78bfa', commodity: '#fbbf24' }
const assetType = (t) => {
  const k = String(t.asset_class || '').toLowerCase()
  return ASSET[k] ? k : 'other'
}

// Subtle, text-free asset glyph: stock = bars, crypto = hexagon, commodity = layers.
function AssetIcon({ type }) {
  const color = ASSET[type] || '#52525b'
  const p = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { opacity: 0.65, flexShrink: 0 } }
  if (type === 'crypto') return <svg {...p}><path d="M12 3l7 4.5v9L12 21l-7-4.5v-9z" /></svg>
  if (type === 'commodity') return <svg {...p}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>
  if (type === 'stock') return <svg {...p}><path d="M3 20h18M6 20V13M12 20V5M18 20V10" /></svg>
  return null
}

const SHARIA = {
  compliant:     { label: 'Compliant',    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  questionable:  { label: 'Questionable', chip: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  inconclusive:  { label: 'Inconclusive', chip: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  non_compliant: { label: 'Avoid',        chip: 'border-red-500/30 bg-red-500/10 text-red-300' },
  unknown:       { label: 'Unscreened',   chip: 'border-zinc-700 bg-zinc-800/40 text-zinc-500' },
}
const shariaOf = (s) => SHARIA[s] || SHARIA.unknown

const gradeColor = (g) => (g == null ? '#52525b' : g >= 7 ? '#34d399' : g >= 5 ? '#fbbf24' : '#f87171')
const fmtPrice = (p) => (p == null ? '—' : p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toPrecision(3))

// ---- the plan rail -------------------------------------------------------
export function Rail({ v }) {
  const dot = STATE[v.state].dot
  return (
    <div className="relative h-5 w-full">
      <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded bg-zinc-800" />
      {v.buyLoPct != null && v.buyHiPct != null && (
        <div className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-sm bg-emerald-500/25"
          style={{ left: `${Math.min(v.buyLoPct, v.buyHiPct)}%`, width: `${Math.max(2, Math.abs(v.buyHiPct - v.buyLoPct))}%` }} />
      )}
      {v.invalPct != null && <div className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 bg-red-500/60" style={{ left: `${v.invalPct}%` }} />}
      {v.targetPct != null && <div className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 bg-emerald-400/70" style={{ left: `${v.targetPct}%` }} />}
      <div className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${STATE[v.state].live ? 'dot-live' : ''}`}
        style={{ left: `${v.pricePct}%`, background: dot, color: dot }} />
    </div>
  )
}

// ---- in-trade view -------------------------------------------------------
// Once you're in a position, "buy zone" is irrelevant — what matters is the
// stop (invalidation) and the target. This re-frames the rail around loss/
// reward risk: stop → entry (risk runway) and entry → target (profit runway),
// plus live distances from price to each.
export const POS_STATE = {
  at_target: { label: 'At target', dot: '#34d399', live: true },
  near_tp:   { label: 'Near TP',   dot: '#fbbf24', live: true },
  in_profit: { label: 'In profit', dot: '#34d399', live: false },
  holding:   { label: 'Holding',   dot: '#a1a1aa', live: false },
  at_risk:   { label: 'At risk',   dot: '#fb923c', live: false },
  near_stop: { label: 'Near stop', dot: '#f87171', live: true },
  stop_hit:  { label: 'Stop hit',  dot: '#f87171', live: true },
  no_plan:   { label: 'No plan',   dot: '#52525b', live: false },
  no_price:  { label: 'No price',  dot: '#52525b', live: false },
}

export function positionView(rawT, price, entry) {
  const t = effectivePlan(rawT)
  // Targets are often staged (TP1 → TP2 → HTF). For a live position the
  // actionable level is the NEXT target above price, not the final one — and
  // scaling the rail to it keeps stop/entry/price legible instead of squashed.
  const targets = (t.targets || []).map((x) => num(x.price)).filter((n) => n != null).sort((a, b) => a - b)
  const finalTarget = targets.length ? targets[targets.length - 1] : null
  const target = price != null ? (targets.find((x) => x > price) ?? finalTarget) : finalTarget
  const inval = num(t.invalidation)
  const e = entry != null ? Number(entry) : null

  if (price == null) return { state: 'no_price' }
  if (target == null && inval == null) return { state: 'no_plan' }

  let state
  if (inval != null && price <= inval) state = 'stop_hit'
  else if (finalTarget != null && price >= finalTarget) state = 'at_target'
  else if (target != null && (target - price) / target <= 0.03) state = 'near_tp'
  else if (inval != null && (price - inval) / price <= 0.03) state = 'near_stop'
  else if (e != null && price >= e) state = 'in_profit'
  else if (e != null) state = 'at_risk'
  else state = 'holding'

  const pts = [inval, e, target, price].filter((n) => n != null)
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const span = hi - lo || 1
  const pct = (v) => (v == null ? null : Math.max(0, Math.min(100, ((v - lo) / span) * 100)))
  return {
    state,
    pricePct: pct(price), entryPct: pct(e), invalPct: pct(inval), targetPct: pct(target),
    toTp: target != null ? ((target - price) / price) * 100 : null,
    toStop: inval != null ? ((inval - price) / price) * 100 : null,
  }
}

// Signed distance chips for the in-trade label, e.g. ['+6.2% TP', '-4.1% stop'].
export function posLabelParts(v) {
  const parts = []
  if (v.toTp != null) parts.push(`${v.toTp >= 0 ? '+' : ''}${v.toTp.toFixed(1)}% TP`)
  if (v.toStop != null) parts.push(`${v.toStop >= 0 ? '+' : ''}${v.toStop.toFixed(1)}% stop`)
  return parts
}

export function PositionRail({ v }) {
  const dot = POS_STATE[v.state].dot
  return (
    <div className="relative h-5 w-full">
      <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded bg-zinc-800" />
      {v.invalPct != null && v.entryPct != null && (
        <div className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-sm bg-red-500/20"
          style={{ left: `${Math.min(v.invalPct, v.entryPct)}%`, width: `${Math.max(2, Math.abs(v.entryPct - v.invalPct))}%` }} />
      )}
      {v.entryPct != null && v.targetPct != null && (
        <div className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-sm bg-emerald-500/25"
          style={{ left: `${Math.min(v.entryPct, v.targetPct)}%`, width: `${Math.max(2, Math.abs(v.targetPct - v.entryPct))}%` }} />
      )}
      {v.invalPct != null && <div className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 bg-red-500/70" style={{ left: `${v.invalPct}%` }} title="stop / invalidation" />}
      {v.entryPct != null && <div className="absolute top-1/2 h-2.5 w-[2px] -translate-y-1/2 bg-zinc-400/70" style={{ left: `${v.entryPct}%` }} title="your entry" />}
      {v.targetPct != null && <div className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 bg-emerald-400/80" style={{ left: `${v.targetPct}%` }} title="target" />}
      <div className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${POS_STATE[v.state].live ? 'dot-live' : ''}`}
        style={{ left: `${v.pricePct}%`, background: dot, color: dot }} />
    </div>
  )
}

// ---- a row ---------------------------------------------------------------
function Row({ t, quote, i, onOpen }) {
  const price = quote?.price ?? null
  const changePct = quote?.changePct ?? null
  const v = planView(t, price)   // commodity: priced off spot, so state matches Zero's levels
  const s = STATE[v.state]
  // Commodities surface the locked ETC (what you actually buy) in the price cell.
  const veh = t.asset_class === 'commodity' ? quote?.vehicle : null
  const dispPrice = veh ? veh.price : price
  const dispChange = veh ? veh.changePct : changePct
  const type = assetType(t)
  const sharia = shariaOf(t.sharia_status)
  const hasPlan = v.state !== 'no_plan' && v.state !== 'no_price'

  return (
    <button onClick={() => onOpen(t.symbol)}
      className="row-in group grid w-full grid-cols-[minmax(150px,1fr)_minmax(96px,1.15fr)_auto] items-center gap-3 border-b border-zinc-900 py-2.5 pl-3 pr-3 text-left transition-colors hover:bg-white/[0.025]"
      style={{ animationDelay: `${Math.min(i * 26, 400)}ms` }}>

      {/* identity — subtle asset icon after the symbol, name BELOW */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[15px] font-semibold leading-tight tracking-tight text-zinc-100">{t.symbol}</span>
          <AssetIcon type={type} />
        </div>
        <div className="truncate text-[11px] leading-tight text-zinc-500">
          {t.name}{veh && <span className="text-zinc-600"> · via {veh.ticker}</span>}
        </div>
      </div>

      {/* rail (or muted state) */}
      <div className="min-w-0">
        {hasPlan ? (
          <>
            <Rail v={v} />
            <div className="mt-0.5 text-[10px] uppercase tracking-wider" style={{ color: s.dot }}>{s.label}</div>
          </>
        ) : (
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">{s.label}</div>
        )}
      </div>

      {/* data cluster — fixed widths so columns align across rows */}
      <div className="flex items-center justify-end gap-3 font-mono tabular">
        <div className="w-[58px] text-right">
          <div className="text-[14px] text-zinc-100">{fmtPrice(dispPrice)}</div>
          {dispChange != null && (
            <div className="text-[11px]" style={{ color: dispChange >= 0 ? '#34d399' : '#f87171' }} title="change vs previous close">
              {dispChange >= 0 ? '+' : ''}{dispChange.toFixed(1)}%
            </div>
          )}
        </div>
        <div className="w-6 text-right text-[13px]" style={{ color: gradeColor(t.top_grade) }} title="§20 grade">
          {t.top_grade != null ? t.top_grade : '·'}
        </div>
        <span className={`w-[92px] rounded-md border px-1.5 py-0.5 text-center text-[10px] font-medium ${sharia.chip}`}
          title={`Sharia: ${t.sharia_status || 'unknown'}`}>
          {sharia.label}
        </span>
        <svg className="h-3.5 w-3.5 text-zinc-700 transition-colors group-hover:text-zinc-400" viewBox="0 0 24 24" fill="none">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  )
}

// ---- the list ------------------------------------------------------------
// rows: array | null (null = loading). Sorted attention-first, then by grade.
export default function TickerList({ rows, quotes = {}, onOpen, empty = 'Nothing here yet.' }) {
  const sorted = useMemo(() => {
    if (!rows) return []
    return [...rows].sort((a, b) => {
      const sa = ORDER[planView(a, quotes[a.symbol]?.price).state]
      const sb = ORDER[planView(b, quotes[b.symbol]?.price).state]
      if (sa !== sb) return sa - sb
      return (b.top_grade ?? -1) - (a.top_grade ?? -1)
    })
  }, [rows, quotes])

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-900 bg-black/20">
      {!rows && <div className="px-3 py-10 text-center text-sm text-zinc-600">Loading…</div>}
      {rows && sorted.length === 0 && <div className="px-3 py-10 text-center text-sm text-zinc-600">{empty}</div>}
      {sorted.map((t, i) => (
        <Row key={t.symbol} t={t} quote={quotes[t.symbol]} i={i} onOpen={onOpen} />
      ))}
    </div>
  )
}
