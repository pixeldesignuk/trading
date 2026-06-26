import React from 'react'

// Inline chart, shown when the agent calls get_chart ("show me the chart" or a
// ticker with no synthesis yet). Renders by URL — no base64 to the browser.
const SOURCE_LABEL = { moneytaur: 'Moneytaur', zero_hub: 'Zero · Hub', zero_live: 'Zero · Live', zero_tg: 'Zero · Telegram', manual: 'Manual' }

export default function ChartWidget({ data }) {
  if (!data?.url) return null
  const { symbol, url, caption, source } = data
  return (
    <figure className="mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">📈</span>
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Chart · {symbol}</span>
        </div>
        {source && <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">{SOURCE_LABEL[source] || source}</span>}
      </div>
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={caption || `${symbol} chart`} className="w-full" />
      </a>
      {caption && <figcaption className="border-t border-zinc-800/60 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">{caption}</figcaption>}
    </figure>
  )
}
