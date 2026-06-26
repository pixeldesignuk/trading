import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brokerToHubSymbol, reconcileStages } from './sync.js'

test('brokerToHubSymbol strips the T212 suffix and uppercases', () => {
  assert.equal(brokerToHubSymbol('AAPL_US_EQ'), 'AAPL')
  assert.equal(brokerToHubSymbol('NKE_US_EQ'), 'NKE')
  assert.equal(brokerToHubSymbol('VUSA_EQ'), 'VUSA')
  assert.equal(brokerToHubSymbol('btc'), 'BTC')        // no suffix, normalised
})

// reconcileStages takes an injected query so this never touches a real DB —
// it must promote held tickers to 'in' and demote no-longer-held 'in' to 'closed'.
function fakeQuery() {
  const calls = []
  const q = async (text, params) => { calls.push({ text, params }); return { rows: [] } }
  return { q, calls }
}

test('reconcileStages promotes held to in and demotes unheld in to closed', async () => {
  const { q, calls } = fakeQuery()
  await reconcileStages(['AAPL', 'NKE'], { q })
  const promote = calls.find((c) => /status\s*=\s*'in'/.test(c.text))
  const demote = calls.find((c) => /status\s*=\s*'closed'/.test(c.text))
  assert.ok(promote, 'issues a promote-to-in update')
  assert.deepEqual(promote.params, [['AAPL', 'NKE']])
  assert.ok(demote, 'issues a demote-to-closed update')
  assert.match(demote.text, /status\s*=\s*'in'/)        // only demotes rows currently 'in'
  assert.deepEqual(demote.params, [['AAPL', 'NKE']])
})

test('reconcileStages with no holdings closes all active tickers', async () => {
  const { q, calls } = fakeQuery()
  await reconcileStages([], { q })
  // no promote when nothing is held; still issues the demote so a fully-exited
  // portfolio empties the Active column
  const demote = calls.find((c) => /status\s*=\s*'closed'/.test(c.text))
  assert.ok(demote)
  assert.deepEqual(demote.params, [[]])
})
