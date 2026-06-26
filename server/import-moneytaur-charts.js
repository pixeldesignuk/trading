/**
 * import-moneytaur-charts.js
 *
 * For each existing moneytaur event whose payload.chart is set, ensure a
 * matching kind:'chart' event exists (dedupe key: moneytaur-chart:<native_id>).
 *
 * The chart path already points at media/moneytaur/<file>, which is served from
 * trading-hub/media/. We skip the copyChartImage step when the destination already
 * exists; we always create/upsert the chart event.
 *
 * Run:  node --env-file-if-exists=.env server/import-moneytaur-charts.js
 * Script: pnpm import:moneytaur
 */

import path from 'node:path'
import { query } from './db.js'
import { appendEvent } from './events.js'
import { copyChartImage } from './charts.js'
import { TRADING, MEDIA_DIR } from './config.js'

const SIGNALS_MEDIA = path.resolve(TRADING, 'signals-web', 'media')

/**
 * Pure helper — given a moneytaur event row, return the chart event params.
 * Returns null if the event has no chart payload.
 *
 * @param {{ id: string, ticker: string, dedup_key: string, occurred_at: string|null, payload: object }} event
 * @returns {{ symbol: string, chartRel: string, nativeId: string, occurred_at: string|null }|null}
 */
export function moneytaurEventToChart(event) {
  const chart = event.payload?.chart
  if (!chart) return null

  // dedup_key is "moneytaur:<native_id>"
  const nativeId = event.dedup_key?.split(':').slice(1).join(':') ?? String(event.id)

  return {
    symbol: event.ticker,
    chartRel: chart,                        // e.g. media/moneytaur/12345.jpg
    nativeId,
    occurred_at: event.occurred_at ?? null,
  }
}

/**
 * Ensure the chart file exists in trading-hub/media/moneytaur/.
 * Tries the signals-web/media path as fallback source if the dest is missing.
 *
 * @param {string} chartRel  e.g. "media/moneytaur/12345.jpg"
 * @returns {Promise<string>}  The rel path (unchanged)
 */
async function ensureChartFile(chartRel) {
  const dest = path.join(MEDIA_DIR, 'moneytaur', path.basename(chartRel))
  const fs = await import('node:fs')
  if (!fs.default.existsSync(dest)) {
    // Try copying from signals-web/media
    const src = path.join(SIGNALS_MEDIA, 'moneytaur', path.basename(chartRel))
    if (fs.default.existsSync(src)) {
      await copyChartImage(src, 'moneytaur')
    } else {
      console.warn(`  Warning: chart source not found: ${src}`)
    }
  }
  return chartRel
}

/**
 * Main runner — idempotent.
 */
export async function run() {
  const { rows: events } = await query(
    `SELECT id, ticker, source, kind, dedup_key, occurred_at, payload
     FROM events
     WHERE source = 'moneytaur' AND payload->>'chart' IS NOT NULL
     ORDER BY id`,
  )

  let skipped = 0
  let upserted = 0

  for (const event of events) {
    const params = moneytaurEventToChart(event)
    if (!params) { skipped++; continue }

    const { symbol, chartRel, nativeId, occurred_at } = params
    const chartDedup = `moneytaur-chart:${nativeId}`

    // Ensure the file exists in hub media
    await ensureChartFile(chartRel)

    // Upsert the chart event (appendEvent dedupes on dedup_key)
    await appendEvent({
      ticker: symbol,
      source: 'moneytaur',
      kind: 'chart',
      occurred_at,
      native_id: chartDedup,    // becomes dedup_key = "moneytaur:moneytaur-chart:<id>"
      payload: { chart: chartRel },
    })
    upserted++
    console.log(`  [moneytaur chart] ${symbol} → ${chartRel}`)
  }

  console.log(`moneytaur charts: ${events.length} events scanned, ${skipped} skipped (no chart), ${upserted} chart events upserted`)
  return { total: events.length, skipped, upserted }
}

// CLI guard
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { pool } = await import('./db.js')
  try {
    await run()
  } finally {
    await pool.end()
  }
}
