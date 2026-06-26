import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import { query } from './db.js'
import { getTicker, listTickers } from './tickers.js'
import { eventsForTicker } from './events.js'
import { chartPath } from './synthesize.js'
import { classify } from './portfolio/classify.js'
import { priceVsPlan } from './price-plan.js'
import { effectivePlan } from './portfolio/effective-plan.js'
import { assessPosture } from './portfolio/posture.js'
import { getQuotes, getHistory } from './price-provider.js'
import { commodityView, getCommodity } from './commodities.js'
import { getHoldings, getFunds } from './brokers/funds.js'
import { getTargets } from './portfolio/targets.js'
import { buildLedger } from './portfolio/ledger.js'
import { computeRotation, BIG6 } from './portfolio/rotation.js'
import { benchmarkSymbol, trailingReturn, bookReturn } from './portfolio/benchmark.js'
import { listAlerts } from './alerts/list.js'
import { createCustomAlert, cancelCustomAlert, setMuted } from './alerts/custom.js'
import { fetchNews, newsReady } from './news.js'
import { computeTickerRisk } from './portfolio/ticker-risk.js'
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, CHAT_MODEL, TRADING, ROOT, HELD_BROKERS } from './config.js'

// Provider is inferred from the model id. gemini-* → Google, else Anthropic.
const isGemini = (model = CHAT_MODEL) => /^gemini/i.test(model)

const r2 = (n) => (n == null || !Number.isFinite(n)) ? null : Math.round(n * 100) / 100
const r1 = (n) => (n == null || !Number.isFinite(n)) ? null : Math.round(n * 10) / 10
const pct = (f) => (f == null || !Number.isFinite(f)) ? 'n/a' : `${(f * 100).toFixed(1)}%`
const signed = (n) => (n == null || !Number.isFinite(n)) ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
const ageDays = (ts) => ts ? Math.round((Date.now() - new Date(ts).getTime()) / 864e5) : null
const today = () => new Date().toISOString().slice(0, 10)

// A content-free acknowledgement / chitchat turn — answer it as such, and DON'T
// drown it in live data + a chart (the bug that made "ok" trigger a re-grade).
const ACK_RE = /^(o?k(ay)?|kk|thx|thanks?|thank you|ty|got it|noted|cool|nice|great|cheers|sure|yep+|yup|yeah|right|fine|sounds good|makes sense|understood|perfect|👍+|🙏+)[.!\s]*$/i
const isAck = (text) => ACK_RE.test(String(text || '').trim())

// ── The "bible": Zero's frameworks, loaded once and held byte-stable ─────────
// Searched in order: an explicit BIBLE_DIR, the local live mirror (dojo-library,
// a gitignored sibling), then the vendored snapshot in-repo (server/reference/
// bible) — so production (where the sibling mirror isn't present) still has it.
const BIBLE_DIRS = [
  process.env.BIBLE_DIR,
  path.join(TRADING, 'dojo-library'),
  path.join(ROOT, 'server', 'reference', 'bible'),
].filter(Boolean)
const BIBLE_FILES = ['ZERO-BIBLE.md', 'INVESTING-MASTERCLASS.md', 'SHARIA-SCREENING.md']
function bibleFile(f) {
  for (const dir of BIBLE_DIRS) {
    const p = path.join(dir, f)
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  }
  return ''
}

const PERSONA = `You are Mansoor's trading study partner inside the Trading Hub dashboard.

You help him understand a ticker and grade setups against the frameworks below. This is
for study, not live execution. Talk like a sharp colleague: answer the actual question he
asked, be concise, and build on the conversation. Use whichever context is relevant — you
don't have to mention every field. Don't restate things he already has on screen. When he
just acknowledges ("ok", "thanks", "got it"), a one-line reply is plenty — don't relaunch
the analysis.

Hard rules (Mansoor's, non-negotiable):
- Spot only. Leverage, CFDs and futures are haram — never recommend them. Gold/silver via
  a physical-backed ETC, never a swap/CFD.
- Sizing: position = risk ÷ stop-distance, R:R ≥ 2:1, risk-per-trade HTF 3% / MTF 2% /
  LTF 1%. Holds are built by DCA, not a single risk-sized entry.
- Never invent a price or level. If the data says a value is unavailable, or no plan is
  confirmed, say so plainly rather than guessing.
- Grading a setup → use the bible's §20 scorecard and give a clear verdict. Sizings are
  educational, from his own model weights — remind him to verify on his broker.

Alerts — you can act, not just talk:
- You have tools: show_alerts (renders an INTERACTIVE widget), set_alert (custom one-shot
  price-cross), cancel_alert, mute_alert (silence a ticker's plan alerts).
- When he wants to see or change alerts, CALL THE TOOL — don't describe alerts in prose.
  The widget he gets is interactive (cancel/mute/add buttons), so after a tool runs add
  only a short takeaway or next step; never re-list the widget's contents as text.
- A "custom" alert is a free-standing price level (e.g. "MSTR above 350"). Plan alerts are
  derived from the ticker's synthesis plan; you mute/unmute those rather than set them.
- Before set_alert, make sure the ticker, direction (above/below) and price match what he
  asked. If he just says "alert me at 350" on this ticker, infer the direction from where
  price is now relative to 350.

News & sentiment — go to the web, don't guess:
- get_news pulls CURRENT headlines + sentiment from the web. Your training data is stale,
  so for ANYTHING time-sensitive — "what's the news", "why is it moving", sentiment,
  catalysts, earnings, analyst views — CALL get_news rather than answering from memory.
- After it returns, don't just relay headlines: read them through the frameworks — does the
  news support or threaten the thesis/plan? Is sentiment confirming the setup or fading it?
  Cite which specific catalyst matters. The source links are shown to him in a widget.

Charts — you usually do NOT need the image:
- The synthesis already digested the charts into the plan, levels, structure and stance you
  have in context. For grading, market structure, or "where's price vs the levels", reason
  from that TEXT — it's more precise than re-reading pixels.
- Call get_chart ONLY when there is NO synthesis yet, or he explicitly asks about the visual
  ("show me the chart", "what's that wick"). It attaches the image for you and shows it to him.`

let _bible = null
function bible() {
  if (_bible) return _bible
  const parts = BIBLE_FILES.map((f) => {
    const txt = bibleFile(f)
    return txt ? `\n\n===== ${f} =====\n\n${txt}` : ''
  })
  _bible = `${PERSONA}\n\n# REFERENCE LIBRARY (the bible)\n${parts.join('')}`
  return _bible
}

