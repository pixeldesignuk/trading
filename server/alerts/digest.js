import { listAlerts } from './list.js'
import { getTicker } from '../tickers.js'
import { getQuotes } from '../price-provider.js'
import { sendTelegram } from './telegram.js'
import { nearestTarget } from './transitions.js'

// ── Twice-daily digest ───────────────────────────────────────────────────────
// An ACTIONABLE-ONLY briefing: the tickers that need attention right now (in the
// buy zone, near a target, or past invalidation) with their key levels, plus any
// pending custom price-cross alerts. Sent at 07:00 and 21:30 Europe/London by two
// thin Trigger.dev schedules poking POST /api/alerts/digest. Distinct from the
// hourly alert engine — it never fires/records events, it just summarises state.

// States worth surfacing (mirrors list.js's ORDER — the actionable head of it).
const ACTIONABLE = new Set(['in_buy', 'near_target', 'past_invalidation'])
const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }))

// morning before noon, evening after — by London wall-clock so BST/GMT is handled.
function labelFor(now) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }).format(new Date(now)))
  return hour < 12 ? 'morning' : 'evening'
}
const dateFor = (now) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(now))

// Assemble the digest inputs from the live alerts payload (which already re-prices
// and recomputes state, so the digest can't disagree with the Alerts tab). Custom
// alerts are enriched with current price + how far it sits from the level; symbols
// not already priced among the armed set get one top-up quote batch.
export async function gatherDigest({ now = Date.now(), quoter = getQuotes } = {}) {
  const data = await listAlerts()
  const actionable = (data.armed || []).filter((a) => ACTIONABLE.has(a.state))

  const priceBySym = new Map((data.armed || []).filter((a) => a.price != null).map((a) => [a.symbol, a.price]))
  const customs = data.custom || []
  const missing = [...new Set(customs.map((c) => c.symbol).filter((s) => !priceBySym.has(s)))]
  if (missing.length) {
    const tks = new Map(await Promise.all(missing.map(async (s) => [s, await getTicker(s)])))
    const q = await quoter(missing.map((s) => ({ ticker: s, asset_class: tks.get(s)?.asset_class, symbol: tks.get(s)?.quote_symbol || undefined })))
    for (const s of missing) if (q[s]?.price != null) priceBySym.set(s, q[s].price)
  }
  const enrichedCustoms = customs.map((c) => {
    const price = priceBySym.get(c.symbol) ?? null
    const awayPct = price != null && price > 0 ? Math.abs((c.price - price) / price) * 100 : null
    return { symbol: c.symbol, direction: c.direction, price: c.price, note: c.note, livePrice: price, awayPct }
  })
  return { actionable, customs: enrichedCustoms }
}

// One actionable ticker → one line, shaped by its state.
function actionableLine(a) {
  const p = a.plan || {}
  const stop = p.invalidation != null ? ` · stop ${fmt(p.invalidation)}` : ''
  const targets = (p.targets || []).length ? ` · targets ${p.targets.map(fmt).join(' / ')}` : ''
  if (a.state === 'in_buy') {
    const zone = p.entryLow === p.entryHigh ? fmt(p.entryLow) : `${fmt(p.entryLow)}–${fmt(p.entryHigh)}`
    return `🟢 ${a.symbol} · in buy ${zone} · now ${fmt(a.price)}${stop}${targets}`
  }
  if (a.state === 'near_target') {
    return `🎯 ${a.symbol} · near target ${fmt(nearestTarget(a.price, p.targets || []))} · now ${fmt(a.price)}${stop}`
  }
  // past_invalidation
  return `🔴 ${a.symbol} · breached stop ${fmt(p.invalidation)} · now ${fmt(a.price)}`
}

function customLine(c) {
  const arrow = c.direction === 'above' ? '↑' : '↓'
  const tail = c.livePrice != null
    ? ` · now ${fmt(c.livePrice)}${c.awayPct != null ? ` · ${c.awayPct.toFixed(1)}% away` : ''}`
    : ''
  return `${c.symbol} ${arrow} ${fmt(c.price)}${tail}${c.note ? ` · ${c.note}` : ''}`
}

// Pure: build the Telegram text from gathered inputs. Empty → a brief "all quiet"
// heartbeat so the digest is a predictable twice-daily signal.
export function buildDigestMessage({ actionable = [], customs = [] }, { now = Date.now() } = {}) {
  const head = `🥷 Trading Hub — ${labelFor(now)} digest · ${dateFor(now)}`
  if (!actionable.length && !customs.length) {
    return [head, '', '✅ All quiet — no actionable setups, no custom alerts pending.'].join('\n')
  }
  const body = []
  if (actionable.length) {
    body.push(`⚡ Actionable (${actionable.length})`, ...actionable.map(actionableLine))
  }
  if (customs.length) {
    if (body.length) body.push('')
    body.push(`🔔 Pending custom alerts (${customs.length})`, ...customs.map(customLine))
  }
  return [head, '', ...body].join('\n')
}

// Gather → build → send. `quoter`/`sender` injectable for tests/dry-runs, mirroring
// runAlerts. Returns a summary; never throws on a send failure (sender swallows it).
export async function runDigest({ now = Date.now(), quoter = getQuotes, sender = sendTelegram } = {}) {
  const { actionable, customs } = await gatherDigest({ now, quoter })
  const text = buildDigestMessage({ actionable, customs }, { now })
  const telegram = await sender(text)
  return {
    label: labelFor(now),
    actionable: actionable.length,
    customs: customs.length,
    allQuiet: !actionable.length && !customs.length,
    telegram,
  }
}
