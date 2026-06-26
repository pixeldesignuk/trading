import { resolvePlan } from './resolve-plan.js'
import { ALERT_POINT_BAND } from '../config.js'

// A ticker is armed for alerts when it's on the watchlist or held — the
// Portfolio statuses — AND has a usable numeric plan. Single source of truth so
// the run engine and the Alerts page never disagree on what's armed.
export const ARM_STATUSES = new Set(['watching', 'in'])

export function armTickers(tickers = []) {
  return tickers
    .filter((t) => ARM_STATUSES.has(t.status))
    .map((t) => ({ t, plan: resolvePlan(t, { pointBand: ALERT_POINT_BAND }) }))
    .filter((x) => x.plan)
}
