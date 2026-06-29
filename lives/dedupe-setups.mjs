// Merge consecutive same-symbol setups in a vision-extracted setups.json.
// The scene-detector is tuned for high recall (over-segments), so a single chart can
// span several segments; vision reads the same symbol for each. Collapse runs of the
// same symbol into one, keeping the richest entry. Usage:
//   node lives/dedupe-setups.mjs <live-dir>
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: node lives/dedupe-setups.mjs <live-dir>'); process.exit(1) }
const file = path.join(dir, 'setups.json')
const raw = JSON.parse(fs.readFileSync(file, 'utf8'))

// Enrich each setup with its segment's frame + timing from evidence.json (joined by
// chart_index) so setups.json is self-contained before we renumber via dedup.
const ev = fs.existsSync(path.join(dir, 'evidence.json'))
  ? JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8'))
  : { charts: [] }
const segByIdx = Object.fromEntries((ev.charts || []).map((c) => [c.chart_index, c]))
const setups = raw.map((c) => {
  const seg = segByIdx[c.chart_index]
  return seg ? { ...c, frame: c.frame || seg.frame, start_sec: seg.start_sec, mid_sec: seg.mid_sec } : c
})

// "richness" = how much real setup data a card carries (prefer the one to keep)
const score = (c) =>
  (c.entry ? 2 : 0) + ((c.targets || []).length ? 2 : 0) + (c.invalidation ? 1 : 0) +
  (c.grade_score || 0) / 10 + (c.kind === 'setup' ? 1 : 0) + (c.confidence || 0)

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9.]/g, '')

const merged = []
for (const c of setups) {
  const prev = merged[merged.length - 1]
  if (prev && norm(prev.symbol) && norm(prev.symbol) === norm(c.symbol)) {
    // same symbol as the previous run → keep the richer card, widen its time span
    const keep = score(c) > score(prev) ? { ...c } : { ...prev }
    keep.start_sec = Math.min(prev.start_sec ?? prev.mid_sec ?? 1e9, c.start_sec ?? c.mid_sec ?? 1e9)
    keep.merged_from = (prev.merged_from || 1) + 1
    merged[merged.length - 1] = keep
  } else {
    merged.push({ ...c })
  }
}
// renumber chart_index
merged.forEach((c, i) => (c.chart_index = i + 1))

fs.writeFileSync(file, JSON.stringify(merged, null, 2))
console.log(`Deduped ${setups.length} → ${merged.length} setups (merged consecutive same-symbol)`)
for (const c of merged) console.log(`  ${String(c.chart_index).padStart(2)} ${c.symbol}${c.merged_from ? ` (×${c.merged_from})` : ''}`)
