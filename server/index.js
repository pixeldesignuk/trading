import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { init, query } from './db.js'
import { listTickers, getTicker, setStatus, setPlan, setVehicle, setClassification, setCommodityKey, upsertTicker, setActioned, reorderTickers, markSourcesSeen } from './tickers.js'
import { getCommodity, vehicleByTicker, pickVehicle, commodityView, vehicleToCommodity } from './commodities.js'
import { eventsForTicker } from './events.js'
import { ingestSignal } from './ingest-signal.js'
import { addChartEvent } from './charts.js'
import { ingestDiscussion, listDiscussions, getDiscussion } from './discussions.js'
import { listIdeas } from './ideas.js'
import { getQuotes, getHistory } from './price-provider.js'
import { buildToday } from './today.js'
import { PORT, MEDIA_DIR, ROOT, ACCOUNT_SIZE, RISK_PER_TRADE, RISK_BY_TF, MIN_RR, HELD_BROKERS, MAX_INVESTED_PCT, MAX_POSITIONS } from './config.js'
import { setThesis, setEventEnrichment, setPlanFromLevels } from './enrich.js'
import { synthesize } from './synthesize.js'
import { streamChat, streamPortfolioChat, chatReady, missingKey } from './chat.js'
import { screenTicker } from './sharia/screen.js'
import { runAlerts } from './alerts/run.js'
import { runDigest } from './alerts/digest.js'
import { listAlerts } from './alerts/list.js'
import { createCustomAlert, cancelCustomAlert, setMuted, armPlanAlerts, disarmPlanAlerts } from './alerts/custom.js'
import { ALERTS_RUN_TOKEN } from './config.js'
import { syncAll } from './brokers/sync.js'
import { getFunds, getHoldings } from './brokers/funds.js'
import { hasKey } from './brokers/secrets.js'
import { listAccounts, createOwner, createHousehold, createAccount, deleteAccount } from './brokers/accounts-store.js'
import { loginUser, listLinkedAccounts, personalUserId, client as snaptradeClient } from './brokers/snaptrade.js'
import { getTargets, setTargets, blendTargets } from './portfolio/targets.js'
import { buildLedger } from './portfolio/ledger.js'
import { classify } from './portfolio/classify.js'
import { holdModel } from './portfolio/hold-model.js'
import { tradeModel } from './portfolio/trade-model.js'
import { allocateTargets } from './portfolio/allocate.js'
import { computeTickerRisk } from './portfolio/ticker-risk.js'
import { computeRotation, BIG6 } from './portfolio/rotation.js'
import { benchmarkSymbol, trailingReturn, bookReturn, periodReturns } from './portfolio/benchmark.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())
const PUBLIC = path.join(ROOT, 'server', 'public')

// Resolve the surfaced vehicle for a commodity ticker (locked, else recommended).
const resolveVehicle = (t) => {
  const m = getCommodity(t.commodity_key)
  if (!m) return null
  return (t.commodity_vehicle && vehicleByTicker(t.commodity_key, t.commodity_vehicle)) || pickVehicle(m.vehicles, HELD_BROKERS) || null
}

const quotesForAll = async () => {
  const tickers = await listTickers()
  // Commodities are priced off their reference spot (=F) so the rail state +
  // alert trigger stay faithful to Zero's levels; stocks/crypto price as normal.
  const base = await getQuotes(tickers.map((t) => {
    if (t.asset_class === 'commodity' && t.commodity_key) {
      return { ticker: t.symbol, asset_class: 'commodity', symbol: getCommodity(t.commodity_key)?.reference_symbol }
    }
    return { ticker: t.symbol, asset_class: t.asset_class, symbol: t.quote_symbol || undefined }
  }))
  // Attach the locked ETC's live price (the SURFACED instrument) to each commodity.
  const commodities = tickers.filter((t) => t.asset_class === 'commodity' && t.commodity_key)
  if (commodities.length) {
    const veh = {}
    const vpairs = []
    for (const t of commodities) {
      const v = resolveVehicle(t)
      if (!v) continue
      veh[t.symbol] = v
      vpairs.push({ ticker: `${t.symbol}::veh`, asset_class: 'stock', symbol: v.yahoo })
    }
    const vq = await getQuotes(vpairs)
    for (const t of commodities) {
      const v = veh[t.symbol]
      if (!v || !base[t.symbol]) continue
      const p = vq[`${t.symbol}::veh`]
      base[t.symbol].vehicle = { ticker: v.ticker, price: p?.price ?? null, changePct: p?.changePct ?? null, currency: v.currency }
    }
  }
  return base
}

