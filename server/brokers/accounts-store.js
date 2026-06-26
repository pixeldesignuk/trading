// accounts-store.js — CRUD for households / owners / accounts behind the Accounts
// admin UI. Credentials are encrypted on write (secrets.js) and never read back to
// the client — list responses expose only presence + sync status. The provider's
// credential schema (registry) is validated on create.
import { query } from '../db.js'
import { encrypt } from './secrets.js'
import { REGISTRY, providerCatalog } from './registry.js'

const slug = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'

// Full picture for the admin UI: households, owners, accounts (no secrets),
// and the provider catalogue that drives the add-account form.
export async function listAccounts({ q = query } = {}) {
  const households = (await q('SELECT id, name FROM households ORDER BY name')).rows
  const owners = (await q(
    'SELECT id, household_id, name, relationship, role, color FROM owners ORDER BY relationship, name',
  )).rows
  const accounts = (await q(
    `SELECT id, owner_id, broker AS provider, account_type, label, status, error, synced_at,
            total_value, currency, provider_ref, (credentials_enc IS NOT NULL) AS has_creds
       FROM broker_accounts ORDER BY id`,
  )).rows
  return { households, owners, accounts, providers: providerCatalog() }
}

export async function createHousehold({ name, id = null }, { q = query } = {}) {
  if (!name) throw new Error('name required')
  const hid = id || slug(name)
  await q('INSERT INTO households (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name', [hid, name])
  return hid
}

export async function createOwner(
  { id = null, name, relationship = 'self', role = 'owner', color = null, household_id = 'my-family' },
  { q = query } = {},
) {
  if (!name) throw new Error('name required')
  const oid = id || slug(name)
  // ensure the household exists (default 'My family')
  await q(
    `INSERT INTO households (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [household_id, household_id === 'my-family' ? 'My family' : household_id],
  )
  await q(
    `INSERT INTO owners (id, household_id, name, relationship, role, color)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, relationship=EXCLUDED.relationship,
       role=EXCLUDED.role, color=EXCLUDED.color, household_id=EXCLUDED.household_id`,
    [oid, household_id, name, relationship, role, color],
  )
  return oid
}

export async function createAccount(
  { owner_id, provider, account_type = null, label, credentials, provider_ref = null },
  { q = query } = {},
) {
  const p = REGISTRY[provider]
  if (!p) throw new Error(`unknown provider: ${provider}`)
  if (!owner_id) throw new Error('owner_id required')
  if (!label) throw new Error('label required')
  for (const f of p.credentialFields || []) {
    if (!f.optional && !credentials?.[f.name]) throw new Error(`missing credential: ${f.name}`)
  }
  // Derive the legacy `book` from the owner so the account slots into the current
  // per-book ledger until the per-owner rework lands.
  const owner = (await q('SELECT relationship FROM owners WHERE id=$1', [owner_id])).rows[0]
  const book = owner?.relationship === 'child' ? 'kids' : 'personal'
  const id = `${provider}-${slug(label)}`
  const enc = encrypt(credentials)
  await q(
    `INSERT INTO broker_accounts (id, broker, label, owner_id, account_type, credentials_enc, provider_ref, status, book)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)
     ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, owner_id=EXCLUDED.owner_id,
       account_type=EXCLUDED.account_type, credentials_enc=EXCLUDED.credentials_enc,
       provider_ref=EXCLUDED.provider_ref, status='active', book=EXCLUDED.book`,
    [id, provider, label, owner_id, account_type, enc, provider_ref, book],
  )
  return id
}

export async function deleteAccount(id, { q = query } = {}) {
  await q('DELETE FROM broker_accounts WHERE id=$1', [id]) // holdings cascade
}
