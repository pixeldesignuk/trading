import React, { useEffect, useState } from 'react'
import { useUrlState } from '../useUrlState.js'
import { api } from '../api.js'

// Feed = the community pulse from the Telegram groups, seeded by /feed. Each run
// is a dated digest (TL;DR) with its notable threads as topic cards, grouped by
// Telegram group. Newest run open by default; selection lives in the URL.
export default function Feed({ onOpen }) {
  const [runs, setRuns] = useState(null)
  const [open, setOpen] = useUrlState('run', '')
  const [detail, setDetail] = useState(null)

  useEffect(() => { api.discussions().then(setRuns) }, [])

  // Default to the newest run if none is selected yet.
  const active = open || runs?.[0]?.slug || ''
  useEffect(() => {
    if (!active) { setDetail(null); return }
    let live = true
    api.discussion(active).then((d) => { if (live) setDetail(d) })
    return () => { live = false }
  }, [active])

  if (!runs) return <p className="text-sm text-zinc-500">Loading…</p>
  if (runs.length === 0) {
    return <p className="text-sm text-zinc-500">No discussion digests yet. Run <code className="text-zinc-300">/feed</code> to seed the Feed.</p>
  }

  const toggle = (slug) => setOpen(active === slug ? 'none' : slug)

  return (
    <div className="space-y-3">
      {runs.map((r) => {
        const isOpen = active === r.slug
        const s = r.stats_json || {}
        return (
          <div key={r.slug} className="rounded border border-zinc-800">
            <button onClick={() => toggle(r.slug)}
              className="flex w-full items-center justify-between px-3 py-2 text-left">
              <div>
                <span className="text-sm font-medium text-zinc-100">{r.date || r.slug}</span>
                {r.since && <span className="ml-2 text-xs text-zinc-500">{r.since}</span>}
              </div>
              <span className="font-mono text-[10px] text-zinc-500">
                {s.messages != null && `${s.messages} msgs · `}
                {s.ideas != null && `${s.ideas} ideas · `}
                {s.signals != null && `${s.signals} signals`}
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-zinc-800 px-3 py-3">
                {r.tldr && <p className="mb-3 whitespace-pre-line text-sm text-zinc-300">{r.tldr}</p>}
                {!detail && <p className="text-xs text-zinc-600">Loading threads…</p>}
                {detail?.slug === r.slug && <Topics topics={detail.topics} onOpen={onOpen} />}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Topic cards grouped by their Telegram group.
function Topics({ topics = [], onOpen }) {
  if (topics.length === 0) return <p className="text-xs text-zinc-600">No threads broken out for this run.</p>
  const groups = [...new Set(topics.map((t) => t.grp || 'Other'))]
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g}>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{g}</h4>
          <div className="space-y-2">
            {topics.filter((t) => (t.grp || 'Other') === g).map((t) => (
              <div key={t.id} className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                <div className="text-sm font-medium text-zinc-100">{t.topic}</div>
                {t.summary && <p className="mt-0.5 text-sm text-zinc-400">{t.summary}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {(t.participants || []).map((p) => (
                    <span key={p} className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{p}</span>
                  ))}
                  {(t.tickers || []).map((sym) => (
                    <button key={sym} onClick={() => onOpen(sym)}
                      className="rounded bg-emerald-900/50 px-1.5 py-0.5 font-mono text-emerald-300 hover:bg-emerald-800">{sym}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
