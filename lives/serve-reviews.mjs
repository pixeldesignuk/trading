// Tiny static server for the lives review pages WITH HTTP range support, so the
// <video> player can seek large mp4s. Usage: node lives/serve-reviews.mjs [dir] [port]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.resolve(process.argv[2] || path.join(os.homedir(), 'Developer/personal/trading/dojo-lives'))
const PORT = Number(process.argv[3] || 8930)
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json', '.srt': 'text/plain', '.txt': 'text/plain' }

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0])
    let file = path.join(ROOT, urlPath)
    if (!file.startsWith(ROOT)) return end(res, 403, 'forbidden')
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      // directory index
      const items = fs.readdirSync(file).filter((d) => fs.statSync(path.join(file, d)).isDirectory())
      const links = items.map((d) => `<li><a href="${urlPath.replace(/\/$/, '')}/${d}/review.html">${d}</a></li>`).join('')
      return end(res, 200, `<h2>Live reviews</h2><ul>${links}</ul>`, 'text/html')
    }
    if (!fs.existsSync(file)) return end(res, 404, 'not found')
    const stat = fs.statSync(file)
    const type = TYPES[path.extname(file)] || 'application/octet-stream'
    const range = req.headers.range
    if (range && /^bytes=/.test(range)) {
      const [s, e] = range.replace('bytes=', '').split('-')
      const start = parseInt(s, 10) || 0
      const endByte = e ? parseInt(e, 10) : stat.size - 1
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${endByte}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': endByte - start + 1,
        'Content-Type': type,
      })
      fs.createReadStream(file, { start, end: endByte }).pipe(res)
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' })
      fs.createReadStream(file).pipe(res)
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Serving ${ROOT} with range support on http://127.0.0.1:${PORT}`))

function end(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'Content-Type': type })
  res.end(body)
}
