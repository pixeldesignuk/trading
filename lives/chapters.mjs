// Chapter-resolution cascade for Zero's lives.
// Source priority: (1) Telegram caption "LABEL -> MM:SS" lines, (2) Dojo API chapters,
// (3) scene-detect + symbol OCR (handled by prep.sh, not here).
// This module owns the deterministic, token-free parsers (1) and (2).

// Parse "LABEL -> MM:SS" / "LABEL -> H:MM:SS" entries out of a Telegram caption.
// Handles newline-separated and inline lists, and tolerates leading/trailing emoji
// (e.g. "- DOGE -> 14:07 🦮"). Returns ordered [{ label, start_sec }] or [] if none.
export function parseCaptionChapters(caption) {
  if (!caption) return []
  const out = []
  // Label = text before the arrow (same line only); arrow ∈ -> → –> —>; then a timestamp.
  const re = /([^\n]+?)\s*(?:->|–>|—>|→)\s*(\d{1,2}:\d{2}(?::\d{2})?)/g
  let m
  while ((m = re.exec(caption)) !== null) {
    const label = cleanLabel(m[1])
    if (!label) continue
    out.push({ label, start_sec: toSeconds(m[2]) })
  }
  // Must be ≥2 entries and monotonically non-decreasing to count as a real chapter list.
  if (out.length < 2) return []
  for (let i = 1; i < out.length; i++) {
    if (out[i].start_sec < out[i - 1].start_sec) return []
  }
  return out
}

// Strip leading bullets/separators + leading/trailing emoji & whitespace; keep + / ( ) etc.
function cleanLabel(s) {
  return s
    .replace(/^[\s\-•*–—_.]+/u, '')
    .replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '')
    .replace(/[\p{Extended_Pictographic}️‍\s]+$/u, '')
    .trim()
}

// Dojo API chapters: [{ title, startMs }] (or {label,start}) -> [{ label, start_sec }].
export function parseApiChapters(chapters) {
  if (!Array.isArray(chapters) || chapters.length < 1) return []
  return chapters
    .map((c) => ({
      label: String(c.title ?? c.label ?? c.name ?? '').trim(),
      start_sec: Math.round((c.startMs ?? c.start ?? c.startSec * 1000 ?? 0) / 1000),
    }))
    .filter((c) => c.label)
    .sort((a, b) => a.start_sec - b.start_sec)
}

// Given ordered chapters + total duration, produce [{label,start_sec,end_sec,mid_sec}].
export function toSegments(chapters, durationSec) {
  return chapters.map((c, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1].start_sec : durationSec
    const start = c.start_sec
    return { label: c.label, start_sec: start, end_sec: end, mid_sec: Math.round((start + Math.min(end, durationSec)) / 2) }
  })
}

function toSeconds(ts) {
  const p = ts.split(':').map(Number)
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
}
