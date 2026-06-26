import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useUrlState } from '../useUrlState.js'
import { planView, Rail, STATE, positionView, PositionRail, POS_STATE, posLabelParts } from './TickerList.jsx'

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

// Dynamic Kanban Portfolio — the pipeline as a board driven by real Trading 212
// positions (read-only mirror). Potential ↔ Watched are manual (drag); Active is
// broker-driven (a card is here because the broker holds it — you can't fake-
// promote into it) and Closed is auto (held → gone). See the v1 design spec.

const COLUMNS = [
  { key: 'new', label: 'Potential', droppable: true, accent: '#38bdf8' },
  { key: 'watching', label: 'Watched', droppable: true, accent: '#fbbf24' },
  { key: 'in', label: 'Active', droppable: false, broker: true, accent: '#34d399' },
  { key: 'closed', label: 'Closed', droppable: false, accent: '#71717a' },
]

const ASSET = { stock: '#38bdf8', crypto: '#a78bfa', commodity: '#fbbf24' }
const SHARIA = {
  compliant: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  questionable: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  inconclusive: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  non_compliant: 'border-red-500/30 bg-red-500/10 text-red-300',
  unknown: 'border-zinc-700 bg-zinc-800/40 text-zinc-500',
}
const SHARIA_LABEL = { compliant: 'Compliant', questionable: 'Questionable', inconclusive: 'Inconclusive', non_compliant: 'Avoid', unknown: 'Unscreened' }

const fmtPrice = (p) => (p == null ? '—' : p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : Number(p).toPrecision(3))
const fmtMoney = (v, ccy = 'GBP') => (v == null ? '—' : v.toLocaleString('en-GB', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }))
const isIdea = (t) => t.status === 'new' && (t.sources || []).includes('community')
const sinceText = (iso) => {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`
}

// ---- funds header --------------------------------------------------------
function FundsBar({ funds, onSync, syncing }) {
  const ccy = funds?.currency || 'GBP'
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-zinc-900 bg-black/20 px-4 py-3">
      <Stat label="Total value" value={fmtMoney(funds?.totalValue, ccy)} />
      <Stat label="Available cash" value={fmtMoney(funds?.cash, ccy)} />
      <Stat label="Unrealised P/L" value={fmtMoney(funds?.pnl, ccy)} color={funds?.pnl >= 0 ? '#34d399' : '#f87171'} />
      <div className="flex flex-wrap gap-1.5">
        {(funds?.accounts || []).map((a) => (
          <span key={a.id} title={a.error || `${a.label}: ${fmtMoney(a.totalValue, a.currency || ccy)}`}
            className={`rounded-md border px-2 py-1 font-mono text-[10px] ${a.error ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-zinc-700 bg-zinc-800/40 text-zinc-300'}`}>
            {a.label} {a.error ? '⚠' : fmtMoney(a.totalValue, a.currency || ccy)}
          </span>
        ))}
        {funds?.source === 'config' && (
          <span className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1 font-mono text-[10px] text-zinc-500">no broker connected · config £{Math.round(funds.totalValue).toLocaleString()}</span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="font-mono text-[10px] text-zinc-600">synced {sinceText(funds?.accounts?.[0]?.syncedAt)}</span>
        <button onClick={onSync} disabled={syncing}
          className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/5 disabled:opacity-50">
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    </div>
  )
}
const Stat = ({ label, value, color }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
    <div className="font-mono text-sm tabular" style={color ? { color } : undefined}>{value}</div>
  </div>
)

// ---- a card --------------------------------------------------------------
function Card({ t, quote, holding, funds, draggable, onOpen, onDragStart }) {
  const price = quote?.price ?? null
  const change = quote?.changePct ?? null
  const sharia = t.sharia_status || 'unknown'
  const dot = ASSET[String(t.asset_class || '').toLowerCase()] || '#52525b'
  const pctOfAccount = holding && funds?.totalValue ? (holding.value / funds.totalValue) * 100 : null
  const { v, RailComp, state: planState, dist } = railFor(t, price, holding)

  return (
    <div draggable={draggable} onDragStart={draggable ? (e) => onDragStart(e, t) : undefined}
      onClick={() => onOpen(t.symbol)}
      className={`row-in mb-2 rounded-lg border border-zinc-900 bg-zinc-950/60 p-2.5 text-left transition-colors hover:bg-white/[0.03] ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
          <span className="font-mono text-[14px] font-semibold tracking-tight text-zinc-100">{t.symbol}</span>
        </div>
        <div className="text-right font-mono tabular">
          <div className="text-[13px] text-zinc-100">{fmtPrice(price)}</div>
          {change != null && <div className="text-[10px]" style={{ color: change >= 0 ? '#34d399' : '#f87171' }}>{change >= 0 ? '+' : ''}{change.toFixed(1)}%</div>}
        </div>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-zinc-500">{t.name || ' '}</div>

      {/* plan rail — entry readiness, or in-trade stop/TP risk when held */}
      {hasPlan(v) && (
        <div className="mt-2">
          <RailComp v={v} />
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[10px] uppercase tracking-wider">
            <span style={{ color: planState.dot }}>{planState.label}</span>
            {dist.map((d) => <span key={d} className="text-zinc-600">· {d}</span>)}
          </div>
        </div>
      )}

      {holding && (
        <div className="mt-2 rounded-md border border-zinc-800/80 bg-black/30 px-2 py-1.5 font-mono text-[10px] text-zinc-400">
          <div className="flex justify-between"><span>{holding.quantity} @ {fmtPrice(holding.avgPrice)}</span><span className="text-zinc-200">{fmtMoney(holding.value, holding.currency)}</span></div>
          <div className="mt-0.5 flex justify-between">
            <span style={{ color: (holding.pnl ?? 0) >= 0 ? '#34d399' : '#f87171' }}>{(holding.pnl ?? 0) >= 0 ? '+' : ''}{fmtMoney(holding.pnl, holding.currency)}</span>
            {pctOfAccount != null && <span className="text-zinc-500">{pctOfAccount.toFixed(1)}% of acct</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {holding.accounts.map((label) => <span key={label} className="rounded bg-zinc-800/60 px-1 py-0.5 text-zinc-400">{label}</span>)}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${SHARIA[sharia] || SHARIA.unknown}`}>{SHARIA_LABEL[sharia] || 'Unscreened'}</span>
        {t.top_grade != null && <span className="font-mono text-[11px]" style={{ color: t.top_grade >= 7 ? '#34d399' : t.top_grade >= 5 ? '#fbbf24' : '#f87171' }} title="§20 grade">{t.top_grade}</span>}
      </div>
    </div>
  )
}

