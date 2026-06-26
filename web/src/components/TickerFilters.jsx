import React, { useMemo } from 'react'

// Faceted filter bar for the Tickers list — quant-terminal styling: monospace
// tab-underline controls with live counts that respect the OTHER active facets.
// No separate labels: the facet name lives in its "All …" option.

export const SOURCE_LABELS = {
  zero_hub: 'Zero Hub', zero_live: 'Zero Live', zero_tg: 'Zero TG',
  moneytaur: 'Moneytaur', community: 'Community', manual: 'Manual',
}
export const KNOWN_SOURCES = Object.keys(SOURCE_LABELS)
const TYPE_LABELS = { stock: 'Stocks', crypto: 'Crypto', commodity: 'Commodities' }
const TYPES = Object.keys(TYPE_LABELS)
const TYPE_COLOR = { stock: '#38bdf8', crypto: '#a78bfa', commodity: '#fbbf24' }
const SHARIA = {
  compliant: { label: 'Compliant', c: '#34d399' },
  questionable: { label: 'Questionable', c: '#fbbf24' },
  inconclusive: { label: 'Inconclusive', c: '#38bdf8' },
  non_compliant: { label: 'Avoid', c: '#f87171' },
  unknown: { label: 'Unscreened', c: '#52525b' },
}
const SHARIA_ORDER = Object.keys(SHARIA)
// Stage = where a ticker is in your pipeline: Ideas (community-raised) →
// Potential (candidates you're considering) → Watched → Active (entered, held).
const STAGE = { potential: 'Potential', watched: 'Watched', active: 'Active', ideas: 'Ideas', archived: 'Archived' }
const STAGE_ORDER = Object.keys(STAGE)

// An "idea" is a community-raised ticker not yet triaged (matches the old Ideas
// tab: community source + status new). Promoted ones (watching/in) graduate out.
export const isIdea = (t) => t.status === 'new' && (t.sources || []).includes('community')
export function statusMatch(t, key) {
  const idea = isIdea(t)
  switch (key) {
    case 'all': return true
    case 'ideas': return idea
    case 'watched': return t.status === 'watching'
    case 'active': return t.status === 'in'                 // entered / held
    case 'archived': return t.status === 'archived'         // parked / removed from the board
    case 'potential': default: return t.status === 'new' && !idea
  }
}
const typeMatch = (t, key) => key === 'all' || String(t.asset_class || '').toLowerCase() === key
const sourceMatch = (t, key) => key === 'all'
  || (key === 'other' ? (t.sources || []).some((s) => !KNOWN_SOURCES.includes(s)) : (t.sources || []).includes(key))
const shariaMatch = (t, key) => key === 'all' || (t.sharia_status || 'unknown') === key

