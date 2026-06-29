// Deterministic batch prep for the caption-chapter back-catalogue: for each in-scope
// video (newest→oldest, excluding already-done), download → whisper transcript →
// build evidence pack. Idempotent/resumable: skips any video whose evidence.json exists.
// Extraction (vision subagents) + dedup + seed are driven separately, per video.
//
//   node lives/batch-prep.mjs            # all remaining
//   node lives/batch-prep.mjs 1874 1871  # only these msg ids
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildManifest } from './triage.mjs'

const HOME = os.homedir()
const LIVES = path.join(HOME, 'Developer/personal/trading/dojo-lives')
const TG = path.join(HOME, 'Developer/personal/trading/tg-reader')
const LIVES_DIR = path.join(HOME, 'Developer/personal/trading/trading-hub/lives')
const CHAN = '-1002039653167'
const DONE = new Set([1879, 1504, 1876])

const only = process.argv.slice(2).map(Number).filter(Boolean)
let batch = buildManifest()
  .filter((m) => m.in_scope && m.chapter_source === 'caption' && !DONE.has(m.msg_id))
  .sort((a, b) => b.date.localeCompare(a.date) || b.msg_id - a.msg_id)
if (only.length) batch = batch.filter((m) => only.includes(m.msg_id))

console.log(`[batch-prep] ${batch.length} videos to prep (newest→oldest)`)
let ok = 0, skip = 0, fail = 0
for (const m of batch) {
  const slug = `${m.date}-${m.msg_id}`
  const dir = path.join(LIVES, slug)
  const evidence = path.join(dir, 'evidence.json')
  if (fs.existsSync(evidence)) { console.log(`[skip] ${slug} (evidence exists)`); skip++; continue }
  try {
    fs.mkdirSync(dir, { recursive: true })
    const video = path.join(dir, 'video.mp4')
    if (!fs.existsSync(video)) {
      console.log(`[dl]   ${slug} …`)
      execFileSync(path.join(TG, '.venv/bin/python'), [path.join(TG, 'tg.py'), 'download', CHAN, String(m.msg_id), video], { stdio: 'ignore' })
    }
    console.log(`[prep] ${slug} (whisper) …`)
    execFileSync('bash', [path.join(LIVES_DIR, 'prep.sh'), video, dir], { stdio: 'ignore' })
    console.log(`[evid] ${slug} …`)
    const out = execFileSync('node', [path.join(LIVES_DIR, 'build-evidence.mjs'), dir, slug, '--caption-msg', String(m.msg_id)], { encoding: 'utf8' })
    const charts = (out.match(/(\d+) charts/) || [])[1] || '?'
    console.log(`[done] ${slug} → ${charts} charts`)
    ok++
  } catch (e) {
    console.log(`[FAIL] ${slug}: ${String(e.message).split('\n')[0]}`)
    fail++
  }
}
console.log(`[batch-prep] complete: ${ok} prepped, ${skip} skipped, ${fail} failed`)
