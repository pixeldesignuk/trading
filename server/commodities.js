import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Commodity vehicle reference — physically-backed ETCs for compliant exposure.
// Zero charts CFD/spot (XPD/USD etc.) which are NOT investable (leverage +
// overnight interest); a commodity ticker locks in one of these ETCs as its
// investable identity. See the commodity-handling design spec.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference', 'commodity-vehicles.json'), 'utf8'))

export function getCommodity(key) {
  const m = key && REF[key]
  return m && typeof m === 'object' ? m : null
}

// Pure: choose the best vehicle — prefer ones available on a broker the user
// holds, then lowest TER. Falls back to the global cheapest when none of the
// held brokers list any of them.
export function pickVehicle(vehicles, heldBrokers = []) {
  if (!vehicles?.length) return null
  const onHeld = vehicles.filter((v) => heldBrokers.some((b) => v.brokers?.[b]))
  const pool = onHeld.length ? onHeld : vehicles
  return [...pool].sort((a, b) => (a.ter ?? Infinity) - (b.ter ?? Infinity))[0] || null
}

export function recommendVehicle(key, heldBrokers = []) {
  const m = getCommodity(key)
  return m ? pickVehicle(m.vehicles, heldBrokers) : null
}

export function vehicleByTicker(key, ticker) {
  const m = getCommodity(key)
  if (!m || !ticker) return null
  const t = String(ticker).toUpperCase()
  return m.vehicles.find((v) => v.ticker.toUpperCase() === t) || null
}

export function compliance(key) {
  const m = getCommodity(key)
  return m ? { ribawi: !!m.ribawi, note: m.compliance_note } : null
}

// Build the detail-page commodity payload: live spot (reference future) + each
// vehicle's live price/availability + the locked selection, recommendation, and
// the spot→ETC ratio. `getQuotes(pairs)` is injectable for tests; each pair uses
// a `symbol` override so we price arbitrary yahoo symbols keyed by their ticker.
export async function commodityView(ticker, { getQuotes, heldBrokers = [] }) {
  const m = getCommodity(ticker?.commodity_key)
  if (!m) return null
  const pairs = [
    { ticker: m.reference_symbol, asset_class: 'commodity', symbol: m.reference_symbol },
    ...m.vehicles.map((v) => ({ ticker: v.yahoo, asset_class: 'stock', symbol: v.yahoo })),
  ]
  const q = await getQuotes(pairs)
  const spot = q[m.reference_symbol]?.price ?? null
  const vehicles = m.vehicles.map((v) => ({
    ...v,
    price: q[v.yahoo]?.price ?? null,
    changePct: q[v.yahoo]?.changePct ?? null,
    available: heldBrokers.some((b) => v.brokers?.[b]),
  }))
  const recommended = pickVehicle(m.vehicles, heldBrokers)?.ticker || null
  const selected = (ticker.commodity_vehicle && vehicleByTicker(ticker.commodity_key, ticker.commodity_vehicle)?.ticker) || recommended
  const sel = vehicles.find((v) => v.ticker === selected) || null
  const ratio = sel?.price && spot ? sel.price / spot : null
  return {
    key: m.key || ticker.commodity_key, label: m.label, ribawi: !!m.ribawi,
    investable: m.investable !== false,   // oil/agri/base metals: no compliant physical vehicle
    no_vehicle_note: m.no_vehicle_note || null,
    compliance_note: m.compliance_note, reference_symbol: m.reference_symbol,
    spot, vehicles, recommended, selected, ratio,
  }
}
