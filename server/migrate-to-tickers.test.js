import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mtRowToSignal, parseTradeList } from './migrate-to-tickers.js'

test('mtRowToSignal maps a moneytaur_setups row to an ingest signal', () => {
  const s = mtRowToSignal({
    tweet_id: 't1', ticker: 'MSTR', asset: 'MicroStrategy', asset_class: 'stock',
    entry: '$300', targets_json: '["$400"]', grade_score: 7, grade_verdict: 'partial',
    sharia_status: 'questionable', posted_at: '2026-06-20', url: 'https://x.com/1',
  })
  assert.equal(s.symbol, 'MSTR')
  assert.equal(s.source, 'moneytaur')
  assert.equal(s.native_id, 't1')
  assert.deepEqual(s.payload.targets, ['$400'])
  assert.equal(s.payload.grade_score, 7)
})

test('parseTradeList reads the Quick reference table into signals with plans', () => {
  const md = [
    '## Quick reference',
    '| Ticker | TF | Status | Entry | Next add | First target | Invalidation |',
    '|--------|----|--------|-------|----------|--------------|--------------|',
    '| CRSP | 1W | In | $51.17 | $46 | $60.39 | <$30 wk close |',
    '| XPEV | 1W | Watch | — | $11–14 | $28.50 | <$11 wk close |',
  ].join('\n')
  const out = parseTradeList(md)
  assert.equal(out.length, 2)
  const crsp = out.find((s) => s.symbol === 'CRSP')
  assert.equal(crsp.source, 'manual')
  assert.equal(crsp.payload.entry, '$51.17')
  assert.equal(crsp.payload.invalidation, '<$30 wk close')
})
