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

// Pull a `**Label:** value` line out of a section body (first match wins).
// `labels` is an alternation, e.g. 'Entry|Add'. Returns the trimmed, emoji-free
// value or null.
function grabField(body, labels) {
  const m = body.match(new RegExp(`^\\s*\\*\\*(?:${labels}):?\\*\\*\\s*(.+?)\\s*$`, 'im'))
  return m ? stripEmoji(m[1]).trim() : null
}

// Split a "TP1 · TP2 · TP3" / comma list into a clean array, preserving levels.
export function splitLevels(v) {
  if (!v) return []
  return String(v).split(/\s*[·;]\s*|\s*,\s+/).map((s) => s.trim()).filter(Boolean)
}

// Labels we lift out of the prose into structured fields (kept in sync with grabField).
const FIELD_LABELS = 'Entry|Add|Targets|TPs|Target|Invalidation|Invalid|Stop|Levels|Key levels|Bias|Spot|Sharia'

// Parse `## TICKER` prose sections. Returns
//   [{ticker, prose, chartFile, entry, targets, invalidation, levels, bias, spot, sharia_text}].
// `prose` is the narrative with the **Label:** lines and the image stripped out;
// the labelled lines become structured fields so the Sources card renders
// Entry / Targets / Invalid / Levels rows instead of a bare blurb.
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
    const entry = grabField(body, 'Entry|Add')
    const targets = grabField(body, 'Targets|TPs|Target')
    const invalidation = grabField(body, 'Invalidation|Invalid|Stop')
    const levels = grabField(body, 'Levels|Key levels')
    const bias = grabField(body, 'Bias')
    const spot = grabField(body, 'Spot')
    const sharia_text = grabField(body, 'Sharia')
    const prose = stripEmoji(
      body
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(new RegExp(`^\\s*\\*\\*(?:${FIELD_LABELS}):?\\*\\*.*$`, 'gim'), ''),
    ).trim()
    if (!prose && !img && !entry && !targets) continue
    out.push({ ticker: symbol, prose, chartFile: img ? img[1] : null, entry, targets, invalidation, levels, bias, spot, sharia_text })
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
    // Section structured fields win; the table fills any gaps (e.g. sharia_text).
    // Drop null section fields so they don't clobber a value the table provided.
    const { ticker, ...fields } = s
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null))
    merged[ticker] = { ...(table[ticker] || {}), ...defined }
  }
  for (const [sym, row] of Object.entries(table)) {
    if (!merged[sym]) merged[sym] = { prose: null, chartFile: null, ...row }
  }
  for (const rec of Object.values(merged)) rec.sharia_status = shariaFromText(rec.sharia_text || '')
  return merged
}