app.get('/api/config', (req, res) =>
  res.json({ account_size: ACCOUNT_SIZE, risk_per_trade: RISK_PER_TRADE, risk_by_tf: RISK_BY_TF, min_rr: MIN_RR,
    max_invested_pct: MAX_INVESTED_PCT, max_positions: MAX_POSITIONS }))

app.get('/api/tickers', async (req, res) => res.json(await listTickers({
  status: req.query.status,
  exclude: req.query.exclude ? String(req.query.exclude).split(',') : undefined,
})))

app.get('/api/tickers/:symbol', async (req, res) => {
  const ticker = await getTicker(req.params.symbol)
  if (!ticker) return res.status(404).json({ error: 'not found' })
  // Auto-resolve the vehicle-reference key on open: if this commodity isn't keyed
  // yet but its symbol matches a reference entry (e.g. USOIL → usoil), key it now.
  if (ticker.asset_class === 'commodity' && !ticker.commodity_key) {
    const key = String(ticker.symbol).toLowerCase()
    if (getCommodity(key)) { await setCommodityKey(ticker.symbol, key); ticker.commodity_key = key }
  }
  const commodity = ticker.asset_class === 'commodity' && ticker.commodity_key
    ? await commodityView(ticker, { getQuotes, heldBrokers: HELD_BROKERS })
    : null
  const events = await eventsForTicker(req.params.symbol)
  // "unread" for the Sources-tab dot: any event captured after the last time the
  // Sources tab was opened (sources_seen_at). Cleared by POST …/seen.
  const seenAt = ticker.sources_seen_at ? new Date(ticker.sources_seen_at).getTime() : 0
  const unread = events.some((e) => e.captured_at && new Date(e.captured_at).getTime() > seenAt)
  res.json({ ticker, events, commodity, unread })
})

// Mark a ticker's sources as read (clears the unread badge). Called when the
// user opens the Sources tab.
app.post('/api/tickers/:symbol/seen', async (req, res) => {
  await markSourcesSeen(req.params.symbol)
  res.json({ ok: true })
})

app.get('/api/tickers/:symbol/history', async (req, res) => {
  const ticker = await getTicker(req.params.symbol)
  if (!ticker) return res.status(404).json({ error: 'not found' })
  // Commodities chart off their reference future (the bare symbol won't resolve);
  // other lines can carry a quote_symbol override (e.g. a broker LSE line).
  const symbol = ticker.asset_class === 'commodity' && ticker.commodity_key
    ? getCommodity(ticker.commodity_key)?.reference_symbol : (ticker.quote_symbol || undefined)
  res.json(await getHistory(ticker.symbol, ticker.asset_class, { symbol }))
})

app.patch('/api/tickers/:symbol/status', async (req, res) => {
  await setStatus(req.params.symbol, req.body.status)
  res.json({ ok: true })
})

