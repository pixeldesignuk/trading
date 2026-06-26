import { query } from './db.js'
import { eventsForTicker } from './events.js'

// Pure: compute the ticker rollup from its events (any order).
export function recomputeRollupFrom(events = []) {
  let top = null, verdict = null
  for (const e of events) {
    const s = e.payload?.grade_score
    if (s != null && (top == null || s > top)) { top = s; verdict = e.payload?.grade_verdict ?? null }
  }
  // events arrive newest-first; first with a sharia status wins.
  const sorted = [...events].sort((a, b) =>
    String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')))
  const sh = sorted.find((e) => e.payload?.sharia_status)
  return {
    top_grade: top,
    top_grade_verdict: verdict,
    sharia_status: sh?.payload?.sharia_status || 'unknown',
    sharia_note: sh?.payload?.sharia_note || null,
  }
}

export async function recomputeRollup(symbol) {
  const events = await eventsForTicker(symbol)
  const r = recomputeRollupFrom(events)
  await query(
    `UPDATE tickers SET top_grade=$2, top_grade_verdict=$3,
       sharia_status=$4, sharia_note=$5, updated_at=now() WHERE symbol=$1`,
    [symbol, r.top_grade, r.top_grade_verdict, r.sharia_status, r.sharia_note],
  )
}
