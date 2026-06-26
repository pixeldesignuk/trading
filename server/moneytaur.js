import fs from 'node:fs'
import path from 'node:path'
import { MEDIA_DIR, TRADING } from './config.js'
import { ingestSignal } from './ingest-signal.js'

const ARCHIVE_DIR = path.join(TRADING, 'x-reader', 'exports')

export function setupToRow(s) {
  const targets = Array.isArray(s.targets) ? s.targets : (s.targets ? [s.targets] : [])
  return {
    tweet_id: s.tweet_id || null,
    ticker: s.ticker || null,
    type: s.type || null,
    asset: s.asset || null,
    status: s.status || null,
    entry: s.entry || null,
    targets_json: JSON.stringify(targets),
    invalidation: s.invalidation || null,
    note: s.note || null,
    grade_score: s.grade?.score ?? null,
    grade_verdict: s.grade?.verdict || null,
    sharia_status: s.sharia?.status || null,
    sharia_note: s.sharia?.note || null,
    chart: s.chart ? `media/moneytaur/${path.basename(s.chart)}` : null,
    url: s.url || null,
    posted_at: s.posted_at || null,
    full_text: s.full_text || null,
    asset_class: s.asset_class || null,
  }
}

// Copy <ARCHIVE_DIR>/<relImage> -> <mediaDir>/moneytaur/<basename>. Returns true on success.
export function copyArchiveImage(relImage, mediaDir = MEDIA_DIR, archiveDir = ARCHIVE_DIR) {
  try {
    const src = path.join(archiveDir, relImage)
    if (!fs.existsSync(src)) return false
    const destDir = path.join(mediaDir, 'moneytaur')
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(src, path.join(destDir, path.basename(relImage)))
    return true
  } catch {
    return false
  }
}

export async function ingestMoneytaur(payload, opts = {}) {
  const p = payload || {}
  const setups = p.setups || []
  let setupCount = 0
  for (const s of setups) {
    if (!s.ticker) continue
    if (s.chart) copyArchiveImage(path.join('media-archive', path.basename(s.chart)), opts.mediaDir, opts.archiveDir)
    const targets = Array.isArray(s.targets) ? s.targets : (s.targets ? [s.targets] : [])
    await ingestSignal({
      symbol: s.ticker,
      name: s.asset,
      asset_class: s.asset_class || 'stock',
      source: 'moneytaur',
      kind: s.grade ? 'grade' : 'mention',
      occurred_at: s.posted_at,
      native_id: s.tweet_id,
      payload: {
        entry: s.entry,
        targets,
        invalidation: s.invalidation,
        note: s.note,
        grade_score: s.grade?.score,
        grade_verdict: s.grade?.verdict,
        sharia_status: s.sharia?.status,
        sharia_note: s.sharia?.note,
        chart: s.chart ? `media/moneytaur/${path.basename(s.chart)}` : null,
        url: s.url,
        text: s.full_text,
      },
    })
    setupCount++
  }
  const charts = p.charts || []
  for (const c of charts) {
    if (c.image) copyArchiveImage(c.image, opts.mediaDir, opts.archiveDir)
  }
  return { setups: setupCount, charts: charts.length }
}

