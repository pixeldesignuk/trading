import { query } from './db.js'

export async function upsertTicker(symbol, { name = null, asset_class = null } = {}) {
  // `(xmax = 0) AS inserted` distinguishes a fresh INSERT from an ON CONFLICT
  // UPDATE: a plain insert leaves the system column xmax at 0, an update sets it.
  const r = await query(
    `INSERT INTO tickers (symbol, name, asset_class)
     VALUES ($1, $2, $3)
     ON CONFLICT (symbol) DO UPDATE SET
       name = COALESCE(tickers.name, EXCLUDED.name),
       asset_class = COALESCE(tickers.asset_class, EXCLUDED.asset_class),
       updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [symbol, name, asset_class],
  )
  return r.rows[0]
}

export async function getTicker(symbol) {
  const r = await query('SELECT * FROM tickers WHERE symbol = $1', [symbol])
  return r.rows[0] || null
}

// Lists tickers with a distinct `sources` array (the event sources each ticker
// has) so the UI can filter by source. `status` includes one status; `exclude`
// hides statuses (e.g. the Tickers tab hides watching/in which live in Portfolio).
export async function listTickers({ status, exclude } = {}) {
  const params = []
  let where = ''
  if (status) { params.push(status); where = `WHERE t.status = $${params.length}` }
  else if (exclude?.length) { params.push(exclude); where = `WHERE t.status <> ALL($${params.length})` }
  const r = await query(
    `SELECT t.*, COALESCE(array_agg(DISTINCT e.source) FILTER (WHERE e.source IS NOT NULL), '{}') AS sources
       FROM tickers t LEFT JOIN events e ON e.ticker = t.symbol
       ${where}
       GROUP BY t.symbol
       ORDER BY t.pinned DESC, t.updated_at DESC`,
    params,
  )
  return r.rows
}

export async function setStatus(symbol, status) {
  await query('UPDATE tickers SET status=$2, updated_at=now() WHERE symbol=$1', [symbol, status])
}

// Lock in the investable ETC for a commodity ticker (surfaces on lists + alerts).
export async function setVehicle(symbol, vehicle) {
  await query('UPDATE tickers SET commodity_vehicle=$2, updated_at=now() WHERE symbol=$1', [symbol, vehicle])
}

// Map a commodity ticker to its vehicle-reference key (auto-resolved on open).
export async function setCommodityKey(symbol, key) {
  await query('UPDATE tickers SET commodity_key=$2, updated_at=now() WHERE symbol=$1', [symbol, key])
}

export async function setPlan(symbol, { entry_zone = null, ladder = [], targets = [], invalidation = null, thesis = null }) {
  await query(
    `UPDATE tickers SET entry_zone=$2, ladder=$3, targets=$4, invalidation=$5, thesis=$6, updated_at=now()
     WHERE symbol=$1`,
    [symbol, entry_zone, JSON.stringify(ladder), JSON.stringify(targets), invalidation, thesis],
  )
}

const CLASSIFICATION_FIELDS = ['layer', 'role', 'pyramid_tier', 'target_pin', 'sleeve', 'satellite_theme', 'core_type']

export async function setClassification(symbol, patch, { q = query } = {}) {
  const sets = []
  const params = [symbol]
  for (const field of CLASSIFICATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      params.push(patch[field] ?? null)
      sets.push(`${field}=$${params.length}`)
    }
  }
  if (sets.length === 0) return // no whitelisted keys — no-op
  await q(
    `UPDATE tickers SET ${sets.join(', ')}, updated_at=now() WHERE symbol=$1`,
    params,
  )
}

export async function setActioned(symbol, on, { q = query } = {}) {
  if (on) {
    await q('UPDATE tickers SET actioned_at = now() WHERE symbol = $1', [symbol])
  } else {
    await q('UPDATE tickers SET actioned_at = NULL WHERE symbol = $1', [symbol])
  }
}
