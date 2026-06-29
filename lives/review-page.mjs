// Generate a self-contained QA page: each chart frame next to its extracted setup.
// Lets you visually verify extraction before seeding. Usage:
//   node lives/review-page.mjs <live-dir>   ->  writes <live-dir>/review.html
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: node lives/review-page.mjs <live-dir>'); process.exit(1) }
const setups = JSON.parse(fs.readFileSync(path.join(dir, 'setups.json'), 'utf8'))
const ev = fs.existsSync(path.join(dir, 'evidence.json'))
  ? JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8'))
  : { charts: [] }
const segByIdx = Object.fromEntries((ev.charts || []).map((c) => [c.chart_index, c]))
// Prefer timing/frame carried on the setup itself (set by dedupe-setups after a
// vision run); fall back to the evidence segment by chart_index.
const segFor = (c) => ({
  frame: c.frame || segByIdx[c.chart_index]?.frame,
  start_sec: c.start_sec ?? segByIdx[c.chart_index]?.start_sec,
  mid_sec: c.mid_sec ?? segByIdx[c.chart_index]?.mid_sec,
})
const hasVideo = fs.existsSync(path.join(dir, 'video.mp4'))
const mmss = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)
const msgId = path.basename(dir).match(/(\d+)$/)?.[1]
const tgUrl = msgId ? `https://t.me/c/2039653167/${msgId}` : null

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))
const shBadge = (s) => ({ halal: '#1f8a4c', questionable: '#b8860b', haram: '#b33', unknown: '#555' }[s] || '#555')
const gradeBadge = (v) => ({ textbook: '#1f8a4c', partial: '#b8860b', weak: '#b33', context: '#555' }[v] || '#555')

const cards = setups.map((c) => `
  <div class="card">
    <div class="img">${segFor(c).frame ? `<img src="${esc(segFor(c).frame)}" loading="lazy">` : '<div class="noimg">no frame</div>'}</div>
    <div class="meta">
      <h2>#${c.chart_index} ${esc(c.symbol)} <span class="name">${esc(c.name || '')}</span>
        ${hasVideo && segFor(c).start_sec != null ? `<button class="jump" data-start="${segFor(c).start_sec}">▶ ${mmss(segFor(c).start_sec)}</button>` : ''}</h2>
      <div class="tags">
        <span class="tag">${esc(c.asset_class)}</span>
        <span class="tag">${esc(c.kind)}</span>
        <span class="tag bias">${esc(c.bias)}</span>
        <span class="tag" style="background:${gradeBadge(c.grade_verdict)}">${esc(c.grade_verdict)} ${c.grade_score}/10</span>
        <span class="tag" style="background:${shBadge(c.sharia_status)}">☪ ${esc(c.sharia_status)}</span>
        <span class="tag muted">conf ${esc(c.confidence)}</span>
        <span class="tag muted">${esc(c.timeframe || '')}</span>
      </div>
      <table>
        <tr><th>entry</th><td>${esc(c.entry) || '—'}</td></tr>
        <tr><th>targets</th><td>${esc((c.targets || []).join(' · ')) || '—'}</td></tr>
        <tr><th>invalidation</th><td>${esc(c.invalidation) || '—'}</td></tr>
        <tr><th>key levels</th><td>${esc((c.key_levels || []).join(' · ')) || '—'}</td></tr>
        <tr><th>why</th><td>${esc(c.rationale)}</td></tr>
        <tr><th>☪ note</th><td>${esc(c.sharia_note) || '—'}</td></tr>
        ${c.spot_note ? `<tr><th>spot</th><td>${esc(c.spot_note)}</td></tr>` : ''}
      </table>
    </div>
  </div>`).join('\n')

const html = `<!doctype html><meta charset="utf-8"><title>Live review — ${esc(path.basename(dir))}</title>
<style>
  body{margin:0;background:#0d0f12;color:#e7e9ec;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
  header{padding:12px 24px;border-bottom:1px solid #222;position:sticky;top:0;background:#0d0f12;z-index:2;display:flex;gap:18px;align-items:center}
  header h1{margin:0;font-size:16px} header .sub{color:#8a8f98;font-size:12px}
  header video{height:150px;border-radius:8px;border:1px solid #2a2e35;background:#000}
  .jump{margin-left:10px;font:600 12px/1 ui-sans-serif,system-ui;background:#34507a;color:#fff;border:0;border-radius:5px;padding:5px 9px;cursor:pointer;vertical-align:middle}
  .jump:hover{background:#3f6093}  .jump:active{transform:translateY(1px)}
  .tglink{margin-left:12px;font-size:12px;font-weight:500;color:#4ea3e0;text-decoration:none;border:1px solid #2a4866;border-radius:5px;padding:3px 8px;vertical-align:middle}
  .tglink:hover{background:#13314d;color:#7cc0f0}
  .card{display:grid;grid-template-columns:minmax(380px,1fr) 1fr;gap:18px;padding:18px 24px;border-bottom:1px solid #1c1f24;align-items:start}
  .img img{width:100%;border-radius:8px;border:1px solid #222} .noimg{color:#666;padding:40px;text-align:center;border:1px dashed #333;border-radius:8px}
  h2{margin:.1em 0 .4em;font-size:18px} .name{color:#8a8f98;font-weight:400;font-size:13px}
  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .tag{background:#2a2e35;color:#fff;border-radius:5px;padding:2px 8px;font-size:12px}
  .tag.bias{background:#34507a} .tag.muted{background:transparent;color:#8a8f98;border:1px solid #333}
  table{border-collapse:collapse;width:100%} th{text-align:left;color:#8a8f98;font-weight:500;vertical-align:top;width:90px;padding:3px 10px 3px 0}
  td{padding:3px 0;border-bottom:1px solid #16191e}
</style>
<header>
  ${hasVideo ? '<video id="player" controls preload="metadata" src="video.mp4"></video>' : ''}
  <div><h1>${esc(path.basename(dir))} — ${setups.length} charts ${tgUrl ? `<a class="tglink" href="${tgUrl}" target="_blank" rel="noopener">↗ Telegram message</a>` : ''}</h1>
  <div class="sub">Visual QA: chart frame ↔ extracted setup. ${hasVideo ? 'Click ▶ on a chart to jump the player to that segment. ' : ''}Educational only, not financial advice.</div></div>
</header>
${cards}
<script>
  const player = document.getElementById('player')
  document.querySelectorAll('.jump').forEach((b) => b.addEventListener('click', () => {
    if (!player) return
    player.currentTime = Number(b.dataset.start) || 0
    player.play().catch(() => {})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }))
</script>`

const out = path.join(dir, 'review.html')
fs.writeFileSync(out, html)
console.log(`Wrote ${out}`)
console.log(`Open: file://${path.resolve(out)}`)
