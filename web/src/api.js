const j = (r) => r.json()

// POST a JSON body and consume a Server-Sent Events stream. Calls onText(delta)
// per token and onEvent(obj) for structured generative-UI events (e.g. a widget
// payload). Resolves with the final usage object. Throws on a streamed error.
async function streamSSE(url, body, { onText, onEvent, signal } = {}) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal,
  })
  if (!res.ok || !res.body) {
    let err = `request failed (${res.status})`
    try { err = (await res.json()).error || err } catch { /* not json */ }
    throw new Error(err)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', usage = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const line = buf.slice(0, idx).split('\n').find((l) => l.startsWith('data:'))
      buf = buf.slice(idx + 2)
      if (!line) continue
      const obj = JSON.parse(line.slice(5).trim())
      if (obj.error) throw new Error(obj.error)
      if (obj.t) onText?.(obj.t)
      else if (obj.widget) onEvent?.(obj) // { widget:'alerts', data, focus }
      if (obj.done) usage = obj.usage
    }
  }
  return usage
}

export const api = {
  // opts: a status string (e.g. 'in'), or { exclude: ['watching','in'] }.
  tickers: (opts) => {
    const q = typeof opts === 'string' ? `?status=${opts}`
      : opts?.exclude?.length ? `?exclude=${opts.exclude.join(',')}` : ''
    return fetch('/api/tickers' + q).then(j)
  },
  ticker: (symbol) => fetch(`/api/tickers/${symbol}`).then(j),
  // Mark a ticker's sources as read (clears the unread badge) — on Sources-tab open.
  markSeen: (symbol) => fetch(`/api/tickers/${symbol}/seen`, { method: 'POST' }).then(j),
  history: (symbol) => fetch(`/api/tickers/${symbol}/history`).then(j),
  setStatus: (symbol, status) =>
    fetch(`/api/tickers/${symbol}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }).then(j),
  setPlan: (symbol, plan) =>
    fetch(`/api/tickers/${symbol}/plan`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(plan),
    }).then(j),
  quotes: () => fetch('/api/quotes').then(j),
  config: () => fetch('/api/config').then(j),
  synthesize: (symbol, force) =>
    fetch(`/api/tickers/${symbol}/synthesize${force ? '?force=1' : ''}`, { method: 'POST' }).then(j),
  sharia: (symbol, force) =>
    fetch(`/api/tickers/${symbol}/sharia${force ? '?force=1' : ''}`, { method: 'POST' }).then(j),
  today: () => fetch('/api/today').then(j),
  discussions: () => fetch('/api/discussions').then(j),
  discussion: (slug) => fetch(`/api/discussions/${slug}`).then(j),
  ideas: (sharia) => fetch('/api/ideas' + (sharia && sharia !== 'all' ? `?sharia=${sharia}` : '')).then(j),
  alerts: () => fetch('/api/alerts').then(j),
  createAlert: ({ symbol, direction, price, note } = {}) =>
    fetch('/api/alerts/custom', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol, direction, price, note }),
    }).then(j),
  cancelAlert: (id) =>
    fetch(`/api/alerts/custom/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(j),
  muteAlert: (symbol, muted) =>
    fetch('/api/alerts/mute', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol, muted }),
    }).then(j),
  armAlerts: (symbol) => fetch(`/api/tickers/${symbol}/alerts/arm`, { method: 'POST' }).then(j),
  disarmAlerts: (symbol) => fetch(`/api/tickers/${symbol}/alerts/arm`, { method: 'DELETE' }).then(j),
  reorderTickers: (symbols) =>
    fetch('/api/tickers/reorder', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbols }),
    }).then(j),
  enrichTicker: (symbol, { ai_thesis, plan_levels } = {}) =>
    fetch('/api/enrich/ticker', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol, ai_thesis, plan_levels }),
    }).then(j),
  enrichEvent: (event_id, { summary, caption, levels } = {}) =>
    fetch('/api/enrich/event', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_id, summary, caption, levels }),
    }).then(j),
  enrichPending: () => fetch('/api/enrich/pending').then(j),
  setVehicle: (symbol, vehicle) =>
    fetch(`/api/tickers/${symbol}/vehicle`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vehicle }),
    }).then(j),
  funds: () => fetch('/api/funds').then(j),
  holdings: (scope) => fetch('/api/holdings' + (scope ? `?scope=${encodeURIComponent(scope)}` : '')).then(j),
  syncBrokers: () => fetch('/api/brokers/sync', { method: 'POST' }).then(j),
  // Accounts & owners admin
  accounts: () => fetch('/api/accounts').then(j),
  addOwner: (owner) =>
    fetch('/api/owners', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(owner),
    }).then(j),
  addAccount: (account) =>
    fetch('/api/accounts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(account),
    }).then(j),
  removeAccount: (id) =>
    fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(j),
  snaptradeAccounts: () => fetch('/api/snaptrade/accounts').then(j),
  importSnapTrade: (payload) =>
    fetch('/api/snaptrade/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(j),
  snaptradeConnect: () => fetch('/api/snaptrade/connect', { method: 'POST' }).then(j),
  // Portfolio allocation (per book: 'personal' | 'kids')
  ledger: (book) => fetch(`/api/portfolio/${book}/ledger`).then(j),
  rotation: () => fetch('/api/portfolio/rotation').then(j),
  fundUniverse: (filter) => fetch('/api/portfolio/funds' + (filter?.coreType ? `?coreType=${filter.coreType}` : filter?.theme ? `?theme=${filter.theme}` : '')).then(j),
  addFund: (fund) =>
    fetch('/api/portfolio/funds/add', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fund),
    }).then(j),
  setAccountBook: (id, book) =>
    fetch(`/api/brokers/${encodeURIComponent(id)}/book`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ book }),
    }).then(j),
  tickerRisk: (symbol, book = 'personal') => fetch(`/api/tickers/${symbol}/risk?book=${book}`).then(j),
  chat: (symbol, messages, opts) => streamSSE(`/api/tickers/${symbol}/chat`, { messages }, opts),
  portfolioChat: (messages, opts, book = 'personal') => streamSSE('/api/portfolio/chat', { messages, book }, opts),
  setClassification: (symbol, patch) =>
    fetch(`/api/tickers/${symbol}/classification`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(j),
  portfolioTargets: (book) => fetch(`/api/portfolio/${book}/targets`).then(j),
  setPortfolioTargets: (book, patch) =>
    fetch(`/api/portfolio/${book}/targets`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(j),
}
