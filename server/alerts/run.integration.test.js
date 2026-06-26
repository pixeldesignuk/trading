import { test } from 'node:test'
import assert from 'node:assert/strict'
import { upsertTicker, setPlan, setStatus } from '../tickers.js'
import { query } from '../db.js'
import { runAlerts } from './run.js'

const SYM = '__ALERTTEST'
const clean = async () => {
  await query('DELETE FROM events WHERE ticker=$1', [SYM])
  await query('DELETE FROM alert_state WHERE symbol=$1', [SYM])
  await query('DELETE FROM tickers WHERE symbol=$1', [SYM])
}

test('alert run: seed baseline, fire entered_buy, dedup, fire invalidation, record events', async (t) => {
  await clean()
  await upsertTicker(SYM, { name: 'Alert Test', asset_class: 'stock' })
  await setStatus(SYM, 'watching') // armed = watchlist/held only
  await setPlan(SYM, { ladder: [{ price: 40 }, { price: 50 }], targets: [{ price: 80 }], invalidation: 'below 30' })
  t.after(clean)

  const sent = []
  const sender = async (text) => { sent.push(text); return { ok: true } }
  const quote = (price) => async () => ({ [SYM]: { price } })

  // 1) price below the zone → baseline seeded, no fire
  let r = await runAlerts({ now: Date.UTC(2026, 5, 23, 10), quoter: quote(35), sender })
  assert.equal(r.fired.find((x) => x.symbol === SYM), undefined)
  assert.equal(sent.length, 0)

  // 2) price enters the buy zone → entered_buy fires
  r = await runAlerts({ now: Date.UTC(2026, 5, 23, 11), quoter: quote(45), sender })
  const f = r.fired.find((x) => x.symbol === SYM)
  assert.ok(f && f.transition === 'entered_buy', 'entered_buy fired')
  assert.equal(sent.length, 1)
  assert.match(sent[0], /entered buy zone 40–50/)

  // event recorded on the ticker
  const ev = await query("SELECT payload->>'note' note FROM events WHERE ticker=$1 AND source='alert'", [SYM])
  assert.equal(ev.rows.length, 1)
  assert.match(ev.rows[0].note, /entered buy zone/)

  // 3) still in the zone → no re-fire (state unchanged)
  r = await runAlerts({ now: Date.UTC(2026, 5, 23, 12), quoter: quote(46), sender })
  assert.equal(r.fired.find((x) => x.symbol === SYM), undefined)
  assert.equal(sent.length, 1)

  // 4) breaches invalidation → fires (different transition, not in cooldown)
  r = await runAlerts({ now: Date.UTC(2026, 5, 23, 13), quoter: quote(29), sender })
  const fi = r.fired.find((x) => x.symbol === SYM)
  assert.ok(fi && fi.transition === 'invalidation', 'invalidation fired')
  assert.equal(sent.length, 2)

  const all = await query("SELECT count(*)::int c FROM events WHERE ticker=$1 AND source='alert'", [SYM])
  assert.equal(all.rows[0].c, 2)
})
