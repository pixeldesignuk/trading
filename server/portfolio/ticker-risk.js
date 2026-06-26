import { query } from '../db.js'
import { getTicker, listTickers } from '../tickers.js'
import { getTargets } from './targets.js'
import { getFunds, getHoldings } from '../brokers/funds.js'
import { classify } from './classify.js'
import { allocateTargets } from './allocate.js'
import { holdModel } from './hold-model.js'
import { tradeModel } from './trade-model.js'

const BOOKS = new Set(['personal', 'kids'])

// Per-ticker risk + allocation for a book. Extracted from the /risk route so the
// chat agent can reason from the SAME numbers the Risk panel shows (book value,
// this ticker's target weight, trade sizing) instead of generic examples.
export async function computeTickerRisk(symbol, { book = 'personal' } = {}) {
  const t = await getTicker(symbol)
  if (!t) throw new Error('unknown ticker')
  book = BOOKS.has(book) ? book : 'personal'
  const relationship = book === 'kids' ? 'child' : 'self'
  // Map the legacy book to its owner for per-owner targets (falls back to the
  // relationship template when that owner has no custom row).
  const riskOwner = (await query('SELECT id, relationship FROM owners', [])).rows
    .find((o) => (o.relationship === 'child' ? 'kids' : 'personal') === book)
  const targets = await getTargets(riskOwner?.id ?? book, { relationship })
  const funds = await getFunds({ book })
  const cap = Number(targets.active_risk_cap_pct || 0.02)
  // Active-sleeve CAPITAL budget = the picks bucket (Zero: trade size = risk ÷ stop,
  // bounded by the active sleeve's capital, NOT by the risk-per-trade %).
  const picksBudget = funds.totalValue * Number(targets.picks_pct || 0)
  // Reconcile the hold target against the sleeve budget: build the hold-layer
  // universe (held names + this one) and take this ticker's allocated share.
  const holdings = await getHoldings({ book })
  const allTickers = await listTickers()
  const byTicker = new Map(allTickers.map((x) => [x.symbol, x]))
  const heldHold = [...new Set(holdings.map((h) => h.ticker))]
    .map((sym) => byTicker.get(sym) || { symbol: sym })
    .filter((x) => classify(x).layer !== 'trade')
  const universe = heldHold.some((x) => x.symbol === t.symbol) ? heldHold : [...heldHold, t]
  const alloc = allocateTargets(universe, targets).get(t.symbol)
  const hold = holdModel(t)
  return {
    symbol: t.symbol, book, bookValue: funds.totalValue, cash: funds.cash,
    activeRiskCapPct: cap, benchmark: targets.benchmark,
    classification: classify(t),
    bucket: alloc?.bucket ?? null,
    sleeve: alloc?.bucket ?? null,   // back-compat alias for TickerDetail.jsx until its selector is reworked
    hold: { ...hold, targetPct: alloc ? alloc.targetPct : hold.targetPct, pinned: alloc ? alloc.pinned : hold.pinned, rawTargetPct: hold.targetPct },
    trade: tradeModel(t, { account: funds.totalValue, sleeveBudget: picksBudget, riskPct: cap }),
  }
}
