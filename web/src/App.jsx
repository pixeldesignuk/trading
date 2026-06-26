import React, { useEffect, useState } from 'react'
import { useUrlState } from './useUrlState.js'
import { api } from './api.js'
import Feed from './components/Feed.jsx'
import Tickers from './components/Tickers.jsx'
import TickerDetail from './components/TickerDetail.jsx'
import Portfolio from './components/Portfolio.jsx'
import AllocationLedger from './components/AllocationLedger.jsx'
import Alerts from './components/Alerts.jsx'
import Archive from './components/Archive.jsx'
import Accounts from './components/Accounts.jsx'
import PortfolioChat from './components/PortfolioChat.jsx'

// Ideas now live as a "Stage" filter on the Tickers tab, not a separate tab.
const TABS = [
  ['tickers', 'Tickers'], ['feed', 'Feed'],
  ['portfolio', 'Portfolio'], ['allocation', 'Allocation'], ['alerts', 'Alerts'],
  ['accounts', 'Accounts'], ['archive', 'Archive'],
]

export default function App() {
  const [tab, setTab] = useUrlState('tab', 'tickers')
  const [symbol, setSymbol] = useUrlState('symbol', '')
  const [chatOpen, setChatOpen] = useState(false)   // portfolio desk (mobile slide-over)
  // tab counts: Tickers = the default "Potential" stage (new candidates, no
  // ideas/watched/active); Portfolio = watching/in.
  const [counts, setCounts] = useState({})
  useEffect(() => {
    const isIdea = (x) => x.status === 'new' && (x.sources || []).includes('community')
    api.tickers().then((t) => setCounts({
      tickers: t.filter((x) => x.status === 'new' && !isIdea(x)).length,
      portfolio: t.filter((x) => ['watching', 'in'].includes(x.status)).length,
    }))
  }, [])

  if (symbol) return <TickerDetail symbol={symbol} onBack={() => setSymbol('')} />

  // On the Portfolio tab the desk is a persistent right rail on desktop (fixed),
  // so the shell goes full-width and pads right to clear it.
  const portfolioTab = tab === 'portfolio'

  return (
    <>
    <div className={`mx-auto px-4 py-6 ${portfolioTab ? 'max-w-none lg:pr-[28rem]' : 'max-w-5xl'}`}>
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Trading Hub</h1>
      </header>
      <nav className="mb-6 flex gap-1 border-b border-zinc-800">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
              tab === id ? 'border-b-2 border-emerald-500 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            {label}
            {counts[id] != null && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] tabular text-zinc-400">{counts[id]}</span>
            )}
          </button>
        ))}
      </nav>
      {tab === 'feed' && <Feed onOpen={setSymbol} />}
      {tab === 'tickers' && <Tickers onOpen={setSymbol} />}
      {tab === 'portfolio' && <Portfolio onOpen={setSymbol} onAskZ={() => setChatOpen(true)} />}
      {tab === 'allocation' && <AllocationLedger onOpen={setSymbol} />}
      {tab === 'alerts' && <Alerts onOpen={setSymbol} />}
      {tab === 'accounts' && <Accounts />}
      {tab === 'archive' && <Archive />}
      <footer className="mt-10 text-center text-xs text-zinc-600">
        Educational only - grades the calls, does not tell you to take them. Not financial advice.
      </footer>
    </div>

    {/* Portfolio desk — persistent right rail on desktop, slide-over on mobile */}
    {portfolioTab && (
      <>
        <PortfolioChat open={chatOpen} onClose={() => setChatOpen(false)} onOpen={setSymbol} />
        <button onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-4 py-2.5 text-sm font-medium text-emerald-200 shadow-lg shadow-black/40 backdrop-blur lg:hidden">
          <span className="font-mono text-xs font-bold">Z</span> Ask portfolio
        </button>
      </>
    )}
    </>
  )
}
