import React, { useEffect, useState } from 'react'
import { useUrlState } from '../useUrlState.js'
import { api } from '../api.js'

// Ideas = ticker ideas that community MEMBERS raised in the Telegram chatter
// (source='community'), attributed to whoever floated them — distinct from the
// Zero/Moneytaur signals in Tickers. One card per ticker; triage moves it out.
export default function IdeasInbox({ onOpen }) {
  const [rows, setRows] = useState(null)
  const [sharia, setSharia] = useUrlState('sharia', 'all')
  const load = () => api.ideas(sharia).then(setRows)
  useEffect(() => { load() }, [sharia])
  const triage = (symbol, status) => api.setStatus(symbol, status).then(load)

  return (
    <div>
      <div className="mb-4 flex gap-2 text-sm">
        {['all', 'compliant', 'questionable', 'non_compliant'].map((s) => (
          <button key={s} onClick={() => setSharia(s)}
            className={`rounded px-2 py-1 ${sharia === s ? 'bg-emerald-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}>{s}</button>
        ))}
      </div>
      {rows == null && <p className="text-sm text-zinc-500">Loading…</p>}
      {rows?.length === 0 && (
        <p className="text-sm text-zinc-500">No community ideas yet. Member ideas surfaced by <code className="text-zinc-300">/feed</code> land here.</p>
      )}
      <ul className="space-y-2">
        {rows?.map((t) => (
          <li key={t.symbol} className="rounded border border-zinc-800 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <button onClick={() => onOpen(t.symbol)} className="text-left">
                <span className="font-medium text-zinc-100">{t.symbol}</span>
                {t.name && <span className="ml-2 text-zinc-500">{t.name}</span>}
                <span className="ml-2 text-zinc-600">· {t.sharia_status}</span>
              </button>
              <div className="flex gap-1">
                <button onClick={() => triage(t.symbol, 'watching')} className="rounded bg-zinc-800 px-2 py-1 hover:bg-emerald-700">watch</button>
                <button onClick={() => triage(t.symbol, 'in')} className="rounded bg-zinc-800 px-2 py-1 hover:bg-emerald-700">in</button>
                <button onClick={() => triage(t.symbol, 'dismissed')} className="rounded bg-zinc-800 px-2 py-1 hover:bg-red-800">dismiss</button>
              </div>
            </div>
            <ul className="mt-1.5 space-y-1">
              {t.ideas.map((idea, i) => (
                <li key={i} className="text-zinc-400">
                  <span className="font-medium text-emerald-300">{idea.author?.handle || idea.author?.name || 'member'}</span>
                  {idea.note && <span className="ml-1.5">{idea.note}</span>}
                  {idea.url && <a href={idea.url} target="_blank" rel="noreferrer" className="ml-1.5 text-zinc-600 hover:text-zinc-400">↗</a>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
