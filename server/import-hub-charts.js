/**
 * import-hub-charts.js
 *
 * Imports Zero Hub chart images from dojo-archive/hub.jsonl into chart events.
 *
 * Pure transform: hubRecordToCharts(record) → [{symbol, srcFile, native_id, occurred_at}]
 * DB writer:      run() — reads hub.jsonl, skips unknown tickers, dedupes by native_id.
 */

import fs from 'node:fs'
import readline from 'node:readline'
import path from 'node:path'
import { TRADING } from './config.js'
import { addChartEvent } from './charts.js'
import { getTicker } from './tickers.js'

const DOJO_ARCHIVE = path.resolve(TRADING, 'dojo-archive')
const HUB_JSONL = path.join(DOJO_ARCHIVE, 'hub.jsonl')

/**
 * Pure transform — for one hub.jsonl record, yield one entry per media chart.
 *
 * @param {object} record  Parsed JSON line from hub.jsonl
 * @returns {Array<{symbol: string, srcFile: string, native_id: string, occurred_at: string}>}
 */
export function hubRecordToCharts(record) {
  const media = Array.isArray(record.media) ? record.media : []
  return media.map((item, idx) => ({
    symbol: record.ticker,
    srcFile: item.file,         // relative to dojo-archive/  e.g. "charts/abc-0-XPEV.png"
    native_id: `hub:${record.hub_id}:${idx}`,
    occurred_at: record.published_at,
  }))
}

/**
 * Read hub.jsonl, import chart events for every ticker that exists in the DB.
 * Idempotent — appendEvent dedupes on dedup_key (source:native_id).
 */
export async function run() {
  if (!fs.existsSync(HUB_JSONL)) {
    console.error(`hub.jsonl not found at ${HUB_JSONL}`)
    process.exit(1)
  }

  const rl = readline.createInterface({ input: fs.createReadStream(HUB_JSONL), crlfDelay: Infinity })
  let total = 0
  let skipped = 0
  let imported = 0

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let record
    try {
      record = JSON.parse(trimmed)
    } catch {
      console.warn('Skipping malformed line')
      continue
    }

    total++
    const ticker = await getTicker(record.ticker)
    if (!ticker) {
      skipped++
      continue
    }

    const charts = hubRecordToCharts(record)
    for (const { symbol, srcFile, native_id, occurred_at } of charts) {
      const absPath = path.join(DOJO_ARCHIVE, srcFile)
      await addChartEvent({
        symbol,
        source: 'zero_hub',
        srcFile: absPath,
        occurred_at,
        native_id,
      })
      imported++
    }
  }

  console.log(`hub charts: ${total} records processed, ${skipped} tickers skipped, ${imported} chart events upserted`)
  return { total, skipped, imported }
}

// CLI guard — run when executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { pool } = await import('./db.js')
  try {
    await run()
  } finally {
    await pool.end()
  }
}
