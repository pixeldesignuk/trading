import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripEmoji, normalizeTickerLabel, parseLiveSummary, shariaFromText, splitLevels } from './lives-parse.js'

const SAMPLE = `# Weekly Market Update

**TL;DR:** global context that must NOT leak onto any single ticker.

## ☪ Spot Snapshot (prioritised for you)
| Asset | Zero's read | Spot level / action | ☪ Sharia |
|---|---|---|---|
| **MSTR** | Grinding down, expecting the 2024 area lost → full rebalance | Watch the deep **March-2024 rebalance** zone for spot/long (refine LTF) | ❌ lean avoid — leveraged-BTC vehicle |
| **GOLD** | Accumulation continuing | Tap **~$4,000** | ✅ compliant via physical ETC |

## 📉 MSTR
![MSTR](screenshots/04-MSTR.png)
Going down since July-2025 → full **rebalance of the March-2024 impulse**. No appealing short here. ❌ lean avoid (leveraged-BTC vehicle).

## 🥇 GOLD
![GOLD](screenshots/01-GOLD.png)
Accumulating toward 4,000.
`

test('stripEmoji removes pictographs but keeps arrows and dashes', () => {
  assert.equal(stripEmoji('lost → full ❌ ☪ avoid — done'), 'lost → full avoid — done')
})

test('normalizeTickerLabel cleans emoji, bold, parens, slashes', () => {
  assert.equal(normalizeTickerLabel('📉 MSTR'), 'MSTR')
  assert.equal(normalizeTickerLabel('**GOLD**'), 'GOLD')
  assert.equal(normalizeTickerLabel('BTC / USDT.D'), 'BTC')
  assert.equal(normalizeTickerLabel('US OIL'), 'USOIL')
  // header taglines after an em/en dash or spaced hyphen are dropped
  assert.equal(normalizeTickerLabel('MRNA — *SPOT WINNER RUNNING*'), 'MRNA')
  assert.equal(normalizeTickerLabel('GOLD — *THE CLEAN SPOT IDEA*'), 'GOLD')
  assert.equal(normalizeTickerLabel('UBER - brand new setup'), 'UBER')
  assert.equal(normalizeTickerLabel('₿ BTC'), 'BTC')
})

test('shariaFromText maps cells to enum', () => {
  assert.equal(shariaFromText('compliant via physical ETC'), 'compliant')
  assert.equal(shariaFromText('lean avoid — leveraged-BTC vehicle'), 'questionable')
  assert.equal(shariaFromText('oil via CFD = non-compliant'), 'non_compliant')
})

test('parseLiveSummary gives MSTR its OWN prose, chart, read, and no leak', () => {
  const out = parseLiveSummary(SAMPLE, new Set(['MSTR', 'GOLD']))
  const m = out.MSTR
  assert.ok(m, 'MSTR parsed')
  assert.match(m.prose, /Going down since July-2025/)
  assert.doesNotMatch(m.prose, /TL;DR|global context/) // the global TL;DR never leaks
  assert.match(m.prose, /→/) // arrow preserved
  assert.doesNotMatch(JSON.stringify(m), /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u) // no emoji
  assert.equal(m.chartFile, 'screenshots/04-MSTR.png')
  assert.match(m.zeros_read, /Grinding down/)
  assert.match(m.spot_action, /March-2024 rebalance/)
  assert.equal(m.sharia_status, 'questionable')
  // GOLD did not get MSTR's content
  assert.match(out.GOLD.prose, /Accumulating toward 4,000/)
  assert.equal(out.GOLD.chartFile, 'screenshots/01-GOLD.png')
})

test('parseLiveSections lifts **Label:** lines into structured fields + clean prose', () => {
  const md = [
    '## PALLADIUM — standout',
    '![PALLADIUM](screenshots/10-PALLADIUM.png)',
    'Monthly demand is reacting nicely; needs time.',
    '**Entry:** long from the monthly demand; reload 1,000',
    '**Targets:** 1,500 · 1,727',
    '**Invalidation:** daily supply is the first reaction area',
    '**Levels:** 1,000 reload · 1,500 / 1,727 targets',
    '**Bias:** long / spot',
    '**Sharia:** physical palladium — compliant',
  ].join('\n')
  const r = parseLiveSummary(md, new Set(['PALLADIUM']))
  const p = r.PALLADIUM
  assert.equal(p.entry, 'long from the monthly demand; reload 1,000')
  assert.equal(p.targets, '1,500 · 1,727')
  assert.match(p.invalidation, /daily supply/)
  assert.match(p.levels, /1,000 reload/)
  assert.equal(p.bias, 'long / spot')
  assert.equal(p.sharia_status, 'compliant')
  // the labelled lines are stripped from the narrative prose
  assert.match(p.prose, /Monthly demand is reacting/)
  assert.doesNotMatch(p.prose, /\*\*Entry|\*\*Targets|\*\*Levels/)
})

test('splitLevels splits on middot/comma, keeping decimals', () => {
  assert.deepEqual(splitLevels('80 (psych) · 82.75 · 87.50'), ['80 (psych)', '82.75', '87.50'])
  assert.deepEqual(splitLevels('1,500 · 1,727'), ['1,500', '1,727'])
  assert.deepEqual(splitLevels(null), [])
})