// ── Reconciled plan ──────────────────────────────────────────────────────────
// The bug codex caught: the manual plan columns can be empty while the synthesis
// carries a real safest_plan, so the STATE block said "no_plan" while the sizing
// block used entry/stop/targets. One source of truth: prefer the manual plan; fall
// back to the synthesis candidate. Labelled so the agent knows which it is.
const planLine = (p) => !p ? 'none defined'
  : `entry ${p.buyLow === p.buyHigh ? (p.buyLow ?? '?') : `${p.buyLow ?? '?'}–${p.buyHigh ?? '?'}`}, invalidation ${p.invalidation ?? '?'}, targets ${(p.targets || []).join(' / ') || '?'} [${p.source}]`

// ── Per-ticker context: stable within a session (CACHED) ─────────────────────
function chatSources(events) {
  return (events || []).map((e) => {
    const p = e.payload || {}
    return {
      source: e.source, kind: e.kind,
      at: e.occurred_at ? new Date(e.occurred_at).toISOString().slice(0, 16).replace('T', ' ') : null,
      text: p.text || null, note: p.note || null, caption: p.caption || null,
      entry: p.entry || null, targets: (p.targets || []).filter(Boolean), invalidation: p.invalidation || null,
      grade: p.grade_score ?? null, grade_verdict: p.grade_verdict || null,
      author: p.author?.handle || p.author?.name || (typeof p.author === 'string' ? p.author : null),
      url: p.url || null, has_chart: !!p.chart,
    }
  }).filter((v) => v.text || v.note || v.caption || v.entry || v.targets.length || v.invalidation || v.grade != null || v.has_chart)
}

export function tickerContext(ticker, events) {
  const c = classify(ticker)
  const ctx = {
    symbol: ticker.symbol, name: ticker.name, asset_class: ticker.asset_class, status: ticker.status,
    pinned: ticker.pinned ?? false,
    first_seen: ticker.first_seen ? new Date(ticker.first_seen).toISOString().slice(0, 10) : null,
    classification: c, // { layer, role, bucket, theme, pyramidTier, coreType }
    manual_plan: { entry_zone: ticker.entry_zone, ladder: ticker.ladder, targets: ticker.targets, invalidation: ticker.invalidation, thesis: ticker.thesis },
    synthesis: ticker.synthesis || null,
    sharia: { status: ticker.sharia_status || null, note: ticker.sharia_note || null, source: ticker.sharia_source || null, screen: ticker.sharia_screen || null },
    top_grade: ticker.top_grade ?? null, top_grade_verdict: ticker.top_grade_verdict || null,
    ai_thesis: ticker.ai_thesis || null,
    sources: chatSources(events).slice(0, 8), // most-recent 8; full set is on the page
  }
  return `# TICKER CONTEXT — ${ticker.symbol} (reference; the live DECISION PACKET reconciles the plan)\n\n` +
    '```json\n' + JSON.stringify(ctx, null, 2) + '\n```'
}

// ── Live blocks: volatile, NOT cached ────────────────────────────────────────
function historyDigest(bars) {
  const closes = (bars || []).map((b) => b.c).filter((c) => c != null)
  if (closes.length < 2) return null
  const last = closes[closes.length - 1]
  const at = (n) => closes[Math.max(0, closes.length - 1 - n)]
  const pc = (from) => from ? r1(((last - from) / from) * 100) : null
  return {
    last_close: r2(last), as_of: new Date(bars[bars.length - 1].t).toISOString().slice(0, 10), bars: closes.length,
    range: { low: r2(Math.min(...closes)), high: r2(Math.max(...closes)) },
    change_pct: { m1: pc(at(21)), m3: pc(at(63)), y1: pc(at(252)) },
  }
}

// The derived "read this first" summary codex asked for: intent already resolved
// (acks never reach here), the reconciled plan, current state, and the synthesis
// stance — so the model orients before wading through raw blocks.
function decisionPacket({ ticker, price, plan, state }) {
  const syn = ticker.synthesis
  const L = ['# DECISION PACKET — derived, read first']
  L.push(`Effective plan: ${planLine(plan)}.`)
  L.push(`Price-vs-plan: ${state}${price != null ? ` (live ${r2(price)})` : ' (no live price)'}.`)
  if (syn?.action) L.push(`Synthesis stance: ${syn.action}${syn.conviction != null ? `, conviction ${syn.conviction}/10` : ''}${syn.contested ? ', CONTESTED' : ''}.`)
  if (syn?.plain_english) L.push(`Synthesis basis: ${syn.plain_english}`)
  return L.join('\n')
}

function marketBlock({ symbol, price, changePct, history, commodity, holding }) {
  const L = ['# MARKET']
  L.push(price != null
    ? `Price ${r2(price)}${changePct != null ? ` (${changePct >= 0 ? '+' : ''}${r2(changePct)}% today)` : ''}`
    : 'Price: unavailable from market data — do not state a current price.')
  if (commodity) {
    const sel = (commodity.vehicles || []).find((v) => v.ticker === commodity.selected)
    L.push(`Commodity. Spot (${commodity.reference_symbol}) = ${r2(commodity.spot) ?? 'n/a'}; halal vehicle ${sel ? `${commodity.selected} ETC @ ${r2(sel.price) ?? 'n/a'}${commodity.ratio ? `, ETC/spot ${commodity.ratio.toFixed(4)}` : ''}` : (commodity.investable === false ? `none (${commodity.no_vehicle_note || 'avoid'})` : 'n/a')}. Plan levels are in SPOT terms.`)
  }
  if (history) L.push('History (daily closes): ' + JSON.stringify(history))
  L.push(holding
    ? `Position: ${r2(holding.quantity)} @ avg ${r2(holding.avgPrice)}, value £${r2(holding.value)}, P&L £${r2(holding.pnl)} (${holding.accounts.join(', ')}).`
    : 'Position: none held.')
  return L.join('\n')
}

function stateBlock({ ticker, alert }) {
  const L = ['# STATE & RECENCY', `Today ${today()}.`]
  const sa = ageDays(ticker.synth_at), sca = ageDays(ticker.sharia_screen_at)
  if (sa != null) L.push(`Synthesis ${sa}d old${sa > 14 ? ' — STALE, may be worth a re-run' : ''}.`)
  if (sca != null) L.push(`Sharia screen ${sca}d old.`)
  if (alert) L.push(`Alert: ${alert.state}${alert.last_transition ? ` · last ${alert.last_transition}` : ''}${alert.last_fired_at ? ` · fired ${String(alert.last_fired_at).slice(0, 10)}` : ''}.`)
  return L.length > 2 ? L.join('\n') : ''
}

