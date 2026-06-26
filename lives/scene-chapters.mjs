// Fallback chapter detection for videos with no caption/API chapters (older lives,
// Mr. PA). Strategy: sample a frame every N seconds, OCR the TradingView symbol
// header (top-left), then collapse consecutive same-symbol samples into segments.
// More robust than raw scene-cut detection for one-chart-at-a-time walkthroughs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// OCR the top header band (toolbar + chart title) and return a stable symbol
// fingerprint. TradingView shows a search box "Q <TICKER>" and a title like
// "Bitcoin / U.S. Dollar-1D- INDEX" / "ConocoPhillips · 1W · NYSE".
export function ocrSymbolHeader(framePath, tmpDir) {
  const pre = path.join(tmpDir, 'hdr.png')
  try {
    // header band: full-width-ish left 1100px, y 78..248 — covers toolbar + title row.
    execFileSync('ffmpeg', ['-y', '-i', framePath, '-vf',
      'crop=1100:170:0:78,format=gray,negate,scale=iw*2:ih*2', pre], { stdio: 'ignore' })
    const raw = execFileSync('tesseract', [pre, 'stdout', '--psm', '6'], { encoding: 'utf8' })
    fs.rmSync(pre, { force: true })
    return cleanHeader(raw)
  } catch {
    return ''
  }
}

// Pull the instrument fingerprint from the noisy header OCR.
// Prefer the title name (before the "-1D-"/"· 1W ·" timeframe), else the search ticker.
export function cleanHeader(raw) {
  const text = raw.replace(/\r/g, ' ').replace(/\s+/g, ' ').trim()
  // 1) Title: "<Name> -1D- EXCHANGE" or "<Name> · 1W · EXCHANGE"
  const title = text.match(/([A-Za-z][A-Za-z0-9 .&/']{2,40}?)\s*[-·]\s*\d+\s*[mhdwDWM]\b/)
  if (title) {
    const name = title[1].replace(/[^A-Za-z0-9 .&/']/g, ' ').replace(/\s+/g, ' ').trim()
    if (name.length >= 3) return name.toUpperCase().slice(0, 40)
  }
  // 2) Search box ticker: "Q BTCUSD" (Q may be glued to the ticker as a misread icon)
  const tick = text.match(/\bQ\s*([A-Z][A-Z0-9.]{1,11})\b/) || text.match(/\b([A-Z]{2,6}USD?T?)\b/)
  if (tick) return tick[1].replace(/^Q(?=[A-Z]{2,})/, '').toUpperCase().slice(0, 12)
  return ''
}

// Levenshtein-ratio similarity so OCR jitter ("CONOCOPHILLIPS" vs "CONOCOPHILUPS") still groups.
function similar(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const m = a.length, n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return 1 - d[m][n] / Math.max(m, n)
}

// Sample frames across the video, OCR each header, collapse to segments.
// Returns ordered [{ label, start_sec }] (same shape as parseCaptionChapters).
export function detectChapters(video, durationSec, { interval = 15, minSegSec = 30, tmpDir } = {}) {
  tmpDir = tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'scenech-'))
  const samples = []
  for (let t = 5; t < durationSec; t += interval) {
    const f = path.join(tmpDir, 'f.png')
    try {
      execFileSync('ffmpeg', ['-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-q:v', '3', f], { stdio: 'ignore' })
      samples.push({ t, sym: ocrSymbolHeader(f, tmpDir) })
    } catch {
      samples.push({ t, sym: '' })
    }
  }
  // collapse consecutive similar symbols into runs
  const runs = []
  for (const s of samples) {
    const last = runs[runs.length - 1]
    if (last && (similar(last.sym, s.sym) >= 0.6 || !s.sym)) {
      last.end = s.t
      if (s.sym && s.sym.length > last.sym.length) last.sym = s.sym // keep the fullest reading
    } else {
      runs.push({ sym: s.sym, start: s.t, end: s.t })
    }
  }
  // keep runs that are a real chart (named + long enough), merge tiny ones forward
  const chapters = runs
    .filter((r) => r.sym && r.end - r.start >= minSegSec - interval)
    .map((r) => ({ label: r.sym, start_sec: Math.max(0, r.start - Math.floor(interval / 2)) }))
  // de-dup identical adjacent labels after filtering
  const out = []
  for (const c of chapters) {
    if (!out.length || out[out.length - 1].label !== c.label) out.push(c)
  }
  return out
}
