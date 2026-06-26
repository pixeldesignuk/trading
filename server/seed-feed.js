// Seed a /feed run into the RUNNING trading-hub server.
//
//   node server/seed-feed.js <feed.json> [--api http://localhost:8920]
//
// Posts to the live server (not the DB directly) so new-ticker AI synthesis
// fires in the server's process and survives this script exiting. The feed.json
// the /feed command produces looks like:
//   {
//     "discussion": { slug, date, generated, since, tldr, stats, topics:[…] },
//     "ideas":   [ { symbol, name, asset_class, occurred_at, native_id, author:{handle,name}, note, url } ],
//     "signals": [ { symbol, name, asset_class, source, kind, occurred_at, native_id, payload:{…} } ]
//   }
import fs from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('usage: node server/seed-feed.js <feed.json> [--api URL]'); process.exit(1) }
const apiFlag = process.argv.indexOf('--api')
const API = (apiFlag > -1 && process.argv[apiFlag + 1]) || process.env.FEED_API || 'http://localhost:8920'

const feed = JSON.parse(fs.readFileSync(file, 'utf8'))

async function post(path, body) {
  let res
  try {
    res = await fetch(API + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
  } catch (e) {
    console.error(`\n✗ cannot reach trading-hub at ${API} — is the server running? (pnpm dev / pnpm start)\n  ${e.message}`)
    process.exit(1)
  }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

// 1) Discussion digest → Feed tab
if (feed.discussion?.slug) {
  const d = await post('/api/discussions', feed.discussion)
  console.log(`Registered discussion ${feed.discussion.slug} (${d.topics} topic cards)`)
}

// 2) Community ideas → Ideas tab (attributed to members)
let queued = 0
for (const idea of feed.ideas || []) {
  const r = await post('/api/ingest', {
    symbol: idea.symbol, name: idea.name, asset_class: idea.asset_class,
    source: 'community', kind: 'idea', occurred_at: idea.occurred_at, native_id: idea.native_id,
    payload: { note: idea.note, url: idea.url, author: idea.author },
  })
  if (r.synth_queued) queued++
}
console.log(`Ingested ${(feed.ideas || []).length} community idea(s)`)

// 3) Signals (Zero Hub / Moneytaur / Zero TG trade updates) → tickers pipeline
for (const s of feed.signals || []) {
  const r = await post('/api/ingest', {
    symbol: s.symbol, name: s.name, asset_class: s.asset_class,
    source: s.source, kind: s.kind || 'mention', occurred_at: s.occurred_at, native_id: s.native_id,
    payload: s.payload || {},
  })
  if (r.synth_queued) queued++
}
console.log(`Ingested ${(feed.signals || []).length} signal(s)`)
console.log(`Auto-synthesis queued for ${queued} new ticker(s) (runs in the server, serially)`)
