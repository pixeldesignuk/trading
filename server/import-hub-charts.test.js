import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { hubRecordToCharts } from './import-hub-charts.js'

// Real sampled record from dojo-archive/hub.jsonl (first line, COP)
const COP_RECORD = {
  hub_id: '6a34d95b8d00250880100575',
  name: 'COP SPOT',
  ticker: 'COP',
  asset: 'CONOCOPHILLIPS',
  asset_type: 'STOCK',
  type: 'SPOT',
  status: 'PLANNED',
  published_at: '2026-06-19T06:02:33.965Z',
  entry: 102.5,
  leverage: null,
  size: 2.5,
  strategies: ['BREAKER'],
  targets: [
    { n: 'TP1', p: 120, hit: false },
    { n: 'TP2', p: 130, hit: false },
  ],
  info: {
    entry: 'The idea is to utilize the 3M breaker to catch an entry...',
    exit: 'First take profit at $120, VAH + 4/5D supply, trailing mode.',
    invalidation: 'Starting to close below the 3M BB would constitute a major sign of further weakness.',
    sizing: '',
  },
  emotions: ['DISCIPLINED', 'FOCUSED'],
  media: [
    {
      name: 'COP_2026-06-19_08-02-13.png',
      file: 'charts/6a34d95b8d00250880100575-0-COP_2026-06-19_08-02-13.png',
    },
  ],
  created_at: '2026-06-19T05:53:31.494Z',
  updated_at: '2026-06-19T06:02:31.524Z',
  archived_at: '2026-06-22T09:54:44.498Z',
}

describe('hubRecordToCharts', () => {
  it('maps a single-media record to one chart entry', () => {
    const charts = hubRecordToCharts(COP_RECORD)
    assert.equal(charts.length, 1)
    const [c] = charts
    assert.equal(c.symbol, 'COP')
    assert.equal(c.srcFile, 'charts/6a34d95b8d00250880100575-0-COP_2026-06-19_08-02-13.png')
    assert.equal(c.native_id, 'hub:6a34d95b8d00250880100575:0')
    assert.equal(c.occurred_at, '2026-06-19T06:02:33.965Z')
  })

  it('returns one entry per media item', () => {
    const multi = {
      ...COP_RECORD,
      hub_id: 'abc123',
      ticker: 'MSTR',
      media: [
        { name: 'a.png', file: 'charts/abc123-0-a.png' },
        { name: 'b.png', file: 'charts/abc123-1-b.png' },
      ],
    }
    const charts = hubRecordToCharts(multi)
    assert.equal(charts.length, 2)
    assert.equal(charts[0].native_id, 'hub:abc123:0')
    assert.equal(charts[1].native_id, 'hub:abc123:1')
    assert.equal(charts[0].symbol, 'MSTR')
    assert.equal(charts[1].srcFile, 'charts/abc123-1-b.png')
  })

  it('returns empty array when media is absent', () => {
    const noMedia = { ...COP_RECORD, media: [] }
    assert.deepEqual(hubRecordToCharts(noMedia), [])
  })

  it('returns empty array when media is null/undefined', () => {
    const nullMedia = { ...COP_RECORD, media: null }
    assert.deepEqual(hubRecordToCharts(nullMedia), [])
  })
})