function Glyph({ type }) {
  const p = { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (type === 'crypto') return <svg {...p}><path d="M12 3l7 4.5v9L12 21l-7-4.5v-9z" /></svg>
  if (type === 'commodity') return <svg {...p}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>
  return <svg {...p}><path d="M3 20h18M6 20V13M12 20V5M18 20V10" /></svg> // stock
}
const Dot = () => <span className="block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />

function Tab({ active, disabled, onClick, label, count, glyph, glyphColor }) {
  return (
    <button onClick={onClick} disabled={disabled && !active}
      className={`group relative flex items-center gap-1.5 whitespace-nowrap pb-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors
        ${active ? 'text-zinc-100' : disabled ? 'cursor-default text-zinc-700' : 'text-zinc-500 hover:text-zinc-200'}`}>
      {glyph && <span style={glyphColor ? { color: glyphColor } : undefined} className={active ? '' : 'opacity-70'}>{glyph}</span>}
      <span>{label}</span>
      <span className={`tabular text-[10px] ${active ? 'text-emerald-400' : 'text-zinc-600'}`}>{count}</span>
      <span className={`absolute -bottom-px left-0 right-0 h-[2px] rounded-full transition-all duration-150
        ${active ? 'bg-emerald-400' : disabled ? '' : 'bg-transparent group-hover:bg-zinc-700'}`} />
    </button>
  )
}

function Facet({ value, set, options }) {
  if (options.filter((o) => o.key !== 'all').length < 2) return null // nothing to filter
  return (
    <div className="flex flex-wrap items-center gap-x-4">
      {options.map((o) => (
        <Tab key={o.key} active={value === o.key} disabled={o.count === 0} onClick={() => set(o.key)}
          label={o.label} count={o.count} glyph={o.glyph} glyphColor={o.glyphColor} />
      ))}
    </div>
  )
}

export default function TickerFilters({ rows, status, setStatus, source, setSource, type, setType, sharia, setSharia, shown }) {
  const opts = useMemo(() => {
    const all = rows || []
    // a facet's counts respect every OTHER active facet
    const baseFor = (skip) => all.filter((t) =>
      (skip === 'status' || statusMatch(t, status))
      && (skip === 'type' || typeMatch(t, type))
      && (skip === 'source' || sourceMatch(t, source))
      && (skip === 'sharia' || shariaMatch(t, sharia)))
    const stBase = baseFor('status'), tBase = baseFor('type'), sBase = baseFor('source'), shBase = baseFor('sharia')

    const statusOpts = [{ key: 'all', label: 'All Stages', count: stBase.length },
      ...STAGE_ORDER.filter((k) => all.some((t) => statusMatch(t, k))).map((k) => ({ key: k, label: STAGE[k], count: stBase.filter((t) => statusMatch(t, k)).length }))]

    const typeOpts = [{ key: 'all', label: 'All Types', count: tBase.length },
      ...TYPES.filter((tp) => all.some((t) => typeMatch(t, tp))).map((tp) => ({
        key: tp, label: TYPE_LABELS[tp], glyph: <Glyph type={tp} />, glyphColor: TYPE_COLOR[tp],
        count: tBase.filter((t) => typeMatch(t, tp)).length,
      }))]

    const srcSet = new Set(); let hasOther = false
    for (const t of all) for (const s of t.sources || []) (KNOWN_SOURCES.includes(s) ? srcSet.add(s) : (hasOther = true))
    const sourceOpts = [{ key: 'all', label: 'All Sources', count: sBase.length },
      ...KNOWN_SOURCES.filter((s) => srcSet.has(s)).map((s) => ({ key: s, label: SOURCE_LABELS[s], count: sBase.filter((t) => sourceMatch(t, s)).length })),
      ...(hasOther ? [{ key: 'other', label: 'Other', count: sBase.filter((t) => sourceMatch(t, 'other')).length }] : [])]

    const shariaOpts = [{ key: 'all', label: 'All Sharia', count: shBase.length },
      ...SHARIA_ORDER.filter((k) => all.some((t) => (t.sharia_status || 'unknown') === k)).map((k) => ({
        key: k, label: SHARIA[k].label, glyph: <Dot />, glyphColor: SHARIA[k].c, count: shBase.filter((t) => shariaMatch(t, k)).length,
      }))]

    return { statusOpts, typeOpts, sourceOpts, shariaOpts }
  }, [rows, status, source, type, sharia])

  if (!rows) return null
  const dirty = status !== 'potential' || source !== 'all' || type !== 'all' || sharia !== 'all'
  return (
    <div className="mb-4 border-b border-zinc-900 pb-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <Facet value={status} set={setStatus} options={opts.statusOpts} />
          <Facet value={type} set={setType} options={opts.typeOpts} />
          <Facet value={source} set={setSource} options={opts.sourceOpts} />
          <Facet value={sharia} set={setSharia} options={opts.shariaOpts} />
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-0.5 font-mono text-[10px] uppercase tracking-wider">
          <span className="text-zinc-600"><span className="tabular text-zinc-300">{shown}</span> shown</span>
          {dirty && (
            <button onClick={() => { setStatus('potential'); setSource('all'); setType('all'); setSharia('all') }} className="text-zinc-500 transition-colors hover:text-zinc-200">✕ reset</button>
          )}
        </div>
      </div>
    </div>
  )
}
