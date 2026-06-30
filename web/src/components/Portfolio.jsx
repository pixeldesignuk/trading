import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useUrlState } from '../useUrlState.js'
import { planView, Rail, STATE, positionView, PositionRail, POS_STATE, posLabelParts, UnreadBadge } from './TickerList.jsx'
// Pure server modules (Vite bundles them; see AllocationLedger). Importing the
// SAME state + posture rules the chat/scan use keeps the page's "at risk"
// judgement identical to the agent's — one source of truth.
import { effectivePlan } from '../../../server/portfolio/effective-plan.js'
import { priceVsPlan } from '../../../server/price-plan.js'
import { assessPosture } from '../../../server/portfolio/posture.js'

// Held positions get the in-trade rail (stop · entry · TP + loss/reward
// distances); everything else gets the entry rail (buy zone). Returns the
// resolved view, components and label parts for a row.
function railFor(t, price, holding) {
  if (holding && holding.avgPrice != null) {
    const v = positionView(t, price, holding.avgPrice)
    return { v, RailComp: PositionRail, state: POS_STATE[v.state], dist: posLabelParts(v) }
  }
  const v = planView(t, price)
  return { v, RailComp: Rail, state: STATE[v.state], dist: [] }
}
const hasPlan = (v) => v.state !== 'no_plan' && v.state !== 'no_price'

// Dynamic Kanban Portfolio — the pipeline as a board driven by real broker
// positions (read-only mirror). Potential ↔ Watched are manual (drag + reorder);
// Active is broker-driven (a card is here because the broker holds it) and Closed
// is auto (held → gone). The list is the default view; the board is dormant.

const COLUMNS = [
  { key: 'in', label: 'Active', droppable: false, broker: true, accent: '#34d399' },
  { key: 'watching', label: 'Watched', droppable: true, accent: '#fbbf24' },
  { key: 'new', label: 'Potential', droppable: true, accent: '#38bdf8' },
  { key: 'closed', label: 'Closed', droppable: false, accent: '#71717a' },
  { key: 'archived', label: 'Archived', droppable: false, accent: '#52525b' },
]

const ASSET = { stock: '#38bdf8', etf: '#2dd4bf', crypto: '#a78bfa', commodity: '#fbbf24' }
// Asset "kind" for the dot + Asset filter — prefers the yahoo-derived instrument
// (so ETFs split out from single stocks) and falls back to asset_class.
const assetKind = (r) => {
  if (r.instrument === 'etf') return 'etf'
  if (r.instrument === 'crypto' || r.asset_class === 'crypto') return 'crypto'
  if (r.asset_class === 'commodity' || r.instrument === 'commodity') return 'commodity'
  if (r.instrument === 'equity' || r.asset_class === 'stock') return 'stock'
  return String(r.asset_class || '').toLowerCase()
}
const SHARIA = {
  compliant: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  questionable: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  inconclusive: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  non_compliant: 'border-red-500/30 bg-red-500/10 text-red-300',
  unknown: 'border-zinc-700 bg-zinc-800/40 text-zinc-500',
}
const SHARIA_LABEL = { compliant: 'Compliant', questionable: 'Questionable', inconclusive: 'Inconclusive', non_compliant: 'Avoid', unknown: 'Unscreened' }

// Solar-system classification labels/colours (a HOLD is sized by allocation; a
// TRADE by a plan). Surfaced as a row badge so the two are never conflated.
const LAYER = { trade: { label: 'Trade', c: '#f472b6' }, hold: { label: 'Hold', c: '#38bdf8' } }
const BUCKET_LABEL = { core: 'Core', satellite: 'Satellite', picks: 'Picks', cash: 'Cash' }
const THEME_LABEL = { tech: 'Tech', em: 'EM', commodities: 'Commodities', niche: 'Niche', crypto: 'Crypto' }

