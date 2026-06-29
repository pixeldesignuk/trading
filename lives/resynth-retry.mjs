// Retry synthesis for tickers that failed during the transient model outage:
//   - any zero_live ticker still missing synthesis (stuck auto-synth)
//   - recurring zero_live tickers (>=2 live events, excl MSTR) not yet force-resynthed
// Per-ticker retry with backoff so a flaky/recovering model eventually succeeds.
import { query } from '../server/db.js'

const API = process.env.FEED_API || 'http://localhost:8920'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DONE = new Set(['BTC', 'ETH', 'DOGE', 'XRP', 'KAS', 'SGLN']) // already re-synthed before the outage

const missing = (await query(
  `SELECT DISTINCT e.ticker FROM events e LEFT JOIN tickers t ON t.symbol=e.ticker
   WHERE e.source=$1 AND t.synthesis IS NULL`, ['zero_live'])).rows.map((x) => x.ticker)
const recurring = (await query(
  `SELECT ticker FROM events WHERE source=$1 AND kind<>$2 GROUP BY ticker HAVING count(*)>=2`,
  ['zero_live', 'chart'])).rows.map((x) => x.ticker).filter((t) => t !== 'MSTR' && !DONE.has(t))

const targets = [...new Set([...missing, ...recurring])]
console.log(`[retry] ${targets.length} tickers (${missing.length} missing-synth + recurring): ${targets.join(' ')}`)

async function synth(t) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${API}/api/tickers/${encodeURIComponent(t)}/synthesize?force=1`, { method: 'POST' })
      if (res.ok) return true
      // 500 likely = model still unavailable; back off and retry
      if (attempt < 5) await sleep(45000 * attempt)
    } catch { if (attempt < 5) await sleep(45000 * attempt) }
  }
  return false
}

let ok = 0, fail = 0
for (const t of targets) {
  const r = await synth(t)
  console.log(`[retry] ${t} ${r ? '✓' : '✗'}`)
  r ? ok++ : fail++
}
console.log(`[retry] done: ${ok} synthesized, ${fail} still failing`)
process.exit(0)
