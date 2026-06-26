// Parse a MuslimXchange ticker page (https://muslimxchange.com/ticker/<ticker>/)
// to a status. The verdict element is class="mxx-limited-verdict pass|fail".
// Unrecognised / missing → 'unknown' (fail-safe).
export function parseMuslimXchange(html = '') {
  const m = String(html).match(/mxx-limited-verdict\s+(pass|fail)/i)
  if (!m) return 'unknown'
  return m[1].toLowerCase() === 'pass' ? 'compliant' : 'non_compliant'
}
