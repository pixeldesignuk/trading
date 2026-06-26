import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useUrlState } from '../useUrlState.js'
// Pure shared model math (constants + derivePyramid). Imported from the server
// package; Vite bundles it for the client (see vite.config.js fs.allow).
import { derivePyramid, DEFAULT_THEME_SPLITS, DEFAULT_CORE_TYPE_SPLITS } from '../../../server/portfolio/satellite-model.js'

// Allocation Ledger — nested 4-bucket view (Zero Investing Masterclass):
//   CORE → SATELLITES (with derived pyramid + theme coverage) → PICKS → CASH
// API shape: /api/portfolio/:book/ledger →
//   { rows:[{symbol,name,bucket,theme,tier,currentPct,targetPct,suggestedPct,deltaPct,
//            action,rr,overCap,needsLevels,pending,pinned}],
//     pyramid:{neutral,effective}, cashAdvisory, regime:{regime,label},
//     deployedPct, dryPowderPct, bookValue, benchmark, bookReturnPct }
// Note: row.bucket is singular 'satellite'; we map that → 'satellites' group.

const TIER = {
  defensive: { label: 'Defensive', c: '#34d399' },
  lower:     { label: 'Lower',     c: '#60a5fa' },
  moderate:  { label: 'Moderate',  c: '#fbbf24' },
  high:      { label: 'High',      c: '#f87171' },
}

const REGIME = {
  expansion:  { c: '#34d399', dot: '#34d399' },
  late_cycle: { c: '#fbbf24', dot: '#fbbf24' },
  defense:    { c: '#f87171', dot: '#f87171' },
  unknown:    { c: '#71717a', dot: '#52525b' },
}

// Four fixed bucket blocks — order is the masterclass ladder.
const BUCKETS = [
  { key: 'core',       label: 'CORE',       color: '#38bdf8', desc: 'buy-and-hold base' },
  { key: 'satellites', label: 'SATELLITES', color: '#a78bfa', desc: 'ETF boosters · pyramid inside' },
  { key: 'picks',      label: 'PICKS',      color: '#f472b6', desc: 'active book · capital + risk capped' },
  { key: 'cash',       label: 'CASH',       color: '#34d399', desc: 'dry powder' },
]

const THEMES = ['tech', 'em', 'commodities', 'niche', 'crypto']

// ---- v2 targets-editor config (nested 4-bucket model) -------------------
// L1 buckets: [key, label, color, healthy band|null]. Order = masterclass ladder.
const L1_SLEEVES = [
  ['core_pct',      'CORE',       '#38bdf8', [0.40, 0.80]],
  ['satellite_pct', 'SATELLITES', '#a78bfa', [0.05, 0.30]],
  ['picks_pct',     'PICKS',      '#f472b6', null],
  ['cash_pct',      'CASH',       '#34d399', [0.05, 0.20]],
]
const THEME_LABEL = { tech: 'Tech', em: 'Emerging mkts', commodities: 'Commodities', niche: 'Niche', crypto: 'Crypto' }
const THEME_COLOR = { tech: '#60a5fa', em: '#34d399', commodities: '#fbbf24', niche: '#f472b6', crypto: '#a78bfa' }
const CORE_TYPE_LABEL = { world: 'World', us: 'US', quality_income: 'Quality income' }
const CORE_TYPE_COLOR = { world: '#38bdf8', us: '#818cf8', quality_income: '#34d399' }
const PYRAMID_ORDER = ['high', 'moderate', 'lower', 'defensive']

// Reset-to-masterclass templates in v2 shape (mirrors server TEMPLATES).
const V2_TEMPLATES = {
  personal: {
    core_pct: 0.60, satellite_pct: 0.20, picks_pct: 0.12, cash_pct: 0.08, active_risk_cap_pct: 0.02,
    satellite_theme_splits: { ...DEFAULT_THEME_SPLITS }, core_type_splits: { ...DEFAULT_CORE_TYPE_SPLITS },
  },
  kids: {
    core_pct: 0.80, satellite_pct: 0.00, picks_pct: 0.00, cash_pct: 0.20, active_risk_cap_pct: 0.00,
    satellite_theme_splits: { ...DEFAULT_THEME_SPLITS }, core_type_splits: { ...DEFAULT_CORE_TYPE_SPLITS },
  },
}

// Proportionally rebalance a group of keys that should sum to 1: set `changedKey`
// to `val`, distribute the remainder across the others by their current weights.
function rebalanceGroup(obj, keys, changedKey, val) {
  val = Math.max(0, Math.min(1, val))
  const others = keys.filter((k) => k !== changedKey)
  const otherSum = others.reduce((s, k) => s + Number(obj[k] || 0), 0)
  const remaining = 1 - val
  const next = { ...obj, [changedKey]: val }
  if (otherSum <= 1e-9) others.forEach((k) => { next[k] = others.length ? remaining / others.length : 0 })
  else others.forEach((k) => { next[k] = (Number(obj[k] || 0) / otherSum) * remaining })
  return next
}

// Formatters
const fmtGBP = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }))
const pct  = (f) => (f == null ? '—' : `${(f * 100).toFixed(1)}%`)
const pct0 = (f) => (f == null ? '—' : `${Math.round(f * 100)}%`)
const signed = (f) => (f == null ? '—' : `${f >= 0 ? '+' : ''}${(f * 100).toFixed(1)}%`)

