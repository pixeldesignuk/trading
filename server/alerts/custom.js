import { query } from '../db.js'
import { getTicker } from '../tickers.js'
import { getQuotes } from '../price-provider.js'
import { appendEvent } from '../events.js'
import { resolvePlan } from './resolve-plan.js'

// ── Custom price-cross alerts ────────────────────────────────────────────────
// Free-standing "ping me when SYM crosses PRICE", distinct from the plan-derived
// engine. One-shot: fires once when price crosses in `direction`, then active=false.
// Set/cancelled from the chat agent or the Alerts widget; evaluated in the hourly
// run alongside the plan alerts and delivered through the same Telegram path.

const DIRECTIONS = new Set(['above', 'below'])
const CREATORS = new Set(['chat', 'widget', 'plan'])
const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }))

// Active custom alerts, newest first. Optional symbol filter.
export async function listCustomAlerts({ symbol } = {}) {
  const r = symbol
    ? await query('SELECT * FROM custom_alerts WHERE active AND symbol=$1 ORDER BY created_at DESC', [symbol])
    : await query('SELECT * FROM custom_alerts WHERE active ORDER BY created_at DESC')
  return r.rows
}

// Create a one-shot alert. Validates the ticker exists and the inputs are sane so
// a bad tool call from chat can't poison the table. Returns the created row.
export async function createCustomAlert({ symbol, direction, price, note = null, createdBy = 'chat' } = {}) {
  const sym = String(symbol || '').toUpperCase().trim()
  if (!sym) throw new Error('symbol required')
  const t = await getTicker(sym)
  if (!t) throw new Error(`unknown ticker ${sym}`)
  const dir = String(direction || '').toLowerCase().trim()
  if (!DIRECTIONS.has(dir)) throw new Error("direction must be 'above' or 'below'")
  const p = Number(price)
  if (!Number.isFinite(p) || p <= 0) throw new Error('price must be a positive number')
  const r = await query(
    `INSERT INTO custom_alerts (symbol, direction, price, note, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [sym, dir, p, note ? String(note).slice(0, 280) : null, CREATORS.has(createdBy) ? createdBy : 'chat'],
  )
  return r.rows[0]
}

// ── Plan-armed alerts ────────────────────────────────────────────────────────
// Arm a deterministic set of one-shot alerts straight from a ticker's plan: the
// entry (buy zone), the invalidation (stop) and each target. Direction is chosen
// so each alert sits AHEAD of the live price (a future cross) rather than firing
// instantly. Tagged created_by='plan' so disarm can find + cancel exactly this
// set; re-arming clears the old set first so levels track the current plan.
export async function armPlanAlerts(symbol) {
  const sym = String(symbol || '').toUpperCase().trim()
  const t = await getTicker(sym)
  if (!t) throw new Error(`unknown ticker ${sym}`)
  const plan = resolvePlan(t)
  if (!plan) return { symbol: sym, armed: 0, reason: 'no plan levels' }
  await disarmPlanAlerts(sym)
  let price = null
  try { const q = await getQuotes([{ ticker: sym, asset_class: t.asset_class }]); price = q[sym]?.price ?? null } catch { /* best-effort */ }
  const aheadDir = (level) => (price != null && price >= level ? 'below' : 'above')
  const levels = []
  if (plan.entryHigh != null) levels.push({ price: plan.entryHigh, note: 'Plan: entry zone' })
  if (plan.invalidation != null) levels.push({ price: plan.invalidation, direction: 'below', note: 'Plan: invalidation (stop)' })
  ;(plan.targets || []).forEach((tp, i) => levels.push({ price: tp, direction: 'above', note: `Plan: target ${i + 1}` }))
  let armed = 0
  for (const lv of levels) {
    if (lv.price == null || !(lv.price > 0)) continue
    await createCustomAlert({ symbol: sym, direction: lv.direction || aheadDir(lv.price), price: lv.price, note: lv.note, createdBy: 'plan' })
    armed++
  }
  return { symbol: sym, armed }
}

// Cancel the plan-armed set for a ticker (custom chat/widget alerts untouched).
export async function disarmPlanAlerts(symbol) {
  const sym = String(symbol || '').toUpperCase().trim()
  const r = await query("UPDATE custom_alerts SET active=FALSE WHERE symbol=$1 AND created_by='plan' AND active", [sym])
  return { symbol: sym, cancelled: r.rowCount }
}

// Deactivate one alert. Returns true if a matching active alert was found.
export async function cancelCustomAlert(id) {
  const r = await query('UPDATE custom_alerts SET active=FALSE WHERE id=$1 AND active RETURNING id', [Number(id)])
  return r.rowCount > 0
}

// Mute / unmute the plan-derived alerts for a ticker (custom alerts unaffected).
export async function setMuted(symbol, muted) {
  const sym = String(symbol || '').toUpperCase().trim()
  const r = await query('UPDATE tickers SET alerts_muted=$2 WHERE symbol=$1 RETURNING symbol', [sym, !!muted])
  if (!r.rowCount) throw new Error(`unknown ticker ${sym}`)
  return { symbol: sym, muted: !!muted }
}

// Evaluate active custom alerts against live prices, fire the crossed ones (event
// + collected line for Telegram), and deactivate them. Mirrors run.js's per-item
// isolation. `quoter` is injectable for tests. Returns { fired, lines }.
export async function evalCustomAlerts({ now = Date.now(), quoter = getQuotes } = {}) {
  const active = await listCustomAlerts()
  if (!active.length) return { fired: [], lines: [] }

  // One quote batch over the distinct symbols.
  const symbols = [...new Set(active.map((a) => a.symbol))]
  const tickers = new Map(await Promise.all(symbols.map(async (s) => [s, await getTicker(s)])))
  const quotes = await quoter(symbols.map((s) => ({ ticker: s, asset_class: tickers.get(s)?.asset_class })))
  const hourBucket = new Date(now).toISOString().slice(0, 13)

  const fired = []
  const lines = []
  for (const a of active) {
    try {
      const price = quotes[a.symbol]?.price ?? null
      if (price == null) continue
      const hit = a.direction === 'above' ? price >= a.price : price <= a.price
      if (!hit) continue
      const arrow = a.direction === 'above' ? '↑' : '↓'
      const line = `🔔 ${a.symbol} crossed ${arrow} ${fmt(a.price)} · now ${fmt(price)}${a.note ? ` · ${a.note}` : ''}`
      await appendEvent({
        ticker: a.symbol, source: 'alert', kind: 'alert',
        occurred_at: new Date(now).toISOString(),
        native_id: `custom:${a.id}:${hourBucket}`,
        payload: { note: line, text: `crossed ${a.direction} ${a.price}`, levels: a.price },
      })
      await query('UPDATE custom_alerts SET active=FALSE, last_fired_at=$2, fired_price=$3 WHERE id=$1',
        [a.id, new Date(now).toISOString(), price])
      lines.push(line)
      fired.push({ id: a.id, symbol: a.symbol, direction: a.direction, price: a.price, crossed_at: price })
    } catch (e) {
      console.warn(`[alerts] custom #${a.id} ${a.symbol} skipped: ${e.message}`)
    }
  }
  return { fired, lines }
}
