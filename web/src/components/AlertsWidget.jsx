import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// Interactive alerts widget rendered inline in the chat stream (generative UI).
// Seeded from the tool-call payload, then self-refreshes from the REST responses
// after each action — so chat-set and button-set stay one source of truth.

const num = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }))

const STATE_STYLE = {
  in_buy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  near_target: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  past_invalidation: 'border-red-500/30 bg-red-500/10 text-red-300',
  below_buy: 'border-zinc-700 bg-zinc-800/40 text-zinc-400',
  drifting: 'border-zinc-700 bg-zinc-800/40 text-zinc-400',
}
const stateStyle = (s) => STATE_STYLE[s] || 'border-zinc-700 bg-zinc-800/40 text-zinc-500'
const stateLabel = (s) => (s ? s.replace(/_/g, ' ') : 'no price')

function Zone({ plan }) {
  if (!plan) return null
  const { invalidation, targets } = plan
  // Prefer the real entry (entryLow/High) over the ±band trigger zone (buyLow/High).
  const lo = plan.entryLow ?? plan.buyLow
  const hi = plan.entryHigh ?? plan.buyHigh
  const entry = lo == null ? null : lo === hi ? num(lo) : `${num(lo)}–${num(hi)}`
  return (
    <span className="font-mono text-[10px] text-zinc-500">
      {entry && <>buy {entry} </>}
      {invalidation != null && <>· inval {num(invalidation)} </>}
      {targets?.length ? <>· tgt {targets.slice(0, 3).map(num).join('/')}</> : null}
    </span>
  )
}