function portfolioBlock(memo, ticker) {
  if (!memo?.led) return ''
  const { led, regime, favorTiers, benchmark, bookReturnPct } = memo
  const c = classify(ticker)
  const L = ['# PORTFOLIO']
  L.push(`Regime ${regime || 'unknown'}${favorTiers?.length ? ` (favour ${favorTiers.join('/')})` : ''}. Deployed ${pct(led.deployedPct)} · dry powder ${pct(led.dryPowderPct)} · open risk £${r2(led.openRisk)}${led.bookValue ? ` (${pct(led.openRisk / led.bookValue)} of book)` : ''}.`)
  if (benchmark) L.push(`Benchmark ${benchmark.label || '?'} ${benchmark.return1y != null ? signed(benchmark.return1y * 100) + '% 1y' : 'n/a'} · book ${bookReturnPct != null ? signed(bookReturnPct * 100) + '%' : 'n/a'}.`)
  const peers = (led.rows || []).filter((r) => r.symbol !== ticker.symbol && r.currentPct > 0 && (r.tier === c.pyramidTier || (c.theme && r.theme === c.theme)))
  if (peers.length) L.push(`Already in this ${c.theme ? 'theme/' : ''}tier (${c.pyramidTier}): ${peers.map((r) => `${r.symbol} ${pct(r.currentPct)}`).join(', ')}.`)
  const gaps = (led.coreCoverage || []).filter((cc) => cc.needsBuy).map((g) => g.coreType)
  if (gaps.length) L.push(`Core coverage thin: ${gaps.join(', ')}.`)
  return L.join('\n')
}

function accountBlock(risk, holding, actionable = true) {
  const cls = risk.classification || {}
  const L = ['# YOUR ACCOUNT', `Book ${risk.book}: total £${r2(risk.bookValue)} · cash/dry powder £${r2(risk.cash)}.`]
  const heldGbp = holding ? (r2(holding.value) ?? 0) : 0
  if (cls.layer === 'trade' && risk.trade) {
    L.push(`Sizing (TRADE = risk ÷ stop, capped by picks budget)${actionable ? '' : ' — HYPOTHETICAL: what the position WOULD be once the setup confirms. The current stance is wait / not-confirmed, so this is NOT a go-signal — do not present it as "enter X now"'}: ` + JSON.stringify(risk.trade))
  } else if (risk.hold) {
    const p = risk.hold.targetPct
    const tgt = p != null ? r2(risk.bookValue * p) : null
    L.push(`Sizing (HOLD, DCA): target ${p != null ? (p * 100).toFixed(1) + '% ≈ £' + tgt : 'n/a'}; held £${heldGbp}; headroom £${tgt != null ? r2(tgt - heldGbp) : 'n/a'}.`)
  }
  return L.join('\n')
}

// Book-wide ledger + regime + benchmark, memoised 60s. Best-effort.
let _ledgerMemo = null
async function bookLedger() {
  if (_ledgerMemo && Date.now() - _ledgerMemo.at < 60_000) return _ledgerMemo
  const riskOwner = (await query('SELECT id, relationship FROM owners', [])).rows
    .find((o) => (o.relationship === 'child' ? 'kids' : 'personal') === 'personal')
  const targets = await getTargets(riskOwner?.id ?? 'personal', { relationship: 'self' })
  const [funds, holdings, tickers] = await Promise.all([getFunds({ book: 'personal' }), getHoldings({ book: 'personal' }), listTickers()])
  let regime = 'unknown', favorTiers = []
  try {
    const closes = {}
    await Promise.all(BIG6.map(async (s) => { const bars = await getHistory(s, 'stock'); closes[s] = (bars || []).map((b) => b.c).filter((c) => c != null) }))
    const rot = computeRotation(closes, { lookback: 20 }); regime = rot.regime; favorTiers = rot.favorTiers
  } catch { /* regime best-effort */ }
  const led = buildLedger({ book: 'personal', targets, holdings, tickers, bookValue: funds.totalValue, regime })
  let benchmark = null
  try {
    const sym = benchmarkSymbol(targets.benchmark)
    const bars = sym ? await getHistory(sym, 'stock') : null
    benchmark = { label: targets.benchmark, return1y: bars ? trailingReturn(bars.map((b) => b.c).filter((c) => c != null), 252) : null }
  } catch { /* benchmark best-effort */ }
  _ledgerMemo = { at: Date.now(), led, regime, favorTiers, benchmark, bookReturnPct: bookReturn(funds) }
  return _ledgerMemo
}

// Assemble all live (uncached) blocks — only called for substantive turns.
async function buildLive(ticker) {
  const symbol = ticker.symbol
  const isCommodity = String(ticker.asset_class || '').toLowerCase() === 'commodity' && ticker.commodity_key
  let price = null, changePct = null, commodity = null, history = null, holding = null, alert = null, risk = null, memo = null
  try {
    if (isCommodity) { commodity = await commodityView(ticker, { getQuotes, heldBrokers: HELD_BROKERS }); price = commodity?.spot ?? null }
    else { const q = (await getQuotes([{ ticker: symbol, asset_class: ticker.asset_class, symbol: ticker.quote_symbol || undefined }]))[symbol]; price = q?.price ?? null; changePct = q?.changePct ?? null }
  } catch { /* price best-effort */ }
  try {
    const refSym = isCommodity ? getCommodity(ticker.commodity_key)?.reference_symbol : undefined
    history = historyDigest(await getHistory(symbol, ticker.asset_class, { symbol: refSym }))
  } catch { /* history best-effort */ }
  try {
    const mine = (await getHoldings({ book: 'personal' })).filter((h) => h.ticker === symbol)
    if (mine.length) {
      const quantity = mine.reduce((t, h) => t + (h.quantity || 0), 0)
      const cost = mine.reduce((t, h) => t + (h.avgPrice || 0) * (h.quantity || 0), 0)
      holding = { quantity, avgPrice: quantity ? cost / quantity : null, value: mine.reduce((t, h) => t + (h.value || 0), 0), pnl: mine.reduce((t, h) => t + (h.pnl || 0), 0), accounts: [...new Set(mine.map((h) => h.accountLabel))] }
    }
  } catch { /* holdings best-effort */ }
  try { alert = (await listAlerts()).armed?.find((a) => a.symbol === symbol) || null } catch { /* alerts best-effort */ }
  try { risk = await computeTickerRisk(symbol, { book: 'personal' }) } catch { /* risk best-effort */ }
  try { memo = await bookLedger() } catch { /* portfolio best-effort */ }

  const plan = effectivePlan(ticker)
  const state = priceVsPlan(price, plan)
  // A trade is only "go-able" when the synthesis says enter, it isn't contested,
  // and price is actually in the zone — otherwise sizing is hypothetical.
  const syn = ticker.synthesis
  const actionable = syn?.action === 'enter' && !syn?.contested && state === 'in_buy'
  return [
    decisionPacket({ ticker, price, plan, state }),
    marketBlock({ symbol, price, changePct, history, commodity, holding }),
    stateBlock({ ticker, alert }),
    portfolioBlock(memo, ticker),
    risk ? accountBlock(risk, holding, actionable) : '',
  ].filter(Boolean).join('\n\n')
}

