import { query } from '../server/db.js'

const stmts = [
  `ALTER TABLE tickers ADD COLUMN IF NOT EXISTS core_type TEXT`,
  `ALTER TABLE allocation_targets ADD COLUMN IF NOT EXISTS core_type_splits JSONB`,
]
for (const s of stmts) { await query(s); console.log('ok:', s.slice(0, 60)) }
console.log('done')
process.exit(0)