// Persist manual Portfolio board order (sort_order = position in the array).
app.patch('/api/tickers/reorder', async (req, res) => {
  try { res.json(await reorderTickers(req.body?.symbols || [])) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.patch('/api/tickers/:symbol/plan', async (req, res) => {
  await setPlan(req.params.symbol, req.body || {})
  res.json({ ok: true })
})

// Lock the investable ETC for a commodity (surfaces on lists + alerts).
app.patch('/api/tickers/:symbol/vehicle', async (req, res) => {
  await setVehicle(req.params.symbol, req.body?.vehicle || null)
  res.json({ ok: true })
})

// Skeptical-editor synthesis: read all of a ticker's sources and produce one
// conflict-aware plan + conviction. Slow (spawns headless Claude); on-demand.
app.post('/api/tickers/:symbol/synthesize', async (req, res) => {
  try {
    const out = await synthesize(req.params.symbol, { force: req.query.force === '1' })
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Ticker chat — stream an answer grounded in the bible + this ticker's context,
// over Server-Sent Events. The big stable prefix (bible + ticker) is prompt-cached
// so follow-up turns read it at ~0.1x instead of re-sending it.
// Shared SSE plumbing for both chat scopes (ticker + portfolio). `invoke` runs the
// scoped streamer with the onText/onEvent/signal wiring; events are streamed as
// { t } (text), { widget, data, … } (generative UI), then { done, usage }.
async function chatSSE(req, res, invoke) {
  if (!chatReady()) {
    return res.status(503).json({ error: `chat unavailable: set ${missingKey()} in .env` })
  }
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  let closed = false
  const send = (obj) => { if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`) }
  const ac = new AbortController()
  // res 'close' = client actually disconnected (req 'close' fires early, once the
  // request body is read, which would falsely abort an in-flight stream).
  res.on('close', () => { closed = true; ac.abort() })
  try {
    const usage = await invoke({ messages: req.body?.messages || [], onText: (t) => send({ t }), onEvent: (evt) => send(evt), signal: ac.signal })
    send({ done: true, usage })
  } catch (e) {
    send({ error: String(e.message || e) })
  } finally {
    if (!closed) res.end()
  }
}

app.post('/api/tickers/:symbol/chat', (req, res) =>
  chatSSE(req, res, (opts) => streamChat({ symbol: req.params.symbol, ...opts })))

// Portfolio-level chat: reasons over the whole roster (new/watching/in) — standouts
// + active trades at risk — with a clickable ticker-shortlist widget.
app.post('/api/portfolio/chat', (req, res) =>
  chatSSE(req, res, (opts) => streamPortfolioChat({ book: req.body?.book || 'personal', ...opts })))

// Live 2-of-3 Sharia screen (Zoya/Musaffa/MuslimXchange). Stocks only; cached 7d.
app.post('/api/tickers/:symbol/sharia', async (req, res) => {
  try {
    res.json(await screenTicker(req.params.symbol, { force: req.query.force === '1' }))
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.get('/api/quotes', async (req, res) => res.json(await quotesForAll()))

app.get('/api/today', async (req, res) => {
  const [tickers, quotes] = [await listTickers(), await quotesForAll()]
  // buildToday wants a {symbol: price} map; quotes are now {price, changePct}.
  const prices = Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, v?.price ?? null]))
  res.json(buildToday(tickers, prices))
})

app.post('/api/ingest', async (req, res) => {
  try { res.json(await ingestSignal(req.body?.signal || req.body)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

// Attach a chart image to a ticker. The server copies srcFile (an absolute path on
// this machine) into its own MEDIA_DIR and appends a kind:'chart' event, so the image
// always lands where /media serves it. Ensures the ticker exists first.
app.post('/api/chart', async (req, res) => {
  try {
    const { symbol, name, asset_class, source = 'zero_live', srcFile, occurred_at = null, native_id = null, caption = null, levels = null } = req.body || {}
    if (!symbol || !srcFile) throw new Error('symbol and srcFile are required')
    // Vehicle-code guard (mirrors ingestSignal): a chart labelled with an ETC code
    // (e.g. "SGLN") attaches to the canonical commodity ticker, not a duplicate.
    const remap = vehicleToCommodity(symbol)
    const t = remap
      ? await upsertTicker(remap.symbol, { name: getCommodity(remap.key)?.label || name, asset_class: 'commodity' })
      : await upsertTicker(symbol, { name, asset_class })
    await addChartEvent({ symbol: t.symbol, source, srcFile, occurred_at, native_id, caption, levels })
    res.json({ ok: true, symbol: t.symbol })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// --- Feed (discussion digests) ---

app.post('/api/discussions', async (req, res) => {
  try { res.json(await ingestDiscussion(req.body || {})) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.get('/api/discussions', async (req, res) => {
  try { res.json(await listDiscussions({ limit: Number(req.query.limit) || 50 })) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/discussions/:slug', async (req, res) => {
  const d = await getDiscussion(req.params.slug)
  if (!d) return res.status(404).json({ error: 'not found' })
  res.json(d)
})

// --- Ideas (community ticker ideas extracted from discussions) ---

app.get('/api/ideas', async (req, res) => {
  try { res.json(await listIdeas({ sharia: req.query.sharia })) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// --- Alerts ---
// Planned alerts: every armed ticker + its plan + current state, and recent fires.
app.get('/api/alerts', async (req, res) => {
  try { res.json(await listAlerts()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Run one alert pass (fires Telegram + records kind='alert' events on plan-state
// transitions). Guarded by a shared secret; the Trigger.dev cron pokes this.
app.post('/api/alerts/run', async (req, res) => {
  if (!ALERTS_RUN_TOKEN || req.get('x-alerts-token') !== ALERTS_RUN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try { res.json(await runAlerts()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Twice-daily actionable digest (07:00 + 21:30 Europe/London). Builds + sends the
// Telegram briefing; never records events. Same shared-secret guard; two Trigger.dev
// schedules poke this.
app.post('/api/alerts/digest', async (req, res) => {
  if (!ALERTS_RUN_TOKEN || req.get('x-alerts-token') !== ALERTS_RUN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try { res.json(await runDigest()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Custom price-cross alerts (set from the Alerts widget; the chat tool shares the
// same store). Create / cancel / mute, then return the refreshed alerts payload so
// the widget re-renders from a single source of truth.
app.post('/api/alerts/custom', async (req, res) => {
  try {
    const { symbol, direction, price, note } = req.body || {}
    const alert = await createCustomAlert({ symbol, direction, price, note, createdBy: 'widget' })
    res.json({ ok: true, alert, alerts: await listAlerts() })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.delete('/api/alerts/custom/:id', async (req, res) => {
  try {
    const ok = await cancelCustomAlert(req.params.id)
    if (!ok) return res.status(404).json({ error: 'no active alert with that id' })
    res.json({ ok: true, alerts: await listAlerts() })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/api/alerts/mute', async (req, res) => {
  try {
    const { symbol, muted } = req.body || {}
    const out = await setMuted(symbol, muted)
    res.json({ ok: true, ...out, alerts: await listAlerts() })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// Arm / disarm the plan-derived alert set for a ticker (entry · stop · targets).
app.post('/api/tickers/:symbol/alerts/arm', async (req, res) => {
  try {
    const out = await armPlanAlerts(req.params.symbol)
    res.json({ ok: true, ...out, alerts: await listAlerts() })
  } catch (e) { res.status(400).json({ error: e.message }) }
})
app.delete('/api/tickers/:symbol/alerts/arm', async (req, res) => {
  try {
    const out = await disarmPlanAlerts(req.params.symbol)
    res.json({ ok: true, ...out, alerts: await listAlerts() })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// --- Brokers (Dynamic Kanban Portfolio: T212 multi-account, read-only mirror) ---

const BOOKS = new Set(['personal', 'kids'])

// Resolve an allocation scope param → owner ids to aggregate over. A scope is
// either an owner id, or 'hh:<householdId>' for a household roll-up. Returns null
// if it resolves to nothing (404).
async function resolveScope(scope) {
  if (scope?.startsWith('hh:')) {
    const householdId = scope.slice(3)
    const owners = (await query('SELECT id, name, relationship FROM owners WHERE household_id=$1 ORDER BY relationship, name', [householdId])).rows
    if (!owners.length) return null
    return { isHousehold: true, householdId, owners, ownerIds: owners.map((o) => o.id) }
  }
  const owner = (await query('SELECT id, name, relationship FROM owners WHERE id=$1', [scope])).rows[0]
  if (!owner) return null
  return { isHousehold: false, owner, owners: [owner], ownerIds: [owner.id], relationship: owner.relationship }
}

app.get('/api/portfolio/:scope/targets', async (req, res) => {
  try {
    const s = await resolveScope(req.params.scope)
    if (!s) return res.status(404).json({ error: 'unknown owner' })
    if (s.isHousehold) {
      const perOwner = await Promise.all(s.owners.map(async (o) => ({
        value: (await getFunds({ ownerIds: [o.id] })).totalValue,
        targets: await getTargets(o.id, { relationship: o.relationship }),
      })))
      return res.json({ owner: req.params.scope, readOnly: true, ...blendTargets(perOwner) })
    }
    res.json(await getTargets(s.owner.id, { relationship: s.relationship }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/portfolio/:scope/targets', async (req, res) => {
  try {
    const s = await resolveScope(req.params.scope)
    if (!s) return res.status(404).json({ error: 'unknown owner' })
    if (s.isHousehold) return res.status(400).json({ error: 'household targets are a roll-up — edit each owner' })
    res.json(await setTargets(s.owner.id, req.body || {}, { relationship: s.relationship }))
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// Benchmark trailing-1y return, cached 6h per symbol (daily bars barely move).
const _benchmark = new Map() // symbol → { at, ret }
async function getBenchmarkReturn(symbol) {
  if (!symbol) return null
  const hit = _benchmark.get(symbol)
  if (hit && Date.now() - hit.at < ROTATION_TTL) return hit.ret
  let ret = null
  try {
    const bars = await getHistory(symbol, 'stock')
    ret = trailingReturn((bars || []).map((b) => b.c).filter((c) => c != null), 252)
  } catch { ret = null }
  _benchmark.set(symbol, { at: Date.now(), ret })
  return ret
}

app.get('/api/portfolio/:scope/ledger', async (req, res) => {
  try {
    const s = await resolveScope(req.params.scope)
    if (!s) return res.status(404).json({ error: 'unknown owner' })
    // Per-owner (or household roll-up): aggregate accounts/holdings by owner_id.
    let targets
    if (s.isHousehold) {
      const perOwner = await Promise.all(s.owners.map(async (o) => ({
        value: (await getFunds({ ownerIds: [o.id] })).totalValue,
        targets: await getTargets(o.id, { relationship: o.relationship }),
      })))
      targets = blendTargets(perOwner)
    } else {
      targets = await getTargets(s.owner.id, { relationship: s.relationship })
    }
    const funds = await getFunds({ ownerIds: s.ownerIds })
    const holdings = await getHoldings({ ownerIds: s.ownerIds })
    const tickers = await listTickers()
    const rotation = await getRotation()
    const led = buildLedger({ book: req.params.scope, targets, holdings, tickers, bookValue: funds.totalValue, regime: rotation.regime })
    led.regime = { regime: rotation.regime, label: rotation.label }
    // Performance scorecard: return vs the benchmark's trailing 1y.
    const sym = benchmarkSymbol(targets.benchmark)
    led.benchmark = { label: targets.benchmark, symbol: sym, return1y: await getBenchmarkReturn(sym) }
    led.bookReturnPct = bookReturn(funds)
    res.json(led)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/tickers/:symbol/classification', async (req, res) => {
  try { await setClassification(req.params.symbol, req.body || {}); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Macro rotation (Big 6 sector-ETF ratios → regime). Cached 6h — daily bars
// barely move and the 6 history fetches are otherwise repeated per page load.
let _rotation = null
const ROTATION_TTL = 6 * 60 * 60 * 1000
async function getRotation() {
  if (_rotation && Date.now() - _rotation.at < ROTATION_TTL) return _rotation.data
  const closes = {}
  await Promise.all(BIG6.map(async (sym) => {
    try {
      const bars = await getHistory(sym, 'stock')
      closes[sym] = (bars || []).map((b) => b.c).filter((c) => c != null)
    } catch { closes[sym] = [] }
  }))
  const data = { ...computeRotation(closes, { lookback: 20 }), asOf: new Date().toISOString() }
  _rotation = { at: Date.now(), data }
  return data
}
app.get('/api/portfolio/rotation', async (req, res) => {
  try { res.json(await getRotation()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Sharia fund universe (curated reference) enriched with YTD + all-time growth.
// Cached 6h — each fund needs a history fetch.
let _fundUniverse = null
async function getFundUniverse() {
  if (_fundUniverse && Date.now() - _fundUniverse.at < ROTATION_TTL) return _fundUniverse.data
  const file = path.join(ROOT, 'server', 'reference', 'fund-universe.json')
  const uni = JSON.parse(fs.readFileSync(file, 'utf8'))
  const year = new Date().getFullYear()
  for (const [key, list] of Object.entries(uni)) {
    if (!Array.isArray(list)) continue
    await Promise.all(list.map(async (f) => {
      // `symbol` is the Trading 212 form (e.g. ISDW.GB); `yahoo` is the price-feed
      // symbol (ISDW.L). Fetch growth off `yahoo`. CASH/no-feed entries skip.
      const feed = f.yahoo
      if (!feed) { f.perf = { ytd: null, allTime: null }; return }
      const ac = key === 'crypto' ? 'crypto' : 'stock'
      try { f.perf = periodReturns(await getHistory(feed, ac, { months: 360 }), year) }
      catch { f.perf = { ytd: null, allTime: null } }
    }))
  }
  _fundUniverse = { at: Date.now(), data: uni }
  return uni
}
app.get('/api/portfolio/funds', async (req, res) => {
  // Optional ?coreType= / ?theme= filters narrow the universe to the candidates for
  // one core sub-type or satellite theme (the multi-option suggestion picker).
  try {
    const uni = await getFundUniverse()
    const { coreType, theme } = req.query
    if (!coreType && !theme) return res.json(uni)
    const out = {}
    for (const [section, list] of Object.entries(uni)) {
      if (!Array.isArray(list)) { out[section] = list; continue }
      out[section] = list.filter((f) =>
        (!coreType || f.core_type === coreType) && (!theme || f.theme === theme))
    }
    res.json(out)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Add a fund from the universe to the watchlist (creates a hold-classified ticker).
app.post('/api/portfolio/funds/add', async (req, res) => {
  const { symbol, name, sleeve, asset_class = 'stock', actioned, satellite_theme } = req.body || {}
  if (!symbol) return res.status(400).json({ error: 'symbol required' })
  try {
    await upsertTicker(symbol, { name, asset_class })
    await setStatus(symbol, 'watching')
    await setClassification(symbol, { layer: 'hold', role: sleeve === 'core' ? 'core' : 'satellite', pyramid_tier: null, target_pin: null, satellite_theme: satellite_theme || null })
    if (actioned) await setActioned(symbol, true)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Tag a synced account to a book (personal|kids) so the JISA splits out.
app.patch('/api/brokers/:id/book', async (req, res) => {
  const book = req.body?.book
  if (!BOOKS.has(book)) return res.status(400).json({ error: 'book must be personal or kids' })
  try {
    const r = await query('UPDATE broker_accounts SET book = $2 WHERE id = $1', [req.params.id, book])
    if (!r.rowCount) return res.status(404).json({ error: 'unknown account' })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Per-ticker risk panel: classification + hold-weight + trade-sizing for a book.
app.get('/api/tickers/:symbol/risk', async (req, res) => {
  try {
    const book = BOOKS.has(req.query.book) ? req.query.book : 'personal'
    res.json(await computeTickerRisk(req.params.symbol, { book }))
  } catch (e) {
    if (e.message === 'unknown ticker') return res.status(404).json({ error: 'unknown ticker' })
    res.status(500).json({ error: e.message })
  }
})

// Synced available funds (+ per-account), aggregate total value is the risk basis.
app.get('/api/funds', async (req, res) => {
  try { res.json(await getFunds()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Holdings drive the Active column + real P/L.
app.get('/api/holdings', async (req, res) => {
  // Optional ?scope= (owner id or hh:<household>) scopes holdings to that owner's
  // accounts — so a same-ticker position in another owner's book (e.g. a kids JISA
  // CRSP) is not summed into this owner's row value/P&L. Absent = all.
  try {
    let ownerIds = null
    if (req.query.scope) {
      const s = await resolveScope(req.query.scope)
      if (!s) return res.status(404).json({ error: 'unknown scope' })
      ownerIds = s.ownerIds
    }
    res.json(await getHoldings(ownerIds ? { ownerIds } : {}))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Manual "Sync now" — pulls every account, reconciles stages, returns fresh funds.
app.post('/api/brokers/sync', async (req, res) => {
  try { await safeSync(); res.json(await getFunds()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// --- Accounts & owners (admin) ---

// Households, owners, accounts (no secrets) + provider catalogue for the form.
app.get('/api/accounts', async (req, res) => {
  try { res.json(await listAccounts()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/households', async (req, res) => {
  try { res.json({ id: await createHousehold(req.body || {}) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/api/owners', async (req, res) => {
  try { res.json({ id: await createOwner(req.body || {}) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

// Create an account (encrypts credentials), then run a full sync so the new
// holdings appear and the Active stage reconciles against the complete held set.
// Returns the account's post-sync status so a bad key surfaces immediately.
app.post('/api/accounts', async (req, res) => {
  try {
    if (!hasKey()) return res.status(400).json({ error: 'APP_ENCRYPTION_KEY not set — cannot store credentials' })
    const id = await createAccount(req.body || {})
    await safeSync()
    const row = (await query('SELECT id, error, synced_at, total_value FROM broker_accounts WHERE id=$1', [id])).rows[0]
    res.json({ id, ...row })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.delete('/api/accounts/:id', async (req, res) => {
  try { await deleteAccount(req.params.id); await safeSync(); res.json({ ok: true }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

// SnapTrade: list the brokerage accounts already linked to the personal user, so
// the user can import each (and map it to an owner). Mints a short-lived secret.
app.get('/api/snaptrade/accounts', async (req, res) => {
  try {
    const { accounts } = await listLinkedAccounts()
    res.json((accounts || []).map((a) => ({
      id: a.id, institution: a.institution_name, name: a.name,
      total: a.balance?.total?.amount ?? null, currency: a.balance?.total?.currency || 'GBP',
    })))
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// Import a linked SnapTrade account → an owner's book. Stores { userId } as creds
// (a fresh secret is minted per sync) and the SnapTrade account id as provider_ref.
app.post('/api/snaptrade/import', async (req, res) => {
  try {
    if (!hasKey()) return res.status(400).json({ error: 'APP_ENCRYPTION_KEY not set — cannot store credentials' })
    const { owner_id, snaptrade_account_id, label, account_type } = req.body || {}
    if (!owner_id || !snaptrade_account_id || !label) return res.status(400).json({ error: 'owner_id, snaptrade_account_id and label required' })
    const userId = await personalUserId()
    const id = await createAccount({
      owner_id, provider: 'snaptrade', account_type: account_type || 'jisa', label,
      credentials: { userId }, provider_ref: snaptrade_account_id,
    })
    await safeSync()
    const row = (await query('SELECT id, error, synced_at, total_value FROM broker_accounts WHERE id=$1', [id])).rows[0]
    res.json({ id, ...row })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// Connection-portal URL to link a NEW brokerage (when nothing is linked yet).
app.post('/api/snaptrade/connect', async (req, res) => {
  try {
    const s = snaptradeClient()
    const userId = await personalUserId(s)
    const userSecret = (await s.authentication.resetSnapTradeUserSecret({ userId })).data.userSecret
    res.json({ portalUrl: await loginUser(userId, userSecret, s) })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// --- Enrich routes ---

app.post('/api/enrich/ticker', async (req, res) => {
  try {
    const { symbol, ai_thesis, plan_levels } = req.body || {}
    if (!symbol) return res.status(400).json({ error: 'symbol required' })
    if (ai_thesis != null) await setThesis(symbol, ai_thesis)
    if (Array.isArray(plan_levels) && plan_levels.length > 0) await setPlanFromLevels(symbol, plan_levels)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/enrich/event', async (req, res) => {
  try {
    const { event_id, summary, caption, levels } = req.body || {}
    if (!event_id) return res.status(400).json({ error: 'event_id required' })
    await setEventEnrichment(event_id, { summary, caption, levels })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/enrich/pending', async (req, res) => {
  try {
    // Tickers lacking ai_thesis, plus all their events so a backfill agent can
    // fetch one ticker's full material in a single call.
    const tickersRes = await query(
      `SELECT symbol, name, asset_class, status FROM tickers
       WHERE ai_thesis IS NULL ORDER BY updated_at DESC`,
    )
    const tickers = tickersRes.rows
    const result = await Promise.all(
      tickers.map(async (t) => {
        const evRes = await query(
          `SELECT id, source, kind, occurred_at, payload FROM events WHERE ticker=$1
           ORDER BY occurred_at DESC NULLS LAST, id DESC`,
          [t.symbol],
        )
        return { ...t, events: evRes.rows }
      }),
    )
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.use('/media', express.static(MEDIA_DIR))
if (fs.existsSync(path.join(PUBLIC, 'index.html'))) {
  app.use(express.static(PUBLIC))
  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')))
}

// Broker sync runs in-process: once on boot, then every 5 min, whenever there's
// at least one connected account (stored credentials) and an encryption key to
// decrypt them. `syncing` guards against overlapping runs. Each account is
// spaced by its provider's rate limit inside syncAll.
let syncing = false
async function safeSync() {
  if (syncing) return
  syncing = true
  try { return await syncAll() }
  finally { syncing = false }
}

await init()
{
  const { rows } = await query('SELECT count(*)::int AS n FROM broker_accounts WHERE credentials_enc IS NOT NULL')
  const connected = rows[0]?.n || 0
  if (connected > 0 && hasKey()) {
    safeSync().catch((e) => console.error('[brokers] initial sync failed:', e.message))
    setInterval(() => safeSync().catch((e) => console.error('[brokers] sync failed:', e.message)), 5 * 60 * 1000)
    console.log(`[brokers] syncing ${connected} connected account(s) every 5 min`)
  } else if (connected > 0 && !hasKey()) {
    console.warn('[brokers] APP_ENCRYPTION_KEY not set — broker sync disabled')
  }
}
app.listen(PORT, () => console.log(`[trading-hub] http://localhost:${PORT}`))
