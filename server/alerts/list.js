import { query } from '../db.js'
import { listTickers } from '../tickers.js'
import { priceVsPlan } from '../price-plan.js'
import { getQuotes } from '../price-provider.js'
import { ALERT_NEAR } from '../config.js'
import { armTickers } from './arming.js'
import { listCustomAlerts } from './custom.js'

// Surface the "planned alerts": every armed ticker (watchlist/held + numeric
// plan), its resolved levels, and where it currently sits (state/price from the
// last engine run, in alert_state). Plus the recent fire history. Read-only —
// for the Alerts tab. Actionable states are sorted to the top.
const ORDER = { in_buy: 0, past_invalidation: 1, near_target: 2, below_buy: 3, drifting: 4, no_price: 5, no_plan: 6 }

export async function listAlerts() {
  const tickers = await listTickers()
  const states = await query('SELECT * FROM alert_state')
  const bySym = new Map(states.rows.map((r) => [r.symbol, r]))

  const armedBase = armTickers(tickers)
  // Price LIVE (same source + cache as the chat's live blocks) so the widget never
  // shows a stale alert_state.price — keyed the same way run.js prices them.
  let quotes = {}
  try { quotes = await getQuotes(armedBase.map(({ t }) => ({ ticker: t.symbol, asset_class: t.asset_class, symbol: t.quote_symbol || undefined }))) }
  catch { /* fall back to last-eval price below */ }

  const armed = armedBase.map(({ t, plan }) => {
    const s = bySym.get(t.symbol) || {}
    const price = quotes[t.symbol]?.price ?? s.price ?? null // live, else last-eval
    // Recompute state from the CURRENT plan + live price so plan/price/state always
    // agree on the page (and with the chat), even if the plan changed since the run.
    return {
      symbol: t.symbol, name: t.name, asset_class: t.asset_class, status: t.status,
      sharia_status: t.sharia_status, top_grade: t.top_grade,
      muted: !!t.alerts_muted,
      plan, price, state: price == null ? null : priceVsPlan(price, plan, ALERT_NEAR),
      last_transition: s.last_transition || null, last_fired_at: s.last_fired_at || null,
      last_eval_at: s.last_eval_at || null,
    }
  })
  armed.sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || a.symbol.localeCompare(b.symbol))

  const custom = await listCustomAlerts()

  const recent = await query(
    `SELECT ticker, occurred_at, payload->>'note' AS note
     FROM events WHERE source='alert'
     ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT 50`,
  )
  return { armed, custom, recent: recent.rows, generated_at: states.rows[0]?.last_eval_at || null }
}
