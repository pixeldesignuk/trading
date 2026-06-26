// Pure transition logic. A notable alert fires when a ticker moves INTO one of
// three states; every other state change updates the stored state silently.
const NOTABLE = {
  in_buy: { kind: 'entered_buy', emoji: '🟢', label: 'entered buy zone' },
  near_target: { kind: 'near_target', emoji: '🎯', label: 'approaching target' },
  past_invalidation: { kind: 'invalidation', emoji: '🔴', label: 'breached invalidation' },
}

// prev → new. Returns the transition descriptor or null. A genuine state change
// is required (prev !== next); a null/unknown prev is the caller's call (run.js
// seeds the baseline without firing on first sight).
export function transitionFor(prevState, newState) {
  if (prevState === newState) return null
  return NOTABLE[newState] || null
}

const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }))

export function nearestTarget(price, targets = []) {
  let best = null, bestD = Infinity
  for (const t of targets) {
    const d = Math.abs(price - t)
    if (d < bestD) { bestD = d; best = t }
  }
  return best
}

// The numeric level the price crossed — for the event payload.
export function levelFor(plan, price, transition) {
  if (transition.kind === 'entered_buy') return { buyLow: plan.buyLow, buyHigh: plan.buyHigh }
  if (transition.kind === 'near_target') return nearestTarget(price, plan.targets)
  if (transition.kind === 'invalidation') return plan.invalidation
  return null
}

// One line per fire, with grade/Sharia context.
export function formatLine(ticker, plan, price, transition) {
  const ctx = [
    ticker.top_grade != null ? `grade ${ticker.top_grade}/10` : null,
    ticker.sharia_status && ticker.sharia_status !== 'unknown' ? `☪ ${ticker.sharia_status}` : null,
  ].filter(Boolean).join(' · ')
  const tail = ctx ? ` · ${ctx}` : ''
  if (transition.kind === 'entered_buy') {
    const zone = plan.buyLow === plan.buyHigh ? fmt(plan.buyLow) : `${fmt(plan.buyLow)}–${fmt(plan.buyHigh)}`
    return `🟢 ${ticker.symbol} entered buy zone ${zone} · now ${fmt(price)}${tail}`
  }
  if (transition.kind === 'near_target') {
    return `🎯 ${ticker.symbol} approaching ${fmt(nearestTarget(price, plan.targets))} · now ${fmt(price)}${tail}`
  }
  if (transition.kind === 'invalidation') {
    return `🔴 ${ticker.symbol} breached invalidation ${fmt(plan.invalidation)} · now ${fmt(price)}${tail}`
  }
  return ''
}

// One batched Telegram message for all fires in a run.
export function buildMessage(lines = []) {
  const head = `🥷 Trading Hub alerts — ${lines.length} hit`
  return [head, '', ...lines, '', 'not financial advice'].join('\n')
}
