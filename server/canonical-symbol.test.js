import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalSymbol } from './tickers.js'

test('US class shares fold .<letter> → -<letter> (Yahoo form)', () => {
  assert.equal(canonicalSymbol('BRK.B'), 'BRK-B')
  assert.equal(canonicalSymbol('BF.B'), 'BF-B')
  assert.equal(canonicalSymbol('BRK.A'), 'BRK-A')
})

test('already-canonical and plain symbols are unchanged', () => {
  assert.equal(canonicalSymbol('BRK-B'), 'BRK-B')
  assert.equal(canonicalSymbol('AAPL'), 'AAPL')
})

test('multi-letter suffixes (GBP lines), crypto and futures are left alone', () => {
  assert.equal(canonicalSymbol('ISWD.GB'), 'ISWD.GB')   // hub GBP-line symbol, not a class share
  assert.equal(canonicalSymbol('ETH/EUR'), 'ETH/EUR')   // crypto pair
  assert.equal(canonicalSymbol('PA=F'), 'PA=F')         // future
})

test('whitespace is trimmed; empty/nullish → empty string', () => {
  assert.equal(canonicalSymbol('  BRK.B '), 'BRK-B')
  assert.equal(canonicalSymbol(null), '')
  assert.equal(canonicalSymbol(undefined), '')
})
