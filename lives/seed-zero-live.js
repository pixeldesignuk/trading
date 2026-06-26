// Seed one live video's extracted setups into the RUNNING trading-hub server.
// Mirrors seed-feed.js: POSTs each chart as a `source:"zero_live"` event so new
// tickers auto-synthesize in the server. Idempotent (dedup_key = zero_live:<msg>:<chart>).
//
//   node lives/seed-zero-live.js <live-dir> [--api http://localhost:8920]
//
// <live-dir> must contain setups.json (from extraction). msg_id/date/url are
// resolved from the Telegram archive via the trailing id in the dir name.
import fs from 'node:fs'
import path from 'node:path'
import { buildManifest } from './triage.mjs'

const dir = process.argv[2]
if (!dir) { console.error('usage: node lives/seed-zero-live.js <live-dir> [--api URL]'); process.exit(1) }
const apiFlag = process.argv.indexOf('--api')
const API = (apiFlag > -1 && process.argv[apiFlag + 1]) || process.env.FEED_API || 'http://localhost:8920'

const setups = JSON.parse(fs.readFileSync(path.join(dir, 'setups.json'), 'utf8'))
const msgId = Number(path.basename(dir).match(/(\d+)$/)?.[1])
const meta = buildManifest().find((m) => m.msg_id === msgId) || {}
const occurredAt = meta.date ? `${meta.date}T00:00:00Z` : null

async function post(p, body) {
  let res
  try {
    res = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch (e) {
    console.error(`\n✗ cannot reach trading-hub at ${API} — is the server running?\n  ${e.message}`); process.exit(1)
  }
  if (!res.ok) throw new Error(`${p} → ${res.status} ${await res.text()}`)
  return res.json()
}

let queued = 0, seeded = 0
for (const c of setups) {
  if (!c.symbol) continue
  const r = await post('/api/ingest', {
    symbol: c.symbol,
    name: c.name,
    asset_class: c.asset_class,
    source: 'zero_live',
    kind: c.kind === 'context' ? 'context' : 'grade',
    occurred_at: occurredAt,
    native_id: `${msgId}:${c.chart_index}`,
    payload: {
      entry: c.entry, targets: c.targets, invalidation: c.invalidation, key_levels: c.key_levels,
      timeframe: c.timeframe, bias: c.bias, rationale: c.rationale,
      grade_score: c.grade_score, grade_verdict: c.grade_verdict,
      sharia_status: c.sharia_status, sharia_note: c.sharia_note, spot_note: c.spot_note,
      confidence: c.confidence,
      resolution: c.resolution || 'unresolved',
      live_slug: path.basename(dir), live_date: meta.date, video_ts_sec: c.mid_sec || null,
      url: meta.url || null, note: 'from Zero live (educational, not financial advice)',
    },
  })
  if (r.synth_queued) queued++
  seeded++
}
console.log(`Seeded ${seeded} zero_live setup(s) from ${path.basename(dir)} (msg ${msgId}, ${meta.date || '?'})`)
console.log(`Auto-synthesis queued for ${queued} new ticker(s)`)
