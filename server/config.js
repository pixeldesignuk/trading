import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const home = os.homedir()

export const ROOT = path.resolve(__dirname, '..')            // signals-web/
export const TRADING = path.resolve(ROOT, '..')              // ~/Developer/personal/trading
// Media lives OUTSIDE server/public so `vite build` (emptyOutDir) can't wipe it.
// Served via the explicit `/media` express mount in index.js.
export const MEDIA_DIR = process.env.MEDIA_DIR || path.join(ROOT, 'media')
export const DATA_DIR = path.join(ROOT, 'data')
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'signals.db')
export const PROMPT_TEMPLATE = path.join(ROOT, 'server', 'prompts', 'digest.md')

// 8920 locally so trading-hub never collides with the legacy signals-web app
// (which keeps 8910). Railway injects its own PORT in prod.
export const PORT = Number(process.env.PORT || 8920)

// Postgres connection string. Local dev: a local Postgres; prod: Railway's.
export const DATABASE_URL = process.env.DATABASE_URL ||
  'postgres://localhost:5432/trading_hub'

// Risk management per the Zero bible (ZERO-BIBLE.md §12–13):
//  - Risk per trade is a % of ACCOUNT, by timeframe: HTF 3% / MTF 2% / LTF 1%.
//    Default 2% (MTF). Risk is measured entry→stop, not notional.
//  - Position size = Risk Amount ÷ Stop-Loss distance.
//  - Stops are STRUCTURE-based (never fixed-%); R:R minimum 2:1.
export const ACCOUNT_SIZE = Number(process.env.ACCOUNT_SIZE || 20000) // £, from PLAN.md
export const RISK_PER_TRADE = Number(process.env.RISK_PER_TRADE || 0.02)
export const RISK_BY_TF = { HTF: 0.03, MTF: 0.02, LTF: 0.01 }
export const MIN_RR = Number(process.env.MIN_RR || 2)

// Brokers you hold — used to pick the best compliant commodity ETC (available on
// one of these → then lowest TER). Override via HELD_BROKERS="hl,t212" etc.
export const HELD_BROKERS = (process.env.HELD_BROKERS || 'hl,t212,ajbell')
  .split(',').map((s) => s.trim()).filter(Boolean)

// Portfolio construction (Zero §11/§17): "3–5 core spot names, never >50%
// invested — always dry powder." A new position is sized within this invested
// ceiling, split across the open position slots, so one trade never goes all-in.
// Default 80% invested ceiling (20% reserved for DCA + rare opportunities). Zero's
// "never >50% invested" is a leveraged-crypto/bear posture; a spot accumulator
// runs hotter. Editable per-session in the risk panel; this is just the default.
export const MAX_INVESTED_PCT = Number(process.env.MAX_INVESTED_PCT || 0.8)
export const MAX_POSITIONS = Number(process.env.MAX_POSITIONS || 5)

// Ticker chat agent — Anthropic Messages API (prompt-cached bible + ticker prefix).
// Distinct from the headless CLI runner below: chat needs an API key so we can
// place cache_control breakpoints. No key → the /chat route returns 503.
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
// Provider is inferred from the model id: gemini-* → Google, else Anthropic.
export const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-opus-4-8'

// News / sentiment tool — Gemini with Google-Search grounding (chat's get_news
// tool). Reuses GEMINI_API_KEY (no new key); a cheap flash model does the news
// sub-call. No key → the tool reports news is unavailable; chat still works.
export const NEWS_MODEL = process.env.NEWS_MODEL || 'gemini-2.5-flash'

// Claude Code headless runner config (overridable via env)
export const CLAUDE_BIN = process.env.CLAUDE_BIN ||
  '/Applications/cmux.app/Contents/Resources/bin/claude'
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || '' // '' = inherit default
export const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 12 * 60 * 1000)
// PATH the spawned claude needs (brew, fnm node, claude bin dir)
export const SPAWN_PATH = [
  '/opt/homebrew/bin',
  path.dirname(CLAUDE_BIN),
  path.join(home, '.fnm'),
  process.env.PATH || '',
].join(':')

// No scheduler — runs are produced on demand by the /signals slash command
// (server/register-digest.js), not on a cron.

// --- Alerts (engine grounded in tickers-with-plans; see docs/.../alerts spec) ---
// Telegram delivery (reuse the existing alert bot's token/chat).
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''
// Shared secret guarding POST /api/alerts/run. Unset → the endpoint always 401s
// (the engine never runs without a configured token).
export const ALERTS_RUN_TOKEN = process.env.ALERTS_RUN_TOKEN || ''
export const ALERT_NEAR = Number(process.env.ALERT_NEAR || 0.05)        // target proximity
export const ALERT_COOLDOWN_H = Number(process.env.ALERT_COOLDOWN_H || 6) // per (symbol,transition) re-fire suppression
export const ALERT_POINT_BAND = Number(process.env.ALERT_POINT_BAND || 0.01) // widen a synthesis point entry into a band