function chartImage(events) {
  const ev = (events || []).find((e) => e.payload?.chart)
  if (!ev) return null
  try {
    const abs = chartPath(ev.payload.chart, ROOT)
    if (!abs || !fs.existsSync(abs)) return null
    const ext = path.extname(abs).toLowerCase()
    const mediaType = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : null
    if (!mediaType) return null
    const data = fs.readFileSync(abs, 'base64')
    if (data.length > 7_000_000) return null
    return { mediaType, data, caption: ev.payload.caption || null, source: ev.source }
  } catch { return null }
}

// The latest chart for the get_chart tool: base64 (for the model to READ) + a URL
// (for the UI widget to SHOW). Null when the ticker has no chart on file.
function chartInfo(events) {
  const ev = (events || []).find((e) => e.payload?.chart)
  if (!ev) return null
  return { image: chartImage(events), url: '/' + ev.payload.chart, caption: ev.payload.caption || null, source: ev.source }
}

// ── Normalised usage + pricing ───────────────────────────────────────────────
const normAnthropic = (u = {}) => ({ cached: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0, input: u.input_tokens || 0, output: u.output_tokens || 0 })
const normGemini = (u = {}) => ({ cached: u.cachedContentTokenCount || 0, write: 0, input: Math.max(0, (u.promptTokenCount || 0) - (u.cachedContentTokenCount || 0)), output: u.candidatesTokenCount || 0 })

const PRICING = {
  'claude-opus-4-8': { in: 5, out: 25, write: 10, read: 0.5 },
  'claude-opus-4-7': { in: 5, out: 25, write: 10, read: 0.5 },
  'claude-sonnet-4-6': { in: 3, out: 15, write: 6, read: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, write: 2, read: 0.1 },
  'gemini-2.5-pro': { in: 1.25, out: 10, write: 0, read: 0.3125 },
  'gemini-2.5-flash': { in: 0.30, out: 2.50, write: 0, read: 0.075 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40, write: 0, read: 0.025 },
}
function costOf(model, u = {}) {
  const p = PRICING[model] || PRICING['claude-opus-4-8']
  return ((u.input || 0) * p.in + (u.output || 0) * p.out + (u.write || 0) * p.write + (u.cached || 0) * p.read) / 1e6
}

let _anthropic, _genai
const anthropic = () => (_anthropic ??= ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null)
const genai = () => (_genai ??= GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null)

export function missingKey() {
  if (isGemini()) return GEMINI_API_KEY ? null : 'GEMINI_API_KEY'
  return ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY'
}
export const chatReady = () => missingKey() === null

const MAX_TURNS = 24
const OUTPUT_TOKENS = 8192
const MAX_TOOL_ITERS = 4 // cap the agentic loop per turn (cost + runaway guard)

// ── Tools (generative UI) ────────────────────────────────────────────────────
// Defined once, provider-agnostically (parameters = JSON-Schema). A tool call is
// the widget trigger: the server runs it, streams a `widget` event to the UI with
// the rich data, and feeds the model only a COMPACT summary back — so the loop
// stays cheap and the widget JSON never re-enters the model context. The tool set
// is per-SCOPE (ticker vs portfolio); the agent loop + runTool dispatch are shared.
const TICKER_TOOLS = [
  {
    name: 'show_alerts',
    description: "Show Mansoor his alerts as an interactive widget (NOT text). Use whenever he asks to see / review / list / check alerts. DEFAULTS to the CURRENT ticker — a bare 'show me the alerts' means THIS ticker, so leave symbol empty and it scopes to the one he's viewing. Pass a different symbol to focus that ticker, or all=true only when he explicitly wants every ticker's alerts.",
    parameters: { type: 'object', properties: {
      symbol: { type: 'string', description: 'ticker to focus; omit to use the current ticker' },
      all: { type: 'boolean', description: 'true ONLY when he asks for every ticker / all alerts' },
    } },
  },
  {
    name: 'set_alert',
    description: "Create a custom one-shot price-cross alert (e.g. 'alert me when MSTR hits 350'). Fires once when the live price crosses `price` in `direction`, delivered via Telegram. Defaults symbol to the current ticker if omitted.",
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ticker, e.g. MSTR (defaults to the current ticker)' },
        direction: { type: 'string', enum: ['above', 'below'], description: 'above = fire when price rises to/above; below = fire when price falls to/below' },
        price: { type: 'number', description: 'the trigger price' },
        note: { type: 'string', description: 'optional short reminder shown with the alert' },
      },
      required: ['direction', 'price'],
    },
  },
  {
    name: 'cancel_alert',
    description: 'Cancel a custom price-cross alert by its id (shown in the alerts widget). Use when he asks to remove/delete/cancel a specific alert.',
    parameters: { type: 'object', properties: { id: { type: 'number', description: 'the custom alert id' } }, required: ['id'] },
  },
  {
    name: 'mute_alert',
    description: "Mute or unmute the plan-derived alerts for a ticker (stays on the list but won't fire Telegram). Does NOT affect custom alerts. Defaults symbol to the current ticker.",
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ticker (defaults to the current ticker)' },
        muted: { type: 'boolean', description: 'true to mute, false to unmute' },
      },
      required: ['muted'],
    },
  },
  {
    name: 'get_news',
    description: "Fetch CURRENT real-world news + market sentiment for a ticker from the web. Use whenever he asks about news, headlines, sentiment, catalysts, earnings, analyst views, or WHY a stock is moving ('what's the news on X', 'why is it dropping', 'any bearish catalysts'). Your training data is stale — always call this for anything time-sensitive rather than guessing. Defaults to the current ticker.",
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ticker (defaults to the current ticker)' },
        query: { type: 'string', description: "optional angle to focus on, e.g. 'bearish catalysts', 'earnings', 'why is it falling', 'analyst ratings'" },
        recency: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: "news window; default 'month'. Use 'day'/'week' for a fast-moving story." },
      },
    },
  },
  {
    name: 'get_chart',
    description: "Load the latest chart IMAGE for visual analysis + show it to him. Use ONLY when (a) the ticker has NO synthesis yet (nothing has digested the chart), or (b) he explicitly asks about the visual ('show me the chart', 'what's that wick', 'draw the levels'). For normal grading / structure / 'price vs levels' questions the synthesis text already encodes the chart read MORE precisely than re-reading pixels — do NOT pull the image for those.",
    parameters: { type: 'object', properties: { reason: { type: 'string', description: 'why the image is needed (no synthesis, or an explicit visual question)' } } },
  },
]

