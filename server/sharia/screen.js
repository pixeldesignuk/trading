import { query } from '../db.js'
import { getTicker } from '../tickers.js'
import { PROVIDERS, fetchOne } from './providers.js'

// 2-of-3 rule (strict): a source is a YES only if exactly 'compliant'. Doubtful,
// non_compliant, and unknown are all not-yes. Need >=2 yes to clear.
export function aggregate(statuses = []) {
  const compliant_count = statuses.filter((s) => s === 'compliant').length
  return { verdict: compliant_count >= 2 ? 'cleared' : 'not_cleared', compliant_count }
}

// Badge (4 states), separate from the binary entry verdict. A source that
// returned NO data (unknown) must not be counted as a "no" — when one is
// missing and there's no clear 2-of-3, the screen is INCONCLUSIVE (incomplete),
// not Avoid. e.g. CRSP = 1 compliant / 1 non-compliant / 1 no-data → a 50:50
// tie among the sources that answered, not a verdict.
//   >=2 compliant            -> Compliant (green, cleared)
//   any source no-data, <2 ✓ -> Inconclusive (sky — incomplete, re-check)
//   1 compliant (all rated)  -> Questionable (amber — one source agrees)
//   0 compliant (all rated)  -> Avoid (red)
export function badgeFor(compliantCount, unknownCount = 0) {
  if (compliantCount >= 2) return 'compliant'
  // Inconclusive only when it's a genuine tie: exactly 1 yes AND a missing source
  // (e.g. CRSP 1✓/1✗/1 no-data). 0 yes is Avoid regardless of any no-data — a
  // missing source can't manufacture a yes.
  if (compliantCount === 1) return unknownCount >= 1 ? 'inconclusive' : 'questionable'
  return 'non_compliant'
}

const STALE_MS = 7 * 24 * 60 * 60 * 1000

// Run (or return cached) the live screen. Stocks only. `fetchImpl`/`now` are
// injectable for tests so we never hit the network there.
export async function screenTicker(symbol, { force = false, fetchImpl = fetch, now = Date.now() } = {}) {
  const t = await getTicker(symbol)
  if (!t) throw new Error(`unknown ticker ${symbol}`)
  if (String(t.asset_class || '').toLowerCase() !== 'stock') {
    return { skipped: true, reason: 'screen is stocks-only', sharia_screen: t.sharia_screen ?? null }
  }
  const fresh = t.sharia_screen && t.sharia_screen_at && (now - new Date(t.sharia_screen_at).getTime()) < STALE_MS
  if (!force && fresh) return { cached: true, sharia_screen: t.sharia_screen }

  const sources = await Promise.all(PROVIDERS.map((p) => fetchOne(p, symbol, { fetchImpl })))
  const { verdict, compliant_count } = aggregate(sources.map((s) => s.status))
  const unknown_count = sources.filter((s) => s.status === 'unknown').length
  const screen = { verdict, compliant_count, unknown_count, sources, checked_at: new Date(now).toISOString() }

  await query(
    'UPDATE tickers SET sharia_screen=$2, sharia_screen_at=now(), sharia_status=$3, updated_at=now() WHERE symbol=$1',
    [symbol, JSON.stringify(screen), badgeFor(compliant_count, unknown_count)],
  )
  return { cached: false, sharia_screen: screen }
}
