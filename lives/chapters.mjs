// Chapter-resolution cascade for Zero's lives.
// Source priority: (1) Telegram caption "LABEL -> MM:SS" lines, (2) Dojo API chapters,
// (3) scene-detect + symbol OCR (handled by prep.sh, not here).
// This module owns the deterministic, token-free parsers (1) and (2).

// Parse "LABEL -> MM:SS" / "LABEL -> H:MM:SS" lines out of a Telegram caption.
// Returns ordered [{ label, start_sec }] or [] if the caption has no chapter lines.
export function parseCaptionChapters(caption) {
  if (!caption) return []
  const out = []
  // Match: optional bullet, label, an arrow (->, –>, →), then a timestamp.
  const re = /^[\s\-•*]*(.+?)\s*(?:->|–>|—>|→)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$/
  for (const raw of caption.split('\n')) {
    const m = raw.match(re)
    if (!m) continue
    const label = m[1].trim().replace(/[💡🔥📈📉👀:\s]+$/u, '').trim()
    if (!label) continue
    out.push({ label, start_sec: toSeconds(m[2]) })
  }
  // Must be monotonically non-decreasing and start at/near 0 to be a real chapter list.
  if (out.length < 2) return []
  for (let i = 1; i < out.length; i++) {
    if (out[i].start_sec < out[i - 1].start_sec) return [] // not a real ordered chapter list
  }
  return out
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
