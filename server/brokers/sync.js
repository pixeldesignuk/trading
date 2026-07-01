// Broker sync — pulls a snapshot for every connected account (any provider),
// upserts broker_accounts + holdings, and reconciles the ticker pipeline so
// Active mirrors what the broker actually holds. Read-only: no orders. Accounts
// + their encrypted credentials live in the DB; each provider's snapshot fn and
// rate limit come from the broker registry. See the accounts-multi-broker spec.
import { query } from '../db.js'
import { upsertTicker, setClassification } from '../tickers.js'
import { REGISTRY } from './registry.js'
import { decrypt, hasKey } from './secrets.js'
import { fundMatchMap, matchHeldSymbol } from '../portfolio/fund-match.js'
import { vehicleToCommodity } from '../commodities.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Load connected accounts (those with stored credentials) from the DB. `broker`
// is the provider key; credentials_enc is decrypted lazily at sync time.
export async function loadAccounts({ q = query } = {}) {
  const { rows } = await q(
    `SELECT id, broker AS provider, label, credentials_enc, provider_ref, owner_id
       FROM broker_accounts WHERE credentials_enc IS NOT NULL ORDER BY id`,
  )
  return rows
}

// Default snapshot resolver: pick the provider from the registry and call its
// fetchSnapshot with the account's decrypted credentials. Injectable in tests.
async function registrySnapshot(account, { registry = REGISTRY, decryptCreds = decrypt } = {}) {
  const provider = registry[account.provider]
  if (!provider) throw new Error(`unknown provider: ${account.provider}`)
  const creds = decryptCreds(account.credentials_enc)
  return provider.fetchSnapshot(creds, { providerRef: account.provider_ref })
}

// Spacing before an account's call — its provider's rate limit (default 1.1s).
function spacingFor(account, registry = REGISTRY) {
  return registry[account.provider]?.rateLimitMs ?? 1100
}

// T212 tickers are suffixed (AAPL_US_EQ); the hub symbol is the bare, uppercased
// root. (Crypto pairs without a suffix pass through, just normalised.)
export function brokerToHubSymbol(brokerSymbol) {
  return (brokerSymbol.split('_')[0] || brokerSymbol).toUpperCase()
}

// Resolve a broker line to the hub ticker it belongs under. A held commodity ETC
// (the T212 London silver line SSLNl_EQ → SSLNL) folds onto its commodity ticker
// (SILVER) so it lands as that commodity's held vehicle — priced via the registry's
// yahoo symbol (SSLN.L) — instead of minting a dead standalone SSLNL line with no
// price. Everything else keeps its bare hub symbol. Returns { symbol, commodity? }.
export function hubTickerFor(brokerSymbol) {
  const hub = brokerToHubSymbol(brokerSymbol)
  const v = vehicleToCommodity(hub)
  return v ? { symbol: v.symbol, commodity: { key: v.key, vehicle: v.vehicle } } : { symbol: hub }
}

// Yahoo price symbol for a held broker line, when we can infer one: the curated
// fund-universe `yahoo` (authoritative, verified) else a London `.L` derivation
// from T212's lowercase-`l` venue suffix (ISWDl_EQ → ISWD.L). Without this a synced
// LSE line is priced off its dead bare root (ISWDL) and shows no price. Null when
// unknown — leaves quote_symbol unset rather than guessing a bad symbol.
export function quoteSymbolFor(brokerSymbol, map = fundMatchMap()) {
  const fromUniverse = matchHeldSymbol(brokerToHubSymbol(brokerSymbol), map)?.yahoo
  if (fromUniverse) return fromUniverse
  const m = /^([A-Z0-9]+)l$/.exec(String(brokerSymbol).split('_')[0]) // London venue: root + lowercase l
  return m ? `${m[1]}.L` : null
}

// Held tickers become Active ('in'); any ticker currently 'in' but no longer
// held in any account is demoted to 'closed' (auto-exit mirror rule).
export async function reconcileStages(heldSymbols, { q = query } = {}) {
  if (heldSymbols.length) {
    await q(
      `UPDATE tickers SET status='in', updated_at=now()
       WHERE symbol = ANY($1) AND status <> 'in'`,
      [heldSymbols],
    )
  }
  await q(
    `UPDATE tickers SET status='closed', updated_at=now()
     WHERE status='in' AND NOT (symbol = ANY($1))`,
    [heldSymbols],
  )
}

