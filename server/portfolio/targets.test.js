import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TARGETS, getTargets, setTargets, normalizeTargets, fromRow } from './targets.js'

const sumL1 = (t) => t.core_pct + t.satellite_pct + t.picks_pct + t.cash_pct

// --- legacy-compat tests (updated for v2: sleeveSum/validateTargets removed) ---

test('personal defaults sum to 1', () => {
  assert.ok(Math.abs(sumL1(DEFAULT_TARGETS.personal) - 1) < 1e-9)
  assert.ok(Math.abs(sumL1(DEFAULT_TARGETS.kids) - 1) < 1e-9)
})

test('normalizeTargets clamps rather than rejects bad inputs (v2 replaces validateTargets)', () => {
  // valid input normalises to 1
  const good = normalizeTargets({ ...DEFAULT_TARGETS.personal })
  assert.ok(Math.abs(sumL1(good) - 1) < 1e-9)
  // bad input is renormalised, not rejected
  const bad = normalizeTargets({ ...DEFAULT_TARGETS.personal, cash_pct: 0.5 })
  assert.ok(Math.abs(sumL1(bad) - 1) < 1e-9)
})

test('getTargets seeds the masterclass default when no row exists', async () => {
  const q = async () => ({ rows: [] })
  const t = await getTargets('personal', { q })
  assert.equal(t.core_pct, 0.60)
  assert.equal(t.benchmark, 'MSCI World Islamic')
})

test('setTargets normalises and writes v2 columns (v2 does not throw on bad sums)', async () => {
  let wrote = false
  const q = async (sql) => { if (/insert|update/i.test(sql)) wrote = true; return { rows: [] } }
  // v2 normalises rather than throwing; the write should happen
  await setTargets('personal', { cash_pct: 0.9 }, { q })
  assert.equal(wrote, true)
})

// --- new v2 tests ---

test('DEFAULT_TARGETS.personal is the 4-bucket v2 shape summing to 1', () => {
  const p = DEFAULT_TARGETS.personal
  assert.ok(Math.abs(sumL1(p) - 1) < 1e-9)
  assert.deepEqual([p.core_pct, p.satellite_pct, p.picks_pct, p.cash_pct], [0.60, 0.20, 0.12, 0.08])
})

test('normalizeTargets renormalises bad L1 sums and drops unknown theme keys', () => {
  const t = normalizeTargets({ core_pct: 6, satellite_pct: 2, picks_pct: 1.2, cash_pct: 0.8,
    satellite_theme_splits: { tech: 1, junk: 5 }, satellite_tier_targets: {}, active_risk_cap_pct: 9 })
  assert.ok(Math.abs(sumL1(t) - 1) < 1e-9)
  assert.equal(t.satellite_theme_splits.junk, undefined)
  assert.equal(t.active_risk_cap_pct, 0.05) // clamped
})

test('fromRow derives v2 from a legacy v1 row (crypto folds into satellite)', () => {
  const v2 = fromRow({ book: 'personal', schema_version: 1, core_pct: 0.6, sat_etf_pct: 0.1,
    crypto_pct: 0.1, picks_pct: 0.12, cash_pct: 0.08, active_risk_cap_pct: 0.02, benchmark: 'MSCI World Islamic' })
  assert.ok(Math.abs(v2.satellite_pct - 0.20) < 1e-9) // 0.10 + 0.10
  assert.equal(v2.satellite_theme_splits.crypto, 0.15)
})

test('targets carry normalised core_type_splits; unknown keys dropped', () => {
  const p = DEFAULT_TARGETS.personal
  assert.ok(Math.abs(Object.values(p.core_type_splits).reduce((a,b)=>a+b,0) - 1) < 1e-9)
  const n = normalizeTargets({ ...p, core_type_splits: { world: 2, us: 1, quality_income: 1, junk: 9 } })
  assert.equal(n.core_type_splits.junk, undefined)
  assert.ok(Math.abs(Object.values(n.core_type_splits).reduce((a,b)=>a+b,0) - 1) < 1e-9)
})
