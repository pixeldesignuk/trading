// secrets.js — AES-256-GCM encryption for broker credentials stored in the DB.
// The master key comes from env APP_ENCRYPTION_KEY (32 bytes, base64). Credentials
// are decrypted only at sync time and never logged or returned to the client.
import crypto from 'node:crypto'

function keyFromEnv() {
  const b64 = process.env.APP_ENCRYPTION_KEY
  if (!b64) throw new Error('APP_ENCRYPTION_KEY is not set')
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to 32 bytes (base64)')
  return key
}

// Encrypt an object → { iv, tag, ciphertext } (all base64). A fresh random IV per
// call makes the ciphertext non-deterministic.
export function encrypt(obj, key = keyFromEnv()) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

// Decrypt { iv, tag, ciphertext } → the original object. Throws if the auth tag
// fails (tampered ciphertext or wrong key).
export function decrypt(enc, key = keyFromEnv()) {
  const iv = Buffer.from(enc.iv, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8'))
}

// Generate a fresh master key (base64) — for `openssl rand`-style provisioning.
export function generateKey() {
  return crypto.randomBytes(32).toString('base64')
}

// Is a usable APP_ENCRYPTION_KEY present? Callers gate broker sync on this so a
// missing key disables sync with a clear message instead of crashing.
export function hasKey() {
  const b64 = process.env.APP_ENCRYPTION_KEY
  if (!b64) return false
  try {
    return Buffer.from(b64, 'base64').length === 32
  } catch {
    return false
  }
}
