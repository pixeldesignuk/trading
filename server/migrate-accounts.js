// One-off migration: stand up the accounts & owners model on top of the existing
// broker_accounts data. Idempotent — safe to re-run.
//   1. apply schema (households/owners + new broker_accounts/allocation_targets cols)
//   2. seed a default household + owners (me, kids)
//   3. backfill owner_id from the old `book` column
//   4. import T212_ACCOUNTS env creds into broker_accounts.credentials_enc (encrypted)
// Run: node --env-file-if-exists=.env server/migrate-accounts.js
import { pool, query, init } from './db.js'
import { encrypt, hasKey } from './brokers/secrets.js'
import { parseAccounts } from './brokers/accounts.js'

async function main() {
  await init() // applies schema.sql incl. the new tables/columns

  // 2. seed household + owners
  await query(`INSERT INTO households (id, name) VALUES ('my-family', 'My family')
               ON CONFLICT (id) DO NOTHING`)
  await query(
    `INSERT INTO owners (id, household_id, name, relationship, role, color) VALUES
       ('me',   'my-family', 'Me',   'self',  'owner', '#34d399'),
       ('kids', 'my-family', 'Kids', 'child', 'owner', '#a78bfa')
     ON CONFLICT (id) DO NOTHING`,
  )

  // 3. backfill owner_id from book (personal/null → me, kids → kids)
  await query(`UPDATE broker_accounts   SET owner_id='me'   WHERE owner_id IS NULL AND (book='personal' OR book IS NULL)`)
  await query(`UPDATE broker_accounts   SET owner_id='kids' WHERE owner_id IS NULL AND book='kids'`)
  await query(`UPDATE allocation_targets SET owner_id='me'   WHERE owner_id IS NULL AND book='personal'`)
  await query(`UPDATE allocation_targets SET owner_id='kids' WHERE owner_id IS NULL AND book='kids'`)

  // 4. import existing T212 creds into the encrypted column (keyed by account id)
  let imported = 0
  if (hasKey()) {
    for (const a of parseAccounts(process.env.T212_ACCOUNTS)) {
      const enc = encrypt({ keyId: a.keyId, secret: a.secret, baseUrl: a.baseUrl })
      const { rowCount } = await query(
        `UPDATE broker_accounts SET credentials_enc=$2, status='active' WHERE id=$1`,
        [a.id, enc],
      )
      imported += rowCount
    }
  } else {
    console.warn('[migrate] APP_ENCRYPTION_KEY not set — skipped credential import')
  }

  const owners = await query('SELECT id, name, relationship FROM owners ORDER BY id')
  const accts = await query(
    `SELECT id, broker, owner_id, book, (credentials_enc IS NOT NULL) AS has_creds FROM broker_accounts ORDER BY id`,
  )
  console.log('owners:', owners.rows)
  console.log('accounts:', accts.rows)
  console.log(`credentials imported into ${imported} account(s)`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
