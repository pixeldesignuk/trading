import { query } from './db.js'

// Ingest one /feed run's discussion digest: a `discussions` header (slug, TL;DR,
// stats) plus its `discussion_topics` cards. Idempotent on slug — re-running a
// run replaces its topics (so a re-run of /feed for the same window overwrites
// rather than duplicates).
export async function ingestDiscussion({ slug, date = null, generated = null, since = null, tldr = null, stats = null, topics = [] }) {
  if (!slug) throw new Error('ingestDiscussion: slug is required')
  const r = await query(
    `INSERT INTO discussions (slug, date, generated, since, tldr, stats_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (slug) DO UPDATE SET
       date = EXCLUDED.date, generated = EXCLUDED.generated, since = EXCLUDED.since,
       tldr = EXCLUDED.tldr, stats_json = EXCLUDED.stats_json
     RETURNING id`,
    [slug, date, generated, since, tldr, stats ? JSON.stringify(stats) : null],
  )
  const id = r.rows[0].id
  await query('DELETE FROM discussion_topics WHERE discussion_id = $1', [id])
  let ord = 0
  for (const t of topics) {
    await query(
      `INSERT INTO discussion_topics (discussion_id, grp, topic, summary, participants, tickers, ord)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, t.group || t.grp || null, t.topic || null, t.summary || null,
        JSON.stringify(t.participants || []), JSON.stringify(t.tickers || []), ord++],
    )
  }
  return { id, slug, topics: topics.length }
}

// Newest-first list of runs (header only) for the Feed tab.
export async function listDiscussions({ limit = 50 } = {}) {
  const r = await query(
    `SELECT id, slug, date, generated, since, tldr, stats_json
     FROM discussions ORDER BY generated DESC NULLS LAST, id DESC LIMIT $1`,
    [limit],
  )
  return r.rows
}

// One run with its topic cards, ordered.
export async function getDiscussion(slug) {
  const d = await query('SELECT * FROM discussions WHERE slug = $1', [slug])
  if (!d.rows[0]) return null
  const topics = await query(
    'SELECT id, grp, topic, summary, participants, tickers, ord FROM discussion_topics WHERE discussion_id = $1 ORDER BY ord',
    [d.rows[0].id],
  )
  return { ...d.rows[0], topics: topics.rows }
}
