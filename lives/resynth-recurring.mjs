// Wait for the auto-synth queue to drain, then force-resynth the RECURRING zero_live
// tickers (≥2 live events, excl MSTR) so each thesis folds in its full accumulated
// history ("plans grow with time"). Sequential to avoid thrashing the claude-CLI synth.
import { query } from '../server/db.js'

const API = process.env.FEED_API || 'http://localhost:8920'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function missingCount() {
  const r = await query(
    `SELECT count(DISTINCT e.ticker)::int n FROM events e LEFT JOIN tickers t ON t.symbol=e.ticker
     WHERE e.source=$1 AND t.synthesis IS NULL`, ['zero_live'])
  return r.rows[0].n
}

// 1) wait until the auto-synth queue stops making progress (drained or stuck)
console.log('[resynth] waiting for auto-synth queue to drain…')
let prev = -1, stable = 0
for (let i = 0; i < 120; i++) {            // up to ~60 min
  const m = await missingCount()
  console.log(`[resynth] missing synthesis: ${m}`)
  if (m === 0) break
  if (m === prev) { if (++stable >= 3) { console.log('[resynth] no progress for 3 checks — proceeding'); break } }
  else stable = 0
  prev = m
  await sleep(30000)
}

// 2) recurring tickers (≥2 non-chart live events), excl MSTR
const rec = (await query(
  `SELECT ticker, count(*)::int n FROM events WHERE source=$1 AND kind<>$2
   GROUP BY ticker HAVING count(*)>=2 ORDER BY n DESC`, ['zero_live', 'chart'])).rows
  .map((x) => x.ticker).filter((t) => t !== 'MSTR')

console.log(`[resynth] force-resynth ${rec.length} recurring tickers (excl MSTR): ${rec.join(' ')}`)
let ok = 0, fail = 0
for (const t of rec) {
  try {
    const res = await fetch(`${API}/api/tickers/${encodeURIComponent(t)}/synthesize?force=1`, { method: 'POST' })
    if (res.ok) { ok++; console.log(`[resynth] ${t} ✓`) }
    else { fail++; console.log(`[resynth] ${t} ✗ ${res.status}`) }
  } catch (e) { fail++; console.log(`[resynth] ${t} ✗ ${e.message}`) }
}
console.log(`[resynth] done: ${ok} re-synthesized, ${fail} failed`)
process.exit(0)
