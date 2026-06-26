import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createAccount } from './accounts-store.js'
import { decrypt } from './secrets.js'

// A fixed key so encrypt/decrypt work without a real env in tests.
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')

function fakeQuery(ownerRel = 'self') {
  const calls = []
  const q = async (text, params) => {
    calls.push({ text, params })
    if (/FROM owners WHERE id/.test(text)) return { rows: [{ relationship: ownerRel }] }
    return { rows: [] }
  }
  return { q, calls }
}

test('createAccount rejects an unknown provider', async () => {
  const { q } = fakeQuery()
  await assert.rejects(() => createAccount({ owner_id: 'me', provider: 'nope', label: 'X', credentials: {} }, { q }), /unknown provider/)
})

test('createAccount requires all non-optional credential fields', async () => {
  const { q } = fakeQuery()
  await assert.rejects(
    () => createAccount({ owner_id: 'me', provider: 'bitget', label: 'X', credentials: { apiKey: 'k' } }, { q }),
    /missing credential: apiSecret/,
  )
})

test('createAccount stores ENCRYPTED credentials (never plaintext) and derives book', async () => {
  const { q, calls } = fakeQuery('child')
  const id = await createAccount(
    { owner_id: 'kid', provider: 'bitget', account_type: 'crypto', label: 'Spot', credentials: { apiKey: 'k', apiSecret: 's', passphrase: 'p' } },
    { q },
  )
  assert.equal(id, 'bitget-spot')
  const insert = calls.find((c) => /INSERT INTO broker_accounts/.test(c.text))
  assert.ok(insert)
  // params: [id, provider, label, owner_id, account_type, enc, provider_ref, book]
  assert.equal(insert.params[1], 'bitget')
  assert.equal(insert.params[7], 'kids') // child owner → kids book
  const enc = insert.params[5]
  assert.ok(enc.iv && enc.tag && enc.ciphertext, 'stored as {iv,tag,ciphertext}')
  const raw = JSON.stringify(enc)
  assert.ok(!raw.includes('apiSecret') && !raw.includes('"s"'), 'no plaintext secret in the stored blob')
  assert.deepEqual(decrypt(enc), { apiKey: 'k', apiSecret: 's', passphrase: 'p' })
})
