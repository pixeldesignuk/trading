import { query } from '../db.js'
import { normalise, DEFAULT_THEME_SPLITS, DEFAULT_TIER_TARGETS, THEMES, DEFAULT_CORE_TYPE_SPLITS, CORE_TYPES } from './satellite-model.js'

const TIERS = ['high', 'moderate', 'lower', 'defensive']
const L1 = ['core_pct', 'satellite_pct', 'picks_pct', 'cash_pct']

// Per-owner allocation targets in the v2 4-bucket shape (core / satellite /
// picks / cash, with nested satellite theme+tier splits and core sub-type
// splits). New owners seed a template by relationship: adults get the
// growth-tilted masterclass mix, children (JISA) a defensive core-heavy mix.
export const TEMPLATES = {
  adult: {
    schema_version: 2,
    core_pct: 0.60, satellite_pct: 0.20, picks_pct: 0.12, cash_pct: 0.08,
    satellite_theme_splits: { ...DEFAULT_THEME_SPLITS },
    satellite_tier_targets: { ...DEFAULT_TIER_TARGETS },
    core_type_splits: { ...DEFAULT_CORE_TYPE_SPLITS },
    active_risk_cap_pct: 0.02, benchmark: 'MSCI World Islamic',
  },
  child: {
    schema_version: 2,
    core_pct: 0.80, satellite_pct: 0.00, picks_pct: 0.00, cash_pct: 0.20,
    satellite_theme_splits: { ...DEFAULT_THEME_SPLITS },
    satellite_tier_targets: { ...DEFAULT_TIER_TARGETS },
    core_type_splits: { ...DEFAULT_CORE_TYPE_SPLITS },
    active_risk_cap_pct: 0.00, benchmark: 'MSCI World Islamic',
  },
}
export const templateFor = (relationship) => (relationship === 'child' ? TEMPLATES.child : TEMPLATES.adult)

// Back-compat alias (old per-book defaults), now in v2 shape.
export const DEFAULT_TARGETS = { personal: { book: 'personal', ...TEMPLATES.adult }, kids: { book: 'kids', ...TEMPLATES.child } }

function pick(obj, keys) { const o = {}; for (const k of keys) if (obj[k] != null) o[k] = Number(obj[k]) || 0; return o }

export function normalizeTargets(t = {}) {
  const l1 = normalise(pick(t, L1))
  // if any L1 key missing, fall back to the adult template before normalising
  const base = L1.every((k) => t[k] != null) ? l1 : normalise(pick(DEFAULT_TARGETS.personal, L1))
  const themes = normalise(pick(t.satellite_theme_splits || DEFAULT_THEME_SPLITS, THEMES))
  const tiers = normalise(pick(t.satellite_tier_targets || DEFAULT_TIER_TARGETS, TIERS))
  const ct = normalise(pick(t.core_type_splits || DEFAULT_CORE_TYPE_SPLITS, CORE_TYPES))
  return {
    owner: t.owner, book: t.book, schema_version: 2,
    core_pct: base.core_pct, satellite_pct: base.satellite_pct, picks_pct: base.picks_pct, cash_pct: base.cash_pct,
    satellite_theme_splits: Object.keys(themes).length ? themes : { ...DEFAULT_THEME_SPLITS },
    satellite_tier_targets: Object.keys(tiers).length ? tiers : { ...DEFAULT_TIER_TARGETS },
    core_type_splits: Object.keys(ct).length ? ct : { ...DEFAULT_CORE_TYPE_SPLITS },
    active_risk_cap_pct: Math.max(0, Math.min(0.05, Number(t.active_risk_cap_pct) || 0)),
    benchmark: t.benchmark || 'MSCI World Islamic',
  }
}

export function fromRow(row) {
  const v2 = Number(row.schema_version) >= 2 && row.satellite_pct != null
  const satellite_pct = v2 ? Number(row.satellite_pct) : Number(row.sat_etf_pct || 0) + Number(row.crypto_pct || 0)
  return normalizeTargets({
    owner: row.owner_id, book: row.book,
    core_pct: Number(row.core_pct), satellite_pct, picks_pct: Number(row.picks_pct), cash_pct: Number(row.cash_pct),
    satellite_theme_splits: v2 ? row.satellite_theme_splits : DEFAULT_THEME_SPLITS,
    satellite_tier_targets: v2 ? row.satellite_tier_targets : DEFAULT_TIER_TARGETS,
    core_type_splits: v2 ? row.core_type_splits : DEFAULT_CORE_TYPE_SPLITS,
    active_risk_cap_pct: Number(row.active_risk_cap_pct), benchmark: row.benchmark,
  })
}