// Group ledger rows by the 4 UI buckets.
function groupRows(rows) {
  const g = { core: [], satellites: [], picks: [], cash: [] }
  for (const r of rows) {
    const k = r.bucket === 'satellite' ? 'satellites' : (r.bucket || 'core')
    if (g[k]) g[k].push(r)
  }
  return g
}

// ---- summary strip -------------------------------------------------------
function Summary({ led }) {
  const b = led.benchmark
  const beat = b?.return1y != null && led.bookReturnPct != null ? led.bookReturnPct - b.return1y : null
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-900 bg-zinc-900 sm:grid-cols-4">
      <Cell k="Deployed" v={pct0(led.deployedPct)} sub={`book ${fmtGBP(led.bookValue)}`} />
      <Cell k="Dry powder" v={fmtGBP(led.dryPowderPct * led.bookValue)} sub={pct0(led.dryPowderPct)} c="#34d399" />
      <Cell k={`vs ${b?.label || 'benchmark'}`}
        v={beat == null ? '—' : signed(beat)}
        sub={b?.return1y != null ? `you ${signed(led.bookReturnPct)} · idx ${signed(b.return1y)} (1y)` : 'index feed pending'}
        c={beat == null ? undefined : beat >= 0 ? '#34d399' : '#f87171'} />
      <Cell k="Unrealised gains" v={led.unrealizedPnl == null ? '—' : `${led.unrealizedPnl >= 0 ? '+' : ''}${fmtGBP(led.unrealizedPnl)}`}
        sub="open profit across book"
        c={led.unrealizedPnl == null ? undefined : led.unrealizedPnl >= 0 ? '#34d399' : '#f87171'} />
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

// ---- macro rotation banner -----------------------------------------------
function RotationBanner({ rot }) {
  const r = REGIME[rot?.regime] || REGIME.unknown
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-900 bg-zinc-900/20 px-3 py-2 font-mono text-[10px] text-zinc-500">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.dot }} />
      <span>Rotation regime:</span>
      <span style={{ color: r.c }}>{rot?.label || '—'}</span>
      {rot?.favorTiers?.length > 0 && <span className="text-zinc-400">· favour {rot.favorTiers.join(' / ')}</span>}
      {rot?.direction && <span className="hidden text-zinc-600 sm:inline">· {rot.direction}</span>}
      {rot?.ratios && (
        <span className="ml-auto flex gap-2 text-zinc-700">
          {rot.ratios.map((x) => (
            <span key={x.name} title={`${x.name} — ${x.gauges}${x.changePct != null ? ` (${x.changePct >= 0 ? '+' : ''}${x.changePct.toFixed(1)}%)` : ''}`}>
              {x.name} {x.trend === 'up' ? '↑' : x.trend === 'down' ? '↓' : x.trend === 'flat' ? '→' : '·'}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

// ---- a holding row (reused across all buckets) ---------------------------
function Row({ r, holding, bookValue = 0, onOpen }) {
  const tier = TIER[r.tier] || { label: r.tier || '—', c: '#71717a' }
  const isPending = r.pending === true
  const isTrade   = r.action === 'trade' || r.bucket === 'picks'
  const value     = holding?.value ?? null
  const pnl       = holding?.pnl ?? null
  const basis     = value != null && pnl != null ? value - pnl : null
  const pnlPct    = basis && basis > 0 ? pnl / basis : null
  return (
    <div onClick={() => onOpen?.(r.symbol)}
      className="row-in grid cursor-pointer grid-cols-[minmax(110px,1.2fr)_minmax(150px,1.4fr)_minmax(64px,auto)] items-center gap-3 border-t border-zinc-900/70 px-4 py-2 transition-colors hover:bg-white/[0.025]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tier.c }} title={`${tier.label} tier`} />
        <span className="font-mono text-[13px] font-semibold tracking-tight text-zinc-100">{r.symbol}</span>
        <span className="truncate font-mono text-[10px] text-zinc-600">{r.name || ''}</span>
        {r.pinned && <span className="shrink-0 text-[10px] text-violet-300" title="pinned target">📌</span>}
        {isTrade && !isPending && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-amber-300">trade</span>}
        {isPending && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-amber-400">pending</span>}
        {r.overCap && <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-red-300">trim to cap</span>}
        {r.needsLevels && <span className="shrink-0 rounded bg-zinc-700/60 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-zinc-400">set entry/stop</span>}
      </div>
      <div className="min-w-0 font-mono text-[11px] tabular">
        {value != null ? (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-zinc-200">{fmtGBP(value)}</span>
            {pnl != null && (
              <span style={{ color: pnl >= 0 ? '#34d399' : '#f87171' }}>
                {pnl >= 0 ? '+' : ''}{fmtGBP(pnl)}
                {pnlPct != null && <span className="ml-1 text-[9px] opacity-70">{signed(pnlPct)}</span>}
              </span>
            )}
          </span>
        ) : <span className="text-zinc-700">—</span>}
      </div>
      <div className="text-right font-mono text-[10px]">
        {isPending
          ? <span className="text-amber-500/80">awaiting sync</span>
          : isTrade
            ? (
              <span className="text-zinc-500">
                {r.rr != null ? `${Number(r.rr).toFixed(1)}:1 R` : 'open trade'}
                {r.suggestedPct != null && r.suggestedPct > 0 && (
                  <span className="ml-1 text-violet-300">{pct0(r.suggestedPct)} sz</span>
                )}
              </span>
            )
            : r.action === 'add'  ? <span className="text-emerald-400">▲ add {fmtGBP(Math.abs(r.deltaPct) * bookValue)}</span>
            : r.action === 'trim' ? <span className="text-amber-400">▼ trim {fmtGBP(Math.abs(r.deltaPct) * bookValue)}</span>
            : <span className="text-zinc-600">on target</span>
        }
      </div>
    </div>
  )
}

// ---- Pyramid widget (SATELLITES block) -----------------------------------
// Each tier bar reads against the PLAN: the bar scale is % of the satellite target
// budget. The target slot is drawn hatched (the planned room for this tier); your
// actual holdings fill it solid from the left. An unfilled tier stays hatched (a
// visible "buy here" gap); over-target spills past the hatch at reduced opacity.
function Pyramid({ pyramid, rows = [], satTargetPct = 0 }) {
  if (!pyramid?.effective) return null
  const order = ['high', 'moderate', 'lower', 'defensive']
  const tierColors = { high: '#f87171', moderate: '#fbbf24', lower: '#60a5fa', defensive: '#34d399' }
  // Held per tier as a fraction of the satellite TARGET budget (currentPct is book-fraction).
  const heldByTier = {}
  for (const r of rows) {
    const c = Number(r.currentPct || 0)
    if (c <= 0 || !r.tier) continue
    heldByTier[r.tier] = (heldByTier[r.tier] || 0) + c
  }
  return (
    <div className="mt-2 border-t border-white/5 pt-2">
      <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-violet-300/70">
        <span>pyramid · derived (tilted by regime)</span>
        <span className="text-[8px] normal-case tracking-normal text-zinc-600">held / target</span>
      </div>
      {order.map((t) => {
        const target = pyramid.effective[t] || 0                                  // % of satellite (sums to 1)
        const held = satTargetPct > 0 ? (heldByTier[t] || 0) / satTargetPct : 0   // % of satellite target
        const filled = Math.min(held, target)
        const over = Math.max(0, held - target)
        const c = tierColors[t]
        return (
          <div key={t} className="mb-1 flex items-center gap-2 font-mono text-[11px]">
            <span className="w-16 text-slate-400 capitalize">{t}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded bg-black/30">
              {/* target slot — hatched (stays visible where unfilled = a buy gap) */}
              <div className="absolute inset-y-0 left-0"
                   style={{ width: `${Math.min(100, target * 100)}%`,
                            backgroundImage: `repeating-linear-gradient(-45deg, ${c}66 0 3px, transparent 3px 7px)`,
                            backgroundColor: `${c}14` }} />
              {/* held — solid fill up to target */}
              <div className="absolute inset-y-0 left-0 transition-all" style={{ width: `${Math.min(100, filled * 100)}%`, background: c }} />
              {/* over-target spill — solid, dimmed, past the hatch */}
              {over > 0 && <div className="absolute inset-y-0" style={{ left: `${Math.min(100, target * 100)}%`, width: `${Math.min(100, over * 100)}%`, background: c, opacity: 0.5 }} />}
            </div>
            <span className="w-14 text-right tabular">
              <span className={held > 0 ? (over > 0 ? 'text-amber-300' : 'text-slate-200') : 'text-zinc-600'}>{Math.round(held * 100)}%</span>
              <span className="text-zinc-700">/{Math.round(target * 100)}%</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---- Theme coverage line (SATELLITES block) ------------------------------
function ThemeCoverage({ rows }) {
  const held = new Set(rows.map((r) => r.theme).filter(Boolean))
  return (
    <div className="mt-2 border-t border-white/5 pt-2">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-violet-300/70">themes</div>
      <div className="flex flex-wrap gap-2">
        {THEMES.map((th) => (
          <span key={th}
            className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${held.has(th) ? 'bg-violet-500/20 text-violet-200' : 'bg-zinc-800/40 text-zinc-600'}`}>
            {th}
          </span>
        ))}
      </div>
    </div>
  )
}

// ---- Core sub-sleeve coverage (CORE block): masterclass 40 / 15 / 15 ------
const CORE_TYPES_UI = [['world', 'World'], ['us', 'US'], ['quality_income', 'Quality-income']]
function CoreCoverage({ coverage = [], onPick, bookValue = 0 }) {
  const byType = Object.fromEntries((coverage || []).map((c) => [c.coreType, c]))
  return (
    <div className="mt-2 border-t border-white/5 pt-2">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-sky-300/70">core sub-sleeves · 40 / 15 / 15</div>
      <div className="space-y-1">
        {CORE_TYPES_UI.map(([k, label]) => {
          const c = byType[k] || { targetPct: 0, currentPct: 0, held: [], needsBuy: true }
          const held = (c.held || []).length > 0
          return (
            <div key={k} className="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={held ? 'text-sky-200' : 'text-zinc-500'}>{held ? '✓' : '○'} {label}</span>
                {held && <span className="truncate text-zinc-600">{c.held.join(', ')}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-zinc-500">{Math.round((c.currentPct || 0) * 100)}% / {Math.round((c.targetPct || 0) * 100)}%</span>
                {c.needsBuy
                  ? <button onClick={() => onPick?.(k)}
                      className="rounded bg-sky-500/15 px-1.5 py-0.5 uppercase tracking-wider text-sky-300 hover:bg-sky-500/25">buy {fmtGBP(Math.max(0, ((c.targetPct || 0) - (c.currentPct || 0)) * bookValue))} →</button>
                  : <span className="text-zinc-600">{fmtGBP((c.currentPct || 0) * bookValue)}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- One bucket block ----------------------------------------------------
// L1 bucket → its target field on the v2 targets object.
const BUCKET_TARGET_KEY = { core: 'core_pct', satellites: 'satellite_pct', picks: 'picks_pct', cash: 'cash_pct' }

function BucketBlock({ bucket, rows, led, targets, holdingByTicker, onOpen, regimeLabel, onPickCore }) {
  const [expanded, setExpanded] = useState(true)
  const { key, label, color, desc } = bucket

  // Current %: cash is the residual dry powder (no held rows); every other bucket
  // is the sum of its holdings' current weight.
  const currentPct = key === 'cash'
    ? (led.dryPowderPct ?? 0)
    : rows.reduce((s, r) => s + (r.currentPct ?? 0), 0)

  // Target %: the actual L1 bucket target (NOT the sum of held-row targets — that
  // undercounts satellites' unheld-theme budget and is 0 for picks/cash).
  const targetPct = Number(targets?.[BUCKET_TARGET_KEY[key]] ?? 0)

  const barFill = targetPct > 0 ? Math.min(1, currentPct / targetPct) : (key === 'cash' ? 1 : 0)
  const isFunded = targetPct > 0 && currentPct >= targetPct - 0.005
  const fillColor = isFunded ? '#34d399' : color

  // £ figures for trade planning: where the bucket is now, and the £ move to target.
  const bookValue = led.bookValue || 0
  const curGBP = currentPct * bookValue
  const gapGBP = targetPct * bookValue - curGBP   // + = add to reach target, − = over

  const pendingRows = rows.filter((r) => r.pending)
  const activeRows  = rows.filter((r) => !r.pending)

  return (
    <div className="border-b border-zinc-900 last:border-b-0">
      {/* Bucket header — tinted colour (colour14 + fill progress), no left border */}
      <button onClick={() => setExpanded((e) => !e)}
        style={{
          background: `linear-gradient(90deg, ${fillColor}33 ${barFill * 100}%, transparent ${barFill * 100}%), linear-gradient(90deg, #0b0d10 ${barFill * 100}%, transparent ${barFill * 100}%), repeating-linear-gradient(-45deg, ${color}1a 0 5px, transparent 5px 11px), ${color}14`,
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-[filter] hover:brightness-125">
        <span style={{ color }} className={`shrink-0 font-mono text-[9px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span style={{ color }} className="shrink-0 text-[11px] font-semibold uppercase tracking-wider">{label}</span>
        {key === 'satellites' && regimeLabel && (
          <span className="shrink-0 font-mono text-[9px] text-zinc-500">· {regimeLabel}</span>
        )}
        {isFunded && <span className="shrink-0 font-mono text-[9px] text-emerald-500">✓ funded</span>}
        {pendingRows.length > 0 && (
          <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-amber-400">
            {pendingRows.length} pending
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">{desc}</span>
        <span className="shrink-0 text-right font-mono text-[10px] tabular leading-tight">
          <span className="block text-zinc-300">
            {pct0(currentPct)}<span className="mx-1 text-zinc-700">/</span><span className="text-zinc-500">{targetPct > 0 ? pct0(targetPct) : '—'} tgt</span>
          </span>
          <span className="block text-[9px] text-zinc-600">
            {fmtGBP(curGBP)}
            {targetPct > 0 && Math.abs(gapGBP) >= 1 && (
              <span className={gapGBP > 0 ? 'text-sky-400/80' : 'text-amber-400/70'}> · {gapGBP > 0 ? 'add ' : 'over '}{fmtGBP(Math.abs(gapGBP))}</span>
            )}
          </span>
        </span>
      </button>

      {expanded && (
        <div>
          {/* Extra info for SATELLITES: pyramid + theme coverage */}
          {key === 'satellites' && (
            <div className="px-4 pb-2 pt-1">
              <Pyramid pyramid={led.pyramid} rows={rows} satTargetPct={targetPct} />
              <ThemeCoverage rows={rows} />
            </div>
          )}

          {/* Extra info for CORE: the 40/15/15 sub-sleeve coverage (guidance) */}
          {key === 'core' && (
            <div className="px-4 pb-2 pt-1">
              <CoreCoverage coverage={led.coreCoverage} onPick={onPickCore} bookValue={led.bookValue} />
            </div>
          )}

          {activeRows.map((r) => (
            <Row key={r.symbol} r={r} holding={holdingByTicker[r.symbol]} bookValue={led.bookValue} onOpen={onOpen} />
          ))}
          {pendingRows.map((r) => (
            <Row key={r.symbol + '_pending'} r={r} holding={holdingByTicker[r.symbol]} bookValue={led.bookValue} onOpen={onOpen} />
          ))}

          {/* CASH block extras */}
          {key === 'cash' && (
            <div className="px-4 py-2">
              <div className="font-mono text-[10px] text-zinc-600">
                Dry powder: <span className="text-emerald-300">{fmtGBP((led.dryPowderPct ?? 0) * led.bookValue)}</span>
              </div>
              {led.cashAdvisory && (
                <div className="mt-1 font-mono text-[11px] text-emerald-300/80">
                  {led.cashAdvisory}
                </div>
              )}
            </div>
          )}

          {/* PICKS: under-capacity guidance */}
          {key === 'picks' && activeRows.length === 0 && pendingRows.length === 0 && (
            <div className="border-t border-zinc-900/60 px-4 py-2 font-mono text-[10px] text-zinc-600">
              Take a pick from Zero's signals in the <span className="text-zinc-400">Tickers / Feed</span> tab — entry &amp; exit levels.
            </div>
          )}

          {/* SATELLITES: empty placeholder (CORE shows sub-sleeve coverage instead) */}
          {key === 'satellites' && activeRows.length === 0 && pendingRows.length === 0 && (
            <div className="px-4 py-2 font-mono text-[10px] text-zinc-700">
              No positions yet — holdings will appear here after sync.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- slider with masterclass band rail ----------------------------------
function BandSlider({ value, color, band, max = 1, onChange }) {
  const v = Math.max(0, Math.min(max, value))
  const p = (x) => `${(x / max) * 100}%`
  return (
    <div className="relative h-3">
      <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-zinc-800" />
      {band && <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-emerald-500/20 ring-1 ring-inset ring-emerald-500/30" style={{ left: p(band[0]), width: p(band[1] - band[0]) }} />}
      <div className="absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full" style={{ width: p(v), background: color }} />
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{ left: p(v) }} />
      <input type="range" min="0" max="100" value={Math.round((v / max) * 100)} onChange={(e) => onChange((Number(e.target.value) / 100) * max)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </div>
  )
}

// ---- editable target sliders (modal) ------------------------------------
// Read-only nested split (core types / satellite themes) with proportional sliders.
function NestedSplit({ title, keys, splits, labelMap, colorMap, bucketValue, onChange }) {
  const sum = keys.reduce((s, k) => s + Number(splits[k] || 0), 0)
  return (
    <div className="mt-2 ml-2 border-l border-zinc-800 pl-3">
      <div className="mb-1.5 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">
        <span>{title}</span>
        <span className={Math.abs(sum - 1) < 0.005 ? 'text-emerald-500' : 'text-amber-400'}>Σ {Math.round(sum * 100)}%</span>
      </div>
      {keys.map((k) => {
        const v = Number(splits[k] || 0)
        return (
          <div key={k} className="mb-2">
            <div className="mb-0.5 flex items-baseline justify-between font-mono">
              <span className="text-[10px] text-zinc-400">{labelMap[k]}</span>
              <span className="text-[11px] tabular text-zinc-300">{Math.round(v * 100)}%<span className="ml-1.5 text-[8px] text-zinc-600">{fmtGBP(v * bucketValue)}</span></span>
            </div>
            <BandSlider value={v} color={colorMap[k]} band={null} onChange={(nv) => onChange(k, nv)} />
          </div>
        )
      })}
    </div>
  )
}

// Derived risk pyramid — computed live from satellite theme splits, never edited
// directly (single source of truth; editing it would double-count capital).
function DerivedPyramid({ pyramid }) {
  return (
    <div className="mt-2 ml-2 border-l border-zinc-800 pl-3">
      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">Pyramid · derived from themes (read-only)</div>
      {PYRAMID_ORDER.map((t) => {
        const v = Number(pyramid[t] || 0); const meta = TIER[t]
        return (
          <div key={t} className="mb-1 flex items-center gap-2 font-mono">
            <span className="w-16 text-[9px] text-zinc-500">{meta.label}</span>
            <div className="relative h-1.5 flex-1 rounded-full bg-zinc-900">
              <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${Math.min(100, v * 100)}%`, background: meta.c }} />
            </div>
            <span className="w-9 text-right text-[10px] tabular text-zinc-400">{Math.round(v * 100)}%</span>
          </div>
        )
      })}
    </div>
  )
}

function TargetsPanel({ scope, relationship = 'self', readOnly = false, ownerName, targets, onSaved }) {
  const [draft, setDraft] = useState(targets)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState({ core: true, satellites: true })
  useEffect(() => setDraft(targets), [targets])
  if (!draft) return null

  const bookValue = Number(draft._bookValue || 0)
  const l1keys = L1_SLEEVES.map(([k]) => k)
  const l1sum = l1keys.reduce((s, k) => s + Number(draft[k] || 0), 0)
  const themeKeys = Object.keys(THEME_LABEL)
  const coreKeys = Object.keys(CORE_TYPE_LABEL)
  const themeSplits = draft.satellite_theme_splits || DEFAULT_THEME_SPLITS
  const coreSplits = draft.core_type_splits || DEFAULT_CORE_TYPE_SPLITS
  const pyramid = derivePyramid(themeSplits)

  const setL1 = (k, v) => setDraft((d) => rebalanceGroup(d, l1keys, k, v))
  const setNested = (field, keys, k, v) => setDraft((d) => ({ ...d, [field]: rebalanceGroup(d[field] || {}, keys, k, v) }))

  const save = async () => {
    if (readOnly) return
    setSaving(true); setErr(null)
    try {
      const payload = {
        core_pct: draft.core_pct, satellite_pct: draft.satellite_pct, picks_pct: draft.picks_pct, cash_pct: draft.cash_pct,
        satellite_theme_splits: draft.satellite_theme_splits, core_type_splits: draft.core_type_splits,
        active_risk_cap_pct: draft.active_risk_cap_pct, benchmark: draft.benchmark,
      }
      onSaved(await api.setPortfolioTargets(scope, payload))
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="rounded-xl border border-zinc-900 bg-[#0b0d10] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Allocation targets · {ownerName || scope}{readOnly && ' · household (read-only)'}</span>
        <span className={`font-mono text-[11px] ${Math.abs(l1sum - 1) < 0.005 ? 'text-emerald-400' : 'text-amber-400'}`}>Σ {Math.round(l1sum * 100)}%</span>
      </div>
      {L1_SLEEVES.map(([k, label, c, band]) => {
        const v = Number(draft[k] || 0)
        const outOfBand = band && (v < band[0] - 1e-9 || v > band[1] + 1e-9)
        const nested = k === 'core_pct' ? 'core' : k === 'satellite_pct' ? 'satellites' : null
        const expanded = nested && open[nested]
        return (
          <div key={k} className="mb-3">
            <div className="mb-1 flex items-baseline justify-between font-mono">
              <span className="flex items-center gap-1.5">
                {nested
                  ? <button onClick={() => setOpen((o) => ({ ...o, [nested]: !o[nested] }))} className="text-[10px] text-zinc-600 hover:text-zinc-300">{expanded ? '▾' : '▸'}</button>
                  : <span className="w-[10px]" />}
                <span className="text-[11px]" style={{ color: c }}>{label}</span>
              </span>
              <span className="text-[12px] tabular text-zinc-200">{Math.round(v * 100)}%<span className="ml-2 text-[9px] text-zinc-600">{fmtGBP(v * bookValue)}</span></span>
            </div>
            <BandSlider value={v} color={c} band={band} onChange={(nv) => setL1(k, nv)} />
            <div className="mt-0.5 font-mono text-[8px]">
              {band ? <span className={outOfBand ? 'text-amber-400' : 'text-zinc-700'}>{outOfBand ? '⚠ outside ' : 'healthy '}{Math.round(band[0] * 100)}–{Math.round(band[1] * 100)}%</span>
                : <span className="text-zinc-700">no band</span>}
            </div>
            {k === 'core_pct' && expanded && (
              <NestedSplit title="Core types · 40/15/15" keys={coreKeys} splits={coreSplits} labelMap={CORE_TYPE_LABEL} colorMap={CORE_TYPE_COLOR}
                bucketValue={v * bookValue} onChange={(sk, sv) => setNested('core_type_splits', coreKeys, sk, sv)} />
            )}
            {k === 'satellite_pct' && expanded && (
              <>
                <NestedSplit title="Satellite themes" keys={themeKeys} splits={themeSplits} labelMap={THEME_LABEL} colorMap={THEME_COLOR}
                  bucketValue={v * bookValue} onChange={(sk, sv) => setNested('satellite_theme_splits', themeKeys, sk, sv)} />
                <DerivedPyramid pyramid={pyramid} />
              </>
            )}
          </div>
        )
      })}
      <div className="mt-4 border-t border-zinc-900 pt-3">
        <div className="mb-1 flex items-baseline justify-between font-mono">
          <span className="text-[11px] text-pink-300/90">Active-trade open-risk cap</span>
          <span className="text-[12px] tabular text-pink-300">{Math.round((draft.active_risk_cap_pct || 0) * 100)}%</span>
        </div>
        <BandSlider value={draft.active_risk_cap_pct || 0} color="#f472b6" band={null} max={0.05}
          onChange={(nv) => setDraft((d) => ({ ...d, active_risk_cap_pct: nv }))} />
        <div className="mt-0.5 font-mono text-[8px] text-zinc-700">caps total open risk across the picks book (server clamps 0–5%)</div>
      </div>
      {err && <div className="mt-3 font-mono text-[10px] text-red-400">{err}</div>}
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving || readOnly}
          className="rounded-md border border-emerald-700/50 bg-emerald-600/10 px-3 py-1.5 font-mono text-[11px] text-emerald-300 hover:bg-emerald-600/20 disabled:opacity-40">
          {readOnly ? 'Read-only (household)' : saving ? 'Saving…' : 'Save targets'}
        </button>
        {!readOnly && <button onClick={() => setDraft((d) => ({ ...d, ...V2_TEMPLATES[relationship === 'child' ? 'kids' : 'personal'] }))} className="font-mono text-[10px] text-zinc-500 hover:text-zinc-300">↺ reset to masterclass</button>}
        <button onClick={() => setDraft(targets)} className="font-mono text-[10px] text-zinc-600 hover:text-zinc-400">undo</button>
      </div>
    </div>
  )
}

// ---- Kids empty-state: tag accounts to a book ---------------------------
function AccountTagger({ onChanged }) {
  const [accounts, setAccounts] = useState(null)
  useEffect(() => { api.funds().then((f) => setAccounts(f.accounts || [])).catch(() => setAccounts([])) }, [])
  if (!accounts) return null
  const tag = async (id, book) => { await api.setAccountBook(id, book); onChanged() }
  return (
    <div className="mt-4 text-left">
      <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">Tag your accounts</div>
      <div className="space-y-1.5">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-lg border border-zinc-900 bg-[#0b0d10] px-3 py-2 font-mono text-[11px]">
            <span className="text-zinc-300">{a.label} <span className="text-zinc-600">{fmtGBP(a.totalValue)}</span></span>
            <div className="flex overflow-hidden rounded border border-zinc-800">
              {['personal', 'kids'].map((bk) => (
                <button key={bk} onClick={() => tag(a.id, bk)}
                  className={`px-2 py-0.5 uppercase tracking-wider ${(a.book || 'personal') === bk ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>{bk}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Sharia fund browser ------------------------------------------------
const FUND_SECTIONS = [
  ['core', 'Core — compounding engine', 'core'],
  ['income', 'Income / quality (sukuk)', 'core'],
  ['satellite_etf', 'Satellite ETFs', 'satellite'],
  ['crypto', 'Crypto', 'satellite'],
  ['cash_defensive', 'Cash / defensive', 'satellite'],
]
function FundBrowser({ filter, onOpen, onAdded, onClose }) {
  const [universe, setUniverse] = useState(null)
  const [added, setAdded] = useState({})
  useEffect(() => { setUniverse(null); api.fundUniverse(filter).then(setUniverse).catch(() => setUniverse({})) }, [filter?.coreType, filter?.theme])
  const add = async (f, section) => {
    const asset_class = section === 'crypto' ? 'crypto' : /gold|silver|commodit/i.test(`${f.exposure} ${f.note}`) ? 'commodity' : 'stock'
    const sleeve = ['core', 'income'].includes(section) ? 'core' : 'satellite'
    setAdded((a) => ({ ...a, [f.symbol]: 'adding' }))
    try { await api.addFund({ symbol: f.symbol, name: f.name, sleeve, asset_class }); setAdded((a) => ({ ...a, [f.symbol]: 'done' })); onAdded?.() }
    catch { setAdded((a) => ({ ...a, [f.symbol]: 'err' })) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 my-8 w-full max-w-lg">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-400">Sharia fund universe</span>
          <button onClick={onClose} className="font-mono text-[11px] text-zinc-400 hover:text-zinc-100">✕ close</button>
        </div>
        {!universe ? <div className="rounded-xl border border-zinc-900 bg-[#0b0d10] p-8 text-center font-mono text-sm text-zinc-600">Loading…</div> : (
          <div className="space-y-3">
            {universe._note && <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 font-mono text-[10px] leading-relaxed text-amber-300/70">{universe._note}</p>}
            {FUND_SECTIONS.map(([key, title]) => (universe[key]?.length ? (
              <div key={key} className="overflow-hidden rounded-xl border border-zinc-900 bg-[#0b0d10]">
                <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{title}</div>
                {universe[key].map((f) => (
                  <div key={f.symbol + f.name} className="flex items-center gap-3 border-t border-zinc-900/80 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-mono">
                        <button onClick={() => onOpen?.(f.symbol)} className="text-[12px] font-semibold text-zinc-100 hover:text-emerald-300">{f.symbol}</button>
                        {f.exposure && <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-zinc-400">{f.exposure}</span>}
                        {f.currency === 'GBP' && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-emerald-300" title="GBP-quoted — no Trading 212 FX fee">GBP · no FX</span>}
                        {f.currency === 'USD' && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-amber-400" title="USD-quoted — Trading 212 charges 0.15% FX">USD · 0.15% FX</span>}
                      </div>
                      <div className="truncate font-mono text-[10px] text-zinc-500">{f.name}</div>
                      <div className="mt-0.5 flex gap-3 font-mono text-[9px]">
                        <span className="text-zinc-600">YTD <span style={{ color: f.perf?.ytd == null ? '#52525b' : f.perf.ytd >= 0 ? '#34d399' : '#f87171' }}>{signed(f.perf?.ytd)}</span></span>
                        <span className="text-zinc-600">all-time <span style={{ color: f.perf?.allTime == null ? '#52525b' : f.perf.allTime >= 0 ? '#34d399' : '#f87171' }}>{signed(f.perf?.allTime)}</span></span>
                      </div>
                    </div>
                    <button onClick={() => add(f, key)} disabled={added[f.symbol] === 'done' || added[f.symbol] === 'adding'}
                      className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-[10px] ${added[f.symbol] === 'done' ? 'border-emerald-700/40 text-emerald-400' : 'border-zinc-700 text-zinc-300 hover:bg-white/5'}`}>
                      {added[f.symbol] === 'done' ? '✓ added' : added[f.symbol] === 'adding' ? '…' : added[f.symbol] === 'err' ? 'retry' : '+ watchlist'}
                    </button>
                  </div>
                ))}
              </div>
            ) : null))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- the page ------------------------------------------------------------
export default function AllocationLedger({ onOpen }) {
  const [scope, setScope] = useUrlState('scope', 'me')   // owner id, or 'hh:<household>'
  const [owners, setOwners] = useState([])
  const [households, setHouseholds] = useState([])
  const [led, setLed] = useState(null)
  const [targets, setTargets] = useState(null)
  const [rot, setRot] = useState(null)
  const [holdings, setHoldings] = useState([])
  const [showTargets, setShowTargets] = useState(false)
  const [showFunds, setShowFunds] = useState(false)
  const [fundFilter, setFundFilter] = useState(null)   // { coreType } | { theme } | null — narrows the Funds picker

  const isHousehold = scope.startsWith('hh:')
  const currentOwner = owners.find((o) => o.id === scope)
  const relationship = currentOwner?.relationship || 'self'

  const reloadLedger = () =>
    api.ledger(scope)
      .then(setLed)
      .catch(() => setLed({ rows: [], bookValue: 0, deployedPct: 0, dryPowderPct: 1, openRisk: 0, pyramid: null, cashAdvisory: null, regime: null }))

  useEffect(() => {
    setLed(null)
    reloadLedger()
    api.portfolioTargets(scope).then(setTargets)
    // Scope-filtered holdings: row value/P&L must reflect only THIS owner — else a
    // same-ticker position in another owner's book (e.g. a kids JISA CRSP) is summed in.
    api.holdings(scope).then(setHoldings).catch(() => setHoldings([]))
  }, [scope])

  useEffect(() => {
    api.rotation().then(setRot).catch(() => {})
    api.accounts().then((d) => { setOwners(d.owners || []); setHouseholds(d.households || []) }).catch(() => {})
  }, [])

  // Once owners load, snap an unknown URL scope to the first owner.
  useEffect(() => {
    if (!owners.length || isHousehold) return
    if (!owners.some((o) => o.id === scope)) setScope(owners[0].id)
  }, [owners]) // eslint-disable-line react-hooks/exhaustive-deps

  const holdingByTicker = useMemo(() => {
    const m = {}
    for (const h of holdings) {
      const g = (m[h.ticker] ||= { quantity: 0, value: 0, pnl: 0, cost: 0, accounts: [] })
      g.quantity += h.quantity; g.value += h.value; g.pnl += h.pnl || 0; g.cost += (h.avgPrice || 0) * h.quantity
      if (!g.accounts.includes(h.accountLabel)) g.accounts.push(h.accountLabel)
    }
    for (const g of Object.values(m)) g.avgPrice = g.quantity ? g.cost / g.quantity : null
    return m
  }, [holdings])

  const t = targets
  const targetsWithBook = t && led ? { ...t, _bookValue: led.bookValue } : t

  // Regime label: prefer the one the API now returns on the ledger; fall back to the rotation endpoint.
  const regimeLabel = led?.regime?.label || rot?.label || null

  const grouped = useMemo(() => (led ? groupRows(led.rows || []) : { core: [], satellites: [], picks: [], cash: [] }), [led])

  return (
    <div>
      {/* top bar */}
      <div className="mb-4 flex items-center justify-between">
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
        <div className="flex gap-1.5">
          <button onClick={() => setShowFunds(true)} className="rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] text-zinc-400 hover:bg-white/5">🔍 Funds</button>
          <button onClick={() => setShowTargets((s) => !s)} className="rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] text-zinc-400 hover:bg-white/5">⚙ Targets</button>
        </div>
      </div>

      {!led ? (
        <div className="px-3 py-10 text-center font-mono text-sm text-zinc-600">Loading…</div>
      ) : (
        <div className="space-y-4">
          <Summary led={led} />
          <RotationBanner rot={led.regime ? { ...rot, ...led.regime } : rot} />

          {led.rows.length === 0 && led.dryPowderPct <= 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-10 text-center font-mono text-[12px] text-zinc-600">
              No holdings for {isHousehold ? 'this household' : (currentOwner?.name || 'this owner')} yet. Link a broker account in the Accounts tab.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-900 bg-black/20">
              {BUCKETS.map((bucket) => (
                <BucketBlock
                  key={bucket.key}
                  bucket={bucket}
                  rows={grouped[bucket.key] || []}
                  led={led}
                  targets={targets}
                  holdingByTicker={holdingByTicker}
                  onOpen={onOpen}
                  regimeLabel={regimeLabel}
                  onPickCore={(coreType) => { setFundFilter({ coreType }); setShowFunds(true) }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showFunds && <FundBrowser filter={fundFilter} onOpen={onOpen} onAdded={reloadLedger} onClose={() => { setShowFunds(false); setFundFilter(null) }} />}

      {showTargets && targetsWithBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowTargets(false)} />
          <div className="relative z-10 w-full max-w-md">
            <div className="mb-2 flex justify-end">
              <button onClick={() => setShowTargets(false)} className="font-mono text-[11px] text-zinc-400 hover:text-zinc-100">✕ close</button>
            </div>
            <div className="max-h-[82vh] overflow-y-auto">
              <TargetsPanel scope={scope} relationship={relationship} readOnly={isHousehold}
                ownerName={isHousehold ? 'Household' : currentOwner?.name} targets={targetsWithBook}
                onSaved={(saved) => { setTargets(saved); reloadLedger(); setShowTargets(false) }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
