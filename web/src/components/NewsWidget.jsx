import React from 'react'

// Web-grounded news + sentiment, rendered inline in the chat (generative UI).
// The model's message carries the framework reframe; this widget is the raw
// grounded synthesis + clickable sources to verify and read on.

const SENTIMENT = {
  bullish: { label: 'Bullish', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  bearish: { label: 'Bearish', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
  mixed: { label: 'Mixed', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  neutral: { label: 'Neutral', cls: 'border-zinc-700 bg-zinc-800/40 text-zinc-400' },
}

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

export default function NewsWidget({ data }) {
  if (!data) return null
  const { symbol, sentiment, summary, sources = [], query, recency } = data
  const sent = SENTIMENT[sentiment] || SENTIMENT.neutral

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">📰</span>
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">News · {symbol}</span>
          {query && <span className="truncate font-mono text-[10px] text-zinc-600">{query}</span>}
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${sent.cls}`}>{sent.label}</span>
      </div>

      {summary && (
        <div className="border-b border-zinc-800/60 px-3 py-2.5 text-[12px] leading-relaxed text-zinc-300 whitespace-pre-wrap">{summary}</div>
      )}

      {sources.length > 0 && (
        <div className="px-3 py-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">sources · web{recency ? ` · past ${recency}` : ''}</div>
          <div className="space-y-1">
            {sources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer"
                className="flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-800/50">
                <span className="min-w-0 truncate text-[12px] text-sky-400/90 hover:text-sky-300">{s.title || domain(s.url)}</span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-600">{s.date ? String(s.date).slice(0, 10) : domain(s.url)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