// Portfolio-scope tools: the shortlist widget + drill-down, plus the shared
// news/chart/alert tools (symbol passed explicitly — there's no "current ticker").
const PORTFOLIO_TOOLS = [
  {
    name: 'present_tickers',
    description: "Render a clickable shortlist of tickers as a widget — each card opens that ticker. Use this whenever you name 2+ tickers (standouts, at-risk trades, or his holdings) INSTEAD of a prose list.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'short heading, e.g. "Standouts", "At risk", "Your positions"' },
        items: {
          type: 'array',
          description: 'the tickers, most important first',
          items: { type: 'object', properties: { symbol: { type: 'string' }, headline: { type: 'string', description: 'one-line reason this ticker is on the list' } }, required: ['symbol'] },
        },
      },
      required: ['title', 'items'],
    },
  },
  {
    name: 'get_ticker_detail',
    description: "Pull ONE ticker's full context (synthesis, plan, thesis, recent sources) to dig in before judging it. Use when the roster line isn't enough to decide.",
    parameters: { type: 'object', properties: { symbol: { type: 'string', description: 'the ticker to inspect' } }, required: ['symbol'] },
  },
  TICKER_TOOLS.find((t) => t.name === 'get_news'),
  TICKER_TOOLS.find((t) => t.name === 'get_chart'),
  TICKER_TOOLS.find((t) => t.name === 'show_alerts'),
  TICKER_TOOLS.find((t) => t.name === 'set_alert'),
  TICKER_TOOLS.find((t) => t.name === 'cancel_alert'),
  TICKER_TOOLS.find((t) => t.name === 'mute_alert'),
]

// Provider-specific tool shapes from a provider-agnostic tool list.
const geminiToolcfg = (tools) => [{ functionDeclarations: tools }]
const claudeToolset = (tools) => tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))

function alertsSummary(data, focus, prefix) {
  if (focus) {
    // Scoped view: report only this ticker's situation so the model's takeaway
    // is about the ticker he's on, not the whole book.
    const custom = (data.custom || []).filter((a) => a.symbol === focus).length
    const armedRow = (data.armed || []).find((a) => a.symbol === focus)
    const plan = armedRow ? `plan-armed (${armedRow.state}${armedRow.muted ? ', muted' : ''})` : 'not plan-armed'
    const none = !custom && !armedRow
    return `${prefix} scoped to ${focus}: ${custom} custom alert(s), ${plan}. The widget shows ONLY ${focus}${none ? ` — he has no alerts on ${focus} yet; offer to set one` : ''}. Don't re-list it; add a brief takeaway or next step.`
  }
  const custom = data.custom?.length || 0
  const armed = data.armed?.length || 0
  const fires = data.recent?.length || 0
  return `${prefix} (all tickers): ${custom} custom alert(s), ${armed} plan-armed ticker(s), ${fires} recent fire(s) — now visible as an interactive widget. Don't re-list its contents; add only a brief takeaway or next step.`
}

// Execute one tool call. Returns { summary (for the model), widget (for the UI) }.
// Never throws — a failure is reported back to the model as text so the stream
// survives and the agent can relay/repair it.
async function runTool(name, args = {}, ctx = {}) {
  const { symbol, events, roster } = ctx
  try {
    if (name === 'present_tickers') {
      const items = (args.items || []).map((it) => {
        const sym = String(it.symbol || '').toUpperCase()
        const r = roster?.get(sym)
        return { symbol: sym, headline: it.headline || null, status: r?.status || null, state: r?.state || null, grade: r?.grade ?? null, price: r?.price ?? null, changePct: r?.changePct ?? null, held: r?.held || null }
      }).filter((x) => x.symbol)
      if (!items.length) return { summary: 'No valid tickers to present.' }
      return { widget: { widget: 'shortlist', data: { title: args.title || 'Tickers', items } }, summary: `Rendered a clickable shortlist "${args.title || 'Tickers'}" (${items.length}): ${items.map((i) => i.symbol).join(', ')}. He can click any card to open it. Add a one-line takeaway — don't re-list them.` }
    }
    if (name === 'get_ticker_detail') {
      const sym = String(args.symbol || '').toUpperCase()
      const t = await getTicker(sym)
      if (!t) return { summary: `No ticker ${sym} in the Hub.` }
      const evs = await eventsForTicker(sym)
      return { summary: `Full context for ${sym}:\n\n${tickerContext(t, evs)}` }
    }
    if (name === 'show_alerts') {
      // Bare "show alerts" in a ticker chat scopes to that ticker; all=true (or
      // portfolio scope, where symbol is undefined) opens the full book.
      const focus = args.all ? null : (String(args.symbol || '').toUpperCase() || symbol || null)
      const data = await listAlerts()
      return { widget: { widget: 'alerts', focus, data }, summary: alertsSummary(data, focus, 'Showed the alerts widget') }
    }
    if (name === 'set_alert') {
      const a = await createCustomAlert({ symbol: args.symbol || symbol, direction: args.direction, price: args.price, note: args.note, createdBy: 'chat' })
      const data = await listAlerts()
      return { widget: { widget: 'alerts', focus: a.symbol, data }, summary: `Created custom alert #${a.id}: ${a.symbol} ${a.direction} ${a.price}${a.note ? ` (${a.note})` : ''}. Widget refreshed — confirm it briefly.` }
    }
    if (name === 'cancel_alert') {
      const ok = await cancelCustomAlert(args.id)
      const data = await listAlerts()
      return { widget: { widget: 'alerts', data }, summary: ok ? `Cancelled custom alert #${args.id}. Widget refreshed.` : `No active custom alert with id ${args.id} — tell him so.` }
    }
    if (name === 'mute_alert') {
      const out = await setMuted(args.symbol || symbol, args.muted !== false)
      const data = await listAlerts()
      return { widget: { widget: 'alerts', focus: out.symbol, data }, summary: `${out.muted ? 'Muted' : 'Unmuted'} plan alerts for ${out.symbol}. Widget refreshed.` }
    }
    if (name === 'get_news') {
      const sym = String(args.symbol || symbol || '').toUpperCase()
      const t = await getTicker(sym)
      const news = await fetchNews({ symbol: sym, name: t?.name, query: args.query, recency: args.recency })
      const srcList = news.sources.map((s) => s.title).filter(Boolean).slice(0, 6).join('; ')
      const summary = [
        `Web news for ${sym}${news.query ? ` (focus: ${news.query})` : ''} — sentiment: ${news.sentiment || 'unclear'}.`,
        news.summary,
        srcList ? `Sources: ${srcList}.` : '',
        'A news widget with these source links is now shown to him. Reframe this through Zero\'s lens — what it means for the setup, the thesis and sentiment — be specific about which catalyst matters; don\'t just repeat the headlines.',
      ].filter(Boolean).join('\n\n')
      return { widget: { widget: 'news', data: news }, summary }
    }
    if (name === 'get_chart') {
      const sym = String(args.symbol || symbol || '').toUpperCase()
      // Ticker scope preloads events for the current symbol; otherwise fetch them.
      const evs = (events && (!args.symbol || sym === symbol)) ? events : await eventsForTicker(sym)
      const info = chartInfo(evs)
      if (!info) return { summary: `No chart on file for ${sym} — reason from the synthesis text instead.` }
      const widget = { widget: 'chart', data: { symbol: sym, url: info.url, caption: info.caption, source: info.source } }
      if (!info.image) return { widget, summary: `Showed ${sym}'s chart to him (couldn't load the image for your own analysis).` }
      return { widget, image: info.image, summary: `Chart for ${sym} (source ${info.source}${info.caption ? `, "${info.caption}"` : ''}) is now attached for you to read AND shown to him. Describe what it adds beyond the synthesis.` }
    }
    return { summary: `Unknown tool ${name}.` }
  } catch (e) {
    return { summary: `Tool ${name} failed: ${e.message}. Relay this to him plainly.` }
  }
}

