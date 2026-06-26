import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ingestSignal } from './ingest-signal.js'
import { TRADING } from './config.js'

const parseTargets = (j) => {
  try {
    const arr = JSON.parse(j || '[]')
    return arr.map((t) => (typeof t === 'object' && t ? `${t.n ?? ''} ${t.p ?? ''}`.trim() : String(t)))
  } catch { return [] }
}

export function mtRowToSignal(r) {
  return {
    symbol: r.ticker, name: r.asset, asset_class: r.asset_class || 'stock',
    source: 'moneytaur', kind: 'grade', occurred_at: r.posted_at, native_id: r.tweet_id,
    payload: {
      entry: r.entry, targets: parseTargets(r.targets_json), invalidation: r.invalidation,
      note: r.note, grade_score: r.grade_score, grade_verdict: r.grade_verdict,
      sharia_status: r.sharia_status, sharia_note: r.sharia_note, chart: r.chart, url: r.url,
      text: r.full_text,
    },
  }
}

export function hubRowToSignal(r) {
  return {
    symbol: r.ticker, name: r.asset, asset_class: r.asset_type || 'stock',
    source: 'zero_hub', kind: 'grade', occurred_at: r.published_at, native_id: r.hub_id,
    payload: {
      entry: r.entry, targets: parseTargets(r.targets_json), invalidation: r.invalidation,
      note: r.info_entry, grade_score: r.grade_score, grade_verdict: r.grade_verdict,
      sharia_status: r.sharia_status, sharia_note: r.sharia_note,
      url: r.hub_id ? `https://dojo-trading.com/hub/${r.hub_id}` : null,
    },
  }
}

export function recapSetupToSignal(r) {
  return {
    symbol: r.ticker, name: r.name, asset_class: r.asset || 'stock',
    source: 'zero_tg', kind: 'mention', occurred_at: null, native_id: `recap:${r.id}`,
    payload: {
      entry: r.entry, targets: parseTargets(r.targets), invalidation: r.invalidation,
      note: r.note, grade_score: r.grade_score, grade_verdict: r.grade_verdict,
      sharia_status: r.sharia_status, sharia_note: r.sharia_note, url: r.url,
    },
  }
}

// Parse the "Quick reference" markdown table into manual plan signals.
export function parseTradeList(md) {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => /^##\s+Quick reference/.test(l))
  if (start < 0) return []
  const out = []
  for (const line of lines.slice(start)) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length < 7) continue
    const [ticker, , status, entry, , target, invalidation] = cells
    if (!/^[A-Z]{1,6}$/.test(ticker)) continue        // skip header/separator rows
    out.push({
      symbol: ticker, asset_class: 'stock', source: 'manual', kind: 'note',
      occurred_at: null, native_id: `tradelist:${ticker}`,
      payload: {
        entry: entry === '—' ? null : entry,
        targets: target && target !== '—' ? [target] : [],
        invalidation: invalidation === '—' ? null : invalidation,
        note: `Imported from trade-list.md (status: ${status})`,
      },
    })
  }
  return out
}

export async function run({ sqlitePath } = {}) {
  const dbPath = sqlitePath || path.join(TRADING, 'signals-web', 'data', 'signals.db')
  let count = 0
  if (fs.existsSync(dbPath)) {
    const old = new DatabaseSync(dbPath, { readOnly: true })
    const tables = [
      ['moneytaur_setups', mtRowToSignal],
      ['hub_setups', hubRowToSignal],
      ['recap_setups', recapSetupToSignal],
    ]
    for (const [table, fn] of tables) {
      let rows = []
      try { rows = old.prepare(`SELECT * FROM ${table}`).all() } catch { rows = [] }
      for (const r of rows) {
        if (!r.ticker) continue
        await ingestSignal(fn(r))
        count++
      }
    }
    old.close()
  }
  const tlPath = path.join(TRADING, 'trade-list.md')
  if (fs.existsSync(tlPath)) {
    for (const s of parseTradeList(fs.readFileSync(tlPath, 'utf8'))) { await ingestSignal(s); count++ }
  }
  return { count }
}

// CLI entry: `pnpm migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { init, pool } = await import('./db.js')
  await init()
  const { count } = await run({})
  console.log(`[migrate] ingested ${count} signals`)
  await pool.end()
}
