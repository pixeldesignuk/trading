// Build a per-chart "evidence pack" for one live video — the input to extraction.
// Deterministic, token-free: frames (ffmpeg) + OCR (tesseract) + transcript slices.
// Usage: node build-evidence.mjs <dir> <slug> [--chapters caption|api] [--caption-msg <id>]
//   <dir> must contain video.mp4 + transcript.srt (run prep.sh first).
// Writes <dir>/evidence.json = [{ chart_index, label, start_sec, end_sec, mid_sec,
//   frame, transcript_chunk, ocr_text }].
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseCaptionChapters, toSegments } from './chapters.mjs'
import { detectChapters } from './scene-chapters.mjs'

const ARCHIVE = path.join(os.homedir(), 'Developer/personal/trading/tg-reader/archive/zero-s-dojo.jsonl')

function srtToCues(srt) {
  const cues = []
  for (const block of srt.split(/\n\s*\n/)) {
    const m = block.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/)
    if (!m) continue
    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000
    const text = block.split('\n').slice(2).join(' ').trim()
    if (text) cues.push({ start, end, text })
  }
  return cues
}

function sliceTranscript(cues, startSec, endSec) {
  return cues
    .filter((c) => c.start >= startSec - 1 && c.start < endSec)
    .map((c) => c.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFrame(video, sec, outPng) {
  execFileSync('ffmpeg', ['-y', '-ss', String(sec), '-i', video, '-frames:v', '1', '-q:v', '2', outPng], {
    stdio: 'ignore',
  })
}

// Dark TradingView charts → invert+grayscale+upscale so tesseract reads the light text.
function ocrFrame(pngPath) {
  const pre = pngPath.replace(/\.png$/, '.ocr.png')
  try {
    execFileSync('ffmpeg', ['-y', '-i', pngPath, '-vf', 'format=gray,negate,scale=iw*1.5:ih*1.5', pre], {
      stdio: 'ignore',
    })
    const out = execFileSync('tesseract', [pre, 'stdout', '--psm', '11'], { encoding: 'utf8' })
    fs.rmSync(pre, { force: true })
    // keep number-bearing tokens + short symbol-like words; drop noise
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && (/\d/.test(l) || /^[A-Z][A-Z0-9.\-]{1,9}$/.test(l)))
      .join(' | ')
      .slice(0, 800)
  } catch {
    return ''
  }
}

function captionFor(msgId) {
  const rows = fs.readFileSync(ARCHIVE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const m = rows.find((r) => r.id === Number(msgId))
  return m ? m.text || '' : ''
}

function main() {
  const [dir, slug] = process.argv.slice(2)
  if (!dir || !slug) {
    console.error('usage: node build-evidence.mjs <dir> <slug> [--caption-msg <id>]')
    process.exit(1)
  }
  const capIdx = process.argv.indexOf('--caption-msg')
  const captionMsg = capIdx > -1 ? process.argv[capIdx + 1] : slug.match(/(\d+)$/)?.[1]

  const video = path.join(dir, 'video.mp4')
  const srtPath = path.join(dir, 'transcript.srt')
  if (!fs.existsSync(video) || !fs.existsSync(srtPath)) {
    console.error(`need ${video} and ${srtPath} (run prep.sh first)`)
    process.exit(1)
  }
  const duration = Math.round(
    Number(
      execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video,
      ], { encoding: 'utf8' }).trim(),
    ),
  )

  let chapters = parseCaptionChapters(captionFor(captionMsg))
  let chapterSource = 'caption'
  if (!chapters.length) {
    console.error('No caption chapters — falling back to scene-detect (sample + symbol OCR)…')
    chapters = detectChapters(video, duration)
    chapterSource = 'scene'
    if (!chapters.length) {
      console.error('Scene-detect found no stable chart segments; aborting.')
      process.exit(2)
    }
  }

  const segments = toSegments(chapters, duration)
  const cues = srtToCues(fs.readFileSync(srtPath, 'utf8'))
  const shotsDir = path.join(dir, 'screenshots')
  fs.mkdirSync(shotsDir, { recursive: true })

  const evidence = segments.map((seg, i) => {
    const idx = String(i + 1).padStart(2, '0')
    const safe = seg.label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'chart'
    const frameRel = `screenshots/${idx}-${safe}.png`
    const framePath = path.join(dir, frameRel)
    extractFrame(video, seg.mid_sec, framePath)
    return {
      chart_index: i + 1,
      label: seg.label,
      start_sec: seg.start_sec,
      end_sec: seg.end_sec,
      mid_sec: seg.mid_sec,
      frame: frameRel,
      ocr_text: ocrFrame(framePath),
      transcript_chunk: sliceTranscript(cues, seg.start_sec, seg.end_sec),
    }
  })

  const out = { slug, chapter_source: chapterSource, duration_sec: duration, charts: evidence }
  const outPath = path.join(dir, 'evidence.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`Wrote ${outPath}: ${evidence.length} charts (chapters: ${chapterSource})`)
  for (const e of evidence) {
    console.log(`  ${String(e.chart_index).padStart(2)} ${String(e.mid_sec).padStart(4)}s  ${e.label}  | transcript ${e.transcript_chunk.length}c | ocr ${e.ocr_text.length}c`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
