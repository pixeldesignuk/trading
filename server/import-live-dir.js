/**
 * import-live-dir.js
 *
 * Seed ONE Zero live straight from its dojo-lives folder into trading-hub —
 * the direct path that replaces the signals-web register-live → signals.db →
 * import-lives round-trip. /feed calls this after transcribing a live.
 *
 * Reads <dir>/{live.json, summary.md, screenshots/*} and:
 *   - copies each screenshot into trading-hub/media/lives/<slug>/
 *   - (with --create) auto-creates a touched ticker the hub doesn't track yet,
 *     gated to assets in the Spot Snapshot table (USO, WMT…)
 *   - writes a source:'zero_live' CHART event per charted shot
 *   - writes a rich source:'zero_live' MENTION event per ticker (full read +
 *     entry / targets / invalidation / levels / bias / sharia)
 *   - upserts the lives + live_shots rows (data completeness)
 * Idempotent — events dedup on (source, native_id); the live upserts on slug.
 *
 *   node server/import-live-dir.js <dir> [--create]
 */

import fs from 'node:fs'
import path from 'node:path'
import { MEDIA_DIR } from './config.js'
import { query } from './db.js'
import { appendEvent } from './events.js'
import { listTickers, upsertTicker } from './tickers.js'
import { parseLiveSummary } from './lives-parse.js'
import { shotLabelToSymbol, liveMentionPayload } from './import-lives.js'

// Parenthetical annotations that are NOT a company name (mirrors import-lives).
const NAME_ANNOTATION = /^(continuation|cont\.?|new setup|setup|update|demand|supply|breaker|weekly|daily|monthly|spot|long|short|confluence)$/i

// Upsert the live row + its shots into trading-hub's own lives tables.
async function upsertLive(live, shots) {
  const r = await query(
    `INSERT INTO lives (slug, date, title, tldr, summary_md, folder, video_id, duration_sec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (slug) DO UPDATE SET
       date=EXCLUDED.date, title=EXCLUDED.title, tldr=EXCLUDED.tldr,
       summary_md=EXCLUDED.summary_md, folder=EXCLUDED.folder,
       video_id=EXCLUDED.video_id, duration_sec=EXCLUDED.duration_sec
     RETURNING id`,
    [live.slug, live.date, live.title, live.tldr, live.summary_md, live.folder,
      live.video_id ?? null, live.duration_sec ?? null],
  )
  const liveId = r.rows[0].id
  await query('DELETE FROM live_shots WHERE live_id = $1', [liveId])
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    await query('INSERT INTO live_shots (live_id, ord, label, file) VALUES ($1,$2,$3,$4)',
      [liveId, i, s.label ?? null, s.file ?? null])
  }
  return liveId
}

export async function importLiveDir(dir, { create = false } = {}) {
  const liveJsonPath = path.join(dir, 'live.json')
  if (!fs.existsSync(liveJsonPath)) throw new Error(`live.json not found in ${dir}`)
  const meta = JSON.parse(fs.readFileSync(liveJsonPath, 'utf8'))
  const summary_md = fs.existsSync(path.join(dir, 'summary.md'))
    ? fs.readFileSync(path.join(dir, 'summary.md'), 'utf8') : ''
  const slug = meta.slug || path.basename(dir)
  const occurred_at = meta.date ? `${meta.date}T00:00:00.000Z` : null
  const shots = (meta.shots || []).map((s) => ({ label: s.label, file: s.file }))

  await upsertLive({
    slug, date: meta.date, title: meta.title, tldr: meta.tldr, summary_md,
    folder: dir, video_id: meta.video_id, duration_sec: meta.duration_sec,
  }, shots)

  const knownSymbols = new Set((await listTickers()).map((t) => t.symbol))

  // Auto-create touched tickers (only with --create), gated to Spot Snapshot assets.
  if (create) {
    const tableSyms = new Set(Object.keys(parseLiveSummary(summary_md, null)))
    for (const shot of shots) {
      const sym = shotLabelToSymbol(shot.label)
      if (!sym || knownSymbols.has(sym) || !tableSyms.has(sym)) continue
      const paren = String(shot.label ?? '').match(/\(([^)]+)\)/)
      const name = paren && !NAME_ANNOTATION.test(paren[1].trim()) ? paren[1].trim() : null
      await upsertTicker(sym, { name })
      knownSymbols.add(sym)
      console.log(`  [live ticker] ${slug} created ${sym}${name ? ` (${name})` : ''}`)
    }
  }

  // Chart events — copy the screenshot into hub media, one event per charted shot.
  let charts = 0
  const matched = new Set()
  for (let ord = 0; ord < shots.length; ord++) {
    const shot = shots[ord]
    const sym = shotLabelToSymbol(shot.label)
    if (!sym || !knownSymbols.has(sym)) continue
    const rel = `media/lives/${slug}/${shot.file}`
    const srcAbs = path.join(dir, 'screenshots', shot.file)
    const destAbs = path.join(MEDIA_DIR, 'lives', slug, shot.file)
    if (fs.existsSync(srcAbs)) {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true })
      await fs.promises.copyFile(srcAbs, destAbs)
    } else {
      console.warn(`  Warning: screenshot not found: ${srcAbs}`)
    }
    await appendEvent({
      ticker: sym, source: 'zero_live', kind: 'chart', occurred_at,
      native_id: `live:${slug}:${ord}`, payload: { chart: rel },
    })
    charts++; matched.add(sym)
    console.log(`  [live chart] ${slug} shot ${ord} → ${sym} (${rel})`)
  }

  // Rich mention events — the full per-ticker read + structured plan fields.
  const parsed = parseLiveSummary(summary_md, knownSymbols)
  const fallback = meta.tldr ?? meta.title
  const mentionSymbols = new Set([...matched, ...Object.keys(parsed).filter((s) => knownSymbols.has(s))])
  let mentions = 0
  for (const sym of mentionSymbols) {
    await appendEvent({
      ticker: sym, source: 'zero_live', kind: 'mention', occurred_at,
      native_id: `live-note:${slug}:${sym}`, payload: liveMentionPayload(parsed[sym], fallback),
    })
    mentions++
  }

  console.log(`live ${slug}: ${charts} chart + ${mentions} mention event(s) on ${mentionSymbols.size} ticker(s)`)
  return { slug, charts, mentions, tickers: [...mentionSymbols] }
}

// CLI guard
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const dir = process.argv[2]
  if (!dir) { console.error('usage: node server/import-live-dir.js <dir> [--create]'); process.exit(1) }
  const create = process.argv.includes('--create')
  const { pool } = await import('./db.js')
  try {
    await importLiveDir(path.resolve(dir), { create })
  } finally {
    await pool.end()
  }
}
