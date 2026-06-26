import { query } from './db.js'

export function dedupKey(source, nativeId) {
  return `${source}:${nativeId}`
}

const num = (v) => { const n = Number(v); return (v === 0 || (v && !Number.isNaN(n))) ? n : null }
const str = (v) => (v == null || v === '' ? null : String(v))

// Whitelist + coerce an event payload. targets is always an array.
export function normalizePayload(raw = {}) {
  const targets = Array.isArray(raw.targets)
    ? raw.targets
    : raw.targets ? [raw.targets] : []
  return {
    entry: str(raw.entry),
    targets,
    invalidation: str(raw.invalidation),
    note: str(raw.note),
    grade_score: num(raw.grade_score),
    grade_verdict: str(raw.grade_verdict),
    sharia_status: str(raw.sharia_status),
    sharia_note: str(raw.sharia_note),
    chart: str(raw.chart),
    caption: str(raw.caption),
    levels: Array.isArray(raw.levels) ? raw.levels : (raw.levels ? [raw.levels] : undefined),
    url: str(raw.url),
    text: str(raw.text),
    // Community ideas (source='community') attribute the idea to the member who
    // raised it: { handle, name }. Passed through verbatim when present.
    author: raw.author && typeof raw.author === 'object'
      ? { handle: str(raw.author.handle), name: str(raw.author.name) }
      : undefined,
  }
}

export async function appendEvent({ ticker, source, kind = 'mention', occurred_at = null, native_id, payload }) {
  await query(
    `INSERT INTO events (ticker, source, kind, occurred_at, payload, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (dedup_key) DO UPDATE SET
       kind = EXCLUDED.kind, occurred_at = EXCLUDED.occurred_at,
       payload = EXCLUDED.payload, captured_at = now()`,
    [ticker, source, kind, occurred_at, normalizePayload(payload), native_id ? dedupKey(source, native_id) : null],
  )
}

export async function eventsForTicker(symbol) {
  const r = await query(
    `SELECT * FROM events WHERE ticker = $1
     ORDER BY occurred_at DESC NULLS LAST, id DESC`,
    [symbol],
  )
  return r.rows
}
