// Dynamic funds — the risk model's account-size basis is the aggregate TOTAL
// VALUE (cash + invested) across all connected accounts, matching how the static
// ACCOUNT_SIZE represents total capital. Available cash is surfaced separately as
// the deploy constraint. Falls back to config when no broker is connected.
import { query } from '../db.js'
import { ACCOUNT_SIZE } from '../config.js'

const n = (v) => (v == null ? 0 : Number(v))

export async function getFunds({ q = query, fallbackSize = ACCOUNT_SIZE, book = null, ownerIds = null } = {}) {
  const { rows } = ownerIds
    ? await q('SELECT * FROM broker_accounts WHERE owner_id = ANY($1) ORDER BY id', [ownerIds])
    : book
      ? await q('SELECT * FROM broker_accounts WHERE book = $1 ORDER BY id', [book])
      : await q('SELECT * FROM broker_accounts ORDER BY id')
  if (!rows.length) {
    // A specific owner/book with no accounts is genuinely empty (£0) — the config
    // fallback only stands in for "no broker connected at all" (whole portfolio).
    if (book || ownerIds) return { source: 'broker', currency: 'GBP', cash: 0, invested: 0, totalValue: 0, pnl: 0, accounts: [] }
    return { source: 'config', currency: 'GBP', cash: 0, invested: 0, totalValue: fallbackSize, pnl: 0, accounts: [] }
  }
  const accounts = rows.map((r) => ({
    id: r.id, label: r.label, currency: r.currency, book: r.book || 'personal',
    cash: n(r.cash), invested: n(r.invested), totalValue: n(r.total_value), pnl: n(r.pnl),
    error: r.error, syncedAt: r.synced_at,
  }))
  const sum = (k) => accounts.reduce((t, a) => t + a[k], 0)
  return {
    source: 'broker',
    currency: accounts[0].currency || 'GBP',
    cash: sum('cash'), invested: sum('invested'), totalValue: sum('totalValue'), pnl: sum('pnl'),
    accounts,
  }
}

// Holdings for the Active cards, joined to their account label.
export async function getHoldings({ q = query, book = null, ownerIds = null } = {}) {
  const where = ownerIds ? 'WHERE a.owner_id = ANY($1)' : book ? 'WHERE a.book = $1' : ''
  const params = ownerIds ? [ownerIds] : book ? [book] : []
  const { rows } = await q(
    `SELECT h.ticker, h.broker_symbol, h.name, h.quantity, h.avg_price, h.value, h.pnl,
            h.currency, h.account_id, h.synced_at, a.label AS account_label
       FROM holdings h JOIN broker_accounts a ON a.id = h.account_id
       ${where}
       ORDER BY h.value DESC NULLS LAST`,
    params,
  )
  return rows.map((r) => ({
    ticker: r.ticker, brokerSymbol: r.broker_symbol, name: r.name,
    quantity: n(r.quantity), avgPrice: n(r.avg_price), value: n(r.value), pnl: n(r.pnl),
    currency: r.currency, accountId: r.account_id, accountLabel: r.account_label, syncedAt: r.synced_at,
  }))
}