function cleanMessages(messages = []) {
  let m = (messages || [])
    .filter((x) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string' && x.content.trim())
    .map((x) => ({ role: x.role, content: x.content }))
  if (m.length > MAX_TURNS) m = m.slice(-MAX_TURNS)
  while (m.length && m[0].role !== 'user') m.shift()
  return m
}

// ── Anthropic path ───────────────────────────────────────────────────────────
function claudeMessages(turns, image) {
  return turns.map((m, i) => {
    if (image && m.role === 'user' && i === turns.length - 1) {
      return { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }, { type: 'text', text: m.content }] }
    }
    return m
  })
}

async function claudeAgent({ scope, turns, onText, onEvent, signal }) {
  const client = anthropic()
  const system = [
    { type: 'text', text: bible(), cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: scope.context, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ]
  if (scope.live) system.push({ type: 'text', text: scope.live }) // only on substantive turns
  const tools = claudeToolset(scope.tools)
  const messages = claudeMessages(turns) // no auto-image — get_chart attaches it on demand
  const acc = { cached: 0, write: 0, input: 0, output: 0 }
  let truncated = false
  // Agentic loop: stream → if the model asked for tools, run them, feed results
  // back, and let it continue; otherwise stop. Capped at MAX_TOOL_ITERS.
  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const stream = client.messages.stream({
      model: CHAT_MODEL, max_tokens: OUTPUT_TOKENS, output_config: { effort: 'medium' },
      system, tools, messages,
    }, signal ? { signal } : undefined)
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text)
    }
    const final = await stream.finalMessage()
    const u = normAnthropic(final.usage)
    acc.cached += u.cached; acc.write += u.write; acc.input += u.input; acc.output += u.output
    if (signal?.aborted) break
    if (final.stop_reason !== 'tool_use') { truncated = final.stop_reason === 'max_tokens'; break }
    const toolUses = final.content.filter((b) => b.type === 'tool_use')
    messages.push({ role: 'assistant', content: final.content })
    const results = []
    for (const tu of toolUses) {
      const { summary, widget, image } = await runTool(tu.name, tu.input || {}, scope.ctx)
      if (widget) onEvent?.(widget)
      // get_chart returns an image — Claude tool_result content can carry it inline.
      const content = image
        ? [{ type: 'text', text: summary }, { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }]
        : summary
      results.push({ type: 'tool_result', tool_use_id: tu.id, content })
    }
    messages.push({ role: 'user', content: results })
  }
  return { ...acc, truncated }
}

// ── Gemini path ──────────────────────────────────────────────────────────────
// Bible in one shared explicit CachedContent. Ticker context is its own turn
// (implicit-cacheable). Live data, when present, is a SEPARATE labelled context
// turn — never glued onto the user's words — so an "ok" stays "ok".
const bibleCacheStore = new Map() // model -> Promise<{ name, exp }>
async function bibleCacheName(ai, model) {
  const hit = bibleCacheStore.get(model)
  if (hit) {
    const resolved = await hit.catch(() => null)
    if (resolved && resolved.exp > Date.now() + 60_000) return resolved.name
    bibleCacheStore.delete(model)
  }
  const p = (async () => {
    const c = await ai.caches.create({ model, config: { systemInstruction: bible(), ttl: '3600s' } })
    return { name: c.name, exp: Date.now() + 3600_000 }
  })()
  bibleCacheStore.set(model, p)
  try { return (await p).name }
  catch (e) { bibleCacheStore.delete(model); console.warn(`gemini bible cache create failed, inline fallback: ${e.message}`); return null }
}

function geminiContents({ context, live, turns, label }) {
  const convo = turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const lastIdx = convo.length - 1
  const prior = convo.slice(0, lastIdx)
  const liveTurns = live ? [
    { role: 'user', parts: [{ text: '# LIVE DATA for this turn (context — NOT a new request)\n\n' + live }] },
    { role: 'model', parts: [{ text: 'Noted the live data; ready for your message.' }] },
  ] : []
  return [
    { role: 'user', parts: [{ text: context }] },
    { role: 'model', parts: [{ text: `Loaded ${label}.` }] },
    ...prior, ...liveTurns,
    { role: 'user', parts: [{ text: turns[lastIdx].content }] }, // the user's actual words, clean
  ]
}

async function geminiAgent({ scope, turns, onText, onEvent, signal }) {
  const ai = genai()
  const contents = geminiContents({ context: scope.context, live: scope.live, turns, label: scope.label }) // no auto-image — get_chart attaches it
  const base = { maxOutputTokens: OUTPUT_TOKENS, abortSignal: signal, tools: geminiToolcfg(scope.tools) }
  if (/flash/i.test(CHAT_MODEL)) base.thinkingConfig = { thinkingBudget: 0 } // flash: snappy; pro keeps thinking on
  // Resolve the bible system once (explicit cache, else inline) and reuse it for
  // every loop iteration. `cacheName` drops to inline if the cache errors.
  let cacheName = null
  try { cacheName = await bibleCacheName(ai, CHAT_MODEL) } catch { cacheName = null }
  const mkConfig = () => {
    const config = { ...base }
    if (cacheName) config.cachedContent = cacheName
    else config.systemInstruction = bible()
    return config
  }
  const open = async () => {
    try { return await ai.models.generateContentStream({ model: CHAT_MODEL, contents, config: mkConfig() }) }
    catch (e) {
      if (cacheName && /cach/i.test(String(e?.message))) { bibleCacheStore.delete(CHAT_MODEL); cacheName = null; return ai.models.generateContentStream({ model: CHAT_MODEL, contents, config: mkConfig() }) }
      throw e
    }
  }
  const acc = { cached: 0, write: 0, input: 0, output: 0 }
  let truncated = false
  // Agentic loop: stream → collect any functionCalls → run them, append the
  // model turn + our functionResponses → continue. Capped at MAX_TOOL_ITERS.
  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const stream = await open()
    const calls = []
    let usage = null
    for await (const chunk of stream) {
      if (signal?.aborted) break
      if (chunk.text) onText(chunk.text)
      for (const p of chunk.candidates?.[0]?.content?.parts || []) if (p.functionCall) calls.push(p.functionCall)
      if (chunk.candidates?.[0]?.finishReason === 'MAX_TOKENS') truncated = true
      if (chunk.usageMetadata) usage = chunk.usageMetadata
    }
    const u = normGemini(usage)
    acc.cached += u.cached; acc.write += u.write; acc.input += u.input; acc.output += u.output
    if (signal?.aborted || !calls.length) break
    contents.push({ role: 'model', parts: calls.map((c) => ({ functionCall: c })) })
    const responses = []
    const images = []
    for (const c of calls) {
      const { summary, widget, image } = await runTool(c.name, c.args || {}, scope.ctx)
      if (widget) onEvent?.(widget)
      responses.push({ functionResponse: { name: c.name, response: { result: summary } } })
      if (image) images.push(image)
    }
    contents.push({ role: 'user', parts: responses })
    // get_chart image: Gemini functionResponses can't carry bytes, so feed it as a
    // following user part for the model to read on the next iteration.
    if (images.length) contents.push({ role: 'user', parts: images.map((im) => ({ inlineData: { mimeType: im.mediaType, data: im.data } })) })
  }
  return { ...acc, truncated }
}

