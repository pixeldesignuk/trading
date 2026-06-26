/**
 * import-lives.js
 *
 * Imports Zero live-session screenshots from the old signals-web SQLite DB as
 * chart events, plus one mention event per (live, ticker) carrying the live tldr.
 *
 * Pure transform:
 *   liveShotToChart(shot, liveSlug, knownSymbols)
 *     → { symbol|null, srcFile, native_id, occurred_at }
 *
 * DB writer: run()
 *   - Reads lives + live_shots from signals-web/data/signals.db (read-only)
 *   - Copies screenshots to trading-hub/media/lives/<slug>/
 *   - Creates chart events (source:'zero_live') for matched tickers
 *   - Creates one mention event per (live, ticker) with payload.text = live.tldr
 *
 * Run:  node --env-file-if-exists=.env server/import-lives.js
 * Script: pnpm import:lives
 */

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TRADING, MEDIA_DIR } from './config.js'
import { addChartEvent } from './charts.js'
import { appendEvent } from './events.js'
import { listTickers } from './tickers.js'
import { parseLiveSummary } from './lives-parse.js'

/**
 * Build a faithful per-ticker mention payload from a parsed live record.
 * Falls back to the live-wide blurb ONLY when the ticker has no section/row —
 * never stamps the global tldr onto a ticker that has its own read.
 *
 * @param {object|null} record  parseLiveSummary()[symbol]
 * @param {string} fallback     live.tldr ?? live.title
 */
export function liveMentionPayload(record, fallback) {
  if (!record) return { text: fallback }
  const payload = { text: record.prose || record.zeros_read || fallback }
  if (record.spot_action) payload.note = `Spot: ${record.spot_action}`
  if (record.sharia_status && record.sharia_status !== 'unknown') payload.sharia_status = record.sharia_status
  if (record.sharia_text) payload.sharia_note = record.sharia_text
  return payload
}

const SIGNALS_DB = path.resolve(TRADING, 'signals-web', 'data', 'signals.db')
const SIGNALS_MEDIA = path.resolve(TRADING, 'signals-web', 'media')

/**
 * Parse a ticker symbol from a live_shots label.
 * Accepts only uppercase tokens (2–6 chars) that exist in knownSymbols.
 *
 * Strategy: extract all \b[A-Z]{2,6}\b tokens, return the first that's known.
 * Labels like "XPEV weekly demand" → "XPEV", "Market overview" → null.
 *
 * @param {{ ord: number, label: string, file: string }} shot
 * @param {string} liveSlug
 * @param {Set<string>} knownSymbols  Set of existing ticker symbols
 * @returns {{ symbol: string|null, srcFile: string, native_id: string, occurred_at: string|null }}
 */
export function liveShotToChart(shot, liveSlug, knownSymbols) {
  const tokens = (shot.label ?? '').match(/\b[A-Z]{2,6}\b/g) ?? []
  const symbol = tokens.find(t => knownSymbols.has(t)) ?? null

  return {
    symbol,
    srcFile: shot.file,                                 // app-relative: "media/lives/<slug>/<file>"
    native_id: `live:${liveSlug}:${shot.ord}`,
    occurred_at: null,                                  // resolved from slug date in run()
  }
}

/**
 * Parse an ISO date from a live slug like "2026-06-15-weekly-market-update".
 * Returns null if it cannot be parsed.
 *
 * @param {string} slug
 * @returns {string|null}
 */
function slugToDate(slug) {
  const m = slug.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? `${m[1]}T00:00:00.000Z` : null
}

/**
 * Copy a screenshot from signals-web/media into trading-hub/media/lives/<slug>/.
 *
 * @param {string} file   app-relative path, e.g. "media/lives/2026-06-15.../01-BTC.png"
 * @returns {string}      the same app-relative path (file copied, dest dir created)
 */
async function copyLiveShot(file) {
  const src = path.join(SIGNALS_MEDIA, file.replace(/^media\//, ''))
  const dest = path.join(MEDIA_DIR, file.replace(/^media\//, ''))

  if (!fs.existsSync(src)) {
    console.warn(`  Warning: screenshot source not found: ${src}`)
    return file
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  await fs.promises.copyFile(src, dest)
  return file
}

/**
 * Main runner — idempotent.
 */
export async function run() {
  if (!fs.existsSync(SIGNALS_DB)) {
    console.error(`signals.db not found at ${SIGNALS_DB}`)
    process.exit(1)
  }

  // Load known ticker symbols from the live Postgres DB
  const tickers = await listTickers()
  const knownSymbols = new Set(tickers.map(t => t.symbol))

  // Open old SQLite DB read-only
  const db = new DatabaseSync(SIGNALS_DB, { readOnly: true })
  const lives = db.prepare('SELECT id, slug, title, tldr, summary_md, folder FROM lives ORDER BY id').all()
  const shotsByLive = {}
  for (const shot of db.prepare('SELECT live_id, ord, label, file FROM live_shots ORDER BY live_id, ord').all()) {
    if (!shotsByLive[shot.live_id]) shotsByLive[shot.live_id] = []
    shotsByLive[shot.live_id].push(shot)
  }
  db.close()

  let chartEvents = 0
  let mentionEvents = 0
  let liveCount = 0

  for (const live of lives) {
    liveCount++
    const occurred_at = slugToDate(live.slug)
    const shots = shotsByLive[live.id] ?? []

    // Collect matched symbols for this live (deduped)
    const matchedSymbols = new Set()

    for (const shot of shots) {
      const { symbol, srcFile, native_id } = liveShotToChart(shot, live.slug, knownSymbols)
      if (!symbol) continue

      // Copy screenshot into hub media
      await copyLiveShot(srcFile)

      // Absolute path for addChartEvent's copyChartImage step
      // But since we already copied, pass the absolute dest path
      const destAbs = path.join(MEDIA_DIR, srcFile.replace(/^media\//, ''))

      // Derive the sub-path under media/ so copyChartImage will use the right source dir.
      // We need to call addChartEvent with source='zero_live' but the file already has
      // the full relative path. Use appendEvent directly to avoid double-copy.
      await appendEvent({
        ticker: symbol,
        source: 'zero_live',
        kind: 'chart',
        occurred_at,
        native_id,
        payload: { chart: srcFile },
      })
      chartEvents++
      matchedSymbols.add(symbol)
      console.log(`  [live chart] ${live.slug} shot ${shot.ord} → ${symbol} (${srcFile})`)
    }

    // Faithful per-ticker mention. Parse the live summary and stamp each ticker
    // with ITS OWN read (prose + spot action + sharia) — not the global tldr.
    // Cover both charted tickers and any table/section-only known tickers.
    const parsed = parseLiveSummary(live.summary_md || '', knownSymbols)
    const fallback = live.tldr ?? live.title
    const mentionSymbols = new Set([
      ...matchedSymbols,
      ...Object.keys(parsed).filter((s) => knownSymbols.has(s)),
    ])
    for (const symbol of mentionSymbols) {
      await appendEvent({
        ticker: symbol,
        source: 'zero_live',
        kind: 'mention',
        occurred_at,
        native_id: `live-note:${live.slug}:${symbol}`,
        payload: liveMentionPayload(parsed[symbol], fallback),
      })
      mentionEvents++
    }
  }

  console.log(`lives: ${liveCount} lives, ${chartEvents} chart events, ${mentionEvents} mention events upserted`)
  return { liveCount, chartEvents, mentionEvents }
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
