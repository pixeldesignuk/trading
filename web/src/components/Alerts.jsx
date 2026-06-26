import React, { useEffect, useState } from 'react'
import { useUrlState } from '../useUrlState.js'
import { api } from '../api.js'

// Planned alerts: every ticker the engine is armed on (has a numeric plan), its
// levels, and where it currently sits. State/price are as of the last hourly run.
const STATE_META = {
  in_buy: { label: 'in buy zone', cls: 'bg-emerald-900/60 text-emerald-300' },
  near_target: { label: 'near target', cls: 'bg-amber-900/60 text-amber-300' },
  past_invalidation: { label: 'invalidation', cls: 'bg-red-900/60 text-red-300' },
  below_buy: { label: 'below buy', cls: 'bg-zinc-800 text-zinc-400' },
  drifting: { label: 'drifting', cls: 'bg-zinc-800 text-zinc-500' },
}
const FILTERS = ['all', 'in_buy', 'near_target', 'past_invalidation', 'below_buy', 'drifting']
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }))

function StateBadge({ state }) {
  const m = STATE_META[state] || { label: state || 'no price', cls: 'bg-zinc-800 text-zinc-500' }
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>
}

export default function Alerts({ onOpen }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useUrlState('astate', 'all')
  useEffect(() => { api.alerts().then(setData).catch((e) => setErr(String(e.message || e))) }, [])

  if (err) return <p className="text-sm text-red-400">Couldn't load alerts: {err}. Is the server up to date? (restart trading-hub)</p>
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>
  const armed = data.armed.filter((a) => filter === 'all' || a.state === filter)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map((f) => {
          const n = f === 'all' ? data.armed.length : data.armed.filter((a) => a.state === f).length
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded px-2 py-1 ${filter === f ? 'bg-emerald-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
              {STATE_META[f]?.label || f} <span className="font-mono text-[10px] opacity-70">{n}</span>
            </button>
          )
        })}
        <span className="ml-auto text-xs text-zinc-600">
          {data.armed.length} armed{data.generated_at ? ` · as of ${new Date(data.generated_at).toLocaleString()}` : ''}
        </span>
      </div>

      <div className="overflow-hidden rounded border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Ticker</th><th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Price</th><th className="px-3 py-2">Buy zone</th>
              <th className="px-3 py-2">Targets</th><th className="px-3 py-2">Invalidation</th>
            </tr>
          </thead>
          <tbody>
            {armed.map((a) => (
              <tr key={a.symbol} className="border-t border-zinc-800/70 hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <button onClick={() => onOpen(a.symbol)} className="text-left">
                    <span className="font-medium text-zinc-100">{a.symbol}</span>
                    <span className="ml-2 text-[11px] text-zinc-600">
                      {a.top_grade != null ? `grade ${a.top_grade}/10` : ''}{a.sharia_status && a.sharia_status !== 'unknown' ? ` · ☪ ${a.sharia_status}` : ''}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2"><StateBadge state={a.state} /></td>
                <td className="px-3 py-2 font-mono text-zinc-300">{fmt(a.price)}</td>
                <td className="px-3 py-2 font-mono text-zinc-400">
                  {a.plan.buyLow == null ? '—' : a.plan.buyLow === a.plan.buyHigh ? fmt(a.plan.buyLow) : `${fmt(a.plan.buyLow)}–${fmt(a.plan.buyHigh)}`}
                </td>
                <td className="px-3 py-2 font-mono text-zinc-500">{a.plan.targets?.length ? a.plan.targets.map(fmt).join(' · ') : '—'}</td>
                <td className="px-3 py-2 font-mono text-zinc-500">{fmt(a.plan.invalidation)}</td>
              </tr>
            ))}
            {armed.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-600">No tickers in this state.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data.recent.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Recent fires</h3>
          <ul className="space-y-1 text-sm">
            {data.recent.map((r, i) => (
              <li key={i} className="flex gap-2 text-zinc-400">
                <span className="shrink-0 font-mono text-[11px] text-zinc-600">{r.occurred_at ? new Date(r.occurred_at).toLocaleString() : ''}</span>
                <button onClick={() => onOpen(r.ticker)} className="text-left hover:text-zinc-200">{r.note || r.ticker}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
