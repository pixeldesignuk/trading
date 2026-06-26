import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseZoya } from './zoya.js'
import { parseMusaffa } from './musaffa.js'
import { parseMuslimXchange } from './mxchange.js'
import { aggregate, badgeFor } from './screen.js'
import { fetchOne, PROVIDERS } from './providers.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fx = (name) => fs.readFileSync(path.join(dir, 'fixtures', name), 'utf8')

// ── Parsers against real captured HTML ──────────────────────────────────────
test('parseZoya reads the verdict (NVDA compliant, JPM not)', () => {
  assert.equal(parseZoya(fx('zoya-NVDA.html')), 'compliant')
  assert.equal(parseZoya(fx('zoya-JPM.html')), 'non_compliant')
  assert.equal(parseZoya('<p>no verdict here</p>'), 'unknown')
})

test('parseMusaffa reads the JSON API (CWCO compliant, COP not, synthetic doubtful)', () => {
  assert.equal(parseMusaffa(fx('musaffa-CWCO.json')), 'compliant')
  assert.equal(parseMusaffa(fx('musaffa-COP.json')), 'non_compliant')
  assert.equal(parseMusaffa(JSON.stringify({ data: [{ compliance_status: 'DOUBTFUL', report_date: '2026-03-31' }] })), 'doubtful')
  assert.equal(parseMusaffa(JSON.stringify({ data: [] })), 'unknown') // not covered
  assert.equal(parseMusaffa('<html>not json</html>'), 'unknown')
})

test('parseMuslimXchange reads the verdict (NVDA pass, JPM fail)', () => {
  assert.equal(parseMuslimXchange(fx('mxchange-NVDA.html')), 'compliant')
  assert.equal(parseMuslimXchange(fx('mxchange-JPM.html')), 'non_compliant')
  assert.equal(parseMuslimXchange('<span>nothing</span>'), 'unknown')
})

// ── Aggregation (the 2-of-3 rule) ───────────────────────────────────────────
test('aggregate clears only on >=2 explicit compliant', () => {
  assert.deepEqual(aggregate(['compliant', 'non_compliant', 'compliant']), { verdict: 'cleared', compliant_count: 2 })
  assert.deepEqual(aggregate(['compliant', 'compliant', 'compliant']), { verdict: 'cleared', compliant_count: 3 })
  assert.deepEqual(aggregate(['compliant', 'doubtful', 'unknown']), { verdict: 'not_cleared', compliant_count: 1 })
  assert.deepEqual(aggregate(['non_compliant', 'non_compliant', 'compliant']), { verdict: 'not_cleared', compliant_count: 1 })
  assert.deepEqual(aggregate(['unknown', 'unknown', 'unknown']), { verdict: 'not_cleared', compliant_count: 0 })
})

test('badgeFor: inconclusive only on a genuine tie (1 yes + a no-data source)', () => {
  assert.equal(badgeFor(3, 0), 'compliant')
  assert.equal(badgeFor(2, 0), 'compliant')
  assert.equal(badgeFor(1, 0), 'questionable')   // 1 yes, all rated → questionable
  assert.equal(badgeFor(1, 1), 'inconclusive')   // CRSP: 1 yes, 1 no, 1 no-data → tie
  assert.equal(badgeFor(0, 1), 'non_compliant')  // BRK-B: 0 yes, 2 no, 1 no-data → avoid
  assert.equal(badgeFor(0, 0), 'non_compliant')  // all rated, none compliant → avoid
})

// ── fetchOne fail-safe ──────────────────────────────────────────────────────
test('fetchOne maps non-200 and thrown errors to unknown', async () => {
  const p = PROVIDERS[0]
  assert.equal((await fetchOne(p, 'AAPL', { fetchImpl: async () => ({ ok: false, status: 404 }) })).status, 'unknown')
  assert.equal((await fetchOne(p, 'AAPL', { fetchImpl: async () => { throw new Error('network') } })).status, 'unknown')
  const ok = await fetchOne(p, 'AAPL', { fetchImpl: async () => ({ ok: true, text: async () => 'is Shariah-compliant' }) })
  assert.deepEqual(ok, { name: 'zoya', status: 'compliant', url: 'https://zoya.finance/stocks/aapl' })
})
