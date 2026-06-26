import { query } from './db.js'

// The repurposed Ideas inbox: ticker ideas that community MEMBERS raised in the
// Telegram chatter (source='community'), attributed to whoever floated them —
// distinct from Zero/Moneytaur signals. Grouped by ticker, un-triaged (status
// 'new') only, newest idea first. Optional Sharia filter.
export async function listIdeas({ sharia } = {}) {
  const params = []
  let shariaClause = ''
  if (sharia && sharia !== 'all') {
    params.push(sharia)
    shariaClause = `AND t.sharia_status = $${params.length}`
  }
  const r = await query(
    `SELECT t.symbol, t.name, t.asset_class, t.status, t.sharia_status,
            t.top_grade, t.top_grade_verdict, t.first_seen,
            e.occurred_at, e.payload
     FROM events e
     JOIN tickers t ON t.symbol = e.ticker
     WHERE e.source = 'community' AND t.status = 'new' ${shariaClause}
     ORDER BY e.occurred_at DESC NULLS LAST, e.id DESC`,
    params,
  )
  // Group events into one card per ticker, preserving newest-first order.
  const byTicker = new Map()
  for (const row of r.rows) {
    if (!byTicker.has(row.symbol)) {
      byTicker.set(row.symbol, {
        symbol: row.symbol, name: row.name, asset_class: row.asset_class,
        status: row.status, sharia_status: row.sharia_status,
        top_grade: row.top_grade, top_grade_verdict: row.top_grade_verdict,
        first_seen: row.first_seen, ideas: [],
      })
    }
    const p = row.payload || {}
    byTicker.get(row.symbol).ideas.push({
      author: p.author || null,
      note: p.note || p.text || null,
      url: p.url || null,
      occurred_at: row.occurred_at,
    })
  }
  return [...byTicker.values()]
}
