// ledger.js — per-book aggregation. Hold targets are reconciled against the
// 4-bucket nested allocation (allocate.js); picks (trade-layer) are dual-cap
// sized by picks-model.js. A derived pyramid is returned for display.
import { classify } from './classify.js'
import { allocateTargets, coreTypeBudgets, derivedPyramidFor, neutralPyramid } from './allocate.js'
import { sizePicks } from './picks-model.js'

const BAND = 0.005

export function buildLedger({ book, targets, holdings = [], tickers = [], bookValue = 0, regime } = {}) {
  const byTicker = new Map(tickers.map((t) => [t.symbol, t]))
  const valueByTicker = new Map()
  for (const h of holdings) valueByTicker.set(h.ticker, (valueByTicker.get(h.ticker) || 0) + Number(h.value || 0))
  const unrealizedPnl = holdings.reduce((s, h) => s + Number(h.pnl || 0), 0)

  const actionedNotHeld = tickers.filter(
    (t) => t.actioned_at != null && !valueByTicker.has(t.symbol) && classify(t).bucket !== 'picks',
  )
  const heldTickers = [...valueByTicker.keys()].map((sym) => byTicker.get(sym) || { symbol: sym })
  const holdUniverse = [...heldTickers.filter((t) => classify(t).bucket !== 'picks'), ...actionedNotHeld]
  const alloc = allocateTargets(holdUniverse, targets, { regime })

  // Picks (trade-layer held names) sized by the dual cap.
  const pickTickers = heldTickers
    .filter((t) => classify(t).bucket === 'picks')
    .map((t) => ({ ...t, value: valueByTicker.get(t.symbol) || 0 }))
  const pickSizing = new Map(
    sizePicks(pickTickers, { bookValue, picksPct: Number(targets.picks_pct || 0), riskCapPct: Number(targets.active_risk_cap_pct || 0.02) })
      .map((p) => [p.symbol, p]),
  )

  const rows = []
  let openRisk = 0
  for (const [symbol, value] of valueByTicker) {
    const t = byTicker.get(symbol) || { symbol }
    const c = classify(t)
    const currentPct = bookValue ? value / bookValue : 0
    if (c.bucket === 'picks') {
      const p = pickSizing.get(symbol) || {}
      if (p.openRisk) openRisk += p.openRisk
      rows.push({ symbol, name: t.name, layer: c.layer, role: c.role, tier: c.pyramidTier, bucket: 'picks', theme: null,
        currentPct, targetPct: null, suggestedPct: p.suggestedPct ?? null, pinned: false, deltaPct: null,
        action: 'trade', pending: false, rr: p.rr ?? null, openRisk: p.openRisk ?? null, overCap: !!p.overCap, needsLevels: !!p.needsLevels })
      continue
    }
    const a = alloc.get(symbol) || { bucket: c.bucket, theme: c.theme, coreType: c.coreType, targetPct: 0, pinned: false }
    const deltaPct = a.targetPct - currentPct
    let action = deltaPct > BAND ? 'add' : deltaPct < -BAND ? 'trim' : 'ok'
    // Guidance, not trim: core fund rows must never show 'trim' — coverage
    // guidance is expressed via coreCoverage, not by trimming the fund.
    if (a.bucket === 'core' && action === 'trim') action = 'ok'
    rows.push({ symbol, name: t.name, layer: c.layer, role: c.role, tier: c.pyramidTier, bucket: a.bucket, theme: a.theme,
      coreType: a.bucket === 'core' ? (a.coreType ?? null) : undefined,
      needsType: a.bucket === 'core' && a.needsType ? true : undefined,
      currentPct, targetPct: a.targetPct, pinned: a.pinned, deltaPct, action, pending: false })
  }
  for (const t of actionedNotHeld) {
    const c = classify(t)
    const a = alloc.get(t.symbol) || { bucket: c.bucket, theme: c.theme, targetPct: 0, pinned: false }
    rows.push({ symbol: t.symbol, name: t.name, layer: c.layer, role: c.role, tier: c.pyramidTier, bucket: a.bucket, theme: a.theme,
      currentPct: 0, targetPct: a.targetPct, pinned: a.pinned, deltaPct: a.targetPct, action: 'pending', pending: true })
  }

  const deployedPct = rows.reduce((s, r) => s + r.currentPct, 0)
  const cashAdvisory = (regime === 'defense' || regime === 'late_cycle')
    ? 'Defensive regime — consider holding extra dry powder (advisory; cash target unchanged).' : null

  // coreCoverage: one entry per core sub-type summarising target vs current coverage.
  const budgets = coreTypeBudgets(targets)
  // Sum current% of held core rows by coreType.
  const currentByType = {}
  const heldByType = {}
  for (const row of rows) {
    if (row.bucket === 'core' && row.coreType) {
      currentByType[row.coreType] = (currentByType[row.coreType] || 0) + row.currentPct
      if (!heldByType[row.coreType]) heldByType[row.coreType] = []
      heldByType[row.coreType].push(row.symbol)
    }
  }
  const coreCoverage = Object.entries(budgets).map(([coreType, targetPct]) => {
    const currentPct = currentByType[coreType] || 0
    const held = heldByType[coreType] || []
    const needsBuy = currentPct < targetPct - BAND
    return { coreType, targetPct, currentPct, held, needsBuy }
  })

  return {
    book, bookValue, deployedPct, dryPowderPct: Math.max(0, 1 - deployedPct), openRisk, unrealizedPnl, rows,
    pyramid: { neutral: neutralPyramid(targets), effective: derivedPyramidFor(targets, regime) },
    cashAdvisory, coreCoverage,
  }
}