export default function AlertsWidget({ data, focus, load = false }) {
  const [d, setD] = useState(data || {})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ symbol: focus || '', direction: 'above', price: '', note: '' })

  useEffect(() => { if (data) setD(data) }, [data])
  useEffect(() => { setForm((f) => ({ ...f, symbol: focus || f.symbol })) }, [focus])
  // Embedded (e.g. on the ticker page) the widget owns its data — the chat passes
  // a tool payload instead. Actions still refresh from the REST responses below.
  useEffect(() => {
    if (!load) return
    let alive = true
    api.alerts().then((a) => { if (alive) setD(a) }).catch(() => {})
    return () => { alive = false }
  }, [load, focus])

  const [showAll, setShowAll] = useState(false)
  // A focused widget scopes to that ticker (the common case: "show me the alerts"
  // inside a ticker chat). "show all" is the escape hatch to the whole book.
  const scoped = !!focus && !showAll
  const allCustom = d.custom || []
  const allArmed = d.armed || []
  const custom = scoped ? allCustom.filter((a) => a.symbol === focus) : allCustom
  const armed = scoped ? allArmed.filter((a) => a.symbol === focus) : allArmed
  const armedSorted = focus ? [...armed].sort((a, b) => (a.symbol === focus ? -1 : b.symbol === focus ? 1 : 0)) : armed
  const recent = (scoped ? (d.recent || []).filter((r) => r.ticker === focus) : (d.recent || [])).slice(0, 6)
  const otherCount = (allArmed.length - (allArmed.some((a) => a.symbol === focus) ? 1 : 0)) + (allCustom.length - allCustom.filter((a) => a.symbol === focus).length)

  async function act(fn) {
    setBusy(true); setErr(null)
    try { const res = await fn(); if (res?.alerts) setD(res.alerts) }
    catch (e) { setErr(String(e.message || e)) }
    finally { setBusy(false) }
  }

  const cancel = (id) => act(() => api.cancelAlert(id))
  const toggleMute = (a) => act(() => api.muteAlert(a.symbol, !a.muted))
  async function submit() {
    const price = Number(form.price)
    if (!form.symbol.trim() || !Number.isFinite(price) || price <= 0) { setErr('Enter a ticker and a positive price.'); return }
    await act(() => api.createAlert({ symbol: form.symbol.trim().toUpperCase(), direction: form.direction, price, note: form.note.trim() || undefined }))
    setForm((f) => ({ ...f, price: '', note: '' })); setAdding(false)
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">🔔</span>
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Alerts{scoped ? ` · ${focus}` : ''}</span>
          {focus && otherCount > 0 && (
            <button onClick={() => setShowAll((v) => !v)}
              className="font-mono text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
              {showAll ? `${focus} only` : `show all (${otherCount} more)`}
            </button>
          )}
        </div>
        <button onClick={() => setAdding((v) => !v)} disabled={busy}
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
          {adding ? 'close' : '+ set alert'}
        </button>
      </div>

      {adding && (
        <div className="border-b border-zinc-800/80 bg-black/30 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="TICKER"
              className="w-24 rounded-md border border-zinc-800 bg-black/40 px-2 py-1 font-mono text-xs uppercase text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none" />
            <div className="flex overflow-hidden rounded-md border border-zinc-800">
              {['above', 'below'].map((dir) => (
                <button key={dir} onClick={() => setForm({ ...form, direction: dir })}
                  className={`px-2 py-1 font-mono text-[11px] ${form.direction === dir ? 'bg-zinc-200 text-black' : 'bg-black/40 text-zinc-400 hover:text-zinc-200'}`}>
                  {dir === 'above' ? '↑ above' : '↓ below'}
                </button>
              ))}
            </div>
            <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="price" inputMode="decimal"
              className="w-24 rounded-md border border-zinc-800 bg-black/40 px-2 py-1 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none" />
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="note (optional)"
              className="min-w-[7rem] flex-1 rounded-md border border-zinc-800 bg-black/40 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none" />
            <button onClick={submit} disabled={busy}
              className="rounded-md bg-emerald-500 px-2.5 py-1 font-mono text-[11px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">set</button>
          </div>
        </div>
      )}

      {err && <div className="border-b border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">{err}</div>}

      <div className="max-h-[22rem] overflow-y-auto chat-scroll">
        {/* Custom price-cross alerts */}
        {custom.length > 0 && (
          <div className="px-3 py-2">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">custom</div>
            <div className="space-y-1">
              {custom.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2 py-1.5">
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-semibold text-zinc-100">{a.symbol}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-zinc-400">{a.direction === 'above' ? '↑' : '↓'} {num(a.price)}</span>
                    {a.note && <span className="ml-1.5 text-[11px] text-zinc-500">· {a.note}</span>}
                  </div>
                  <button onClick={() => cancel(a.id)} disabled={busy} title="Cancel alert"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-500 hover:bg-red-500/15 hover:text-red-300 disabled:opacity-50">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Plan-derived armed tickers */}
        <div className="px-3 py-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">plan-armed</div>
          {armedSorted.length === 0 ? (
            <div className="py-1 text-[11px] text-zinc-600">
              {scoped
                ? `${focus} isn't plan-armed (arms when it's watched/held with a numeric plan). Set a custom alert above.`
                : "Nothing armed — a ticker arms when it's watched/held and has a numeric plan."}
            </div>
          ) : (
            <div className="space-y-1">
              {armedSorted.map((a) => (
                <div key={a.symbol} className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 ${a.symbol === focus ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-800/60 bg-zinc-900/30'}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-zinc-100">{a.symbol}</span>
                      <span className={`rounded border px-1 py-px font-mono text-[9px] ${stateStyle(a.state)}`}>{stateLabel(a.state)}</span>
                      {a.price != null && <span className="font-mono text-[10px] text-zinc-500">@ {num(a.price)}</span>}
                      {a.muted && <span className="font-mono text-[9px] text-amber-400/80">muted</span>}
                    </div>
                    <Zone plan={a.plan} />
                  </div>
                  <button onClick={() => toggleMute(a)} disabled={busy} title={a.muted ? 'Unmute' : 'Mute'}
                    className="shrink-0 rounded px-1 text-sm hover:bg-zinc-800/60 disabled:opacity-50">
                    {a.muted ? '🔕' : '🔔'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent fires */}
        {recent.length > 0 && (
          <div className="border-t border-zinc-800/60 px-3 py-2">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">recent fires</div>
            <div className="space-y-0.5">
              {recent.map((r, i) => (
                <div key={i} className="truncate text-[11px] text-zinc-500">
                  <span className="text-zinc-600">{String(r.occurred_at || '').slice(5, 10)}</span> · {r.note}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
