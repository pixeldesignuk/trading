import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { encrypt, decrypt, generateKey, hasKey } from './secrets.js'

// A fixed 32-byte key so tests don't depend on env. Both encrypt/decrypt accept
// an explicit key argument (defaulting to APP_ENCRYPTION_KEY in production).
const KEY = crypto.createHash('sha256').update('test-key').digest() // 32 bytes

test('encrypt → decrypt round-trips an object', () => {
  const secret = { apiKey: 'abc', apiSecret: 'shh', passphrase: 'p@ss' }
  const enc = encrypt(secret, KEY)
  assert.deepEqual(decrypt(enc, KEY), secret)
})

test('ciphertext is non-deterministic (fresh iv each call)', () => {
  const a = encrypt({ x: 1 }, KEY)
  const b = encrypt({ x: 1 }, KEY)
  assert.notEqual(a.ciphertext, b.ciphertext)
  assert.notEqual(a.iv, b.iv)
})

test('tampered ciphertext is rejected (auth tag)', () => {
  const enc = encrypt({ x: 1 }, KEY)
  const buf = Buffer.from(enc.ciphertext, 'base64')
  buf[0] ^= 0xff
  const tampered = { ...enc, ciphertext: buf.toString('base64') }
  assert.throws(() => decrypt(tampered, KEY))
})

test('a different key cannot decrypt', () => {
  const enc = encrypt({ x: 1 }, KEY)
  const other = crypto.createHash('sha256').update('other').digest()
  assert.throws(() => decrypt(enc, other))
})

test('generateKey returns a 32-byte base64 key; hasKey validates env', () => {
  const k = generateKey()
  assert.equal(Buffer.from(k, 'base64').length, 32)
  const prev = process.env.APP_ENCRYPTION_KEY
  process.env.APP_ENCRYPTION_KEY = k
  assert.equal(hasKey(), true)
  delete process.env.APP_ENCRYPTION_KEY
  assert.equal(hasKey(), false)
  if (prev != null) process.env.APP_ENCRYPTION_KEY = prev
})
