import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickVehicle, getCommodity, recommendVehicle, compliance, vehicleByTicker, commodityView, vehicleToCommodity } from './commodities.js'

const vehicles = [
  { ticker: 'A', ter: 0.49, brokers: { hl: true, t212: true } },
  { ticker: 'B', ter: 0.20, brokers: { hl: true, t212: false } },
  { ticker: 'C', ter: 0.19, brokers: { hl: false, t212: false, ajbell: true } },
]

test('pickVehicle prefers a held broker, then lowest TER', () => {
  // Only A is on t212 (B.t212 false, C.t212 false) → A wins despite higher TER
  assert.equal(pickVehicle(vehicles, ['t212']).ticker, 'A')
  // On hl, A and B available; B cheaper → B wins (TER sort among held)
  assert.equal(pickVehicle(vehicles, ['hl']).ticker, 'B')
  // On ajbell only C is available
  assert.equal(pickVehicle(vehicles, ['ajbell']).ticker, 'C')
})

test('pickVehicle falls back to overall cheapest when none on held brokers', () => {
  const v = pickVehicle(vehicles, ['nonexistent'])
  assert.equal(v.ticker, 'C')   // 0.19 is the global min
})

test('compliance returns ribawi flag + note per metal', () => {
  assert.equal(compliance('palladium').ribawi, false)
  assert.equal(compliance('gold').ribawi, true)
  assert.match(compliance('gold').note, /allocated/i)
  assert.equal(compliance('unknown-metal'), null)
})

test('getCommodity / recommendVehicle / vehicleByTicker resolve real reference data', () => {
  const pal = getCommodity('palladium')
  assert.equal(pal.reference_symbol, 'PA=F')
  assert.ok(pal.vehicles.length >= 2)
  // user holds all three brokers → cheapest TER palladium ETC wins (SPAL 0.19)
  assert.equal(recommendVehicle('palladium', ['hl', 't212', 'ajbell']).ticker, 'SPAL')
  assert.equal(vehicleByTicker('palladium', 'phpd').ticker, 'PHPD')   // case-insensitive
  assert.equal(vehicleByTicker('palladium', 'NOPE'), null)
  assert.equal(getCommodity('xyz'), null)
})

test('vehicleToCommodity remaps a vehicle code to its canonical commodity ticker', () => {
  // The bug that minted a duplicate SGLN ticker: a gold live labelled with its ETC.
  assert.deepEqual(vehicleToCommodity('SGLN'), { key: 'gold', symbol: 'GOLD', vehicle: 'SGLN' })
  assert.deepEqual(vehicleToCommodity('sglp'), { key: 'gold', symbol: 'GOLD', vehicle: 'SGLP' })   // case-insensitive
  // A real commodity symbol, an equity, and junk are left alone.
  assert.equal(vehicleToCommodity('GOLD'), null)
  assert.equal(vehicleToCommodity('AAPL'), null)
  assert.equal(vehicleToCommodity(null), null)
})

test('vehicleToCommodity folds the T212 London + yahoo forms of a vehicle', () => {
  // The held-silver bug: T212's SSLNl_EQ → brokerToHubSymbol → "SSLNL", which must
  // still resolve to SILVER (vehicle SSLN) rather than mint a dead standalone line.
  const silver = { key: 'silver', symbol: 'SILVER', vehicle: 'SSLN' }
  assert.deepEqual(vehicleToCommodity('SSLN'), silver)    // bare ticker
  assert.deepEqual(vehicleToCommodity('SSLNL'), silver)   // T212 London hub form
  assert.deepEqual(vehicleToCommodity('SSLN.L'), silver)  // yahoo symbol
  assert.deepEqual(vehicleToCommodity('ssln.l'), silver)  // case-insensitive
  // The canonical `vehicle` is always the bare ticker, whatever form came in.
  assert.equal(vehicleToCommodity('SSLNL').vehicle, 'SSLN')
})

test('commodityView enriches with live prices, selection, recommendation and ratio', async () => {
  // fake getQuotes: spot PA=F = 1000, ETC prices per yahoo symbol
  const prices = { 'PA=F': 1000, 'SPAL.L': 90, 'SPDM.L': 95, 'PHPD.L': 120 }
  const getQuotes = async (pairs) => Object.fromEntries(pairs.map((p) => [p.ticker, { price: prices[p.symbol] ?? null, changePct: 0 }]))
  const view = await commodityView(
    { symbol: 'PALLADIUM', commodity_key: 'palladium', commodity_vehicle: 'PHPD' },
    { getQuotes, heldBrokers: ['hl', 't212', 'ajbell'] },
  )
  assert.equal(view.spot, 1000)
  assert.equal(view.selected, 'PHPD')          // locked vehicle
  assert.equal(view.recommended, 'SPAL')       // cheapest TER
  assert.equal(view.ratio, 120 / 1000)         // selected ETC ÷ spot
  const phpd = view.vehicles.find((v) => v.ticker === 'PHPD')
  assert.equal(phpd.price, 120)
  assert.equal(phpd.available, true)
})

test('commodityView marks oil/agri non-investable with no vehicles + a note', async () => {
  const getQuotes = async (pairs) => Object.fromEntries(pairs.map((p) => [p.ticker, { price: 80, changePct: 0 }]))
  const view = await commodityView(
    { symbol: 'USOIL', commodity_key: 'usoil', commodity_vehicle: null },
    { getQuotes, heldBrokers: ['hl'] },
  )
  assert.equal(view.investable, false)
  assert.equal(view.vehicles.length, 0)
  assert.equal(view.selected, null)
  assert.equal(view.ratio, null)
  assert.match(view.no_vehicle_note, /no compliant/i)
  assert.equal(view.spot, 80)   // reference future still charts
})

test('commodityView defaults selection to the recommended vehicle when none locked', async () => {
  const getQuotes = async (pairs) => Object.fromEntries(pairs.map((p) => [p.ticker, { price: 1, changePct: 0 }]))
  const view = await commodityView(
    { symbol: 'PALLADIUM', commodity_key: 'palladium', commodity_vehicle: null },
    { getQuotes, heldBrokers: ['hl'] },
  )
  assert.equal(view.selected, 'SPAL')
})
