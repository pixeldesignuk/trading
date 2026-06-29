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
import { fileURLToPath } from 'node:url'
import { buildManifest } from './triage.mjs'

const dir = process.argv[2]
if (!dir) { console.error('usage: node lives/seed-zero-live.js <live-dir> [--api URL]'); process.exit(1) }
const apiFlag = process.argv.indexOf('--api')
const API = (apiFlag > -1 && process.argv[apiFlag + 1]) || process.env.FEED_API || 'http://localhost:8920'

const setups = JSON.parse(fs.readFileSync(path.join(dir, 'setups.json'), 'utf8'))
// frame lookup by chart_index (caption setups carry it on evidence; deduped ones on the setup)
const ev = fs.existsSync(path.join(dir, 'evidence.json'))
  ? JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8'))
  : { charts: [] }
const frameByIdx = Object.fromEntries((ev.charts || []).map((c) => [c.chart_index, c.frame]))
const msgId = Number(path.basename(dir).match(/(\d+)$/)?.[1])
const meta = buildManifest().find((m) => m.msg_id === msgId) || {}
const occurredAt = meta.date ? `${meta.date}T00:00:00Z` : null

// Confluence / macro indices are NOT tradeable assets — dominance, market-cap totals,
// volatility, stablecoins, DXY. They're top-level crypto-market context. Per Mansoor:
// STORE them (for a future macro view) but DO NOT surface them as hub tickers.
const CONFLUENCE = /^(TOTAL\d*|OTHERS\d*|ALT\w*CAP|CRYPTOCAP|USDT|USDC|DXY|.*\.D|.*-D|.*\.?VOL|BVOL|BTC\/OIL.*|.*RATIO|.*:.*|\^.*|CL)$/i
const isConfluence = (s) => CONFLUENCE.test(String(s || '').trim())
const MACRO_STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'macro-reads.jsonl')

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

let queued = 0, seeded = 0, macro = 0, charts = 0
const macroLines = []
for (const c of setups) {
  if (!c.symbol) continue
  // confluence/macro indices: store to the macro sink, never as a hub ticker
  if (isConfluence(c.symbol)) {
    macroLines.push(JSON.stringify({
      symbol: c.symbol, kind: 'confluence', occurred_at: occurredAt,
      live_slug: path.basename(dir), msg_id: msgId, chart_index: c.chart_index,
      bias: c.bias, key_levels: c.key_levels, rationale: c.rationale,
      video_ts_sec: c.mid_sec || null, url: meta.url || null,
    }))
    macro++
    continue
  }
  const r = await post('/api/ingest', {
    symbol: c.symbol,
    name: c.name,
    asset_class: c.asset_class,
    source: 'zero_live',
    kind: c.kind === 'context' ? 'context' : 'grade',
    occurred_at: occurredAt,
    // include symbol: a single chapter can bundle several symbols at the same chart_index
    native_id: `${msgId}:${c.chart_index}:${String(c.symbol).toUpperCase()}`,
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

  // attach the chart frame so it shows in the hub (server copies it into MEDIA_DIR)
  const frame = c.frame || frameByIdx[c.chart_index]
  if (frame) {
    const abs = path.resolve(dir, frame)
    if (fs.existsSync(abs)) {
      await post('/api/chart', {
        symbol: c.symbol, name: c.name, asset_class: c.asset_class, source: 'zero_live',
        srcFile: abs, occurred_at: occurredAt, native_id: `${msgId}:${c.chart_index}:${String(c.symbol).toUpperCase()}:chart`,
        caption: `${c.symbol} — Zero live ${meta.date || ''} (${c.grade_verdict || ''} ${c.grade_score ?? ''})`.trim(),
        levels: c.key_levels || null,
      })
      charts++
    }
  }
}
if (macroLines.length) {
  fs.mkdirSync(path.dirname(MACRO_STORE), { recursive: true })
  fs.appendFileSync(MACRO_STORE, macroLines.join('\n') + '\n')
}
console.log(`Seeded ${seeded} tradeable zero_live setup(s) + ${charts} chart image(s) from ${path.basename(dir)} (msg ${msgId}, ${meta.date || '?'})`)
console.log(`Stored ${macro} confluence/macro read(s) → data/macro-reads.jsonl (not surfaced)`)
console.log(`Auto-synthesis queued for ${queued} new ticker(s)`)
