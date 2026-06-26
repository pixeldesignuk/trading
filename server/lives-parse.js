// Parse a Dojo live-session `summary_md` into per-ticker analysis.
//
// The summary has two structured parts we extract, per ticker:
//   1. A prose section:   `## <emoji?> TICKER\n![alt](screenshots/NN-TICKER.png)\n<prose…>`
//   2. A "Spot Snapshot" table row: `| **TICKER** | Zero's read | spot level / action | sharia |`
//
// Source text is full of emojis (the trader's formatting); we strip them so
// nothing emoji ever lands in the DB (project rule: no emojis in stored text).

// Remove emoji / symbol pictographs (📉 ❌ ✅ ⚠️ ☪ …), collapse the whitespace
// they leave. Arrows (→ U+2190–21FF) and dashes are MEANINGFUL trading shorthand
// ("lost → full rebalance") so they are deliberately preserved — only true
// pictographs are stripped.
export function stripEmoji(s) {
  if (!s) return s
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2049}\u{2122}\u{20BF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim()
}

// Normalize a header/table ticker label to a DB symbol candidate:
// strip emoji + markdown bold + parenthetical, drop a "— tagline" suffix
// ("MRNA — *SPOT WINNER RUNNING*" -> "MRNA"), uppercase, drop inner spaces.
export function normalizeTickerLabel(raw) {
  let cleaned = stripEmoji(raw).replace(/\*\*/g, '').replace(/\([^)]*\)/g, '').trim()
  // cut a tagline after an em/en dash, or a spaced hyphen (keeps hyphenated symbols intact)
  cleaned = cleaned.split(/\s*[—–]\s*|\s+-\s+/)[0].trim()
  // take the part before a slash ("BTC / USDT.D" -> "BTC")
  const head = cleaned.split('/')[0].trim()
  return head.toUpperCase().replace(/\s+/g, '')
}

// Parse `## TICKER` prose sections. Returns [{ticker, prose, chartFile}].
// chartFile is the screenshots/<name> path referenced by the section image (or null).
export function parseLiveSections(md, knownSymbols = null) {
  const out = []
  const re = /^##\s+(.+?)\s*$/gm
  const heads = [...md.matchAll(re)]
  for (let i = 0; i < heads.length; i++) {
    const symbol = normalizeTickerLabel(heads[i][1])
    if (knownSymbols && !knownSymbols.has(symbol)) continue
    const start = heads[i].index + heads[i][0].length
    const end = i + 1 < heads.length ? heads[i + 1].index : md.length
    const body = md.slice(start, end)
    const img = body.match(/!\[[^\]]*\]\(([^)]*screenshots\/[^)]+)\)/)
    const prose = stripEmoji(body.replace(/!\[[^\]]*\]\([^)]*\)/g, '')).trim()
    if (!prose && !img) continue
    out.push({ ticker: symbol, prose, chartFile: img ? img[1] : null })
  }
  return out
}

// Parse the "Spot Snapshot" markdown table.
// Returns { [symbol]: {zeros_read, spot_action, sharia_text} }.
export function parseSpotSnapshot(md, knownSymbols = null) {
  const result = {}
  for (const line of md.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    // a data row is | <asset> | read | action | sharia | -> 4 inner cells (+ empties)
    const inner = cells.slice(1, -1)
    if (inner.length < 4) continue
    const symbol = normalizeTickerLabel(inner[0])
    if (!symbol || symbol === 'ASSET') continue
    if (knownSymbols && !knownSymbols.has(symbol)) continue
    result[symbol] = {
      zeros_read: stripEmoji(inner[1]),
      spot_action: stripEmoji(inner[2]),
      sharia_text: stripEmoji(inner[3]),
    }
  }
  return result
}

// Map a sharia free-text cell to a status enum.
export function shariaFromText(text = '') {
  const t = text.toLowerCase()
  if (/non[- ]?compliant|❌|cfd|avoid/.test(text) || /non[- ]?compliant/.test(t)) {
    if (/non[- ]?compliant/.test(t) || /\bcfd\b/.test(t)) return 'non_compliant'
  }
  if (/compliant/.test(t) && !/non[- ]?compliant/.test(t)) return 'compliant'
  if (/questionable|verify|lean avoid|avoid/.test(t)) return 'questionable'
  return 'unknown'
}

// Combine sections + table into one per-ticker record.
// Returns { [symbol]: {prose, chartFile, zeros_read, spot_action, sharia_text, sharia_status} }.
export function parseLiveSummary(md, knownSymbols = null) {
  const sections = parseLiveSections(md, knownSymbols)
  const table = parseSpotSnapshot(md, knownSymbols)
  const merged = {}
  for (const s of sections) {
    merged[s.ticker] = { prose: s.prose, chartFile: s.chartFile, ...(table[s.ticker] || {}) }
  }
  for (const [sym, row] of Object.entries(table)) {
    if (!merged[sym]) merged[sym] = { prose: null, chartFile: null, ...row }
  }
  for (const rec of Object.values(merged)) rec.sharia_status = shariaFromText(rec.sharia_text || '')
  return merged
}
