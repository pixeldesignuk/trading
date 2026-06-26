import { listTickers } from '../tickers.js'
import { getQuotes } from '../price-provider.js'
import { priceVsPlan } from '../price-plan.js'
import { appendEvent } from '../events.js'
import { ALERT_NEAR, ALERT_COOLDOWN_H } from '../config.js'
import { armTickers } from './arming.js'
import { transitionFor, levelFor, formatLine, buildMessage } from './transitions.js'
import { getAlertState, upsertAlertState, inCooldown } from './state.js'
import { evalCustomAlerts } from './custom.js'
import { sendTelegram } from './telegram.js'

// One alert pass: arm every ticker with a usable numeric plan, price them in one
// batch, and fire on notable plan-state transitions. `quoter`/`sender` are
// injectable for tests/dry-runs. Per-ticker isolation — one failure never sinks
// the run. Idempotent across retries: state transitions fire once, and the alert
// event's hour-bucketed dedup_key collapses same-hour re-runs.
export async function runAlerts({ now = Date.now(), quoter = getQuotes, sender = sendTelegram } = {}) {
  const tickers = await listTickers()
  const armed = armTickers(tickers) // watchlist/held (watching|in) with a numeric plan

  const quotes = await quoter(armed.map((x) => ({ ticker: x.t.symbol, asset_class: x.t.asset_class })))

  const fired = []
  const lines = []
  let evaluated = 0, skipped = 0
  const hourBucket = new Date(now).toISOString().slice(0, 13) // YYYY-MM-DDTHH

  for (const { t, plan } of armed) {
    try {
      const price = quotes[t.symbol]?.price ?? null
      if (price == null) { skipped++; continue }
      evaluated++

      const state = priceVsPlan(price, plan, ALERT_NEAR)
      const prevRow = await getAlertState(t.symbol)
      const prevState = prevRow?.state ?? null
      // First sight → seed the baseline silently (no deploy-time flood).
      const transition = prevState == null ? null : transitionFor(prevState, state)

      let didFire = false
      // Muted tickers still track state (so unmuting is clean) but never fire.
      if (transition && !t.alerts_muted && !inCooldown(prevRow, transition.kind, ALERT_COOLDOWN_H, now)) {
        const line = formatLine(t, plan, price, transition)
        const level = levelFor(plan, price, transition)
        await appendEvent({
          ticker: t.symbol, source: 'alert', kind: 'alert',
          occurred_at: new Date(now).toISOString(),
          native_id: `${t.symbol}:${transition.kind}:${hourBucket}`,
          payload: { note: line, text: `${transition.label} @ ${price}`, levels: level },
        })
        lines.push(line)
        fired.push({ symbol: t.symbol, transition: transition.kind, price, level })
        didFire = true
      }
      await upsertAlertState(t.symbol, { state, price, transition: transition?.kind, fired: didFire, now })
    } catch (e) {
      console.warn(`[alerts] ${t.symbol} skipped: ${e.message}`)
      skipped++
    }
  }

  // Custom price-cross alerts: same quoter, same Telegram batch, same event path.
  const customRes = await evalCustomAlerts({ now, quoter })
  if (customRes.lines.length) lines.push(...customRes.lines)
  if (customRes.fired.length) fired.push(...customRes.fired)

  let telegram = { skipped: true }
  if (lines.length) telegram = await sender(buildMessage(lines))

  return { armed: armed.length, evaluated, skipped, fired, custom: customRes.fired.length, telegram }
}
