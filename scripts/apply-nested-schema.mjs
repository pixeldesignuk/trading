import { query } from '../server/db.js'

const stmts = [
  `ALTER TABLE tickers ADD COLUMN IF NOT EXISTS satellite_theme TEXT`,
  `ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS satellite_pct NUMERIC`,
  `ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS satellite_theme_splits JSONB`,
  `ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS satellite_tier_targets JSONB`,
]
for (const s of stmts) { await query(s); console.log('ok:', s.slice(0, 60)) }
console.log('done')
process.exit(0)
