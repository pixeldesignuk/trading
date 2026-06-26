import { parseZoya } from './zoya.js'
import { parseMusaffa } from './musaffa.js'
import { parseMuslimXchange } from './mxchange.js'

// Ticker casing differs per site. `url` is what we FETCH; `pageUrl` is the
// human page we link in the UI (Musaffa fetches its JSON API but links the page).
export const PROVIDERS = [
  { name: 'zoya', url: (t) => `https://zoya.finance/stocks/${t.toLowerCase()}`, parse: parseZoya },
  {
    name: 'musaffa',
    url: (t) => `https://api.musaffa.us/api/compliance-history/${t.toUpperCase()}?type=stock`,
    pageUrl: (t) => `https://musaffa.com/stock/${t.toUpperCase()}/`,
    accept: 'application/json',
    parse: parseMusaffa,
  },
  { name: 'mxchange', url: (t) => `https://muslimxchange.com/ticker/${t.toLowerCase()}/`, parse: parseMuslimXchange },
]

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

// Fetch one provider for one ticker → { name, status, url }. `url` in the result
// is the human page (pageUrl) for the card link. Any non-200, timeout, or thrown
// error resolves to status 'unknown' (never rejects, never a yes-vote).
export async function fetchOne(provider, ticker, { fetchImpl = fetch } = {}) {
  const fetchUrl = provider.url(ticker)
  const linkUrl = (provider.pageUrl || provider.url)(ticker)
  try {
    const res = await fetchImpl(fetchUrl, {
      headers: { 'user-agent': UA, accept: provider.accept || 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { name: provider.name, status: 'unknown', url: linkUrl }
    const body = await res.text()
    return { name: provider.name, status: provider.parse(body), url: linkUrl }
  } catch {
    return { name: provider.name, status: 'unknown', url: linkUrl }
  }
}
