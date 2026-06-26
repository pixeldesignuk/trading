import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

function Bucket({ title, rows, onOpen, empty }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-zinc-400">{title}</h2>
      {rows.length === 0 && <p className="text-sm text-zinc-600">{empty}</p>}
      <div className="flex flex-wrap gap-2">
        {rows.map((t) => (
          <button key={t.symbol} onClick={() => onOpen(t.symbol)}
            className="rounded border border-zinc-800 px-3 py-2 text-left text-sm hover:bg-zinc-900">
            <div className="font-medium text-zinc-100">{t.symbol}</div>
            <div className="text-zinc-500">grade {t.top_grade ?? '-'} · {t.state}{t.price != null ? ` · ${t.price}` : ''}</div>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function Today({ onOpen }) {
  const [d, setD] = useState(null)
  useEffect(() => { api.today().then(setD) }, [])
  if (!d) return <div className="text-zinc-500">Loading…</div>
  return (
    <div>
      <Bucket title="New compliant ideas to triage" rows={d.newIdeas} onOpen={onOpen} empty="Nothing new." />
      <Bucket title="Entered buy zone" rows={d.enteredBuyZone} onOpen={onOpen} empty="No watchlist ticker is in its buy zone." />
      <Bucket title="Needs attention (near target / invalidated)" rows={d.needsAttention} onOpen={onOpen} empty="All positions are mid-range." />
    </div>
  )
}