// ── Portfolio scope ──────────────────────────────────────────────────────────
const PORTFOLIO_STATUSES = ['new', 'watching', 'in']

const PORTFOLIO_CONTEXT = `# PORTFOLIO MODE
You're looking at Mansoor's WHOLE pipeline — new candidates, watchlist, and held positions — NOT a single ticker. Each turn you get a live PORTFOLIO ROSTER grouped by status, with every name's price, layer, grade, synthesis stance, Sharia and any holding.

## TRADE vs HOLD — read this before flagging anything
Every row is tagged TRADE or HOLD. They are managed completely differently:
- **TRADE** (layer=trade): an active setup managed by a plan — entry, invalidation/stop, targets. Risk = price at/near invalidation, or a trade with NO plan levels defined. A "state" is shown (in_buy, below_buy, near_target, drifting, past_invalidation, no_plan).
- **HOLD** (layer=hold): a long-term allocation position — core/satellite ETFs, crypto/commodity holds. A hold has NO entry/stop plan BY DESIGN; it is sized by allocation, not by a stop. **NEVER flag a HOLD as "at risk" or "no plan" for lacking a stop** — that's the expected state. A hold only deserves attention if it's in heavy drawdown vs its thesis (shown as "⚠ drawdown"), its synthesis turns to stand_aside/contested, or its Sharia status degrades.

Mistaking a hold ETF for a planless trade is the #1 error here — do not make it.

Your job:
- Flag ACTIVE TRADES AT RISK first — held TRADE names at/near invalidation, or trades missing plan levels. Then HOLDS in heavy drawdown or with a degraded thesis.
- Surface STANDOUTS worth a closer look: strong grade + (for trades) a valid/approaching setup + conviction; say why in one line each.
- Answer "what do I hold / show my positions" from the HELD rows.

Tools:
- present_tickers — render a clickable shortlist (each card opens that ticker). PREFER this whenever you name 2+ tickers, instead of a prose list.
- get_ticker_detail(symbol) — pull one ticker's full synthesis/plan/thesis before recommending.
- get_news(symbol) / get_chart(symbol) / show_alerts(all=true) / set_alert / cancel_alert / mute_alert — same as the ticker desk, but always pass the symbol explicitly.

Be decisive and concise. Lead with what needs attention, then the standout(s). Don't dump the roster back as text — he can see the list; add judgement.`

const planCompact = (p) => !p ? null : {
  entry: p.buyLow === p.buyHigh ? r2(p.buyLow) : `${r2(p.buyLow)}-${r2(p.buyHigh)}`,
  inval: r2(p.invalidation), targets: (p.targets || []).map(r2),
}

// Compact live roster of the working set (new/watching/in), grouped by status —
// the portfolio scope's "list-level data". One batched quote call; holdings +
// alerts merged in. Returns { rows, bySymbol } (bySymbol feeds present_tickers).
async function portfolioRoster(book = 'personal') {
  const all = await listTickers()
  const live = all.filter((t) => PORTFOLIO_STATUSES.includes(t.status))
  let quotes = {}
  try { quotes = await getQuotes(live.map((t) => ({ ticker: t.symbol, asset_class: t.asset_class, symbol: t.quote_symbol || undefined }))) } catch { /* best-effort */ }
  const heldBy = new Map()
  try {
    for (const h of await getHoldings({ book })) {
      const cur = heldBy.get(h.ticker) || { value: 0, pnl: 0 }
      cur.value += h.value || 0; cur.pnl += h.pnl || 0
      heldBy.set(h.ticker, cur)
    }
  } catch { /* best-effort */ }
  const armedBy = new Map()
  try { for (const a of (await listAlerts()).armed || []) armedBy.set(a.symbol, a) } catch { /* best-effort */ }

  const rows = live.map((t) => {
    const q = quotes[t.symbol]
    const price = q?.price ?? null
    const plan = effectivePlan(t)
    const c = classify(t)
    const syn = t.synthesis
    const held = heldBy.get(t.symbol) || null
    const al = armedBy.get(t.symbol) || null
    return {
      symbol: t.symbol, name: t.name, status: t.status, asset_class: t.asset_class,
      tier: c.pyramidTier || null, layer: c.layer || null, role: c.role || null, bucket: c.bucket || null, theme: c.theme || null,
      price: r2(price), changePct: r2(q?.changePct ?? null), state: priceVsPlan(price, plan),
      plan: planCompact(plan), grade: t.top_grade ?? null, sharia: t.sharia_status || null,
      synthesis: syn ? { action: syn.action || null, conviction: syn.conviction ?? null, contested: !!syn.contested } : null,
      held: held ? { value: r2(held.value), pnl: r2(held.pnl) } : null,
      alert: al ? { state: al.state, muted: !!al.muted } : null,
    }
  })
  // Deterministic layer-aware posture (same helper the scan bar uses) so the
  // agent's "at risk" judgement is anchored to the same rule, not re-derived.
  for (const r of rows) r.posture = assessPosture({ layer: r.layer, state: r.state, grade: r.grade, held: r.held, synthesis: r.synthesis })
  return { rows, bySymbol: new Map(rows.map((r) => [r.symbol, r])), book }
}

// Drawdown % of cost basis for a held row (negative = underwater), or null.
const heldDrawdownPct = (held) => {
  if (!held) return null
  const cost = held.value - held.pnl
  return cost > 0 ? (held.pnl / cost) * 100 : null
}

