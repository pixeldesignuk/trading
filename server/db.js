import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { DATABASE_URL } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const pool = new pg.Pool({ connectionString: DATABASE_URL })

export function query(text, params) {
  return pool.query(text, params)
}

const TRANSIENT = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Idempotent bootstrap: run the schema (CREATE TABLE IF NOT EXISTS) on start.
// Retries transient connectivity errors (e.g. a momentary DNS blip resolving
// the Railway proxy host) so `pnpm dev` doesn't hard-crash on a network hiccup.
export async function init({ retries = 5, delayMs = 1500 } = {}) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql)
      break
    } catch (err) {
      if (TRANSIENT.has(err.code) && attempt < retries) {
        console.warn(`[db] ${err.code} connecting (attempt ${attempt}/${retries}) — retrying in ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }
      throw err
    }
  }
  // Idempotent column additions — safe to run on an existing DB.
  for (const col of [
    'ai_thesis TEXT', 'ai_thesis_at TIMESTAMPTZ',
    'synthesis JSONB', 'synth_at TIMESTAMPTZ', 'synth_hash TEXT',
    'sharia_screen JSONB', 'sharia_screen_at TIMESTAMPTZ',
  ]) {
    try { await pool.query(`ALTER TABLE tickers ADD COLUMN ${col}`) } catch { /* already exists */ }
  }
}