// ---- a list row (ClickUp-style, grouped by status) -----------------------
function ListRow({ t, quote, holding, funds, draggable, onOpen, onDragStart }) {
  const price = quote?.price ?? null
  const change = quote?.changePct ?? null
  const sharia = t.sharia_status || 'unknown'
  const dot = ASSET[String(t.asset_class || '').toLowerCase()] || '#52525b'
  const { v, RailComp, state: planState, dist } = railFor(t, price, holding)

  return (
    <div draggable={draggable} onDragStart={draggable ? (e) => onDragStart(e, t) : undefined}
      onClick={() => onOpen(t.symbol)}
      className={`row-in group grid grid-cols-[minmax(120px,1.1fr)_minmax(150px,1.8fr)_minmax(70px,0.85fr)_minmax(100px,1.1fr)_auto] items-center gap-3 border-b border-zinc-900 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-white/[0.025] ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}>
      {/* identity */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="font-mono text-[13px] font-semibold tracking-tight text-zinc-100">{t.symbol}</span>
        <span className="truncate text-[11px] text-zinc-500">{t.name || ''}</span>
      </div>
      {/* plan rail — entry readiness, or in-trade stop/TP risk when held */}
      <div className="min-w-0">
        {hasPlan(v) ? (
          <>
            <RailComp v={v} />
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[10px] uppercase leading-tight tracking-wider">
              <span style={{ color: planState.dot }}>{planState.label}</span>
              {dist.map((d) => <span key={d} className="text-zinc-600">{d}</span>)}
            </div>
          </>
        ) : (
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">{planState.label}</div>
        )}
      </div>
      {/* price */}
      <div className="text-right font-mono tabular">
        <span className="text-[13px] text-zinc-100">{fmtPrice(price)}</span>
        {change != null && <span className="ml-1.5 text-[10px]" style={{ color: change >= 0 ? '#34d399' : '#f87171' }}>{change >= 0 ? '+' : ''}{change.toFixed(1)}%</span>}
      </div>
      {/* holding */}
      <div className="text-right font-mono text-[11px] tabular text-zinc-400">
        {holding ? (
          <span className="flex items-center justify-end gap-x-2.5">
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

// ---- board / list view toggle --------------------------------------------
function ViewToggle({ view, setView }) {
  const opts = [
    { key: 'board', label: 'Board', glyph: '▦' },
    { key: 'list', label: 'List', glyph: '☰' },
  ]
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-zinc-800 bg-black/30 p-0.5">
      {opts.map((o) => (
        <button key={o.key} onClick={() => setView(o.key)}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${view === o.key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
          <span className="text-[12px] leading-none">{o.glyph}</span>{o.label}
        </button>
      ))}
    </div>
  )
}

// ---- the board -----------------------------------------------------------
export default function Portfolio({ onOpen }) {
  const [rows, setRows] = useState(null)
  const [quotes, setQuotes] = useState({})
  const [funds, setFunds] = useState(null)
  const [holdings, setHoldings] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [dragOver, setDragOver] = useState(null)
  const [view, setView] = useUrlState('view', 'board')
  // Which list-view status groups are collapsed — persisted across reloads.
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('portfolio.collapsed') || '[]')) } catch { return new Set() }
  })
  const toggleCollapsed = (key) => setCollapsed((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    try { localStorage.setItem('portfolio.collapsed', JSON.stringify([...next])) } catch {}
    return next
  })

  const load = () => {
    api.tickers().then(setRows)
    api.quotes().then(setQuotes)
    api.funds().then(setFunds)
    api.holdings().then(setHoldings)
  }
  useEffect(load, [])

  // Holdings grouped per hub ticker (a position can span accounts → aggregate).
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

  const byColumn = useMemo(() => {
    const cols = { new: [], watching: [], in: [], closed: [] }
    for (const t of rows || []) {
      if (t.status === 'new' && isIdea(t)) continue   // ideas live on the Tickers tab
      if (cols[t.status]) cols[t.status].push(t)
    }
    return cols
  }, [rows])

  const onSync = async () => {
    setSyncing(true)
    try { setFunds(await api.syncBrokers()); api.holdings().then(setHoldings); api.tickers().then(setRows) }
    finally { setSyncing(false) }
  }

  const onDragStart = (e, t) => { e.dataTransfer.setData('text/plain', JSON.stringify({ symbol: t.symbol, from: t.status })) }
  const onDrop = async (e, col) => {
    e.preventDefault(); setDragOver(null)
    if (!col.droppable) return
    let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')) } catch { return }
    if (!data?.symbol || data.from === col.key) return
    if (!['new', 'watching'].includes(data.from)) return  // only manual stages move by drag
    setRows((prev) => prev.map((t) => (t.symbol === data.symbol ? { ...t, status: col.key } : t)))  // optimistic
    await api.setStatus(data.symbol, col.key).catch(load)  // reconcile on failure
  }

  if (rows == null) return <div className="px-3 py-10 text-center text-sm text-zinc-600">Loading…</div>

  return (
    <div>
      <FundsBar funds={funds} onSync={onSync} syncing={syncing} />
      <div className="mb-3 flex items-center justify-end">
        <ViewToggle view={view} setView={setView} />
      </div>

      {view === 'list' ? (
        <div className="overflow-hidden rounded-lg border border-zinc-900 bg-black/20">
          {COLUMNS.map((col) => {
            const items = byColumn[col.key]
            const isCollapsed = collapsed.has(col.key)
            return (
              <div key={col.key}
                onDragOver={col.droppable ? (e) => { e.preventDefault(); setDragOver(col.key) } : undefined}
                onDragLeave={col.droppable ? () => setDragOver((d) => (d === col.key ? null : d)) : undefined}
                onDrop={(e) => onDrop(e, col)}
                className={`border-b border-zinc-900 last:border-b-0 transition-colors ${dragOver === col.key ? 'bg-emerald-500/[0.04]' : ''}`}>
                <button onClick={() => toggleCollapsed(col.key)}
                  style={{ borderLeft: `3px solid ${col.accent}`, background: `${col.accent}14` }}
                  className="flex w-full items-center gap-2 border-b border-zinc-900 px-3 py-1.5 text-left transition-colors hover:brightness-125">
                  <span style={{ color: col.accent }} className={`font-mono text-[9px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                  <span style={{ color: col.accent }} className="text-[11px] font-semibold uppercase tracking-wider">{col.label}</span>
                  {col.broker && <span className="rounded bg-zinc-800/60 px-1 py-0.5 font-mono text-[9px] text-zinc-500" title="Mirrors your broker — not manually set">broker</span>}
                  <span className="font-mono text-[10px] tabular text-zinc-600">{items.length}</span>
                </button>
                {!isCollapsed && (
                  items.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-zinc-700">{col.broker ? 'No open positions' : '—'}</div>
                  ) : (
                    items.map((t) => (
                      <ListRow key={t.symbol} t={t} quote={quotes[t.symbol]} holding={holdingByTicker[t.symbol]} funds={funds}
                        draggable={col.droppable} onOpen={onOpen} onDragStart={onDragStart} />
                    ))
                  )
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = byColumn[col.key]
            return (
              <div key={col.key}
                onDragOver={col.droppable ? (e) => { e.preventDefault(); setDragOver(col.key) } : undefined}
                onDragLeave={col.droppable ? () => setDragOver((d) => (d === col.key ? null : d)) : undefined}
                onDrop={(e) => onDrop(e, col)}
                className={`rounded-lg border bg-black/20 p-2 transition-colors ${dragOver === col.key ? 'border-emerald-500/50 bg-emerald-500/[0.04]' : 'border-zinc-900'}`}>
                <div className="mb-2 flex items-center justify-between border-l-2 pl-2" style={{ borderColor: col.accent }}>
                  <span style={{ color: col.accent }} className="text-[11px] font-semibold uppercase tracking-wider">{col.label}</span>
                  <span className="flex items-center gap-1.5">
                    {col.broker && <span className="rounded bg-zinc-800/60 px-1 py-0.5 font-mono text-[9px] text-zinc-500" title="Mirrors your broker — not manually set">broker</span>}
                    <span className="font-mono text-[10px] tabular text-zinc-600">{items.length}</span>
                  </span>
                </div>
                {items.length === 0 && <div className="px-1 py-6 text-center text-[11px] text-zinc-700">{col.broker ? 'No open positions' : '—'}</div>}
                {items.map((t) => (
                  <Card key={t.symbol} t={t} quote={quotes[t.symbol]} holding={holdingByTicker[t.symbol]} funds={funds}
                    draggable={col.droppable} onOpen={onOpen} onDragStart={onDragStart} />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