const fmtPrice = (p) => (p == null ? '—' : p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : Number(p).toPrecision(3))
const fmtMoney = (v, ccy = 'GBP') => (v == null ? '—' : v.toLocaleString('en-GB', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }))
const pct0 = (f) => (f == null ? '—' : `${Math.round(f * 100)}%`)
const signed = (f) => (f == null ? '—' : `${f >= 0 ? '+' : ''}${(f * 100).toFixed(1)}%`)
const isIdea = (t) => t.status === 'new' && (t.sources || []).includes('community')
const DAY = 86400000
// Compact "time since" for the date-added column: 5h · 3d · 2w · 4mo · 1y.
const agoShort = (iso) => {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < DAY) { const h = Math.floor(ms / 3600000); return h < 1 ? 'now' : `${h}h` }
  const d = Math.floor(ms / DAY)
  if (d < 14) return `${d}d`
  if (d < 60) return `${Math.floor(d / 7)}w`
  if (d < 365) return `${Math.floor(d / 30)}mo`
  return `${Math.floor(d / 365)}y`
}
const isRecent = (iso) => iso && Date.now() - new Date(iso).getTime() < 3 * DAY
const sinceText = (iso) => {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`
}

// ── header: owner selector + summary strip ────────────────────────────────────
function OwnerBar({ owners, households, scope, setScope }) {
  return (
    <div className="flex flex-wrap gap-1">
      {owners.map((o) => (
        <button key={o.id} onClick={() => setScope(o.id)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] ${scope === o.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: o.color || '#52525b' }} />
          {o.name}
        </button>
      ))}
      {owners.length > 1 && households.map((h) => (
        <button key={h.id} onClick={() => setScope('hh:' + h.id)}
          className={`rounded-md px-3 py-1.5 font-mono text-[11px] ${scope === 'hh:' + h.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>⌂ {h.name}</button>
      ))}
    </div>
  )
}
const Cell = ({ k, v, sub, c }) => (
  <div className="bg-[#0b0d10] px-4 py-3">
    <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">{k}</div>
    <div className="mt-1 font-mono text-[17px] tabular" style={c ? { color: c } : undefined}>{v}</div>
    <div className="font-mono text-[9px] text-zinc-600">{sub}</div>
  </div>
)
// Summary strip — lifted from the Allocation page (same `led` shape). Deployed,
// dry powder, performance vs benchmark, open P&L; all scoped to the owner.
function Summary({ led }) {
  if (!led) return <div className="rounded-xl border border-zinc-900 bg-[#0b0d10] px-4 py-6 text-center font-mono text-xs text-zinc-600">Loading book…</div>
  const b = led.benchmark
  const beat = b?.return1y != null && led.bookReturnPct != null ? led.bookReturnPct - b.return1y : null
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-900 bg-zinc-900 sm:grid-cols-4">
      <Cell k="Deployed" v={pct0(led.deployedPct)} sub={`book ${fmtMoney(led.bookValue)}`} />
      <Cell k="Dry powder" v={fmtMoney(led.dryPowderPct * led.bookValue)} sub={pct0(led.dryPowderPct)} c="#34d399" />
      <Cell k={`vs ${b?.label || 'benchmark'}`} v={beat == null ? '—' : signed(beat)}
        sub={b?.return1y != null ? `you ${signed(led.bookReturnPct)} · idx ${signed(b.return1y)} (1y)` : 'index feed pending'}
        c={beat == null ? undefined : beat >= 0 ? '#34d399' : '#f87171'} />
      <Cell k="Unrealised gains" v={led.unrealizedPnl == null ? '—' : `${led.unrealizedPnl >= 0 ? '+' : ''}${fmtMoney(led.unrealizedPnl)}`}
        sub="open profit across book" c={led.unrealizedPnl == null ? undefined : led.unrealizedPnl >= 0 ? '#34d399' : '#f87171'} />
    </div>
  )
}

// ── filter & sort bar (Navattic pattern, all URL state) ───────────────────────
const FACETS = [
  { key: 'layer', label: 'Layer', opts: [['trade', 'Trade'], ['hold', 'Hold']], get: (r) => r.classification?.layer },
  { key: 'bucket', label: 'Bucket', opts: [['core', 'Core'], ['satellite', 'Satellite'], ['picks', 'Picks']], get: (r) => r.classification?.bucket },
  { key: 'theme', label: 'Theme', opts: Object.entries(THEME_LABEL), get: (r) => r.classification?.theme },
  { key: 'sharia', label: 'Sharia', opts: Object.entries(SHARIA_LABEL), get: (r) => r.sharia_status || 'unknown' },
  { key: 'asset', label: 'Asset', opts: [['stock', 'Stock'], ['etf', 'ETF'], ['crypto', 'Crypto'], ['commodity', 'Commodity']], get: assetKind },
]
const SORTS = [['manual', 'Manual'], ['grade', 'Grade'], ['pnl', 'P&L'], ['acct', '% of book'], ['updated', 'Updated'], ['alpha', 'A–Z']]
const parseSet = (s) => new Set((s || '').split(',').filter(Boolean))
const labelFor = (key, val) => FACETS.find((f) => f.key === key)?.opts.find(([v]) => v === val)?.[1] || val

