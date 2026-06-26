import { query } from '../db.js'

export async function getAlertState(symbol) {
  const r = await query('SELECT * FROM alert_state WHERE symbol=$1', [symbol])
  return r.rows[0] || null
}

// Pure cooldown check: suppress re-firing the SAME transition for the same
// ticker within cooldownH hours, even if its state flaps out and back.
export function inCooldown(row, transitionKind, cooldownH, now = Date.now()) {
  if (!row?.last_fired_at || row.last_transition !== transitionKind) return false
  return now - new Date(row.last_fired_at).getTime() < cooldownH * 3600 * 1000
}

// Always record the latest state/price; only stamp last_fired_at/last_transition
// when a notable alert actually fired.
export async function upsertAlertState(symbol, { state, price, transition = null, fired = false, now = Date.now() }) {
  const at = new Date(now).toISOString()
  await query(
    `INSERT INTO alert_state (symbol, state, price, last_transition, last_fired_at, last_eval_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (symbol) DO UPDATE SET
       state = EXCLUDED.state,
       price = EXCLUDED.price,
       last_transition = COALESCE(EXCLUDED.last_transition, alert_state.last_transition),
       last_fired_at  = COALESCE(EXCLUDED.last_fired_at, alert_state.last_fired_at),
       last_eval_at   = EXCLUDED.last_eval_at`,
    [symbol, state, price, fired ? transition : null, fired ? at : null, at],
  )
}
