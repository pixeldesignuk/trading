import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api.js'
import { useUrlState } from '../useUrlState.js'
import ChatPanel from './ChatPanel.jsx'
import AlertsWidget from './AlertsWidget.jsx'

// ---- tokens --------------------------------------------------------------
const STATUSES = ['new', 'watching', 'in', 'closed', 'dismissed']
const ASSET = { stock: '#38bdf8', crypto: '#a78bfa', commodity: '#fbbf24' }
const SHARIA = {
  compliant: { label: 'Compliant', c: '#34d399', chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  questionable: { label: 'Questionable', c: '#fbbf24', chip: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  inconclusive: { label: 'Inconclusive', c: '#38bdf8', chip: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  non_compliant: { label: 'Avoid', c: '#f87171', chip: 'border-red-500/30 bg-red-500/10 text-red-300' },
  unknown: { label: 'Unscreened', c: '#52525b', chip: 'border-zinc-700 bg-zinc-800/40 text-zinc-500' },
}
const SOURCE = {
  moneytaur: { label: 'Moneytaur', accent: '#fbbf24' },
  zero_hub: { label: 'Zero · Hub', accent: '#34d399' },
  zero_live: { label: 'Zero · Live', accent: '#34d399' },
  zero_tg: { label: 'Zero · Telegram', accent: '#34d399' },
  manual: { label: 'Manual', accent: '#a1a1aa' },
}
const STATE = {
  in_buy: { label: 'In buy zone', c: '#34d399' }, below_buy: { label: 'Below buy zone', c: '#38bdf8' },
  near_target: { label: 'Near target', c: '#fbbf24' }, past_invalidation: { label: 'Invalidated', c: '#f87171' },
  drifting: { label: 'Mid-range', c: '#a1a1aa' }, no_plan: { label: 'No plan', c: '#52525b' }, no_price: { label: 'No price', c: '#52525b' },
}
// Skeptical-editor tokens
const STANCE = {
  bullish: { c: '#34d399', arrow: '▲', label: 'Bullish' },
  bearish: { c: '#f87171', arrow: '▼', label: 'Bearish' },
  neutral: { c: '#a1a1aa', arrow: '→', label: 'Neutral' },
}
const ACTION = {
  enter: { c: '#34d399', label: 'Enter' },
  wait: { c: '#fbbf24', label: 'Wait' },
  stand_aside: { c: '#f87171', label: 'Stand aside' },
}

// ---- jargon glossary (beginner aid) --------------------------------------
const GLOSSARY = {
  RH: 'Range High', RL: 'Range Low', TP: 'Take Profit', SL: 'Stop Loss', BE: 'Break Even',
  PSH: 'Previous Swing High', PSL: 'Previous Swing Low', BSL: 'Buy-Side Liquidity', SSL: 'Sell-Side Liquidity',
  BO: 'Breakout', BOS: 'Break of Structure', OB: 'Order Block', HTF: 'Higher Timeframe', MTF: 'Mid Timeframe',
  LTF: 'Lower Timeframe', KSL: 'Key Support Level', EQ: 'Equilibrium', SM: 'Smart Money', ATM: 'At-The-Market offering',
}
function expandLabel(label) {
  if (!label) return ''
  const up = String(label).toUpperCase().trim()
  if (GLOSSARY[up]) return `${GLOSSARY[up]} (${up})`
  const tp = up.match(/^TP\s*(\d+)$/); if (tp) return `Take Profit ${tp[1]} (TP${tp[1]})`
  if (/^0?\.\d+$/.test(up)) return `Fib ${up}`
  return label
}
// Append "(Full Term)" after the FIRST standalone occurrence of each acronym.
function glossText(s) {
  if (!s) return s
  let out = String(s)
  for (const [acr, full] of Object.entries(GLOSSARY)) {
    const re = new RegExp(`\\b${acr}\\b`)
    if (re.test(out) && !out.includes(`(${acr})`)) out = out.replace(re, `${acr} (${full})`)
  }
  return out
}

const md = (s) => ({ __html: marked.parseInline(String(s ?? '')) })
const rich = (s) => ({ __html: marked.parseInline(glossText(String(s ?? ''))) })
const num = (v) => { const m = String(v ?? '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null }
const fmtPrice = (p) => (p == null ? '—' : p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toPrecision(3))
const fmtGBP = (n) => '£' + Math.round(n).toLocaleString('en-GB')
const fmtTargets = (targets) => {
  if (!targets) return []
  const arr = Array.isArray(targets) ? targets : [targets]
  return arr.map((t) => (t && typeof t === 'object' ? [t.level, t.price, t.note ? `(${t.note})` : ''].filter(Boolean).join(' ') : String(t)))
}

function AssetIcon({ type, size = 16 }) {
  const color = ASSET[type] || '#52525b'
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { opacity: 0.7 } }
  if (type === 'crypto') return <svg {...p}><path d="M12 3l7 4.5v9L12 21l-7-4.5v-9z" /></svg>
  if (type === 'commodity') return <svg {...p}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>
  if (type === 'stock') return <svg {...p}><path d="M3 20h18M6 20V13M12 20V5M18 20V10" /></svg>
  return null
}

// ---- setup geometry ------------------------------------------------------
function setup(t, price) {
  const ladder = (t.ladder || []).map((l) => ({ n: l.level, p: num(l.price) })).filter((x) => x.p != null)
  const targets = (t.targets || []).map((x) => ({ n: x.level, p: num(x.price), note: x.note })).filter((x) => x.p != null).sort((a, b) => a.p - b.p)
  const buyLo = ladder.length ? Math.min(...ladder.map((l) => l.p)) : num(t.entry_zone)
  const buyHi = ladder.length ? Math.max(...ladder.map((l) => l.p)) : num(t.entry_zone)
  const entry = buyHi ?? buyLo
  const entryLabel = ladder.length ? ladder.find((l) => l.p === buyHi)?.n : null
  const topTarget = targets.length ? Math.max(...targets.map((x) => x.p)) : null
  const inval = num(t.invalidation)

  let state = 'no_price'
  if (price != null) {
    state = 'drifting'
    if (buyLo == null && topTarget == null) state = 'no_plan'
    else if (inval != null && price < inval) state = 'past_invalidation'
    else if (buyLo != null && buyHi != null && price >= buyLo && price <= buyHi) state = 'in_buy'
    else if (topTarget != null && Math.abs(price - topTarget) / topTarget <= 0.05) state = 'near_target'
    else if (buyLo != null && price < buyLo) state = 'below_buy'
  }
  const pts = [inval, buyLo, buyHi, topTarget, price].filter((n) => n != null)
  const lo = pts.length ? Math.min(...pts) : 0
  const hi = pts.length ? Math.max(...pts) : 1
  const pad = (hi - lo) * 0.08 || 1
  const A = lo - pad, B = hi + pad, span = B - A || 1
  const pct = (v) => (v == null ? null : ((v - A) / span) * 100)
  return {
    state, ladder, targets, buyLo, buyHi, inval, topTarget, price, entry, entryLabel,
    pct, buyLoPct: pct(buyLo), buyHiPct: pct(buyHi), pricePct: pct(price), invalPct: pct(inval), entryPct: pct(entry),
    nextTp: targets.map((x) => x.p).find((p) => price == null || p > price) ?? topTarget,
    hasPlan: buyLo != null || topTarget != null,
  }
}

// When the skeptical editor has run, ITS safest plan governs the gauge/chart —
// not the raw single-source levels. So a contested entry the editor rejected
// stops driving the visual. Returns a setup()-shaped object.
function effectivePlan(t) {
  const sp = t.synthesis?.safest_plan
  if (!sp) return t
  return {
    ...t,
    entry_zone: sp.entry != null ? String(sp.entry) : null,
    ladder: sp.entry != null ? [{ price: sp.entry, note: sp.entry_basis }] : [],
    targets: (sp.targets || []).filter((x) => x?.price != null).map((x, i) => ({ level: `TP${i + 1}`, price: x.price, note: x.basis })),
    invalidation: sp.invalidation != null ? String(sp.invalidation) : null,
  }
}

// Re-express a setup in a different price basis (commodity CFD/spot ↔ chosen ETC)
// by scaling every level by `k`. Positions are scale-invariant — pct(v*k) maps
// to the same place — so the gauge/chart stay aligned; only the printed numbers
// change. The % math downstream (state, R:R, profit %) is unaffected.
function scaleSetup(s, k) {
  if (!k || k === 1) return s
  const m = (v) => (v == null ? null : v * k)
  return {
    ...s,
    buyLo: m(s.buyLo), buyHi: m(s.buyHi), inval: m(s.inval), topTarget: m(s.topTarget),
    price: m(s.price), entry: m(s.entry), nextTp: m(s.nextTp),
    ladder: s.ladder.map((l) => ({ ...l, p: m(l.p) })),
    targets: s.targets.map((t) => ({ ...t, p: m(t.p) })),
    pct: (v) => s.pct(v == null ? null : v / k),   // same position, scaled input
  }
}


// ---- Setup Gauge (hero) --------------------------------------------------
// Smart label staggering: each marker's label/amount sit in a vertical "lane".
// Lanes are assigned greedily by the marker's real label width so two labels
// never share a lane unless their spans clear each other — so nothing overlaps,
// however tightly the price levels cluster.
const BAR_PX = 660 // approx usable gauge width, for width→percent estimates
const LANE = 15    // px added per extra lane (label height + gap)
function labelHalfPct(m) {
  const chars = Math.max(String(m.label || '').length, String(fmtPrice(m.value)).length)
  return ((chars * 5.4 + 10) / 2 / BAR_PX) * 100
}
function assignLanes(markers) {
  const sorted = [...markers].filter((m) => m.pct != null).sort((a, b) => a.pct - b.pct)
  const laneRight = [] // rightmost occupied edge (%) per lane
  for (const m of sorted) {
    const hw = labelHalfPct(m)
    const left = m.pct - hw
    let lane = 0
    while (laneRight[lane] != null && left < laneRight[lane] + 1) lane++
    laneRight[lane] = m.pct + hw
    m.lane = lane
  }
  return sorted
}

// Label ABOVE the bar, amount(s) BELOW; amount colour matches the label. `tall`
// draws a full line through the bar (entry). `lane` lifts the label/amount out
// to its row, with a faint stem keeping it tied to the tick.
function Marker({ pct, color, value, label, sub, subColor, tall, lane = 0 }) {
  if (pct == null) return null
  const clamped = Math.max(2, Math.min(98, pct))
  const align = clamped < 18 ? 'left-0 text-left' : clamped > 82 ? 'right-0 text-right' : 'left-1/2 -translate-x-1/2 text-center'
  const up = 13 + lane * LANE   // gap from bar to label baseline
  const down = 13 + lane * LANE // gap from bar to amount
  return (
    <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${clamped}%` }}>
      {/* tick — short below the bar, or a tall line crossing it */}
      <div className="absolute left-0 w-[2px] -translate-x-1/2 rounded"
        style={{ height: tall ? 24 : 12, top: tall ? -12 : 0, background: color, opacity: tall ? 0.95 : 0.7 }} />
      {/* stems out to the staggered label / amount */}
      <div className="absolute left-0 w-px -translate-x-1/2" style={{ height: up, bottom: 1, background: color, opacity: 0.25 }} />
      <div className="absolute left-0 w-px -translate-x-1/2" style={{ height: down, top: 1, background: color, opacity: 0.25 }} />
      {/* label above */}
      <div className={`absolute whitespace-nowrap font-mono text-[9px] uppercase tracking-wider ${align}`} style={{ bottom: up + 1, color, opacity: 0.9 }}>{label}</div>
      {/* amount below, colour coordinated with the label */}
      <div className={`absolute whitespace-nowrap ${align}`} style={{ top: down + 1 }}>
        <div className="font-mono text-[11px] tabular" style={{ color }}>{fmtPrice(value)}</div>
        {sub && <div className="font-mono text-[10px] tabular" style={{ color: subColor || '#34d399' }}>{sub}</div>}
      </div>
    </div>
  )
}
// Minimal price-level model for the gauge — targets/stop only, no account
// config (the allocation engine now owns sizing; config.js is no longer in the
// per-ticker risk path).
function gaugeModel(s, costBasis = null) {
  const entry = s?.entry
  const stop = s?.inval
  const hasStop = stop != null && entry != null && stop < entry
  // When a position is held, profit % is measured from your ACTUAL average cost
  // (the broker cost basis), not the plan's suggested entry — otherwise the
  // "+X%" badges imply gains relative to a price you never paid. Falls back to
  // the plan entry when flat.
  const cost = costBasis != null && costBasis > 0 ? costBasis : null
  const basis = cost ?? entry
  const targets = (s?.targets || []).map((x) => ({ p: x.p, profitPct: basis ? ((x.p - basis) / basis) * 100 : null }))
  return { targets, hasStop, stop, costBasis: cost }
}
// Signed percentage, e.g. +12% / -4% (a target below your cost is a loss).
const fmtSignedPct = (n) => (n == null ? null : `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`)
function SetupGauge({ s, rm, divider }) {
  const edge = divider ? 'border-t border-zinc-900' : ''
  if (!s.hasPlan || s.pricePct == null) {
    return <div className={`px-5 py-8 text-center text-sm text-zinc-600 ${edge}`}>No plan levels yet for this instrument.</div>
  }
  const stateC = STATE[s.state].c
  const pricePos = Math.max(2, Math.min(98, s.pricePct))
  const clampPct = (v) => Math.max(0, Math.min(100, v))
  const markers = [
    ...s.targets.map((x, i) => {
      const tp = rm.targets.find((r) => r.p === x.p)
      return { key: `t${i}`, pct: s.pct(x.p), color: '#34d399', label: `TP${i + 1}`, value: x.p, sub: fmtSignedPct(tp?.profitPct), subColor: (tp?.profitPct ?? 0) >= 0 ? '#34d399' : '#f87171' }
    }),
    { key: 'entry', pct: s.entryPct, color: '#f87171', label: rm.costBasis != null ? 'Setup' : 'Entry', value: s.entry, tall: true },
    // Your actual average cost — only when held, so the +X% badges and this
    // marker line up against the price you really paid.
    ...(rm.costBasis != null ? [{ key: 'cost', pct: clampPct(s.pct(rm.costBasis)), color: '#fbbf24', label: 'You', value: rm.costBasis, tall: true }] : []),
    ...(rm.hasStop ? [{ key: 'stop', pct: s.invalPct, color: '#fb923c', label: 'Stop', value: rm.stop }] : []),
  ]
  const laid = assignLanes(markers)
  const maxLane = laid.reduce((m, x) => Math.max(m, x.lane), 0)
  const padY = 30 + maxLane * LANE
  return (
    <>
      <div className={`relative px-6 ${edge}`} style={{ paddingTop: padY + 14, paddingBottom: padY + 8 }}>
        <div className="relative h-2">
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
            style={{ background: 'linear-gradient(90deg, rgba(248,113,113,.35), rgba(82,82,91,.25) 55%, rgba(82,82,91,.25))' }} />
          {/* buy zone — the bar itself turns green here */}
          {s.buyLoPct != null && s.buyHiPct != null && (
            <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-emerald-400"
              style={{ left: `${Math.min(s.buyLoPct, s.buyHiPct)}%`, width: `${Math.max(1.5, Math.abs(s.buyHiPct - s.buyLoPct))}%` }} />
          )}
          {laid.map((m) => <Marker key={m.key} {...m} />)}
          {/* live price indicator — dot only (price shown in the header) */}
          <div className="dot-live absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-black" style={{ left: `${pricePos}%`, background: stateC, color: stateC }} />
        </div>
      </div>
      <GaugeLegend hasStop={rm.hasStop} hasTargets={s.targets.length > 0} hasCost={rm.costBasis != null} priceColor={stateC} priceState={STATE[s.state].label} />
    </>
  )
}

// Acronym legend for the gauge markers (kept short so labels never overlap).
function GaugeLegend({ hasStop, hasTargets, hasCost, priceColor, priceState }) {
  const items = [
    { c: '#f87171', k: hasCost ? 'Setup' : 'Entry', v: hasCost ? 'planned entry level' : 'buy / entry level' },
    ...(hasCost ? [{ c: '#fbbf24', k: 'You', v: 'your avg cost · profit % is from here' }] : []),
    ...(hasStop ? [{ c: '#fb923c', k: 'Stop', v: 'stop-loss · structure-based' }] : []),
    ...(hasTargets ? [{ c: '#34d399', k: 'TP1·2·3', v: 'take-profit targets' }] : []),
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-zinc-900 px-6 py-2.5">
      {/* live price dot — ringed to match the gauge, colour = current state */}
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full ring-2 ring-black" style={{ background: priceColor }} />
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider" style={{ color: priceColor }}>Now</span>
        <span className="text-[11px] text-zinc-500">live price{priceState ? ` · ${priceState.toLowerCase()}` : ''}</span>
      </div>
      {items.map((i) => (
        <div key={i.k} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: i.c }} />
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider" style={{ color: i.c }}>{i.k}</span>
          <span className="text-[11px] text-zinc-500">{i.v}</span>
        </div>
      ))}
    </div>
  )
}

// ---- price history chart -------------------------------------------------
function ChartLabel({ top, color, children }) {
  return <div className="absolute right-0 z-10 -translate-y-1/2 rounded bg-black/75 px-1 font-mono text-[9px] tabular" style={{ top: `${top}%`, color }}>{children}</div>
}
const RANGES = [['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['3Y', 1095]]
function PriceChart({ data, s }) {
  const [range, setRange] = useState('6M')
  if (!data || data.length < 2) return null
  const days = RANGES.find((r) => r[0] === range)?.[1] ?? 182
  const cutoff = data.at(-1).t - days * 86400000
  let view = data.filter((d) => d.t >= cutoff)
  if (view.length < 2) view = data
  const W = 700, H = 130, padX = 2, padT = 12, padB = 10
  const closes = view.map((d) => d.c)
  let lo = Math.min(...closes), hi = Math.max(...closes)
  const dLo = lo, dHi = hi
  for (const v of [s.entry, s.nextTp]) if (v != null && v >= dLo * 0.6 && v <= dHi * 1.6) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  const rng = (hi - lo) || 1; lo -= rng * 0.06; hi += rng * 0.06
  const X = (i) => padX + (i / (view.length - 1)) * (W - 2 * padX)
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const yPct = (v) => (Y(v) / H) * 100
  const line = view.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d.c).toFixed(1)}`).join('')
  const area = `${line}L${(W - padX).toFixed(1)},${H - padB}L${padX},${H - padB}Z`
  const up = closes.at(-1) >= closes[0]
  const col = up ? '#34d399' : '#f87171'
  const chg = ((closes.at(-1) - closes[0]) / closes[0]) * 100
  const inRange = (v) => v != null && v >= lo && v <= hi
  const gid = `cg-${up ? 'u' : 'd'}`
  return (
    <div className="px-6 pt-4 pb-1">
     <div className="relative overflow-hidden">
      <div className="absolute left-0 top-1 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        <span style={{ color: col }}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}%</span>
      </div>
      <div className="absolute right-0 top-0 z-10 flex items-center gap-0.5">
        {RANGES.map(([label]) => (
          <button key={label} onClick={() => setRange(label)}
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${range === label ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'}`}>
            {label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-32 w-full">
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity="0.25" /><stop offset="100%" stopColor={col} stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill={`url(#${gid})`} />
        {inRange(s.buyLo) && inRange(s.buyHi) && (
          <rect x="0" y={Math.min(Y(s.buyLo), Y(s.buyHi))} width={W} height={Math.max(2, Math.abs(Y(s.buyHi) - Y(s.buyLo)))} fill="#34d399" opacity="0.08" />
        )}
        {inRange(s.entry) && <line x1="0" y1={Y(s.entry)} x2={W} y2={Y(s.entry)} stroke="#f87171" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" opacity="0.55" />}
        {inRange(s.nextTp) && <line x1="0" y1={Y(s.nextTp)} x2={W} y2={Y(s.nextTp)} stroke="#34d399" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" opacity="0.55" />}
        <path d={line} fill="none" stroke={col} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-black" style={{ right: 0, top: `${yPct(closes.at(-1))}%`, background: col }} />
      {inRange(s.nextTp) && <ChartLabel top={yPct(s.nextTp)} color="#34d399">TP {fmtPrice(s.nextTp)}</ChartLabel>}
      {inRange(s.entry) && <ChartLabel top={yPct(s.entry)} color="#f87171">Entry {fmtPrice(s.entry)}</ChartLabel>}
     </div>
    </div>
  )
}

// ---- helpers for sections ------------------------------------------------
function Stat({ k, children }) {
  return <div className="px-4 py-3"><div className="font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">{k}</div><div className="mt-1 font-mono text-[13px] tabular text-zinc-200">{children}</div></div>
}
function Row({ k, v }) {
  return <div className="flex gap-2 text-sm"><dt className="shrink-0 pt-0.5 font-mono text-[11px] uppercase tracking-wider text-zinc-600">{k}</dt><dd className="text-zinc-200" dangerouslySetInnerHTML={rich(v)} /></div>
}
function SectionLabel({ children }) {
  return <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">{children}</div>
}

function SourceCard({ e, i }) {
  const p = e.payload || {}
  const src = SOURCE[e.source] || { label: e.source, accent: '#a1a1aa' }
  const targets = fmtTargets(p.targets)
  const sharia = p.sharia_status ? SHARIA[p.sharia_status] || SHARIA.unknown : null
  return (
    <section className="row-in overflow-hidden rounded-xl border border-zinc-900 bg-black/20" style={{ animationDelay: `${i * 60}ms` }}>
      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5" style={{ borderLeft: `2px solid ${src.accent}` }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: src.accent }}>{src.label}</span>
          <span className="font-mono text-[11px] tabular text-zinc-600">{(e.occurred_at || e.captured_at || '').slice(0, 10)}</span>
        </div>
        {p.grade_score != null && <span className="font-mono text-[11px] text-zinc-500">§20 {p.grade_score}/10</span>}
      </div>
      <div className="space-y-3 px-4 py-3.5">
        {p.text && <div className="text-sm leading-relaxed text-zinc-200" dangerouslySetInnerHTML={rich(p.text)} />}
        <div className="space-y-1.5">
          {p.entry && <Row k="Entry" v={p.entry} />}
          {targets.length > 0 && <Row k="Targets" v={targets.join(' · ')} />}
          {p.invalidation && <Row k="Invalid" v={p.invalidation} />}
          {p.note && <Row k="Note" v={p.note} />}
        </div>
        {sharia && (
          <div className="flex items-start gap-2 border-t border-zinc-900 pt-3">
            <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${sharia.chip}`}>{sharia.label}</span>
            {p.sharia_note && <span className="text-xs leading-relaxed text-zinc-400" dangerouslySetInnerHTML={rich(p.sharia_note)} />}
          </div>
        )}
        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-block font-mono text-[11px] uppercase tracking-wider text-sky-400/80 hover:text-sky-300">Source ↗</a>}
      </div>
    </section>
  )
}

function KV({ k, v, note, tone }) {
  const c = tone === 'emerald' ? '#34d399' : tone === 'red' ? '#f87171' : tone === 'amber' ? '#fbbf24' : '#e4e4e7'
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">{k}</div>
      <div className="mt-1 font-mono text-[15px] tabular" style={{ color: c }}>{v}</div>
      {note && <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">{note}</div>}
    </div>
  )
}

// ---- Risk panel (engine-driven) -----------------------------------------
// Hold = allocation by target weight (Zero masterclass); Trade = stop/R:R sizing.
// Reads /api/tickers/:symbol/risk (server engine); classification is editable.
function RiskPanel({ symbol, held, book = 'personal' }) {
  const [r, setR] = useState(null)
  const [busy, setBusy] = useState(false)
  const reload = () => api.tickerRisk(symbol, book).then(setR)
  useEffect(() => { setR(null); reload() }, [symbol])
  const patch = async (p) => {
    setBusy(true)
    try { await api.setClassification(symbol, { layer: r.classification.layer, role: r.classification.role, pyramid_tier: r.classification.pyramidTier, sleeve: r.sleeve, satellite_theme: r.classification?.theme ?? null, ...p }); await reload() }
    finally { setBusy(false) }
  }
  const SLEEVE_LABEL = { core: 'Core', sat_etf: 'Satellite ETF', crypto: 'Crypto', picks: 'Pick', cash: 'Cash' }
  if (!r) return null
  const c = r.classification
  const isTrade = c.layer === 'trade'
  const curPct = held && r.bookValue ? held.value / r.bookValue : 0

  return (
    <div className="mt-5">
      <SectionLabel>Risk &amp; allocation · Zero masterclass</SectionLabel>
      <div className="rounded-xl border border-zinc-900 bg-black/20 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-zinc-900 pb-3 font-mono text-[10px]">
          <div className="flex overflow-hidden rounded border border-zinc-800">
            {['hold', 'trade'].map((L) => (
              <button key={L} disabled={busy} onClick={() => patch({ layer: L })}
                className={`px-2.5 py-1 uppercase tracking-wider transition-colors ${c.layer === L ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>{L}</button>
            ))}
          </div>
          <select disabled={busy} value={c.pyramidTier} onChange={(e) => patch({ pyramid_tier: e.target.value })}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 uppercase tracking-wider text-zinc-300">
            {['defensive', 'lower', 'moderate', 'high'].map((tier) => <option key={tier} value={tier}>{tier}</option>)}
          </select>
          {!isTrade && (
            <select disabled={busy} value={r.sleeve || 'picks'}
              onChange={(e) => patch({ sleeve: e.target.value, role: e.target.value === 'core' ? 'core' : 'satellite' })}
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 uppercase tracking-wider text-zinc-300" title="Which allocation sleeve this holding belongs to">
              {['core', 'sat_etf', 'crypto', 'picks', 'cash'].map((sl) => <option key={sl} value={sl}>{SLEEVE_LABEL[sl]}</option>)}
            </select>
          )}
          <span className="ml-auto text-zinc-600">{book} · {fmtGBP(r.bookValue)}</span>
        </div>

        {held && (
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2 font-mono text-[12px] tabular">
            <span className="text-[9px] uppercase tracking-[0.15em] text-emerald-400/80">Live position</span>
            <span className="text-zinc-300">{held.quantity.toLocaleString('en-GB', { maximumFractionDigits: 4 })} @ {fmtPrice(held.avgPrice)}</span>
            <span className="text-zinc-100">{fmtGBP(held.value)}</span>
            <span style={{ color: (held.pnl ?? 0) >= 0 ? '#34d399' : '#f87171' }}>{(held.pnl ?? 0) >= 0 ? '+' : ''}{fmtGBP(held.pnl)}</span>
            <span className="text-zinc-500">{(curPct * 100).toFixed(1)}% of book</span>
          </div>
        )}

        {isTrade ? <TradeMode trade={r.trade} /> : <HoldMode hold={r.hold} curPct={curPct} bookValue={r.bookValue} />}
      </div>
    </div>
  )
}
const PYRAMID = [['defensive', 'Defensive', '#34d399'], ['lower', 'Lower', '#60a5fa'], ['moderate', 'Moderate', '#fbbf24'], ['high', 'High', '#f87171']]
function HoldMode({ hold, curPct, bookValue }) {
  const tgt = hold.targetPct ?? 0
  const delta = tgt - curPct
  const action = hold.pinned ? 'pinned' : Math.abs(delta) < 0.005 ? 'on target' : delta > 0 ? 'add' : 'trim'
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <KV k="Target weight" v={`${(tgt * 100).toFixed(1)}%`} note={`${fmtGBP(tgt * bookValue)}${hold.pinned ? ' · pinned 📌' : ''}`} tone="emerald" />
        <KV k="Current" v={`${(curPct * 100).toFixed(1)}%`} note={fmtGBP(curPct * bookValue)} />
        <KV k="Action"
          v={action === 'add' ? `▲ add ${(Math.abs(delta) * 100).toFixed(1)}%` : action === 'trim' ? `▼ trim ${(Math.abs(delta) * 100).toFixed(1)}%` : action}
          note={action === 'add' || action === 'trim' ? fmtGBP(Math.abs(delta) * bookValue) : 'within band'}
          tone={action === 'add' ? 'emerald' : action === 'trim' ? 'amber' : null} />
        <KV k="Tier ceiling" v={`${(hold.ceiling * 100).toFixed(0)}%`} note={`grade ${hold.grade ?? '—'}/10${hold.rr != null ? ` · R:R ${hold.rr.toFixed(1)}` : ''}`} />
      </div>
      {/* pyramid-position indicator: where this name sits, base → top */}
      <div className="mt-3 flex items-center gap-1 border-t border-zinc-900 pt-3">
        <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">Pyramid</span>
        {PYRAMID.map(([key, label, col]) => (
          <span key={key} className="flex-1 rounded py-1 text-center font-mono text-[9px] uppercase tracking-wider"
            style={hold.tier === key ? { background: `${col}1f`, color: col } : { background: '#15181d', color: '#52525b' }}>
            {label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
        Hold sizing is by <strong>weight</strong>, not a stop — your share of the sleeve budget (tier ceiling × grade × R:R). A long-term hold has no invalidation stop.
      </p>
    </>
  )
}
function TradeMode({ trade }) {
  const rrOk = trade.rr != null && trade.rr >= 2
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <KV k="Risk / trade" v={trade.riskAmount != null ? fmtGBP(trade.riskAmount) : '—'} note="active sleeve cap" />
        <KV k="Stop" v={trade.hasStop ? fmtPrice(trade.stop) : 'structure'} note={trade.hasStop ? `${(trade.stopDist * 100).toFixed(1)}% below entry` : 'set a level'} tone={trade.hasStop ? null : 'amber'} />
        <KV k="Position size" v={trade.positionSize != null ? fmtGBP(trade.positionSize) : '—'} note={trade.positionSize == null ? 'needs a stop' : trade.capped ? 'capped at sleeve' : 'risk ÷ stop'} tone={trade.capped ? 'amber' : null} />
        <KV k="Reward : Risk" v={trade.rr != null ? `${trade.rr.toFixed(1)} : 1` : '—'} note="min 2:1" tone={trade.rr == null ? null : rrOk ? 'emerald' : 'red'} />
      </div>
      {trade.targets && trade.targets.length > 0 && (
        <div className="mt-4 border-t border-zinc-900 pt-3">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">Profit ladder</div>
          <div className="space-y-1.5">
            {trade.targets.map((tp, i) => (
              <div key={i} className="flex items-center justify-between font-mono text-[12px] tabular">
                <span className="text-zinc-400">Target {i + 1} <span className="text-zinc-600">· {fmtPrice(tp.price)}</span></span>
                <span className="flex items-center gap-3">
                  <span className="text-zinc-600">{tp.rr.toFixed(1)}R</span>
                  <span className="w-16 text-right text-emerald-400">+{tp.profitPct.toFixed(1)}%</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!trade.hasStop && (
        <p className="mt-3 border-t border-zinc-900 pt-3 text-[11px] leading-relaxed text-amber-300/80">
          Set a structure-based invalidation (a price) to get R:R and position size.
        </p>
      )}
    </>
  )
}

// ---- commodity vehicle panel --------------------------------------------
// Commodities are owned via a physically-backed ETC, not Zero's CFD/spot chart.
// No Sharia screen — a deterministic compliance note + a broker-aware vehicle
// picker. The selected ETC is locked (persisted) and surfaces on lists + alerts.
const BROKER_LABEL = { hl: 'HL', t212: 'T212', ajbell: 'AJ Bell' }
function fmtVehiclePrice(v, ccy) {
  if (v == null) return '—'
  if (ccy === 'GBX') return (v / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 })
  const cur = ccy === 'USD' ? 'USD' : 'GBP'
  return v.toLocaleString('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 2 })
}
function CommodityPanel({ commodity, symbol, entry, onLock }) {
  const { vehicles, selected, recommended, ratio, compliance_note, reference_symbol, investable, no_vehicle_note } = commodity
  const sel = vehicles.find((v) => v.ticker === selected)
  const etcEntry = entry != null && ratio != null ? entry * ratio : null

  // Oil / agri / base metals: no compliant physical retail vehicle — explain why.
  if (investable === false) {
    return (
      <div className="mt-5">
        <SectionLabel>Ownership — no compliant vehicle</SectionLabel>
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-300">Not investable for you</span>
            <span className="font-mono text-[10px] text-zinc-600">{symbol} · {reference_symbol}</span>
          </div>
          <p className="text-[12px] leading-relaxed text-zinc-300">{no_vehicle_note}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-5">
      <SectionLabel>Own it — physically-backed ETC (no Sharia screen needed)</SectionLabel>
      <div className="rounded-xl border border-zinc-900 bg-black/20 p-4">
        <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[12px] leading-relaxed text-amber-200/90">
          Zero charts <span className="font-mono">{symbol}</span> ({reference_symbol}) — a <strong>CFD/spot</strong> (leverage + overnight interest, no allocated metal): <strong>not investable for you</strong>, chart &amp; levels reference only. Own the metal via a physically-backed ETC below.
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-zinc-400">{compliance_note}</p>
        <div className="space-y-1.5">
          {vehicles.map((v) => {
            const isSel = v.ticker === selected
            return (
              <button key={v.ticker} onClick={() => onLock(v.ticker)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${isSel ? 'border-emerald-500/50 bg-emerald-500/[0.06]' : 'border-zinc-800 hover:bg-white/[0.03]'}`}>
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: isSel ? '#34d399' : '#3f3f46' }}>
                  {isSel && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold text-zinc-100">{v.ticker}</span>
                    {v.ticker === recommended && <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">recommended</span>}
                    {!v.available && <span className="rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-500">not on your brokers</span>}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">{v.name} · {v.currency} · TER {v.ter}%{v.isa_eligible ? ' · ISA' : ''}</div>
                  <div className="mt-1 flex gap-1">
                    {['hl', 't212', 'ajbell'].filter((b) => v.brokers?.[b]).map((b) => (
                      <span key={b} className="rounded bg-zinc-800/60 px-1 py-0.5 font-mono text-[9px] uppercase text-zinc-400">{BROKER_LABEL[b]}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right font-mono tabular">
                  <div className="text-[13px] text-zinc-100">{fmtVehiclePrice(v.price, v.currency)}</div>
                  {v.changePct != null && <div className="text-[10px]" style={{ color: v.changePct >= 0 ? '#34d399' : '#f87171' }}>{v.changePct >= 0 ? '+' : ''}{v.changePct.toFixed(1)}%</div>}
                </div>
              </button>
            )
          })}
        </div>
        {etcEntry != null && (
          <div className="mt-3 border-t border-zinc-900 pt-3 font-mono text-[11px] text-zinc-500">
            Zero's spot entry <span className="text-zinc-300">{fmtPrice(entry)}</span> ≈ <span className="text-zinc-300">{fmtVehiclePrice(etcEntry, sel?.currency)}</span> in {selected} at the current ratio.
          </div>
        )}
        <div className="mt-2 text-[10px] text-zinc-600">Trigger/levels track Zero's spot; you buy the locked ETC. Verify availability + TER on your broker.</div>
      </div>
    </div>
  )
}

// ---- pipeline stepper ----------------------------------------------------
const FUNNEL = ['new', 'watching', 'in', 'closed']
function Pipeline({ status, onSet }) {
  const idx = FUNNEL.indexOf(status)
  const dismissed = status === 'dismissed'
  return (
    <div className="flex items-center">
      <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
        {FUNNEL.map((st, i) => {
          const active = i === idx
          const done = idx >= 0 && i < idx
          return (
            <React.Fragment key={st}>
              <button onClick={() => onSet(st)}
                className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  active ? 'bg-emerald-600 text-white' : done ? 'text-emerald-400/80 hover:text-emerald-300' : 'text-zinc-500 hover:text-zinc-200'}`}>
                {st}
              </button>
              {i < FUNNEL.length - 1 && <span className={`h-px w-2.5 ${done ? 'bg-emerald-600/60' : 'bg-zinc-800'}`} />}
            </React.Fragment>
          )
        })}
      </div>
      <button onClick={() => onSet(dismissed ? 'new' : 'dismissed')} title={dismissed ? 'Restore' : 'Dismiss'}
        className={`ml-2 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
          dismissed ? 'bg-red-900/50 text-red-300' : 'text-zinc-600 hover:text-red-400'}`}>
        {dismissed ? 'dismissed' : 'dismiss'}
      </button>
    </div>
  )
}

// ---- skeptical editor (synthesis) ----------------------------------------
function ConvictionMeter({ value }) {
  const v = Math.max(0, Math.min(10, value ?? 0))
  const c = v <= 3 ? '#f87171' : v <= 6 ? '#fbbf24' : '#34d399'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v * 10}%`, background: c }} />
      </div>
      <span className="font-mono text-[11px] tabular" style={{ color: c }}>{v}/10</span>
    </div>
  )
}

function StanceRow({ s }) {
  const st = STANCE[s.stance] || STANCE.neutral
  const src = SOURCE[s.source] || { label: s.source, accent: '#a1a1aa' }
  return (
    <div className="flex items-baseline gap-2 py-1.5 text-sm">
      <span className="shrink-0 font-mono text-[11px]" style={{ color: st.c }} title={st.label}>{st.arrow}</span>
      <span className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: src.accent }}>{src.label}</span>
      {s.timeframe && <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">{expandLabel(s.timeframe)}</span>}
      {s.as_of && <span className="shrink-0 font-mono text-[10px] tabular text-zinc-600">{s.as_of}</span>}
      <span className="text-zinc-300" dangerouslySetInnerHTML={rich(s.summary)} />
    </div>
  )
}

function Synthesis({ syn, at, busy, onRun }) {
  if (!syn) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl border border-dashed border-zinc-800 bg-black/20 px-4 py-3">
        <div className="text-sm text-zinc-500">No editor read yet — synthesize all sources into one conflict-aware plan.</div>
        <button onClick={onRun} disabled={busy}
          className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
          {busy ? 'Synthesizing…' : 'Run editor'}
        </button>
      </div>
    )
  }
  const act = ACTION[syn.action] || ACTION.wait
  const sp = syn.safest_plan || {}
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800 bg-black/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Skeptical editor</span>
          {syn.contested && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300">⚠ Contested</span>
          )}
        </div>
        <ConvictionMeter value={syn.conviction} />
      </div>

      <div className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">Action</span>
          <span className="rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: act.c, background: act.c + '1a', border: `1px solid ${act.c}44` }}>{act.label}</span>
        </div>

        {syn.plain_english && <p className="mt-2.5 text-sm leading-relaxed text-zinc-200">{syn.plain_english}</p>}

        {/* safest plan, with cited basis */}
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-zinc-900 pt-3 sm:grid-cols-3">
          <PlanCell k="Entry" price={sp.entry} basis={sp.entry_basis} tone="#f87171" />
          <PlanCell k="Target" price={sp.targets?.[0]?.price} basis={sp.targets?.[0]?.basis} tone="#34d399" />
          <PlanCell k="Invalidation" price={sp.invalidation} basis={sp.stop_basis} tone="#fb923c" />
        </div>

        {syn.conflicts?.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-zinc-900 pt-3">
            {syn.conflicts.map((c, i) => (
              <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-amber-300/90">
                <span className="shrink-0">⚑</span><span dangerouslySetInnerHTML={rich(c)} />
              </li>
            ))}
          </ul>
        )}

        {syn.stance_by_source?.length > 0 && (
          <div className="mt-3 border-t border-zinc-900 pt-2">
            <div className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">What each source says</div>
            {syn.stance_by_source.map((s, i) => <StanceRow key={i} s={s} />)}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-zinc-900 pt-2.5">
          <span className="font-mono text-[10px] tabular text-zinc-700">{at ? `Synthesized ${String(at).slice(0, 10)}` : ''}</span>
          <button onClick={onRun} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50">
            <span className={busy ? 'animate-spin' : ''}>↻</span>{busy ? 'Synthesizing…' : 'Re-synthesise'}
          </button>
        </div>
      </div>
    </div>
  )
}
function PlanCell({ k, price, basis, tone }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">{k}</div>
      <div className="font-mono text-[14px] tabular" style={{ color: price == null ? '#52525b' : tone }}>{price == null ? 'none' : fmtPrice(price)}</div>
      {basis && <div className="text-[10px] leading-snug text-zinc-600">{basis}</div>}
    </div>
  )
}

// ---- Sharia screen (live 2-of-3) -----------------------------------------
const SCREEN_STATUS = {
  compliant: { label: 'Compliant', chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  non_compliant: { label: 'Not compliant', chip: 'border-red-500/30 bg-red-500/10 text-red-300' },
  doubtful: { label: 'Doubtful', chip: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  unknown: { label: 'Unknown', chip: 'border-zinc-700 bg-zinc-800/40 text-zinc-500' },
}
const SCREEN_SRC = { zoya: 'Zoya', musaffa: 'Musaffa', mxchange: 'MuslimXchange' }
// A no-data source isn't a "no" — surface incomplete screens as Inconclusive.
function screenOutcome(screen) {
  if (!screen) return { label: 'Unscreened', c: '#52525b', sub: '' }
  const c = screen.compliant_count
  const u = screen.unknown_count ?? (screen.sources || []).filter((s) => s.status === 'unknown').length
  if (c >= 2) return { label: 'Cleared to enter', c: '#34d399', sub: `${c}/3 compliant` }
  if (c === 1 && u >= 1) return { label: 'Inconclusive', c: '#38bdf8', sub: `${u} source${u > 1 ? 's' : ''} no data — undecided` }
  if (c === 1) return { label: 'Not cleared', c: '#fbbf24', sub: '1/3 compliant' }
  return { label: 'Not cleared', c: '#f87171', sub: 'none compliant' }
}
function ShariaScreen({ ticker, busy, onRun }) {
  if (String(ticker.asset_class || '').toLowerCase() !== 'stock') return null // stocks only
  const screen = ticker.sharia_screen
  const head = screenOutcome(screen)
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800 bg-black/30">
      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Sharia screen · 2-of-3</span>
        <span className="font-mono text-[11px] font-semibold" style={{ color: head.c }}>
          {head.label}{head.sub ? ` · ${head.sub}` : ''}
        </span>
      </div>
      <div className="px-4 py-3">
        {!screen && <div className="text-sm text-zinc-500">{busy ? 'Screening Zoya, Musaffa, MuslimXchange…' : 'Not screened yet.'}</div>}
        {screen?.sources?.map((s) => {
          const st = SCREEN_STATUS[s.status] || SCREEN_STATUS.unknown
          return (
            <div key={s.name} className="flex items-center justify-between py-1.5">
              <a href={s.url} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-sky-400/80 hover:text-sky-300">{SCREEN_SRC[s.name] || s.name} ↗</a>
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${st.chip}`}>{st.label}</span>
            </div>
          )
        })}
        {ticker.sharia_note && (
          <div className="mt-2 border-t border-zinc-900 pt-2 text-xs leading-relaxed text-zinc-500">
            <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">Analyst note · </span>
            <span dangerouslySetInnerHTML={rich(ticker.sharia_note)} />
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-zinc-900 pt-2">
          <span className="font-mono text-[10px] tabular text-zinc-700">{screen?.checked_at ? `Checked ${String(screen.checked_at).slice(0, 10)}` : ''}</span>
          <button onClick={onRun} disabled={busy} className="font-mono text-[10px] uppercase tracking-wider text-zinc-600 hover:text-zinc-300 disabled:opacity-50">
            {busy ? 'Screening…' : 'Re-check'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- header chips + tabs -------------------------------------------------
// The synthesis verdict, surfaced loud in the header — the single most important
// "what do I do" signal, no longer buried in the synthesis card.
function ActionPill({ action }) {
  const a = ACTION[action]
  if (!a) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[12px] font-bold uppercase tracking-[0.12em]"
      style={{ color: a.c, background: a.c + '1f', border: `1px solid ${a.c}66` }} title="Skeptical-editor verdict">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.c, boxShadow: `0 0 6px ${a.c}` }} />{a.label}
    </span>
  )
}
function AlertChip({ muted, count, armed }) {
  if (muted) return <span className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/40 px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500" title="Plan alerts muted">🔕 Muted</span>
  if (count > 0) return <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300" title={`${count} active alert${count === 1 ? '' : 's'} set`}>🔔 {count} alert{count === 1 ? '' : 's'}</span>
  if (armed) return <span className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/40 px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400" title="Plan armed — engine watches the levels">🔔 Armed</span>
  return null
}
function DetailTabs({ view, setView, tabs }) {
  return (
    <nav className="mb-5 flex gap-1 border-b border-zinc-800">
      {tabs.map(({ key, label, badge }) => (
        <button key={key} onClick={() => setView(key)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${view === key ? 'border-b-2 border-emerald-500 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
          {label}
          {badge ? <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] tabular text-zinc-400">{badge}</span> : null}
        </button>
      ))}
    </nav>
  )
}

// ---- page ----------------------------------------------------------------
export default function TickerDetail({ symbol, onBack }) {
  const [data, setData] = useState(null)
  const [price, setPrice] = useState(null)
  const [change, setChange] = useState(null)
  const [history, setHistory] = useState(null)
  const [holding, setHolding] = useState(null)
  const [synthBusy, setSynthBusy] = useState(false)
  const [shariaBusy, setShariaBusy] = useState(false)
  const [levels, setLevels] = useUrlState('levels', 'cfd')   // commodity CFD↔ETC level basis
  const [chatOpen, setChatOpen] = useState(false)            // study-desk slide-over (mobile)
  const [view, setView] = useUrlState('view', 'overview')    // detail tab (URL state)
  const [alerts, setAlerts] = useState(null)                 // alerts payload (for the header chip)
  const load = () => api.ticker(symbol).then(setData)
  const loadAlerts = () => api.alerts().then(setAlerts).catch(() => {})
  const runSynth = () => {
    setSynthBusy(true)
    api.synthesize(symbol, true).then(load).catch(() => {}).finally(() => setSynthBusy(false))
  }
  const runSharia = (force) => {
    setShariaBusy(true)
    api.sharia(symbol, force).then(load).catch(() => {}).finally(() => setShariaBusy(false))
  }
  // Auto-screen a stock when its screen is missing or older than 7 days.
  useEffect(() => {
    const t = data?.ticker
    if (!t || String(t.asset_class || '').toLowerCase() !== 'stock' || shariaBusy) return
    const at = t.sharia_screen_at ? new Date(t.sharia_screen_at).getTime() : 0
    if (!t.sharia_screen || Date.now() - at > 7 * 864e5) runSharia(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.ticker?.symbol, data?.ticker?.sharia_screen_at])
  useEffect(() => {
    load()
    loadAlerts()
    setHistory(null)
    api.quotes().then((q) => { setPrice(q[symbol]?.price ?? null); setChange(q[symbol]?.changePct ?? null) })
    api.history(symbol).then(setHistory)
    // Live position for this ticker, scoped to the personal book (owner 'me') so a
    // kids-JISA position in the same ticker doesn't bleed into the personal panel —
    // matches the risk panel, which is personal-scoped (book='personal').
    api.holdings('me').then((hs) => {
      const mine = hs.filter((h) => h.ticker === symbol)
      if (!mine.length) return setHolding(null)
      const quantity = mine.reduce((t, h) => t + h.quantity, 0)
      const cost = mine.reduce((t, h) => t + (h.avgPrice || 0) * h.quantity, 0)
      setHolding({
        quantity,
        avgPrice: quantity ? cost / quantity : null,
        value: mine.reduce((t, h) => t + h.value, 0),
        pnl: mine.reduce((t, h) => t + (h.pnl || 0), 0),
        accounts: [...new Set(mine.map((h) => h.accountLabel))],
      })
    }).catch(() => setHolding(null))
  }, [symbol])
  if (!data?.ticker) return <div className="p-8 text-center text-sm text-zinc-600">Loading…</div>

  const t = data.ticker
  const commodity = data.commodity || null
  const type = ASSET[String(t.asset_class || '').toLowerCase()] ? String(t.asset_class).toLowerCase() : 'other'
  // Levels basis: commodities can switch between Zero's CFD/spot levels and the
  // chosen ETC's price terms (scaled by the live ratio). State/% are unaffected.
  const canToggle = !!(commodity && commodity.ratio)
  const levelBasis = canToggle && levels === 'etc' ? 'etc' : 'cfd'
  const scale = levelBasis === 'etc' ? commodity.ratio : 1
  const s0 = setup(effectivePlan(t), price)
  const s = scaleSetup(s0, scale)
  const priceView = price == null ? null : price * scale
  const historyView = scale === 1 || !history ? history : history.map((p) => ({ ...p, c: p.c * scale }))
  // Held cost basis drives the gauge's profit %, but only when levels aren't
  // being re-scaled by the commodity CFD/ETC toggle (where broker terms and plan
  // terms diverge) — there we keep the plan basis to avoid a unit mismatch.
  const costBasis = holding?.avgPrice != null && !canToggle ? holding.avgPrice : null
  const rm = gaugeModel(s, costBasis)
  const sharia = SHARIA[t.sharia_status] || SHARIA.unknown
  const charts = data.events.filter((e) => e.kind === 'chart')
  const notes = data.events.filter((e) => e.kind !== 'chart')
  // Telegram + community chatter, broken out so it's findable on the Sources tab.
  const chatter = notes.filter((e) => e.source === 'zero_tg' || e.source === 'community')
  const otherNotes = notes.filter((e) => e.source !== 'zero_tg' && e.source !== 'community')

  // Alert status for the header chip (custom alerts set + whether the plan engine is armed).
  const customCount = alerts ? (alerts.custom || []).filter((c) => c.symbol === symbol).length : 0
  const armedPlan = alerts ? (alerts.armed || []).some((a) => a.symbol === symbol) : false
  const alertInfo = { muted: !!t.alerts_muted, count: customCount, armed: armedPlan }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'synthesis', label: 'Synthesis' },
    { key: 'sources', label: 'Sources', badge: notes.length + charts.length },
    { key: 'alerts', label: 'Alerts', badge: customCount },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <main className="chat-scroll flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
      <button onClick={onBack} className="mb-5 font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300">← back</button>

      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-3xl font-semibold tracking-tight text-zinc-50">{t.symbol}</h1>
            <AssetIcon type={type} size={18} />
          </div>
          <div className="mt-1 truncate text-sm text-zinc-500">{t.name}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <ActionPill action={t.synthesis?.action} />
            <Pipeline status={t.status} onSet={(st) => api.setStatus(symbol, st).then(load)} />
            <AlertChip {...alertInfo} />
            {commodity ? (
              commodity.investable === false ? (
                <span className="rounded-md border px-1.5 py-1 text-[10px] font-medium border-red-500/30 bg-red-500/10 text-red-300" title={commodity.no_vehicle_note}>
                  No halal vehicle
                </span>
              ) : (
                <span className="rounded-md border px-1.5 py-1 text-[10px] font-medium border-emerald-500/30 bg-emerald-500/10 text-emerald-300" title={commodity.compliance_note}>
                  Halal via ETC{commodity.selected ? ` · ${commodity.selected}` : ''}
                </span>
              )
            ) : (
              <span className={`rounded-md border px-1.5 py-1 text-[10px] font-medium ${sharia.chip}`}>{sharia.label}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-4xl font-semibold tabular text-zinc-50">{fmtPrice(priceView)}</div>
          {change != null && (
            <div className="font-mono text-sm tabular" style={{ color: change >= 0 ? '#34d399' : '#f87171' }} title="change vs previous close">
              {change >= 0 ? '+' : ''}{change.toFixed(2)}% today
            </div>
          )}
          {t.top_grade != null && <div className="mt-1 font-mono text-[11px] text-zinc-500">§20 grade {t.top_grade}/10</div>}
          {s.hasPlan && (
            <div className="mt-1.5 flex justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                style={{ borderColor: STATE[s.state].c + '55', color: STATE[s.state].c }}>
                <span className="dot-live h-1.5 w-1.5 rounded-full" style={{ background: STATE[s.state].c, color: STATE[s.state].c }} />
                {STATE[s.state].label}
              </span>
            </div>
          )}
        </div>
      </div>

      <DetailTabs view={view} setView={setView} tabs={tabs} />

      {view === 'overview' && (
        <div className="space-y-4">
          {/* commodity: switch all levels between Zero's CFD/spot and the chosen ETC */}
          {canToggle && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">Levels in</span>
              <div className="flex overflow-hidden rounded-md border border-zinc-800">
                {[['cfd', `${commodity.reference_symbol} (spot)`], ['etc', `${commodity.selected} (ETC)`]].map(([v, label]) => (
                  <button key={v} onClick={() => setLevels(v)}
                    className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${levelBasis === v ? 'bg-emerald-600 text-white' : 'bg-transparent text-zinc-400 hover:text-zinc-200'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="font-mono text-[10px] text-zinc-600">ratio {commodity.ratio?.toFixed(4)} · trigger always tracks spot</span>
            </div>
          )}

          {/* levels + graph */}
          <div className="overflow-hidden rounded-xl border border-zinc-900 bg-black/30">
            <PriceChart data={historyView} s={s} />
            <SetupGauge s={s} rm={rm} />
          </div>

          {/* synthesis verdict — the action + one-line "why", with a jump to the full read */}
          {t.synthesis?.plain_english && (
            <div className="rounded-xl border border-zinc-900 bg-black/20 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Editor verdict</span>
                <ActionPill action={t.synthesis.action} />
                <ConvictionMeter value={t.synthesis.conviction} />
                {t.synthesis.contested && <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300">⚠ Contested</span>}
                <button onClick={() => setView('synthesis')} className="ml-auto font-mono text-[10px] uppercase tracking-wider text-sky-400/80 hover:text-sky-300">Full read →</button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-200">{t.synthesis.plain_english}</p>
            </div>
          )}

          {commodity && <CommodityPanel commodity={commodity} symbol={symbol} entry={s0.entry} onLock={(v) => api.setVehicle(symbol, v).then(load)} />}

          <div className="grid grid-cols-2 divide-x divide-y divide-zinc-900 overflow-hidden rounded-xl border border-zinc-900 bg-black/20 sm:grid-cols-4 sm:divide-y-0">
            <Stat k="Entry">{t.synthesis ? (s.entry != null ? fmtPrice(s.entry) : 'stand aside') : (t.entry_zone ? <span dangerouslySetInnerHTML={rich(t.entry_zone)} /> : '—')}</Stat>
            <Stat k="Next target">{s.nextTp != null ? fmtPrice(s.nextTp) : '—'}</Stat>
            <Stat k="Invalidation">{s.inval != null ? fmtPrice(s.inval) : (t.invalidation ? 'structure' : '—')}</Stat>
            <Stat k="State"><span style={{ color: STATE[s.state].c }}>{STATE[s.state].label}</span></Stat>
          </div>

          <RiskPanel symbol={t.symbol} held={holding} />
          <ShariaScreen ticker={t} busy={shariaBusy} onRun={() => runSharia(true)} />
        </div>
      )}

      {view === 'synthesis' && <Synthesis syn={t.synthesis} at={t.synth_at} busy={synthBusy} onRun={runSynth} />}

      {view === 'sources' && (
        <div className="space-y-5">
          {chatter.length > 0 && (
            <div>
              <SectionLabel>Telegram &amp; community</SectionLabel>
              <div className="space-y-3">{chatter.map((e, i) => <SourceCard key={e.id} e={e} i={i} />)}</div>
            </div>
          )}
          {otherNotes.length > 0 && (
            <div>
              <SectionLabel>What each source says</SectionLabel>
              <div className="space-y-3">{otherNotes.map((e, i) => <SourceCard key={e.id} e={e} i={i} />)}</div>
            </div>
          )}
          {t.ai_thesis && (
            <div>
              <SectionLabel>Thesis</SectionLabel>
              <div className="rounded-xl border border-zinc-900 bg-black/20 p-4 text-sm leading-relaxed text-zinc-200" dangerouslySetInnerHTML={rich(t.ai_thesis)} />
            </div>
          )}
          {charts.length > 0 && (
            <div>
              <SectionLabel>Charts</SectionLabel>
              <div className="space-y-4">
                {charts.map((e) => (
                  <figure key={e.id} className="overflow-hidden rounded-xl border border-zinc-900 bg-black/20">
                    <img src={'/' + e.payload.chart} alt={e.payload?.caption || ''} className="w-full" />
                    <figcaption className="border-t border-zinc-900 px-4 py-2.5 text-xs text-zinc-400">
                      <span className="font-mono uppercase tracking-wider" style={{ color: (SOURCE[e.source] || {}).accent || '#a1a1aa' }}>{(SOURCE[e.source] || {}).label || e.source}</span>
                      {e.payload?.caption ? <span className="text-zinc-500"> — {e.payload.caption}</span> : ''}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
          {notes.length === 0 && charts.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 px-4 py-8 text-center text-sm text-zinc-600">No source notes or charts on file for {symbol} yet.</div>
          )}
        </div>
      )}

      {view === 'alerts' && <AlertsWidget load focus={t.symbol} />}

        </div>
      </main>

      <ChatPanel symbol={t.symbol} open={chatOpen} onClose={() => setChatOpen(false)} />

      {/* mobile: open the study desk */}
      <button onClick={() => setChatOpen(true)}
        className="fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-4 py-2.5 text-sm font-medium text-emerald-200 shadow-lg shadow-black/40 backdrop-blur lg:hidden">
        <span className="font-mono text-xs font-bold">Z</span> Ask {symbol}
      </button>
    </div>
  )
}
