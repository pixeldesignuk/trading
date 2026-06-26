CREATE TABLE IF NOT EXISTS tickers (
  symbol         TEXT PRIMARY KEY,
  name           TEXT,
  asset_class    TEXT,                              -- stock | crypto | commodity
  status         TEXT NOT NULL DEFAULT 'new',       -- new|watching|in|closed|dismissed
  sharia_status  TEXT DEFAULT 'unknown',            -- compliant|questionable|non_compliant|unknown
  sharia_note    TEXT,
  sharia_source  TEXT,
  entry_zone     TEXT,
  ladder         JSONB DEFAULT '[]'::jsonb,         -- [{level, price, note}]
  targets        JSONB DEFAULT '[]'::jsonb,         -- [{level, price, note}]
  invalidation   TEXT,
  thesis         TEXT,
  ai_thesis      TEXT,
  ai_thesis_at   TIMESTAMPTZ,
  synthesis      JSONB,                             -- skeptical-editor output (see synthesize.js)
  synth_at       TIMESTAMPTZ,
  synth_hash     TEXT,                              -- hash of the event set the synthesis was built from
  sharia_screen     JSONB,                          -- live 2-of-3 screen (see sharia/screen.js)
  sharia_screen_at  TIMESTAMPTZ,
  top_grade      INTEGER,
  top_grade_verdict TEXT,                            -- pass|partial|fail
  pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Commodity handling: a commodity ticker links to the vehicle reference by
-- `commodity_key` (palladium|platinum|gold|silver) and locks in one investable
-- physically-backed ETC via `commodity_vehicle` (e.g. 'PHPD'). The bare commodity
-- symbol Zero charts (CFD/spot) is reference-only; the locked ETC is what surfaces
-- on lists + alerts. See the commodity-handling design spec.
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS commodity_key     TEXT;
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS commodity_vehicle TEXT;

-- Portfolio & risk rework (2026-06-24): per-ticker classification
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS layer        TEXT;     -- hold|trade (null = default)
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS role         TEXT;     -- core|satellite
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS pyramid_tier TEXT;     -- defensive|lower|moderate|high
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS target_pin   NUMERIC;  -- pinned target weight (fraction) or null
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS actioned_at  TIMESTAMPTZ;  -- "marked as bought" intent (pending until broker confirms)
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS sleeve       TEXT;         -- explicit allocation sleeve override: core|sat_etf|crypto|picks|cash
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS satellite_theme TEXT;  -- tech|em|commodities|niche|crypto (null for non-satellite)

-- Book each synced account belongs to
ALTER TABLE broker_accounts ADD COLUMN IF NOT EXISTS book TEXT NOT NULL DEFAULT 'personal'; -- personal|kids

-- Per-book allocation targets (slider state). Percentages stored as fractions.
CREATE TABLE IF NOT EXISTS allocation_targets (
  book                TEXT PRIMARY KEY,           -- personal|kids
  core_pct            NUMERIC NOT NULL,
  sat_etf_pct         NUMERIC NOT NULL,
  crypto_pct          NUMERIC NOT NULL,
  picks_pct           NUMERIC NOT NULL,
  cash_pct            NUMERIC NOT NULL,
  crypto_pinned       BOOLEAN NOT NULL DEFAULT TRUE,
  active_risk_cap_pct NUMERIC NOT NULL DEFAULT 0.02,
  benchmark           TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS schema_version          INTEGER NOT NULL DEFAULT 1;
ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS satellite_pct           NUMERIC;
ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS satellite_theme_splits  JSONB;
ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS satellite_tier_targets  JSONB;

-- Core sub-type axis (2026-06-25): per-ticker classification within the core bucket
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS core_type TEXT;  -- world|us|quality_income (null for non-core)
ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS core_type_splits JSONB; -- within-core fractions

CREATE TABLE IF NOT EXISTS events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker      TEXT NOT NULL REFERENCES tickers(symbol) ON DELETE CASCADE,
  source      TEXT NOT NULL,                        -- zero_tg|zero_hub|zero_live|moneytaur|community|manual
  kind        TEXT NOT NULL DEFAULT 'mention',      -- mention|grade|chart|note|status_change|idea
  occurred_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- community ideas carry payload.author={handle,name}
  dedup_key   TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_events_ticker ON events(ticker);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);

-- Discussion digests: the community pulse from the Telegram groups, seeded by
-- /feed. One `discussions` row per /feed run (a dated batch with a TL;DR), with
-- the notable threads broken out as `discussion_topics` cards underneath. This
-- is conversation-centric (NOT ticker-centric) — ticker ideas raised in chat
-- are extracted separately into events(source='community', kind='idea').
CREATE TABLE IF NOT EXISTS discussions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,                 -- feed-YYYY-MM-DDTHHMMZ
  date        TEXT,                                 -- YYYY-MM-DD
  generated   TIMESTAMPTZ,
  since       TEXT,                                 -- human window, e.g. "since last check · 06-21→06-23"
  tldr        TEXT,                                 -- overall run TL;DR (2-3 lines)
  stats_json  JSONB,                                -- {messages, channels:[{title,count}], ideas, signals}
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discussion_topics (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  discussion_id BIGINT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  grp           TEXT,                               -- Telegram group: "Discussion area"|"Stock trades"|"Zero's Dojo"
  topic         TEXT,                               -- short thread title
  summary       TEXT,                               -- 1-3 line summary of the thread
  participants  JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["@handle", …]
  tickers       JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["WATER", …] symbols surfaced in the thread
  ord           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_topics_discussion ON discussion_topics(discussion_id);

-- Alert dedup spine: last evaluated plan-state per ticker. The alert engine fires
-- a Telegram + an events(kind='alert') row only on a notable state TRANSITION, and
-- uses last_fired_at/last_transition to suppress re-fires within a cooldown window.
CREATE TABLE IF NOT EXISTS alert_state (
  symbol          TEXT PRIMARY KEY REFERENCES tickers(symbol) ON DELETE CASCADE,
  state           TEXT,                              -- last priceVsPlan state
  price           DOUBLE PRECISION,                  -- last evaluated price
  last_transition TEXT,                              -- last notable transition kind fired
  last_fired_at   TIMESTAMPTZ,                       -- when the last notable alert fired (cooldown basis)
  last_eval_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mute the plan-derived alerts for a ticker without un-arming it (still shows on
-- the watchlist + held lists; just won't fire Telegram). Set from the chat agent
-- or the Alerts widget. Custom price-cross alerts (below) are unaffected.
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS alerts_muted BOOLEAN NOT NULL DEFAULT FALSE;

-- Custom price-cross alerts: free-standing "ping me when SYM crosses PRICE",
-- distinct from the plan-derived engine. One-shot — fires once when price crosses
-- in `direction`, then active=false (re-set to re-arm). Created from chat or the
-- Alerts widget; evaluated in the same hourly run.js pass and delivered via the
-- same Telegram + events(kind='alert') path.
CREATE TABLE IF NOT EXISTS custom_alerts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol        TEXT NOT NULL REFERENCES tickers(symbol) ON DELETE CASCADE,
  direction     TEXT NOT NULL,                       -- 'above' | 'below'
  price         DOUBLE PRECISION NOT NULL,
  note          TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    TEXT NOT NULL DEFAULT 'chat',        -- provenance: chat | widget
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fired_at TIMESTAMPTZ,
  fired_price   DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_custom_alerts_active ON custom_alerts(symbol) WHERE active;

-- Broker sync (Dynamic Kanban Portfolio v1, T212 multi-account, read-only mirror).
-- One row per connected Trading 212 account; upserted every sync. `error` holds
-- the last sync failure (NULL when ok) so one bad key never sinks the others.
CREATE TABLE IF NOT EXISTS broker_accounts (
  id           TEXT PRIMARY KEY,                    -- stable slug from T212_ACCOUNTS config
  broker       TEXT NOT NULL,                       -- 'trading212'
  label        TEXT NOT NULL,
  currency     TEXT,
  cash         NUMERIC,                             -- available cash
  invested     NUMERIC,
  total_value  NUMERIC,
  pnl          NUMERIC,                             -- unrealised
  error        TEXT,
  synced_at    TIMESTAMPTZ
);
-- Holdings drive the Active stage + real P/L. Rows for an account are replaced
-- each sync. `ticker` is the resolved hub symbol (auto-created if not tracked);
-- `broker_symbol` is the raw T212 ticker (e.g. AAPL_US_EQ).
CREATE TABLE IF NOT EXISTS holdings (
  account_id    TEXT NOT NULL REFERENCES broker_accounts(id) ON DELETE CASCADE,
  broker_symbol TEXT NOT NULL,
  ticker        TEXT NOT NULL REFERENCES tickers(symbol) ON DELETE CASCADE,
  name          TEXT,
  quantity      NUMERIC,
  avg_price     NUMERIC,
  value         NUMERIC,
  pnl           NUMERIC,
  currency      TEXT,
  synced_at     TIMESTAMPTZ,
  PRIMARY KEY (account_id, broker_symbol)
);
CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON holdings(ticker);

-- Archive tables ported from the old SQLite app (browse value, not the spine).
CREATE TABLE IF NOT EXISTS runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated TEXT, window_hours REAL, kind TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued', tldr TEXT, daily_summary TEXT,
  stats_json JSONB, error TEXT, log TEXT
);
CREATE TABLE IF NOT EXISTS lives (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL, date TEXT, title TEXT, tldr TEXT, summary_md TEXT,
  folder TEXT, video_id TEXT, duration_sec INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS live_shots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  live_id BIGINT NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  ord INTEGER, label TEXT, file TEXT
);
CREATE TABLE IF NOT EXISTS recaps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL, date TEXT, generated TEXT, since TEXT,
  tldr TEXT, body_md TEXT, stats_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accounts & owners (2026-06-25): people you hold/manage investments for, grouped
-- into households, each owning many accounts across providers. Generalises the old
-- personal/kids `book`. See the accounts-multi-broker design spec.
CREATE TABLE IF NOT EXISTS households (
  id          TEXT PRIMARY KEY,                  -- slug, e.g. 'my-family'
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS owners (
  id            TEXT PRIMARY KEY,                -- slug, e.g. 'me', 'child-a'
  household_id  TEXT REFERENCES households(id),
  name          TEXT NOT NULL,
  relationship  TEXT NOT NULL DEFAULT 'self',    -- self | child | family
  role          TEXT NOT NULL DEFAULT 'owner',   -- owner | managed (F&F managed by me)
  color         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- broker_accounts is generalised into the multi-provider "accounts" table:
-- owner_id replaces book, `broker` is the provider, credentials_enc holds the
-- account's encrypted API secrets (secrets.js), provider_ref is the provider-side
-- account id (e.g. a SnapTrade account uuid).
ALTER TABLE broker_accounts ADD COLUMN IF NOT EXISTS owner_id        TEXT REFERENCES owners(id);
ALTER TABLE broker_accounts ADD COLUMN IF NOT EXISTS account_type    TEXT;          -- isa|jisa|gia|crypto|sipp
ALTER TABLE broker_accounts ADD COLUMN IF NOT EXISTS credentials_enc JSONB;         -- {iv,tag,ciphertext}
ALTER TABLE broker_accounts ADD COLUMN IF NOT EXISTS provider_ref    TEXT;
ALTER TABLE broker_accounts ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'active';

-- Allocation targets become per-owner (was keyed by the book string).
ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES owners(id);