// Sync one account: fetch its snapshot, upsert the account row, and replace its
// holdings (auto-creating hub tickers for anything not yet tracked). Returns the
// set of held hub symbols. Throws on provider failure (caller isolates it).
export async function syncAccount(account, deps = {}) {
  const { snapshot, q = query, upsert = upsertTicker, registry = REGISTRY, decryptCreds = decrypt } = deps
  // Tests/legacy inject `snapshot`; otherwise resolve via the registry.
  const snap = snapshot ? await snapshot(account) : await registrySnapshot(account, { registry, decryptCreds })
  const provider = account.provider || 'trading212'
  const held = []
  // Resolve each line's hub ticker once (folding commodity ETC vehicles onto their
  // commodity), then reuse it for both the ticker upsert and the holdings insert.
  const lines = snap.holdings.map((h) => ({ h, hub: hubTickerFor(h.symbol) }))
  for (const { h, hub } of lines) {
    await upsert(hub.symbol, { name: hub.commodity ? null : (h.name || null), asset_class: hub.commodity ? 'commodity' : null })
    if (hub.commodity) {
      // Lock the commodity's key + the actually-held vehicle so commodityView prices
      // and shows the line you own (COALESCE in upsert preserves any existing synth).
      await q('UPDATE tickers SET commodity_key=COALESCE(commodity_key,$2), commodity_vehicle=$3, updated_at=now() WHERE symbol=$1',
        [hub.symbol, hub.commodity.key, hub.commodity.vehicle])
    } else {
      // Give an LSE line a resolvable yahoo symbol (ISWDL → ISWD.L) so it prices.
      // COALESCE keeps any manual quote_symbol override the user set by hand.
      const qs = quoteSymbolFor(h.symbol)
      if (qs) await q('UPDATE tickers SET quote_symbol=COALESCE(quote_symbol,$2), updated_at=now() WHERE symbol=$1', [hub.symbol, qs])
    }
    held.push(hub.symbol)
  }
  // Upsert only the snapshot fields — owner_id, credentials_enc, book, account_type
  // are owned by the account record and preserved across syncs.
  await q(
    `INSERT INTO broker_accounts (id, broker, label, currency, cash, invested, total_value, pnl, error, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,now())
     ON CONFLICT (id) DO UPDATE SET
       broker=EXCLUDED.broker, label=EXCLUDED.label, currency=EXCLUDED.currency, cash=EXCLUDED.cash,
       invested=EXCLUDED.invested, total_value=EXCLUDED.total_value, pnl=EXCLUDED.pnl,
       error=NULL, synced_at=now()`,
    [account.id, provider, account.label, snap.currency, snap.cash, snap.invested, snap.totalValue, snap.pnl],
  )
  // Replace this account's holdings (delete-then-insert keeps it a clean mirror).
  await q('DELETE FROM holdings WHERE account_id=$1', [account.id])
  for (const { h, hub } of lines) {
    await q(
      `INSERT INTO holdings (account_id, broker_symbol, ticker, name, quantity, avg_price, value, pnl, currency, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      // avg_price stays null when the provider has no cost basis — never coerce a
      // missing cost to 0, which would render a false "@ 0.00 / +£0" entry.
      [account.id, h.symbol, hub.symbol, h.name || null, h.quantity,
       h.quantity && h.cost != null ? h.cost / h.quantity : null, h.value, h.pnl ?? null, h.currency || snap.currency],
    )
  }
  return held
}

// Record a failed account sync without losing its prior holdings: store the
// error on the account row so the UI can flag it, and keep going.
async function recordError(account, message, q) {
  await q(
    `INSERT INTO broker_accounts (id, broker, label, error, synced_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, error=EXCLUDED.error, synced_at=now()`,
    [account.id, account.provider || 'trading212', account.label, message],
  )
}

// Auto-classify newly-synced holdings that match the curated fund universe into
// their sleeve (core/sat_etf/crypto) — so a fund bought in T212 self-files into
// the right Allocation rung instead of defaulting to Individual Picks. Skips any
// ticker the user has already classified (manual sleeve override wins).
export async function autoClassifyFunds(symbols, { q = query } = {}) {
  const map = fundMatchMap()
  for (const sym of symbols) {
    const m = matchHeldSymbol(sym, map)
    if (!m) continue
    const { rows } = await q('SELECT satellite_theme, role FROM tickers WHERE symbol=$1', [sym])
    if (rows[0]?.satellite_theme || rows[0]?.role) continue // manual classification wins
    await setClassification(sym, { layer: 'hold', role: m.bucket === 'core' ? 'core' : 'satellite', pyramid_tier: m.tier, target_pin: null, sleeve: null, satellite_theme: m.theme || null, core_type: m.coreType || null }, { q })
  }
}

// Sync every connected account sequentially (rate-limit friendly), isolating
// per-account failures, then reconcile the pipeline once with the union of held
// symbols. Accounts default to the DB (those with stored credentials); tests
// inject `accounts` + `snapshot`. Spacing before each call is that account's
// provider rate limit unless `spacing` is overridden. Returns a small summary.
export async function syncAll(deps = {}) {
  const {
    accounts,
    q = query,
    reconcile = reconcileStages,
    registry = REGISTRY,
    spacing, // undefined → per-provider rate limit
    wait = sleep,
  } = deps

  // Default to DB accounts. Decryption needs the master key — if absent, skip
  // rather than crash so the rest of the app keeps running.
  let list = accounts
  if (!list) {
    if (!hasKey()) {
      console.warn('[sync] APP_ENCRYPTION_KEY not set — skipping broker sync')
      return { accounts: 0, held: [], errors: [{ id: null, error: 'APP_ENCRYPTION_KEY not set' }] }
    }
    list = await loadAccounts({ q })
  }

  const held = new Set()
  const errors = []
  for (let i = 0; i < list.length; i++) {
    const account = list[i]
    if (i > 0) await wait(spacing != null ? spacing : spacingFor(account, registry))
    try {
      const symbols = await syncAccount(account, deps)
      symbols.forEach((s) => held.add(s))
    } catch (e) {
      errors.push({ id: account.id, error: e.message })
      await recordError(account, e.message, q).catch(() => {})
    }
  }
  await reconcile([...held], { q })
  await autoClassifyFunds([...held], { q }).catch(() => {})
  return { accounts: list.length, held: [...held], errors }
}
