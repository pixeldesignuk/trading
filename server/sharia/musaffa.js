// Musaffa exposes a public JSON compliance API — far more reliable than scraping
// the page (which is client-rendered for less-common tickers, so the verdict
// isn't in the raw HTML). Endpoint:
//   GET https://api.musaffa.us/api/compliance-history/<TICKER>?type=stock
//   -> { data: [{ compliance_status: COMPLIANT|NON_COMPLIANT|DOUBTFUL, report_date, … }] }
// We take the latest report. Unparseable / empty → 'unknown' (fail-safe).
export function parseMusaffa(body = '') {
  let j
  try { j = JSON.parse(body) } catch { return 'unknown' }
  const rows = Array.isArray(j?.data) ? j.data : []
  if (!rows.length) return 'unknown'
  const latest = rows.slice().sort((a, b) => String(b.report_date || '').localeCompare(String(a.report_date || '')))[0]
  const s = String(latest?.compliance_status || '').toUpperCase()
  if (s === 'COMPLIANT') return 'compliant'
  if (s === 'NON_COMPLIANT' || s === 'NOT_COMPLIANT') return 'non_compliant'
  if (s === 'DOUBTFUL' || s === 'QUESTIONABLE') return 'doubtful'
  return 'unknown'
}