// Per-owner targets in v2 shape. Falls back to the relationship template when no
// row exists for the owner.
export async function getTargets(ownerId, { q = query, relationship = 'self' } = {}) {
  const { rows } = await q('SELECT * FROM allocation_targets WHERE owner_id = $1', [ownerId])
  if (rows.length) return fromRow(rows[0])
  return normalizeTargets({ owner: ownerId, ...templateFor(relationship) })
}

export async function setTargets(ownerId, patch, { q = query, relationship = 'self' } = {}) {
  const current = await getTargets(ownerId, { q, relationship })
  const next = normalizeTargets({ ...current, ...patch, owner: ownerId })
  // Persist the v1 back-compat columns (sat_etf carries the full satellite; crypto 0)
  // AND the v2 bucket columns. Keyed by owner_id; `book` is the legacy PK so reuse
  // the owner's existing row, else create one keyed book=owner_id.
  const cols = [next.core_pct, next.satellite_pct, 0, next.picks_pct, next.cash_pct, false, next.active_risk_cap_pct,
                next.benchmark, next.satellite_pct, JSON.stringify(next.satellite_theme_splits),
                JSON.stringify(next.satellite_tier_targets), JSON.stringify(next.core_type_splits)]
  const existing = await q('SELECT book FROM allocation_targets WHERE owner_id = $1', [ownerId])
  if (existing.rows.length) {
    await q(
      `UPDATE allocation_targets SET core_pct=$2, sat_etf_pct=$3, crypto_pct=$4, picks_pct=$5, cash_pct=$6,
         crypto_pinned=$7, active_risk_cap_pct=$8, benchmark=$9, schema_version=2, satellite_pct=$10,
         satellite_theme_splits=$11, satellite_tier_targets=$12, core_type_splits=$13, updated_at=now()
       WHERE owner_id=$1`,
      [ownerId, ...cols],
    )
  } else {
    await q(
      `INSERT INTO allocation_targets
         (book, owner_id, core_pct, sat_etf_pct, crypto_pct, picks_pct, cash_pct, crypto_pinned, active_risk_cap_pct, benchmark,
          schema_version, satellite_pct, satellite_theme_splits, satellite_tier_targets, core_type_splits, updated_at)
       VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,2,$10,$11,$12,$13, now())`,
      [ownerId, ...cols],
    )
  }
  return next
}

// Blend several owners' v2 targets into one household-level target, value-weighted:
// household target% = Σ(target% × value) / Σ value, across L1 buckets AND the nested
// theme/tier/core-type splits; then renormalised.
export function blendTargets(perOwner) {
  const totalV = perOwner.reduce((s, o) => s + (o.value || 0), 0)
  if (totalV <= 0) return normalizeTargets({ ...TEMPLATES.adult, benchmark: perOwner[0]?.targets?.benchmark })
  const wsum = (k) => perOwner.reduce((s, o) => s + Number(o.targets?.[k] || 0) * (o.value || 0), 0) / totalV
  const wsumObj = (field, keys) =>
    Object.fromEntries(keys.map((k) => [k, perOwner.reduce((s, o) => s + Number(o.targets?.[field]?.[k] || 0) * (o.value || 0), 0) / totalV]))
  return normalizeTargets({
    core_pct: wsum('core_pct'), satellite_pct: wsum('satellite_pct'), picks_pct: wsum('picks_pct'), cash_pct: wsum('cash_pct'),
    satellite_theme_splits: wsumObj('satellite_theme_splits', THEMES),
    satellite_tier_targets: wsumObj('satellite_tier_targets', TIERS),
    core_type_splits: wsumObj('core_type_splits', CORE_TYPES),
    active_risk_cap_pct: wsum('active_risk_cap_pct'),
    benchmark: perOwner[0]?.targets?.benchmark || 'MSCI World Islamic',
  })
}
