// Grounding primitive for /feed. Prints, as JSON, what trading-hub has ALREADY
// digested per source — so /feed only ingests genuinely-new material and never
// re-pushes setups that other tooling (import:hub, import:lives, prior
// /moneytaur) already stored. Reads the DB directly (no running server needed).
//
//   node server/feed-state.js
//
// Output shape:
//   { hub: { watermark, latest_occurred_at, known_ids:[hubId…], count },
//     moneytaur: { latest_occurred_at, known_tweet_ids:[…], count },
//     community: { known_native_ids:[…], latest_occurred_at },
//     discussions: { latest_slug, latest_date, count } }
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Mongo-style 24-hex id (Dojo hub_id) anywhere in a dedup_key.
const HEX24 = /[0-9a-f]{24}/i
// X tweet id: a long digit run (>=15).
const TWEETID = /\d{15,}/

async function keysFor(source) {
  const r = await query(
    `SELECT dedup_key, to_char(max(occurred_at) OVER (), 'YYYY-MM-DD') AS latest
     FROM events WHERE source=$1 AND dedup_key IS NOT NULL`, [source])
  return r.rows
}

const hubWatermark = () => {
  const p = path.join(__dirname, '..', 'state', 'hub-watermark.json')
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).last_published_at || null } catch { return null }
}

const hubRows = await keysFor('zero_hub')
const mtRows = await keysFor('moneytaur')
const commRows = await keysFor('community')

const uniq = (a) => [...new Set(a.filter(Boolean))]
const latest = (rows) => rows[0]?.latest || null

const out = {
  hub: {
    watermark: hubWatermark(),
    latest_occurred_at: latest(hubRows),
    known_ids: uniq(hubRows.map((r) => (r.dedup_key.match(HEX24) || [])[0])),
    count: hubRows.length,
  },
  moneytaur: {
    latest_occurred_at: latest(mtRows),
    known_tweet_ids: uniq(mtRows.map((r) => (r.dedup_key.match(TWEETID) || [])[0])),
    count: mtRows.length,
  },
  community: {
    known_native_ids: uniq(commRows.map((r) => r.dedup_key.replace(/^community:/, ''))),
    latest_occurred_at: latest(commRows),
  },
}

const disc = await query(
  `SELECT slug, date, (SELECT count(*) FROM discussions) AS count
   FROM discussions ORDER BY generated DESC NULLS LAST, id DESC LIMIT 1`)
out.discussions = disc.rows[0]
  ? { latest_slug: disc.rows[0].slug, latest_date: disc.rows[0].date, count: Number(disc.rows[0].count) }
  : { latest_slug: null, latest_date: null, count: 0 }

console.log(JSON.stringify(out, null, 2))
process.exit(0)
