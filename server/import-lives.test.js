import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { liveShotToChart, liveMentionPayload } from './import-lives.js'

const KNOWN = new Set(['XPEV', 'MSTR', 'BTC', 'MOS', 'SOL', 'MRNA', 'SILVER', 'WMT', 'NFLX', 'UBER', 'COIN'])

describe('liveMentionPayload', () => {
  it('stamps the per-ticker read, not the global tldr', () => {
    const rec = { prose: 'Exploded +193%, scale out into 83/85/95/105', spot_action: 'Hold spot bag', sharia_status: 'questionable', sharia_text: 'questionable — pharma' }
    const p = liveMentionPayload(rec, 'GLOBAL TLDR')
    assert.equal(p.text, 'Exploded +193%, scale out into 83/85/95/105')
    assert.equal(p.note, 'Spot: Hold spot bag')
    assert.equal(p.sharia_status, 'questionable')
    assert.ok(!p.text.includes('GLOBAL'))
  })
  it('falls back to the live blurb only when the ticker has no record', () => {
    assert.deepEqual(liveMentionPayload(null, 'GLOBAL TLDR'), { text: 'GLOBAL TLDR' })
  })
  it('uses zeros_read when prose is absent (table-only row)', () => {
    const p = liveMentionPayload({ prose: null, zeros_read: 'Add on flip', spot_action: 'demand after >24.49 close' }, 'fb')
    assert.equal(p.text, 'Add on flip')
    assert.equal(p.note, 'Spot: demand after >24.49 close')
  })
})

describe('liveShotToChart', () => {
  it('extracts XPEV from "XPeng" — lower-case label produces no uppercase match → null', () => {
    // "XPeng" has no standalone [A-Z]{2,6} token matching XPEV
    const shot = { ord: 14, label: 'XPeng', file: 'media/lives/2026-06-15-weekly-market-update/13-XPENG.png' }
    const result = liveShotToChart(shot, '2026-06-15-weekly-market-update', KNOWN)
    // "XPeng" yields no uppercase-only token → symbol should be null
    assert.equal(result.symbol, null)
    assert.equal(result.native_id, 'live:2026-06-15-weekly-market-update:14')
    assert.equal(result.srcFile, 'media/lives/2026-06-15-weekly-market-update/13-XPENG.png')
  })

  it('extracts XPEV from label "XPEV weekly demand"', () => {
    const shot = { ord: 5, label: 'XPEV weekly demand', file: 'media/lives/test/shot.png' }
    const result = liveShotToChart(shot, 'test-slug', KNOWN)
    assert.equal(result.symbol, 'XPEV')
    assert.equal(result.native_id, 'live:test-slug:5')
  })

  it('returns null for "Market overview" (no known ticker)', () => {
    const shot = { ord: 0, label: 'Market overview', file: 'media/lives/test/overview.png' }
    const result = liveShotToChart(shot, 'test-slug', KNOWN)
    assert.equal(result.symbol, null)
  })

  it('extracts MSTR from label "MSTR"', () => {
    const shot = { ord: 3, label: 'MSTR', file: 'media/lives/2026-06-22-weekly-market-update/04-MSTR.png' }
    const result = liveShotToChart(shot, '2026-06-22-weekly-market-update', KNOWN)
    assert.equal(result.symbol, 'MSTR')
    assert.equal(result.native_id, 'live:2026-06-22-weekly-market-update:3')
  })

  it('extracts BTC from "BTC"', () => {
    const shot = { ord: 0, label: 'BTC', file: 'media/lives/2026-06-15-weekly-market-update/01-BTC.png' }
    const result = liveShotToChart(shot, '2026-06-15-weekly-market-update', KNOWN)
    assert.equal(result.symbol, 'BTC')
  })

  it('extracts SILVER from label "SILVER"', () => {
    const shot = { ord: 5, label: 'SILVER', file: 'media/lives/2026-06-22-weekly-market-update/06-SILVER.png' }
    const result = liveShotToChart(shot, '2026-06-22-weekly-market-update', KNOWN)
    assert.equal(result.symbol, 'SILVER')
  })

  it('returns null for "USDT.D" (not in known symbols)', () => {
    const shot = { ord: 1, label: 'USDT.D', file: 'media/lives/test/usdt.png' }
    const result = liveShotToChart(shot, 'test-slug', KNOWN)
    assert.equal(result.symbol, null)
  })

  it('returns null for "Gold" (no uppercase token)', () => {
    const shot = { ord: 5, label: 'Gold', file: 'media/lives/test/gold.png' }
    const result = liveShotToChart(shot, 'test-slug', KNOWN)
    assert.equal(result.symbol, null)
  })

  it('extracts COIN from "COIN (Coinbase)"', () => {
    const shot = { ord: 2, label: 'COIN (Coinbase)', file: 'media/lives/2026-06-22-weekly-market-update/03-COIN.png' }
    const result = liveShotToChart(shot, '2026-06-22-weekly-market-update', KNOWN)
    assert.equal(result.symbol, 'COIN')
  })

  it('extracts MRNA from "MRNA"', () => {
    const shot = { ord: 9, label: 'MRNA', file: 'media/lives/2026-06-22-weekly-market-update/10-MRNA.png' }
    const result = liveShotToChart(shot, '2026-06-22-weekly-market-update', KNOWN)
    assert.equal(result.symbol, 'MRNA')
  })

  it('extracts UBER from "UBER (new setup)"', () => {
    const shot = { ord: 10, label: 'UBER (new setup)', file: 'media/lives/2026-06-22-weekly-market-update/11-UBER.png' }
    const result = liveShotToChart(shot, '2026-06-22-weekly-market-update', KNOWN)
    assert.equal(result.symbol, 'UBER')
  })

  it('extracts first known token when multiple uppercase tokens present', () => {
    // "MOS SOL" → both known, should pick first match
    const shot = { ord: 7, label: 'MOS SOL compare', file: 'media/lives/test/multi.png' }
    const result = liveShotToChart(shot, 'test-slug', KNOWN)
    assert.equal(result.symbol, 'MOS')
  })

  it('returned occurred_at is null (caller fills it from slug date)', () => {
    const shot = { ord: 0, label: 'BTC', file: 'media/lives/test/btc.png' }
    const result = liveShotToChart(shot, 'test-slug', KNOWN)
    assert.equal(result.occurred_at, null)
  })

  it('handles empty label gracefully', () => {
    const shot = { ord: 0, label: '', file: 'media/lives/test/empty.png' }
    const result = liveShotToChart(shot, 'test-slug', KNOWN)
    assert.equal(result.symbol, null)
  })

  it('handles null label gracefully', () => {
    const shot = { ord: 0, label: null, file: 'media/lives/test/null.png' }
    const result = liveShotToChart(shot, 'test-slug', KNOWN)
    assert.equal(result.symbol, null)
  })
})
