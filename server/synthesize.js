import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { query } from './db.js'
import { getTicker } from './tickers.js'
import { eventsForTicker } from './events.js'
import { getQuotes } from './price-provider.js'
import {
  CLAUDE_BIN, CLAUDE_MODEL, RUN_TIMEOUT_MS, SPAWN_PATH, TRADING, DATA_DIR, ROOT,
} from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPT_FILE = path.join(__dirname, 'prompts', 'synthesize.md')
const SYNTH_DIR = path.join(DATA_DIR, 'synth')

const ACTIONS = new Set(['enter', 'wait', 'stand_aside'])
const STANCES = new Set(['bullish', 'bearish', 'neutral'])

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

// Absolute path to a stored chart (so the headless editor can Read the image).
// Stored chart paths are relative to the app root, e.g. "media/moneytaur/x.jpg".
export function chartPath(rel, root = ROOT) {
  return rel ? path.resolve(root, rel) : null
}

// One source event → the compact view the editor reasons over. Returns null for
// content-free events with no chart. A bare chart IS content here — the editor
// opens it — so a chart-only event is kept.
export function sourceView(e, root = ROOT) {
  const p = e.payload || {}
  const targets = (p.targets || []).filter(Boolean)
  const chart = chartPath(p.chart, root)
  const hasContent = p.note || p.text || p.entry || p.caption ||
    targets.length || p.grade_score != null || p.invalidation || chart
  if (!hasContent) return null
  return {
    source: e.source,
    kind: e.kind,
    as_of: e.occurred_at ? new Date(e.occurred_at).toISOString().slice(0, 10) : null,
    text: p.text || null,
    note: p.note || null,
    caption: p.caption || null,
    entry: p.entry || null,
    targets,
    invalidation: p.invalidation || null,
    grade_score: p.grade_score ?? null,
    grade_verdict: p.grade_verdict || null,
    chart, // absolute path — the editor must Read this image to verify levels
  }
}

export function buildSources(events = [], root = ROOT) {
  return events.map((e) => sourceView(e, root)).filter(Boolean)
}

// Unique chart image paths across all sources, for the editor's "read these" list.
export function chartList(sources = []) {
  return [...new Set(sources.map((s) => s.chart).filter(Boolean))]
}

// Stable hash of the event set — only the bits that change the synthesis. So the
// editor is re-run when sources change, and cached otherwise.
export function eventsHash(events = []) {
  const basis = [...events]
    .map((e) => ({ id: e.id, occurred_at: e.occurred_at, payload: e.payload }))
    .sort((a, b) => Number(a.id) - Number(b.id))
  return crypto.createHash('sha1').update(JSON.stringify(basis)).digest('hex')
}

export function buildPrompt(template, { ticker, price, sources, outPath }) {
  const charts = chartList(sources)
  const chartsBlock = charts.length ? charts.map((c) => `- ${c}`).join('\n') : '(none)'
  return template
    .replaceAll('{{SYMBOL}}', ticker.symbol)
    .replaceAll('{{NAME}}', ticker.name || ticker.symbol)
    .replaceAll('{{ASSET_CLASS}}', ticker.asset_class || 'unknown')
    .replaceAll('{{PRICE}}', price == null ? 'null' : String(price))
    .replaceAll('{{SOURCES_JSON}}', JSON.stringify(sources, null, 2))
    .replaceAll('{{CHARTS}}', chartsBlock)
    .replaceAll('{{OUT_PATH}}', outPath)
}

