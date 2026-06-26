import { query } from './db.js'
import { setPlan } from './tickers.js'

// Source tiers: 0 = highest priority (zero_hub/zero_live), 1 = lower (moneytaur/manual/others)
function sourceTier(source) {
  if (source === 'zero_hub' || source === 'zero_live') return 0
  return 1
}

/**
 * reconcilePlan(levelsList) — PURE function.
 *
 * levelsList: [{entry_zone, ladder[], targets[], invalidation, confidence, source}]
 *
 * Picks the best "anchor" level set (highest-tier, then highest-confidence) for
 * invalidation / ladder / entry_zone, then merges all targets (dedupe by price,
 * higher-tier entry wins on conflict).
 *
 * Returns: {entry_zone, ladder, targets, invalidation}
 */
export function reconcilePlan(levelsList) {
  if (!levelsList || levelsList.length === 0) {
    return { entry_zone: null, ladder: [], targets: [], invalidation: null }
  }

  // Sort by tier asc, then confidence desc — best anchor is first
  const sorted = [...levelsList].sort((a, b) => {
    const tierDiff = sourceTier(a.source) - sourceTier(b.source)
    if (tierDiff !== 0) return tierDiff
    return (b.confidence ?? 0) - (a.confidence ?? 0)
  })

  const anchor = sorted[0]

  // Merge targets: dedupe by price; for conflicts, prefer lower-tier (higher priority) source
  const targetsByPrice = new Map()
  for (const level of sorted) {
    for (const t of level.targets ?? []) {
      if (t.price == null) continue
      if (!targetsByPrice.has(t.price)) {
        // Lower tier = higher priority, so only insert if not already set by a better source
        targetsByPrice.set(t.price, t)
      }
      // If already set, keep existing (which was set by a higher-priority source first)
    }
  }

  // Also merge ladder (dedupe by price, same rule)
  const ladderByPrice = new Map()
  for (const level of sorted) {
    for (const l of level.ladder ?? []) {
      if (l.price == null) continue
      if (!ladderByPrice.has(l.price)) {
        ladderByPrice.set(l.price, l)
      }
    }
  }

  return {
    entry_zone: anchor.entry_zone ?? null,
    ladder: Array.from(ladderByPrice.values()),
    targets: Array.from(targetsByPrice.values()),
    invalidation: anchor.invalidation ?? null,
  }
}

/**
 * setThesis(symbol, text) — UPDATE tickers SET ai_thesis, ai_thesis_at=now()
 */
export async function setThesis(symbol, text) {
  await query(
    'UPDATE tickers SET ai_thesis=$2, ai_thesis_at=now(), updated_at=now() WHERE symbol=$1',
    [symbol, text],
  )
}

/**
 * setEventEnrichment(eventId, {summary, caption, levels}) — merges keys into events.payload via JSONB merge.
 */
export async function setEventEnrichment(eventId, { summary, caption, levels } = {}) {
  const patch = {}
  if (summary !== undefined) patch.summary = summary
  if (caption !== undefined) patch.caption = caption
  if (levels !== undefined) patch.levels = levels
  await query(
    'UPDATE events SET payload = payload || $2::jsonb WHERE id=$1',
    [eventId, JSON.stringify(patch)],
  )
}

/**
 * setPlanFromLevels(symbol, levelsList) — reconcilePlan then existing setPlan.
 */
export async function setPlanFromLevels(symbol, levelsList) {
  const plan = reconcilePlan(levelsList)
  await setPlan(symbol, plan)
}
