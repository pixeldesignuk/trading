import React from 'react'

// Clickable ticker shortlist (generative UI) — the portfolio agent's way of
// surfacing standouts / at-risk trades / holdings. Each card opens that ticker.
const num = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }))

const STATE_STYLE = {
  in_buy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  near_target: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  past_invalidation: 'border-red-500/30 bg-red-500/10 text-red-300',
  below_buy: 'border-zinc-700 bg-zinc-800/40 text-zinc-400',
  drifting: 'border-zinc-700 bg-zinc-800/40 text-zinc-400',
}
const stateStyle = (s) => STATE_STYLE[s] || 'border-zinc-700 bg-zinc-800/40 text-zinc-500'
const stateLabel = (s) => (s ? s.replace(/_/g, ' ') : '—')

export default function ShortlistWidget({ data, onOpen }) {
  if (!data) return null
  const { title, items = [] } = data
  if (!items.length) return null
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2">
        <span className="text-sm">🎯</span>
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">{title || 'Tickers'}</span>
        <span className="font-mono text-[10px] text-zinc-600">{items.length}</span>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {items.map((it, i) => (
          <button key={i} onClick={() => onOpen?.(it.symbol)}
            className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-800/40">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-sm font-semibold text-zinc-100">{it.symbol}</span>
                {it.state && <span className={`rounded border px-1 py-px font-mono text-[9px] ${stateStyle(it.state)}`}>{stateLabel(it.state)}</span>}
                {it.grade != null && <span className="font-mono text-[10px] text-zinc-500">grade {it.grade}/10</span>}
                {it.held && <span className="font-mono text-[9px] text-emerald-400/80">held £{num(it.held.value)}</span>}
              </div>
              {it.headline && <div className="mt-0.5 text-[12px] leading-snug text-zinc-400">{it.headline}</div>}
            </div>
            <div className="shrink-0 text-right">
              {it.price != null && <div className="font-mono text-[12px] tabular text-zinc-200">{num(it.price)}</div>}
              {it.changePct != null && <div className="font-mono text-[10px] tabular" style={{ color: it.changePct >= 0 ? '#34d399' : '#f87171' }}>{it.changePct >= 0 ? '+' : ''}{it.changePct}%</div>}
            </div>
            <svg className="mt-1 shrink-0 text-zinc-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        ))}
      </div>
    </div>
  )
}