// Layer-aware roster line. A HOLD (core/satellite ETF, crypto/commodity hold) is
// sized by allocation and has no entry/stop plan BY DESIGN — never render it as
// "no_plan" or imply it's a broken trade. Its risk is drawdown vs thesis. Only a
// TRADE carries a plan/invalidation state.
function rosterLine(r) {
  const isHold = r.layer === 'hold'
  const bits = [r.symbol]
  if (r.price != null) bits.push(`${r.price}${r.changePct != null ? ` (${r.changePct >= 0 ? '+' : ''}${r.changePct}%)` : ''}`)
  bits.push(isHold ? `HOLD ${[r.role, r.theme].filter(Boolean).join('/') || 'satellite'}` : 'TRADE')
  if (isHold) {
    const dd = heldDrawdownPct(r.held)
    if (dd != null && dd <= -15) bits.push(`⚠ drawdown ${dd.toFixed(0)}%`)
    if (r.state === 'no_price') bits.push('no price (data gap)')
  } else {
    bits.push(`state ${r.state}`)
    if (r.plan) bits.push(`plan e:${r.plan.entry} inval:${r.plan.inval} tgt:${(r.plan.targets || []).join('/') || '?'}`)
  }
  if (r.grade != null) bits.push(`grade ${r.grade}/10`)
  if (r.synthesis?.action) bits.push(`syn:${r.synthesis.action}${r.synthesis.conviction != null ? `(${r.synthesis.conviction})` : ''}${r.synthesis.contested ? '⚠' : ''}`)
  if (r.sharia && r.sharia !== 'unknown') bits.push(`☪${r.sharia}`)
  if (r.held) bits.push(`HELD £${r.held.value} pnl £${r.held.pnl}`)
  if (r.alert?.muted) bits.push('muted')
  if (r.posture?.kind === 'at_risk') bits.push(`⚠ AT RISK: ${r.posture.reason}`)
  else if (r.posture?.kind === 'watch') bits.push(`◦ watch: ${r.posture.reason}`)
  return bits.join(' · ')
}

function formatRoster(roster) {
  const order = ['in', 'watching', 'new']
  const groups = {}
  for (const r of roster.rows) (groups[r.status] ||= []).push(r)
  const L = ['# PORTFOLIO ROSTER (live, grouped by status)']
  for (const st of order) {
    const rows = groups[st] || []
    if (!rows.length) continue
    L.push(`\n## ${st.toUpperCase()} (${rows.length})`)
    for (const r of rows) L.push('- ' + rosterLine(r))
  }
  if (!roster.rows.length) L.push('\n(empty — no new/watching/held tickers)')
  return L.join('\n')
}

// ── Scope builders + shared core ─────────────────────────────────────────────
async function buildTickerScope(symbol, { ack }) {
  const ticker = await getTicker(symbol)
  if (!ticker) throw new Error(`unknown ticker ${symbol}`)
  const events = await eventsForTicker(symbol)
  return {
    label: `the Hub context for ${symbol}`,
    context: tickerContext(ticker, events),
    live: ack ? '' : await buildLive(ticker),
    tools: TICKER_TOOLS,
    ctx: { symbol, events },
  }
}

async function buildPortfolioScope(book, { ack }) {
  const roster = await portfolioRoster(book)
  return {
    label: 'your portfolio roster',
    context: PORTFOLIO_CONTEXT,
    live: ack ? '' : formatRoster(roster),
    tools: PORTFOLIO_TOOLS,
    ctx: { book, roster: roster.bySymbol },
  }
}

async function streamCore({ scope, messages, onText, onEvent, signal }) {
  const turns = cleanMessages(messages)
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') throw new Error('last message must be a user turn')
  const ack = isAck(turns[turns.length - 1].content)
  const built = await scope(ack)
  const run = isGemini() ? geminiAgent : claudeAgent
  const usage = await run({ scope: built, turns, onText, onEvent: onEvent || (() => {}), signal })
  return { ...usage, model: CHAT_MODEL, costUsd: costOf(CHAT_MODEL, usage) }
}

/**
 * streamChat — stream a reply for a single-ticker conversation. Acknowledgement
 * turns ("ok", "thanks") skip the live blocks. The chart is a lazy get_chart tool
 * (the synthesis text already encodes the chart read). Returns normalised usage
 * { cached, write, input, output, truncated, model, costUsd }.
 */
export async function streamChat({ symbol, messages, onText, onEvent, signal }) {
  const need = missingKey()
  if (need) throw new Error(`chat unavailable: set ${need}`)
  return streamCore({ scope: (ack) => buildTickerScope(symbol, { ack }), messages, onText, onEvent, signal })
}

/**
 * streamPortfolioChat — same engine, portfolio scope: the agent reasons over the
 * whole roster (new/watching/in) to surface standouts + at-risk active trades,
 * with a clickable shortlist widget. Reuses every shared piece of streamChat.
 */
export async function streamPortfolioChat({ book = 'personal', messages, onText, onEvent, signal }) {
  const need = missingKey()
  if (need) throw new Error(`chat unavailable: set ${need}`)
  return streamCore({ scope: (ack) => buildPortfolioScope(book, { ack }), messages, onText, onEvent, signal })
}

// Debug: assemble the EXACT prompt for a ticker without calling the API (base64
// image elided). Mirrors streamChat's ack-gating so the dump reflects reality.
export async function previewPrompt(symbol, messages = [{ role: 'user', content: 'can i enter now?' }]) {
  const ticker = await getTicker(symbol)
  if (!ticker) throw new Error(`unknown ticker ${symbol}`)
  const turns = cleanMessages(messages)
  const events = await eventsForTicker(symbol)
  const tickerCtx = tickerContext(ticker, events)
  const ack = isAck(turns[turns.length - 1].content)
  const live = ack ? '' : await buildLive(ticker)
  const provider = isGemini() ? 'gemini' : 'claude'
  const payload = provider === 'gemini'
    ? { cachedSystemInstruction: '<<BIBLE — see below>>', contents: geminiContents({ context: tickerCtx, live, turns, label: symbol }) }
    : { system: [{ cache_control: '1h', text: '<<BIBLE>>' }, { cache_control: '1h', text: '<<TICKER CONTEXT>>' }, ...(live ? [{ cache_control: 'none', text: '<<LIVE>>' }] : [])], messages: claudeMessages(turns) }
  return {
    provider, model: CHAT_MODEL, ackTurn: ack,
    chart: chartInfo(events) ? 'lazy — via get_chart tool only' : 'none on file',
    bible: bible(), tickerCtx, live, turns, payload,
    sizes: { bibleChars: bible().length, tickerCtxChars: tickerCtx.length, liveChars: live.length },
  }
}
