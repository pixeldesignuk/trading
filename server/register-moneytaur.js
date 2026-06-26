// CLI: register Moneytaur setups (+ optional chart index) into the webapp DB.
// Usage: node server/register-moneytaur.js <moneytaur.json>
import fs from 'node:fs'
import { ingestMoneytaur } from './moneytaur.js'

const file = process.argv[2]
if (!file) { console.error('usage: node server/register-moneytaur.js <moneytaur.json>'); process.exit(1) }
const payload = JSON.parse(fs.readFileSync(file, 'utf8'))

const res = await ingestMoneytaur(payload)
console.log(`Registered ${res.setups} setups / ${res.charts} charts.`)