function FacetMenu({ facet, selected, onToggle, open, setOpen }) {
  const n = selected.size
  return (
    <div className="relative">
      <button onClick={() => setOpen(open === facet.key ? null : facet.key)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${n ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-zinc-800 text-zinc-400 hover:bg-white/5'}`}>
        {facet.label}{n > 0 && <span className="rounded bg-emerald-500/20 px-1 tabular">{n}</span>}
        <span className="text-[8px] text-zinc-600">▾</span>
      </button>
      {open === facet.key && (
        <div className="absolute left-0 z-30 mt-1 min-w-[150px] rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl shadow-black/50">
          {facet.opts.map(([v, label]) => (
            <button key={v} onClick={() => onToggle(facet.key, v)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/5">
              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] ${selected.has(v) ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : 'border-zinc-700 text-transparent'}`}>✓</span>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterSortBar({ q, setQ, sel, toggleFacet, clearAll, minGrade, setMinGrade, sort, setSort, open, setOpen, count }) {
  const chips = []
  for (const f of FACETS) for (const v of sel[f.key]) chips.push({ key: f.key, v, label: labelFor(f.key, v) })
  if (minGrade) chips.push({ key: '_grade', v: '', label: `grade ≥ ${minGrade}` })
  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-zinc-600">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ticker or name"
            className="w-full rounded-md border border-zinc-800 bg-black/30 py-1.5 pl-7 pr-2 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none" />
        </div>
        {FACETS.map((f) => <FacetMenu key={f.key} facet={f} selected={sel[f.key]} onToggle={toggleFacet} open={open} setOpen={setOpen} />)}
        <label className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Grade ≥
          <select value={minGrade} onChange={(e) => setMinGrade(e.target.value)} className="bg-transparent text-zinc-200 focus:outline-none">
            {['', '5', '6', '7', '8', '9'].map((g) => <option key={g} value={g} className="bg-zinc-950">{g || 'any'}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-transparent text-zinc-200 focus:outline-none">
            {SORTS.map(([v, l]) => <option key={v} value={v} className="bg-zinc-950">{l}</option>)}
          </select>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-600">{count} match{count === 1 ? '' : 'es'}</span>
          {chips.map((c) => (
            <button key={c.key + c.v} onClick={() => (c.key === '_grade' ? setMinGrade('') : toggleFacet(c.key, c.v))}
              className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 font-mono text-[10px] text-zinc-300 hover:bg-white/5">
              {c.label} <span className="text-zinc-600">✕</span>
            </button>
          ))}
          <button onClick={clearAll} className="font-mono text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">Clear</button>
        </div>
      )}
    </div>
  )
}

// ── a list row ────────────────────────────────────────────────────────────────
// Trade rows show the plan rail (entry readiness / in-trade stop·TP). Hold rows
// are sized by allocation — no plan/stop — so instead of an empty "no plan" rail
// they show their bucket/role/theme posture.
function HoldPosture({ t }) {
  const c = t.classification || {}
  const bits = [BUCKET_LABEL[c.bucket] || 'Hold']
  if (c.theme) bits.push(THEME_LABEL[c.theme] || c.theme)
  if (c.coreType) bits.push(c.coreType === 'quality_income' ? 'Quality income' : c.coreType.toUpperCase())
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase leading-tight tracking-wider text-zinc-500">
      {bits.map((b, i) => <span key={i} className={i === 0 ? 'text-sky-300/80' : ''}>{b}{i < bits.length - 1 ? ' ·' : ''}</span>)}
      <span className="text-zinc-700">· sized by weight</span>
    </div>
  )
}

// Per-row alert toggle — arms/disarms the plan-derived alert set (entry · stop ·
// targets). Icon-only, sits at the row start. Only meaningful for a TRADE with
// levels; holds render an empty slot so rows stay aligned.
function BellIcon({ filled }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}
function AlertToggle({ armed, busy, onToggle }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle() }} disabled={busy}
      title={armed ? 'Plan alerts armed — click to disarm' : 'Arm alerts from this plan (entry · stop · targets)'}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-40 ${armed ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-600 hover:text-zinc-300'} ${busy ? 'animate-pulse' : ''}`}>
      <BellIcon filled={armed} />
    </button>
  )
}

function ListRow({ t, quote, holding, led, draggable, onOpen, onDragStart, onDragEnd, onDragOver, onDrop, dropEdge, armed, alertBusy, onToggleAlert, onContextMenu }) {
  const price = quote?.price ?? null
  const change = quote?.changePct ?? null
  const sharia = t.sharia_status || 'unknown'
  const dot = ASSET[assetKind(t)] || '#52525b'
  const isHold = t.classification?.layer === 'hold'
  const layer = LAYER[t.classification?.layer] || null
  const { v, RailComp, state: planState, dist } = railFor(t, price, holding)
  const pctOfBook = holding && led?.bookValue ? holding.value / led.bookValue : null

  return (
    <div draggable={draggable} onDragStart={draggable ? onDragStart : undefined} onDragEnd={onDragEnd}
      onDragOver={onDragOver} onDrop={onDrop} onContextMenu={onContextMenu}
      onClick={() => onOpen(t.symbol)}
      className={`row-in group relative grid min-h-[48px] grid-cols-[24px_minmax(150px,1fr)_minmax(120px,1.6fr)_92px_160px_104px] items-center gap-x-3 border-b border-zinc-900 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.025] cursor-default ${dropEdge ? 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-emerald-400' : ''}`}>
      {/* alert bell (trades only) — leading slot, empty for holds to keep alignment */}
      <div className="flex justify-center">{!isHold && <AlertToggle armed={armed} busy={alertBusy} onToggle={() => onToggleAlert(t.symbol, armed)} />}</div>
      {/* identity */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="shrink-0 whitespace-nowrap font-mono text-[13px] font-semibold tracking-tight text-zinc-100">{t.symbol}</span>
        {t.unread && <UnreadBadge className="shrink-0" />}
        {isRecent(t.first_seen) && <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-emerald-300">New</span>}
        {layer && <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider" style={{ color: layer.c, background: layer.c + '1a' }}>{layer.label}</span>}
        <span className="truncate text-[11px] text-zinc-500">{t.name || ''}</span>
        {t.first_seen && <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[10px] text-zinc-600" title={`Added ${new Date(t.first_seen).toLocaleDateString('en-GB')}`}>{agoShort(t.first_seen)}</span>}
      </div>
      {/* posture — plan rail for trades, allocation posture for holds */}
      <div className="min-w-0">
        {isHold ? (
          <HoldPosture t={t} />
        ) : hasPlan(v) ? (
          <>
            <RailComp v={v} />
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[10px] uppercase leading-tight tracking-wider">
              <span style={{ color: planState.dot }}>{planState.label}</span>
              {dist.map((d) => <span key={d} className="text-zinc-600">{d}</span>)}
            </div>
          </>
        ) : (
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400/80" title="A trade needs entry + stop levels">{planState.label}</div>
        )}
      </div>
      {/* price */}
      <div className="whitespace-nowrap text-right font-mono tabular">
        <span className="text-[13px] text-zinc-100">{fmtPrice(price)}</span>
        {change != null && <span className="ml-1.5 text-[10px]" style={{ color: change >= 0 ? '#34d399' : '#f87171' }}>{change >= 0 ? '+' : ''}{change.toFixed(1)}%</span>}
      </div>
      {/* holding */}
      <div className="whitespace-nowrap text-right font-mono text-[11px] tabular text-zinc-400">
        {holding ? (
          <span className="flex items-center justify-end gap-x-2.5">
            {pctOfBook != null && <span className="hidden text-zinc-600 sm:inline">{pct0(pctOfBook)}</span>}
            <span className="text-zinc-200">{fmtMoney(holding.value, holding.currency)}</span>
            <span style={{ color: (holding.pnl ?? 0) >= 0 ? '#34d399' : '#f87171' }}>{(holding.pnl ?? 0) >= 0 ? '+' : ''}{fmtMoney(holding.pnl, holding.currency)}</span>
          </span>
        ) : (
          <span className="text-zinc-700">—</span>
        )}
      </div>
      {/* sharia + grade */}
      <div className="flex items-center justify-end gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${SHARIA[sharia] || SHARIA.unknown}`}>{SHARIA_LABEL[sharia] || 'Unscreened'}</span>
        <span className="w-4 text-right font-mono text-[11px]" style={t.top_grade != null ? { color: t.top_grade >= 7 ? '#34d399' : t.top_grade >= 5 ? '#fbbf24' : '#f87171' } : undefined} title="§20 grade">{t.top_grade ?? ''}</span>
      </div>
    </div>
  )
}

// ── scan / action bar ─────────────────────────────────────────────────────────
// Spins through the flagged names (at-risk first, then worth-a-look), the way the
// agent triages the book — deterministic + layer-aware, so a hold is never
// flagged for lacking a stop. "Ask Z" hands off to the portfolio chat for depth.
function ScanBar({ atRisk, watch, onOpen, onAskZ }) {
  const items = useMemo(() => [
    ...atRisk.map((x) => ({ ...x, kind: 'at_risk' })),
    ...watch.map((x) => ({ ...x, kind: 'watch' })),
  ], [atRisk, watch])
  const [i, setI] = useState(0)
  useEffect(() => { setI(0) }, [items.length])
  useEffect(() => {
    if (items.length <= 1) return
    const id = setInterval(() => setI((x) => (x + 1) % items.length), 3800)
    return () => clearInterval(id)
  }, [items.length])
  const clear = items.length === 0
  const cur = items[i % Math.max(1, items.length)] || null
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-900 bg-gradient-to-r from-zinc-900/50 to-black/10 px-3 py-2">
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">
        <span className="relative flex h-2 w-2">
          {!clear && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${clear ? 'bg-emerald-500' : 'bg-amber-400'}`} />
        </span>
        Scan
      </span>
      {clear ? (
        <span className="text-[12px] text-zinc-500">All clear — nothing needs attention right now.</span>
      ) : (
        <button key={cur.symbol} onClick={() => onOpen(cur.symbol)} className="scan-in group flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${cur.kind === 'at_risk' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>{cur.kind === 'at_risk' ? 'At risk' : 'Watch'}</span>
          <span className="shrink-0 font-mono text-[13px] font-semibold text-zinc-100">{cur.symbol}</span>
          <span className="truncate text-[12px] text-zinc-400 group-hover:text-zinc-200">{cur.reason}</span>
        </button>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        {!clear && <span className="font-mono text-[10px] text-zinc-600"><span className="text-red-400/80">{atRisk.length}</span> at risk · <span className="text-amber-400/80">{watch.length}</span> watch</span>}
        {onAskZ && <button onClick={onAskZ} className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/20"><span className="font-bold">Z</span> Ask</button>}
      </div>
    </div>
  )
}

// ── right-click context menu ──────────────────────────────────────────────────
function ContextMenu({ menu, actions, onClose }) {
  useEffect(() => {
    if (!menu) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey); window.addEventListener('scroll', onClose, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onClose, true) }
  }, [menu, onClose])
  if (!menu) return null
  // Clamp to viewport so the menu never opens off-screen.
  const x = Math.min(menu.x, window.innerWidth - 200)
  const y = Math.min(menu.y, window.innerHeight - (actions.length * 32 + 16))
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="fixed z-50 min-w-[184px] rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl shadow-black/60" style={{ left: x, top: y }}>
        <div className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">{menu.t.symbol}</div>
        {actions.map((a, i) => a.divider ? <div key={i} className="my-1 border-t border-zinc-800/70" /> : (
          <button key={i} onClick={() => { a.onClick(); onClose() }} disabled={a.disabled}
            className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[12px] hover:bg-white/5 disabled:opacity-40 ${a.danger ? 'text-red-300' : 'text-zinc-300'}`}>
            <span className="w-4 text-center text-[11px] text-zinc-500">{a.icon}</span>{a.label}
          </button>
        ))}
      </div>
    </>
  )
}

// ── the page ──────────────────────────────────────────────────────────────────
export default function Portfolio({ onOpen, onAskZ }) {
  const [rows, setRows] = useState(null)
  const [quotes, setQuotes] = useState({})
  const [led, setLed] = useState(null)
  const [holdings, setHoldings] = useState([])
  const [owners, setOwners] = useState([])
  const [households, setHouseholds] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [dragOver, setDragOver] = useState(null)
  const [dropAt, setDropAt] = useState(null)        // { col, before } — insertion indicator
  const [drag, setDrag] = useState(null)            // { symbol, from } currently dragged
  const [planArmed, setPlanArmed] = useState(new Set())  // symbols with plan alerts armed
  const [alertBusy, setAlertBusy] = useState(null)
  const [menu, setMenu] = useState(null)                 // right-click context menu { x, y, t }
  // Which status groups are collapsed — persisted across reloads. Archived starts
  // collapsed by default (v2 key seeds it; user toggles persist thereafter).
  const [collapsed, setCollapsed] = useState(() => {
    try { const s = localStorage.getItem('portfolio.collapsed.v2'); return new Set(s == null ? ['archived'] : JSON.parse(s)) }
    catch { return new Set(['archived']) }
  })
  const toggleCollapsed = (key) => setCollapsed((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    try { localStorage.setItem('portfolio.collapsed.v2', JSON.stringify([...next])) } catch { /* ignore */ }
    return next
  })

  const [scope, setScope] = useUrlState('scope', 'me')
  const isHousehold = scope.startsWith('hh:')

  // Filter + sort state — all in the URL (shareable, refresh-stable).
  const [q, setQ] = useUrlState('q', '')
  const [layerF, setLayerF] = useUrlState('layer', '')
  const [bucketF, setBucketF] = useUrlState('bucket', '')
  const [themeF, setThemeF] = useUrlState('theme', '')
  const [shariaF, setShariaF] = useUrlState('sharia', '')
  const [assetF, setAssetF] = useUrlState('asset', '')
  const [minGrade, setMinGrade] = useUrlState('grade', '')
  const [sort, setSort] = useUrlState('sort', 'manual')
  const [openFacet, setOpenFacet] = useState(null)
  const setters = { layer: setLayerF, bucket: setBucketF, theme: setThemeF, sharia: setShariaF, asset: setAssetF }
  const sel = {
    layer: parseSet(layerF), bucket: parseSet(bucketF), theme: parseSet(themeF),
    sharia: parseSet(shariaF), asset: parseSet(assetF),
  }
  const toggleFacet = (key, val) => {
    const next = new Set(sel[key]); next.has(val) ? next.delete(val) : next.add(val)
    setters[key]([...next].join(','))
  }
  const clearAll = () => { for (const k of Object.keys(setters)) setters[k](''); setMinGrade(''); setQ('') }

  const refreshArmed = (alerts) => setPlanArmed(new Set((alerts?.custom || []).filter((c) => c.created_by === 'plan').map((c) => c.symbol)))
  const loadShared = () => {
    api.tickers().then(setRows); api.quotes().then(setQuotes)
    api.alerts().then(refreshArmed).catch(() => {})
  }
  const loadScoped = () => {
    api.ledger(scope).then(setLed).catch(() => setLed(null))
    api.holdings(scope).then(setHoldings).catch(() => setHoldings([]))
  }
  useEffect(loadShared, [])
  useEffect(() => { setLed(null); loadScoped() }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.accounts().then((d) => { setOwners(d.owners || []); setHouseholds(d.households || []) }).catch(() => {}) }, [])
  // Snap an unknown scope to the first owner once they load.
  useEffect(() => {
    if (!owners.length || isHousehold) return
    if (!owners.some((o) => o.id === scope)) setScope(owners[0].id)
  }, [owners]) // eslint-disable-line react-hooks/exhaustive-deps

  // Holdings grouped per ticker (a position can span accounts → aggregate).
  const holdingByTicker = useMemo(() => {
    const m = {}
    for (const h of holdings) {
      const g = (m[h.ticker] ||= { quantity: 0, value: 0, pnl: 0, cost: 0, currency: h.currency, accounts: [] })
      g.quantity += h.quantity; g.value += h.value; g.pnl += h.pnl || 0
      g.cost += (h.avgPrice || 0) * h.quantity
      if (!g.accounts.includes(h.accountLabel)) g.accounts.push(h.accountLabel)
    }
    for (const g of Object.values(m)) g.avgPrice = g.quantity ? g.cost / g.quantity : null
    return m
  }, [holdings])

  // Filter predicate over the shared universe.
  const matches = (t) => {
    if (q) { const s = q.toLowerCase(); if (!t.symbol.toLowerCase().includes(s) && !(t.name || '').toLowerCase().includes(s)) return false }
    for (const f of FACETS) { if (sel[f.key].size && !sel[f.key].has(f.get(t))) return false }
    if (minGrade && !(t.top_grade != null && t.top_grade >= Number(minGrade))) return false
    return true
  }

  // Sort comparator within a column. 'manual' keeps the server sort_order.
  const sortRows = (items) => {
    if (sort === 'manual') return items
    const g = (t) => holdingByTicker[t.symbol]
    const cmp = {
      grade: (a, b) => (b.top_grade ?? -1) - (a.top_grade ?? -1),
      pnl: (a, b) => ((g(b)?.pnl ?? -Infinity) - (g(a)?.pnl ?? -Infinity)),
      acct: (a, b) => ((g(b)?.value ?? -1) - (g(a)?.value ?? -1)),
      updated: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
      alpha: (a, b) => a.symbol.localeCompare(b.symbol),
    }[sort]
    return cmp ? [...items].sort(cmp) : items
  }

  const byColumn = useMemo(() => {
    const cols = { new: [], watching: [], in: [], closed: [], archived: [] }
    for (const t of rows || []) {
      if (t.status === 'new' && isIdea(t)) continue           // ideas live on the Tickers tab
      if (!cols[t.status]) continue
      if (!matches(t)) continue
      // Active/Closed are owner-scoped: only show a position THIS owner holds.
      if ((t.status === 'in' || t.status === 'closed') && !holdingByTicker[t.symbol]) continue
      cols[t.status].push(t)
    }
    for (const k of Object.keys(cols)) cols[k] = sortRows(cols[k])
    return cols
  }, [rows, holdingByTicker, q, layerF, bucketF, themeF, shariaF, assetF, minGrade, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const matchCount = useMemo(() => Object.values(byColumn).reduce((n, a) => n + a.length, 0), [byColumn])

  // Deterministic, layer-aware triage over the whole (owner-scoped) book — runs
  // regardless of the active filters so a risk is never hidden. Same rules as the
  // chat roster (assessPosture), so the bar and the agent always agree.
  const { atRisk, watchList } = useMemo(() => {
    const at = [], w = []
    for (const t of rows || []) {
      if (t.status === 'closed' || t.status === 'archived' || (t.status === 'new' && isIdea(t))) continue
      const layer = t.classification?.layer
      const held = holdingByTicker[t.symbol]
      const price = quotes[t.symbol]?.price ?? null
      const state = layer === 'hold' ? null : priceVsPlan(price, effectivePlan(t))
      const a = assessPosture({
        layer, state, grade: t.top_grade,
        held: held ? { value: held.value, pnl: held.pnl } : null,
        synthesis: t.synthesis ? { action: t.synthesis.action, contested: t.synthesis.contested } : null,
      })
      if (a.kind === 'at_risk') at.push({ symbol: t.symbol, reason: a.reason })
      else if (a.kind === 'watch') w.push({ symbol: t.symbol, reason: a.reason })
    }
    return { atRisk: at, watchList: w }
  }, [rows, holdingByTicker, quotes])

  const onSync = async () => {
    setSyncing(true)
    try { await api.syncBrokers(); loadScoped(); api.tickers().then(setRows) }
    finally { setSyncing(false) }
  }

  // ── drag: move between manual stages (new↔watching) AND reorder within a group.
  // Order persists via sort_order (the 'Manual' sort). Only the manual stages
  // drag; Active/Closed are broker-driven.
  const MANUAL = ['new', 'watching']
  const onDragStart = (e, t) => { setDrag({ symbol: t.symbol, from: t.status }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.symbol) }
  const onDragEnd = () => { setDrag(null); setDropAt(null); setDragOver(null) }
  const onRowDragOver = (e, t, col) => {
    if (!drag || !col.droppable) return
    e.preventDefault(); e.stopPropagation()
    setDragOver(col.key); setDropAt({ col: col.key, before: t.symbol })
  }
  // Drop dragged card into `destCol`, inserted before `beforeSym` (or appended).
  const moveCard = async (destCol, beforeSym) => {
    const d = drag; setDrag(null); setDropAt(null); setDragOver(null)
    if (!d || !MANUAL.includes(d.from) || !MANUAL.includes(destCol)) return
    if (beforeSym === d.symbol) return
    const prev = rows
    const moved = { ...prev.find((t) => t.symbol === d.symbol), status: destCol }
    const without = prev.filter((t) => t.symbol !== d.symbol)
    let idx
    if (beforeSym) idx = without.findIndex((t) => t.symbol === beforeSym)
    else { let last = -1; without.forEach((t, i) => { if (t.status === destCol) last = i }); idx = last + 1 }
    if (idx < 0) idx = without.length
    const next = [...without]; next.splice(idx, 0, moved)
    setRows(next)   // optimistic
    setSort('manual')   // a manual drag implies manual ordering
    const destOrder = next.filter((t) => t.status === destCol).map((t) => t.symbol)
    try {
      if (d.from !== destCol) await api.setStatus(d.symbol, destCol)
      await api.reorderTickers(destOrder)
    } catch { loadShared() }
  }
  const onColDrop = (e, col) => { e.preventDefault(); if (col.droppable) moveCard(col.key, dropAt?.col === col.key ? dropAt.before : null) }
  const onRowDrop = (e, t, col) => { e.preventDefault(); e.stopPropagation(); if (col.droppable) moveCard(col.key, t.symbol) }

  // Move a ticker between pipeline stages (optimistic), used by the context menu.
  const setRowStatus = async (sym, status) => {
    setRows((prev) => prev.map((t) => (t.symbol === sym ? { ...t, status } : t)))
    await api.setStatus(sym, status).catch(loadShared)
  }
  // Build the context-menu actions for a given row.
  const rowActions = (t) => {
    const isHold = t.classification?.layer === 'hold'
    const armed = planArmed.has(t.symbol)
    const STAGES = [['new', 'Potential'], ['watching', 'Watched']]
    const acts = [{ label: 'Open ticker', icon: '↗', onClick: () => onOpen(t.symbol) }]
    if (!isHold) acts.push({ label: armed ? 'Disarm alerts' : 'Arm plan alerts', icon: armed ? '✕' : '🔔', onClick: () => onToggleAlert(t.symbol, armed) })
    // Manual stages (new/watching) and archived can be re-staged from the menu.
    const movable = ['new', 'watching', 'archived'].includes(t.status)
    if (movable) {
      acts.push({ divider: true })
      for (const [k, label] of STAGES.filter(([k]) => k !== t.status)) acts.push({ label: `Move to ${label}`, icon: '→', onClick: () => setRowStatus(t.symbol, k) })
      // Archive parks the ticker off the board (restorable here or on the Tickers tab).
      if (t.status !== 'archived') acts.push({ label: 'Move to Archive', icon: '🗄', danger: true, onClick: () => setRowStatus(t.symbol, 'archived') })
    }
    return acts
  }

  const onToggleAlert = async (sym, isArmed) => {
    setAlertBusy(sym)
    setPlanArmed((prev) => { const n = new Set(prev); isArmed ? n.delete(sym) : n.add(sym); return n })  // optimistic
    try {
      const res = isArmed ? await api.disarmAlerts(sym) : await api.armAlerts(sym)
      if (res?.alerts) refreshArmed(res.alerts)
    } catch { api.alerts().then(refreshArmed).catch(() => {}) }
    finally { setAlertBusy(null) }
  }

  if (rows == null) return <div className="px-3 py-10 text-center text-sm text-zinc-600">Loading…</div>

  return (
    <div className="space-y-3" onClick={() => openFacet && setOpenFacet(null)}>
      {/* header: owner selector + sync, then the scoped summary strip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OwnerBar owners={owners} households={households} scope={scope} setScope={setScope} />
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-600">synced {sinceText(holdings?.[0]?.syncedAt)}</span>
          <button onClick={onSync} disabled={syncing}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/5 disabled:opacity-50">
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
      <Summary led={led} />

      <ScanBar atRisk={atRisk} watch={watchList} onOpen={onOpen} onAskZ={onAskZ} />

      <FilterSortBar q={q} setQ={setQ} sel={sel} toggleFacet={toggleFacet} clearAll={clearAll}
        minGrade={minGrade} setMinGrade={setMinGrade} sort={sort} setSort={setSort}
        open={openFacet} setOpen={setOpenFacet} count={matchCount} />

      {/* horizontal scroll on mobile — the dense row grid keeps its layout */}
      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
       <div className="min-w-[660px] overflow-hidden rounded-lg border border-zinc-900 bg-black/20">
        {COLUMNS.map((col) => {
          const items = byColumn[col.key]
          const isCollapsed = collapsed.has(col.key)
          return (
            <div key={col.key}
              onDragOver={col.droppable && drag ? (e) => { e.preventDefault(); setDragOver(col.key) } : undefined}
              onDragLeave={col.droppable ? () => setDragOver((d) => (d === col.key ? null : d)) : undefined}
              onDrop={(e) => onColDrop(e, col)}
              className={`border-b border-zinc-900 last:border-b-0 transition-colors ${dragOver === col.key ? 'bg-emerald-500/[0.04]' : ''}`}>
              <button onClick={() => toggleCollapsed(col.key)}
                style={{ borderLeft: `3px solid ${col.accent}`, background: `${col.accent}14` }}
                className="flex w-full items-center gap-2 border-b border-zinc-900 px-3 py-1.5 text-left transition-colors hover:brightness-125">
                <span style={{ color: col.accent }} className={`font-mono text-[9px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                <span style={{ color: col.accent }} className="text-[11px] font-semibold uppercase tracking-wider">{col.label}</span>
                {col.broker && <span className="rounded bg-zinc-800/60 px-1 py-0.5 font-mono text-[9px] text-zinc-500" title="Mirrors your broker — not manually set">broker</span>}
                <span className="font-mono text-[10px] tabular text-zinc-600">{items.length}</span>
              </button>
              {isCollapsed ? null : items.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-zinc-700">{col.broker ? 'No open positions' : '—'}</div>
              ) : (
                items.map((t) => (
                  <ListRow key={t.symbol} t={t} quote={quotes[t.symbol]} holding={holdingByTicker[t.symbol]} led={led}
                    draggable={col.droppable} onOpen={onOpen}
                    onDragStart={(e) => onDragStart(e, t)} onDragEnd={onDragEnd}
                    onDragOver={(e) => onRowDragOver(e, t, col)} onDrop={(e) => onRowDrop(e, t, col)}
                    dropEdge={dropAt?.col === col.key && dropAt?.before === t.symbol}
                    armed={planArmed.has(t.symbol)} alertBusy={alertBusy === t.symbol} onToggleAlert={onToggleAlert}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, t }) }} />
                ))
              )}
            </div>
          )
        })}
       </div>
      </div>

      <ContextMenu menu={menu} actions={menu ? rowActions(menu.t) : []} onClose={() => setMenu(null)} />
    </div>
  )
}
