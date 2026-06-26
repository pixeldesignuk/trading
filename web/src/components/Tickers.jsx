import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useUrlState } from '../useUrlState.js'
import TickerList from './TickerList.jsx'
import TickerFilters, { KNOWN_SOURCES, statusMatch } from './TickerFilters.jsx'

export default function Tickers({ onOpen }) {
  const [rows, setRows] = useState(null)
  const [quotes, setQuotes] = useState({})
  const [status, setStatus] = useUrlState('status', 'potential') // default: candidates, no watched/active/ideas
  const [type, setType] = useUrlState('type', 'all')
  const [source, setSource] = useUrlState('source', 'all')
  const [sharia, setSharia] = useUrlState('sharia', 'all')

  useEffect(() => {
    api.tickers().then(setRows) // all stages; the Stage facet filters client-side
    api.quotes().then(setQuotes)
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return rows
    return rows.filter((t) => {
      const srcs = t.sources || []
      const stageOk = statusMatch(t, status)
      const typeOk = type === 'all' || String(t.asset_class || '').toLowerCase() === type
      const srcOk = source === 'all' || (source === 'other' ? srcs.some((s) => !KNOWN_SOURCES.includes(s)) : srcs.includes(source))
      const shOk = sharia === 'all' || (t.sharia_status || 'unknown') === sharia
      return stageOk && typeOk && srcOk && shOk
    })
  }, [rows, status, type, source, sharia])

  return (
    <div>
      <TickerFilters rows={rows} status={status} setStatus={setStatus} type={type} setType={setType}
        source={source} setSource={setSource} sharia={sharia} setSharia={setSharia} shown={filtered?.length ?? 0} />
      <TickerList rows={filtered} quotes={quotes} onOpen={onOpen}
        empty={status === 'potential' && type === 'all' && source === 'all' && sharia === 'all' ? 'No potential tickers.' : 'No tickers match these filters.'} />
    </div>
  )
}
