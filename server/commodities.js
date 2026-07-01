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

// Reverse index: any form a vehicle ETC can arrive as → { key (commodity), vehicle
// (canonical ticker) }. The SAME physical line reaches us three ways: the bare
// ticker (SSLN), the T212 London hub form (SSLNL — brokerToHubSymbol collapses the
// `l` venue suffix, dropping the dot), and the yahoo symbol (SSLN.L). All three
// must fold onto the commodity, so we index every alias. Built once from the registry.
const VEHICLE_INDEX = (() => {
  const idx = new Map()
  const add = (alias, rec) => { const a = alias?.toUpperCase(); if (a && !idx.has(a)) idx.set(a, rec) }
  for (const [key, m] of Object.entries(REF)) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.vehicles)) continue
    for (const v of m.vehicles) {
      if (!v?.ticker) continue
      const canon = v.ticker.toUpperCase()
      const rec = { key, vehicle: canon }
      add(canon, rec)            // SSLN
      add(canon + 'L', rec)      // SSLNL — T212 London hub form (mirrors fund-match's root+'L')
      if (v.yahoo) {
        add(v.yahoo, rec)                       // SSLN.L
        add(v.yahoo.replace(/\./g, ''), rec)    // SSLNL (yahoo, dot stripped)
      }
    }
  }
  return idx
})()

// Guard against a VEHICLE code landing in the symbol slot — whether an extractor
// stuffs "SGLN" where "GOLD" belongs, or a broker sync hands us a held ETC line
// ("SSLN", "SSLNL", "SSLN.L"). Returns the canonical commodity identity so it folds
// onto the real ticker (GOLD/SILVER, vehicle = SGLN/SSLN) instead of minting a dead
// duplicate. `vehicle` is always the canonical ticker, regardless of input form.
// Null when `symbol` isn't a known vehicle.
export function vehicleToCommodity(symbol) {
  if (!symbol) return null
  const input = String(symbol).toUpperCase()
  const rec = VEHICLE_INDEX.get(input)
  if (!rec) return null
  const canon = rec.key.toUpperCase()
  if (canon === input) return null   // degenerate: code already the commodity symbol
  return { key: rec.key, symbol: canon, vehicle: rec.vehicle }
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