// Returns { ok, errors[] }. Strict enough to keep garbage out of the UI.
export function validateSynthesis(o) {
  const errors = []
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
  const numOrNull = (v) => v === null || isNum(v)
  if (!o || typeof o !== 'object') return { ok: false, errors: ['not an object'] }
  if (!(isNum(o.conviction) && o.conviction >= 0 && o.conviction <= 10)) errors.push('conviction must be 0–10')
  if (typeof o.contested !== 'boolean') errors.push('contested must be boolean')
  if (!ACTIONS.has(o.action)) errors.push(`action must be one of ${[...ACTIONS].join('|')}`)
  const sp = o.safest_plan
  if (!sp || typeof sp !== 'object') errors.push('safest_plan missing')
  else {
    if (!numOrNull(sp.entry)) errors.push('safest_plan.entry must be number|null')
    if (!numOrNull(sp.invalidation)) errors.push('safest_plan.invalidation must be number|null')
    if (!Array.isArray(sp.targets)) errors.push('safest_plan.targets must be array')
    else sp.targets.forEach((t, i) => { if (!numOrNull(t?.price)) errors.push(`target[${i}].price must be number|null`) })
  }
  if (!Array.isArray(o.stance_by_source) || o.stance_by_source.length === 0) errors.push('stance_by_source must be non-empty array')
  else o.stance_by_source.forEach((s, i) => {
    if (!s?.source) errors.push(`stance[${i}].source missing`)
    if (!STANCES.has(s?.stance)) errors.push(`stance[${i}].stance invalid`)
  })
  if (!Array.isArray(o.conflicts)) errors.push('conflicts must be array')
  if (!o.plain_english || typeof o.plain_english !== 'string') errors.push('plain_english missing')
  // Rule 1 guard: a directional conflict cannot carry high conviction.
  if (o.contested && isNum(o.conviction) && o.conviction > 3) errors.push('contested synthesis must have conviction ≤ 3')
  return { ok: errors.length === 0, errors }
}

// ── Headless Claude runner (impure) ─────────────────────────────────────────

// Spawn the local Claude Code CLI to write the synthesis JSON to outPath, then
// read+parse it. Mirrors signals-web's digest runner — no API key, runs on the
// user's machine on demand.
function runClaude(prompt, outPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    if (fs.existsSync(outPath)) fs.rmSync(outPath)
    const args = ['-p', prompt, '--permission-mode', 'bypassPermissions', '--output-format', 'text']
    if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL)
    const child = spawn(CLAUDE_BIN, args, { cwd: TRADING, env: { ...process.env, PATH: SPAWN_PATH } })
    let log = ''
    const timer = setTimeout(() => { child.kill('SIGKILL') }, RUN_TIMEOUT_MS)
    child.stdout.on('data', (d) => { log += d })
    child.stderr.on('data', (d) => { log += d })
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`spawn failed: ${e.message} (CLAUDE_BIN=${CLAUDE_BIN})`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!fs.existsSync(outPath)) return reject(new Error(`claude exited ${code} but wrote no synthesis. Log tail: ${log.slice(-500)}`))
      try { resolve(JSON.parse(fs.readFileSync(outPath, 'utf8'))) }
      catch (e) { reject(new Error(`synthesis JSON parse failed: ${e.message}`)) }
    })
  })
}

// ── Orchestration ───────────────────────────────────────────────────────────

/**
 * synthesize(symbol, opts) — run (or return cached) the skeptical-editor pass.
 * Caches on the event-set hash; pass force:true to bypass. `runner` and `quoter`
 * are injectable for tests so we never spawn claude there.
 */
export async function synthesize(symbol, { force = false, runner = runClaude, quoter = getQuotes } = {}) {
  const ticker = await getTicker(symbol)
  if (!ticker) throw new Error(`unknown ticker ${symbol}`)
  const events = await eventsForTicker(symbol)
  const sources = buildSources(events)
  if (sources.length === 0) throw new Error(`no source content to synthesize for ${symbol}`)

  const hash = eventsHash(events)
  if (!force && ticker.synth_hash === hash && ticker.synthesis) {
    return { cached: true, synthesis: ticker.synthesis }
  }

  let price = null
  try { price = (await quoter([{ ticker: symbol, asset_class: ticker.asset_class }]))[symbol] ?? null } catch { /* price is best-effort */ }

  const template = fs.readFileSync(PROMPT_FILE, 'utf8')
  const outPath = path.join(SYNTH_DIR, `${symbol}.json`)
  const prompt = buildPrompt(template, { ticker, price, sources, outPath })

  const raw = await runner(prompt, outPath)
  const { ok, errors } = validateSynthesis(raw)
  if (!ok) throw new Error(`synthesis failed validation: ${errors.join('; ')}`)

  await query(
    'UPDATE tickers SET synthesis=$2, synth_at=now(), synth_hash=$3, updated_at=now() WHERE symbol=$1',
    [symbol, JSON.stringify(raw), hash],
  )
  return { cached: false, synthesis: raw }
}
