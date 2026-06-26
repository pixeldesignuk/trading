// Triage the Zero's Dojo video back-catalogue from the Telegram archive.
// Pure pass over captions we already have — no downloads, ~zero cost.
// Classifies each video message so we only process real chart-walkthrough lives.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseCaptionChapters } from './chapters.mjs'

const ARCHIVE = path.join(os.homedir(), 'Developer/personal/trading/tg-reader/archive/zero-s-dojo.jsonl')
const ZERO_DOJO_CHAT = '2039653167' // for t.me deep links

// Classify a video message by its caption text.
export function classify(msg) {
  const text = (msg.text || '').trim()
  const lower = text.toLowerCase()
  const chapters = parseCaptionChapters(text)

  if (/mister pa|mr\.?\s*pa|pa['’]s version/i.test(text)) return 'mr-pa'
  // Guide / product launches — not chart walkthroughs.
  if (/guide is live|guides? .*live|notion database|is live!?\s*🔥|database and you/i.test(lower))
    return 'guide-announcement'
  if (chapters.length >= 2) return 'weekly-live'
  // Video posts that read like an analysis even without parsed chapters.
  if (/video[- ]analysis|market (update|outlook)|video update|live (market|outlook)/i.test(lower))
    return 'video-analysis'
  return 'unknown'
}

export function buildManifest(archivePath = ARCHIVE) {
  const rows = fs
    .readFileSync(archivePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((m) => m.media === 'MessageMediaDocument')

  return rows.map((m) => {
    const cls = classify(m)
    const chapters = parseCaptionChapters(m.text || '')
    return {
      msg_id: m.id,
      date: (m.date || '').slice(0, 10),
      sender: m.sender,
      class: cls,
      chapter_source: chapters.length ? 'caption' : 'none', // 'api'/'scene' resolved later
      chapter_count: chapters.length,
      in_scope: cls === 'weekly-live' || cls === 'video-analysis',
      caption: (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      url: `https://t.me/c/${ZERO_DOJO_CHAT}/${m.id}`,
    }
  })
}

// CLI: print the manifest (default) or a summary with --summary.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = buildManifest()
  if (process.argv.includes('--summary')) {
    const by = (k) => manifest.reduce((a, m) => ((a[m[k]] = (a[m[k]] || 0) + 1), a), {})
    console.log('total videos:', manifest.length)
    console.log('by class:', by('class'))
    console.log('in scope:', manifest.filter((m) => m.in_scope).length)
    console.log('with caption chapters:', manifest.filter((m) => m.chapter_source === 'caption').length)
  } else {
    console.log(JSON.stringify(manifest, null, 2))
  }
}
