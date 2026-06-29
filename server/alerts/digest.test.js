import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDigestMessage } from './digest.js'

// June 2026 is BST (UTC+1): 06:00Z → 07:00 London (morning), 20:30Z → 21:30 (evening).
const MORN = Date.UTC(2026, 5, 29, 6, 0)
const EVE = Date.UTC(2026, 5, 29, 20, 30)

const inBuy = { symbol: 'MSTR', state: 'in_buy', price: 82.31, plan: { entryLow: 78, entryHigh: 82, invalidation: 70, targets: [95, 110] } }
const nearTgt = { symbol: 'SOL', state: 'near_target', price: 158.4, plan: { invalidation: 120, targets: [160, 180] } }
const breached = { symbol: 'NIO', state: 'past_invalidation', price: 4.86, plan: { invalidation: 5.0, targets: [] } }

test('header reflects London morning/evening + date', () => {
  assert.match(buildDigestMessage({ actionable: [inBuy] }, { now: MORN }), /morning digest · Mon 29 Jun/)
  assert.match(buildDigestMessage({ actionable: [inBuy] }, { now: EVE }), /evening digest · Mon 29 Jun/)
})

test('actionable lines are shaped by state', () => {
  const msg = buildDigestMessage({ actionable: [inBuy, nearTgt, breached] }, { now: MORN })
  assert.match(msg, /⚡ Actionable \(3\)/)
  assert.match(msg, /🟢 MSTR · in buy 78–82 · now 82.31 · stop 70 · targets 95 \/ 110/)
  assert.match(msg, /🎯 SOL · near target 160 · now 158.4 · stop 120/)
  assert.match(msg, /🔴 NIO · breached stop 5 · now 4.86/)
})

test('single-point entry zone renders one number, no fake band', () => {
  const pt = { symbol: 'X', state: 'in_buy', price: 10, plan: { entryLow: 9, entryHigh: 9, invalidation: 8, targets: [] } }
  assert.match(buildDigestMessage({ actionable: [pt] }, { now: MORN }), /in buy 9 · now 10 · stop 8/)
})

test('pending custom alerts: distance shown when priced, omitted when not', () => {
  const customs = [
    { symbol: 'MSTR', direction: 'above', price: 350, note: 'breakout', livePrice: 82.31, awayPct: 325.1 },
    { symbol: 'OByte', direction: 'below', price: 0.5, note: null, livePrice: null, awayPct: null },
  ]
  const msg = buildDigestMessage({ actionable: [], customs }, { now: EVE })
  assert.match(msg, /🔔 Pending custom alerts \(2\)/)
  assert.match(msg, /MSTR ↑ 350 · now 82.31 · 325.1% away · breakout/)
  assert.match(msg, /OByte ↓ 0.5$/m) // no live price → no "now"/"away" tail, no note
})

test('empty → a brief all-quiet heartbeat', () => {
  const msg = buildDigestMessage({ actionable: [], customs: [] }, { now: MORN })
  assert.match(msg, /✅ All quiet — no actionable setups, no custom alerts pending\./)
  assert.doesNotMatch(msg, /Actionable|Pending/)
})

test('both sections appear with a blank separator', () => {
  const msg = buildDigestMessage({ actionable: [inBuy], customs: [{ symbol: 'SOL', direction: 'above', price: 200, livePrice: 158, awayPct: 26.6 }] }, { now: MORN })
  assert.match(msg, /⚡ Actionable \(1\)[\s\S]*\n\n🔔 Pending custom alerts \(1\)/)
})
