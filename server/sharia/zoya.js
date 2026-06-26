// Parse a Zoya stock page (https://zoya.finance/stocks/<ticker>) to a status.
// Zoya is binary: the verdict sentence is "<Name> (<TICKER>) is [not]
// Shariah-compliant". Check the negative first — it contains "Shariah-compliant"
// as a substring. Anything unrecognised → 'unknown' (fail-safe).
export function parseZoya(html = '') {
  const h = String(html)
  if (/is\s+not\s+Shariah-compliant/i.test(h)) return 'non_compliant'
  if (/is\s+Shariah-compliant/i.test(h)) return 'compliant'
  return 'unknown'
}
