// Multi-account Trading 212 config. Accounts are declared in the T212_ACCOUNTS
// env var as a JSON array — secrets live in trading-hub's own .env (the hub is
// self-contained and never calls the finance app). Parsing is defensive: bad
// input yields [] and a warning, never a throw at import time.
const DEFAULT_BASE_URL = 'https://live.trading212.com'

export function parseAccounts(raw) {
  if (!raw || typeof raw !== 'string') return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((a) => a && a.id && a.keyId && a.secret)
    .map((a) => ({
      id: String(a.id),
      label: a.label ? String(a.label) : String(a.id),
      keyId: String(a.keyId),
      secret: String(a.secret),
      baseUrl: (a.baseUrl ? String(a.baseUrl) : DEFAULT_BASE_URL).replace(/\/$/, ''),
    }))
}

// Parsed once at import. Empty array when unset/malformed — callers gate on length.
export const BROKER_ACCOUNTS = parseAccounts(process.env.T212_ACCOUNTS)
