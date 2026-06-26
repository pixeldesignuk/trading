// Layer-aware posture for a portfolio row — the single source of truth for "what
// needs attention", shared by the deterministic Portfolio scan bar and the chat
// roster so they never disagree. Pure (no node deps) → importable on the client.
//
// A HOLD is sized by allocation and has no stop BY DESIGN, so it's only flagged
// on heavy drawdown vs cost or a degraded thesis. A TRADE is flagged at/near
// invalidation or for missing levels. Returns { kind, reason }:
//   at_risk — needs attention now
//   watch   — worth a look (opportunity or soft risk)
//   ok      — nothing to do
//
// Expected row shape: { layer, state, grade, held:{value,pnl}|null,
//                       synthesis:{action,contested}|null }
export const HOLD_DRAWDOWN = -0.15  // a hold down ≥15% vs cost is "at risk"

export function assessPosture(r = {}) {
  const held = r.held && r.held.value != null
  const cost = held ? r.held.value - r.held.pnl : null
  const ddPct = cost != null && cost > 0 ? r.held.pnl / cost : null
  const syn = r.synthesis || null
  const shaky = syn && (syn.action === 'stand_aside' || syn.contested)
  const grade = r.grade ?? 0

  if (r.layer === 'hold') {
    if (ddPct != null && ddPct <= HOLD_DRAWDOWN) return { kind: 'at_risk', reason: `down ${Math.round(ddPct * 100)}% vs cost` }
    if (held && shaky) return { kind: 'watch', reason: syn.action === 'stand_aside' ? 'thesis: stand aside' : 'thesis contested' }
    if (!held && grade >= 7) return { kind: 'watch', reason: `grade ${grade} hold candidate` }
    return { kind: 'ok' }
  }

  // trade
  if (r.state === 'past_invalidation') return { kind: 'at_risk', reason: held ? 'held below invalidation' : 'below invalidation' }
  if (held && r.state === 'no_plan') return { kind: 'at_risk', reason: 'held trade, no levels set' }
  if (r.state === 'near_target') return { kind: 'watch', reason: 'near target — manage' }
  if (!held && r.state === 'in_buy') return { kind: 'watch', reason: 'in buy zone' }
  if (!held && r.state === 'no_plan') return { kind: 'watch', reason: 'needs entry/stop levels' }
  if (!held && grade >= 7 && (r.state === 'in_buy' || r.state === 'below_buy')) return { kind: 'watch', reason: `grade ${grade} setup` }
  return { kind: 'ok' }
}
