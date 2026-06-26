import YahooFinance from 'yahoo-finance2'
import { listTickers } from './tickers.js'
import { yahooSymbol } from './price-provider.js'
import { query } from './db.js'

// Backfill tickers.instrument (etf|equity|crypto|fund|index) from yahoo's
// quoteType, so ETFs can be told apart from single stocks (e.g. for filtering).
// Commodities are left alone — they're priced off futures and classified by
// asset_class. Re-runnable; only writes when yahoo returns a known type.
const MAP = { ETF: 'etf', EQUITY: 'equity', CRYPTOCURRENCY: 'crypto', FUTURE: 'commodity', MUTUALFUND: 'fund', INDEX: 'index' }

export async function tagInstruments({ yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] }) } = {}) {
  const all = await listTickers()
  const pairs = all
    .filter((t) => t.asset_class !== 'commodity')
    .map((t) => ({ t, s: t.quote_symbol || yahooSymbol(t.symbol, t.asset_class) }))
    .filter((x) => x.s)
  const syms = [...new Set(pairs.map((x) => x.s))]
  let quotes = []
  try { const q = await yf.quote(syms, {}, { validateResult: false }); quotes = Array.isArray(q) ? q : [q] }
  catch (e) { console.warn('[tag-instruments] quote batch error:', e.message) }
  const typeBySym = new Map(quotes.filter((q) => q && q.symbol).map((q) => [q.symbol, q.quoteType]))
  let tagged = 0
  for (const { t, s } of pairs) {
    const inst = MAP[typeBySym.get(s)]
    if (inst && inst !== t.instrument) { await query('UPDATE tickers SET instrument=$2 WHERE symbol=$1', [t.symbol, inst]); tagged++ }
  }
  return { tagged, total: pairs.length }
}

// CLI: `pnpm tag:instruments`
if (import.meta.url === `file://${process.argv[1]}`) {
  tagInstruments()
    .then((r) => { console.log(`tagged ${r.tagged}/${r.total}`); process.exit(0) })
    .catch((e) => { console.error(e); process.exit(1) })
}
