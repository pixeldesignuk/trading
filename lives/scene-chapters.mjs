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
  const outBase = path.join(tmpDir, 'hdr_out')
  try {
    // header band: top-left 60% width, top 22% height — resolution-relative so it
    // catches the title row across layouts (1920x1080 title ~y176; 1280x528 ~y50).
    execFileSync('ffmpeg', ['-y', '-i', framePath, '-frames:v', '1', '-vf',
      'crop=iw*0.6:ih*0.22:0:0,format=gray,scale=iw*2:ih*2', pre], { stdio: 'ignore' })
    execFileSync('tesseract', [pre, outBase, '--psm', '6'], { stdio: 'ignore' })
    const raw = fs.readFileSync(outBase + '.txt', 'utf8')
    fs.rmSync(pre, { force: true }); fs.rmSync(outBase + '.txt', { force: true })
    return cleanHeader(raw)
  } catch {
    return ''
  }
}

// Toolbar/exchange words that contaminate the OCR'd header — never part of the asset name.
const NOISE = /\b(INDICATORS?|ALERT|REPLAY|INDEX|NYSE|NASDAQ|BINANCE|MEXC|TVC|CRYPTO|FOREX|STOCKS|TRADE|PUBLISH|SELL|BUY|SQ|TL|ZIN|USD|USDT|OZ)\b/g

// Pull the instrument fingerprint from the noisy header OCR.
// Prefer the title name (before the "-1D-"/"· 1W ·" timeframe), else the search ticker.
export function cleanHeader(raw) {
  const text = raw.replace(/\r/g, ' ').replace(/\s+/g, ' ').trim()
  // 1) Title: "<Name> -1D- EXCHANGE" / "<Name> · 1W · EXCHANGE". Take the text right
  //    before the timeframe marker, then drop any leading toolbar words.
  const title = text.match(/([A-Za-z][A-Za-z0-9 .&/']{2,40}?)\s*[-·]\s*\d+\s*[mhdwDWM]\b/)
  if (title) {
    let name = title[1].replace(/[^A-Za-z0-9 .&/']/g, ' ').toUpperCase()
    name = name.replace(NOISE, ' ').replace(/\s+/g, ' ').trim()
    // keep only the asset name: last few words before the timeframe (drops "REPLAY BITCOIN"→"BITCOIN")
    name = name.split(' ').filter(Boolean).slice(-5).join(' ')
    if (name.replace(/[^A-Z]/g, '').length >= 3) return name.slice(0, 40)
  }
  // 2) Search-box ticker: "Q BTCUSD" (the Q is the search icon; may glue to the ticker)
  const tick = text.match(/\bQ\s*([A-Z][A-Z0-9.]{1,11})\b/) || text.match(/\b([A-Z]{2,6}USD?T?)\b/)
  if (tick) return tick[1].replace(/^Q(?=[A-Z]{2,})/, '').toUpperCase().slice(0, 12)
  return ''
}

// Normalize a label to a grouping key so OCR variants of the same asset merge
// ("BTCUSD" / "BITCOIN U.S. DOLLAR" → "BITCOIN"; first meaningful word).
export function groupKey(label) {
  const alias = { BTCUSD: 'BITCOIN', BTC: 'BITCOIN', ETHUSD: 'ETHEREUM', ETH: 'ETHEREUM' }
  const w = label.replace(/[^A-Z ]/gi, ' ').toUpperCase().split(/\s+/).filter(Boolean)
  if (!w.length) return label
  // prefer a tickerish alias, else the first "real" word (≥4 chars), else the longest.
  for (const t of w) if (alias[t]) return alias[t]
  const real = w.find((x) => x.length >= 4)
  return real || w.slice().sort((a, b) => b.length - a.length)[0]
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
  // collapse consecutive same-asset samples into runs (group by normalized key so
  // OCR variants merge; blank readings extend the current run rather than break it)
  const runs = []
  for (const s of samples) {
    const last = runs[runs.length - 1]
    const sameAsset = last && s.sym && (groupKey(last.sym) === groupKey(s.sym) || similar(last.sym, s.sym) >= 0.6)
    if (last && (sameAsset || !s.sym)) {
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
