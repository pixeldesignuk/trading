import React, { useEffect, useState } from 'react'
import { useUrlState } from './useUrlState.js'
import { api } from './api.js'
import Feed from './components/Feed.jsx'
import Tickers from './components/Tickers.jsx'
import TickerDetail from './components/TickerDetail.jsx'
import Portfolio from './components/Portfolio.jsx'
import AllocationLedger from './components/AllocationLedger.jsx'
import Alerts from './components/Alerts.jsx'
import Accounts from './components/Accounts.jsx'
import PortfolioChat from './components/PortfolioChat.jsx'
import MarketClock from './components/MarketClock.jsx'

// Primary nav. Tickers is hidden (still reachable at ?tab=tickers) and Archive
// is retired; Alerts + Accounts live under the settings menu.
const PRIMARY = [['feed', 'Feed'], ['portfolio', 'Portfolio'], ['allocation', 'Allocation']]
const SETTINGS = [['alerts', 'Alerts'], ['accounts', 'Accounts']]

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function NavLink({ id, label, active, count, onClick }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}>
      {label}
      {count != null && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] tabular text-zinc-400">{count}</span>}
    </button>
  )
}

function SettingsMenu({ tab, setTab }) {
  const [open, setOpen] = useState(false)
  const active = SETTINGS.some(([id]) => id === tab)
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Settings — alerts & accounts"
        className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${active || open ? 'border-emerald-500/40 text-emerald-300' : 'border-zinc-800 text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}>
        <GearIcon />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1.5 min-w-[160px] rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl shadow-black/50">
            <div className="px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">Settings</div>
            {SETTINGS.map(([id, label]) => (
              <button key={id} onClick={() => { setTab(id); setOpen(false) }}
                className={`flex w-full items-center rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-white/5 ${tab === id ? 'text-emerald-300' : 'text-zinc-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useUrlState('tab', 'portfolio')
  const [symbol, setSymbol] = useUrlState('symbol', '')
  const [chatOpen, setChatOpen] = useState(false)   // portfolio desk (mobile slide-over)
  const [counts, setCounts] = useState({})
  useEffect(() => {
    const isIdea = (x) => x.status === 'new' && (x.sources || []).includes('community')
    api.tickers().then((t) => setCounts({
      portfolio: t.filter((x) => ['watching', 'in'].includes(x.status)).length,
    })).catch(() => {})
  }, [])

  if (symbol) return <TickerDetail symbol={symbol} onBack={() => setSymbol('')} />

  // On the Portfolio tab the desk is a persistent right rail on desktop (fixed),
  // so the shell goes full-width and pads right to clear it.
  const portfolioTab = tab === 'portfolio'

  return (
    <>
      {/* top nav — full-width sticky bar (logo · primary tabs · market clock · settings) */}
      {/* z-30 on mobile (chat slide-over covers it); above the docked rail on desktop
          so the settings menu opens over the chat instead of behind it */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur lg:z-50">
        <div className="flex items-center gap-1.5 px-3 py-2 sm:px-4">
          <span className="mr-1 shrink-0 font-bold tracking-tight">
            <span className="hidden sm:inline">Trading Hub</span><span className="sm:hidden">Hub</span>
          </span>
          <nav className="flex min-w-0 gap-0.5 overflow-x-auto">
            {PRIMARY.map(([id, label]) => (
              <NavLink key={id} id={id} label={label} active={tab === id} count={id === 'portfolio' ? counts.portfolio : undefined} onClick={() => setTab(id)} />
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <div className="hidden md:block"><MarketClock /></div>
            <SettingsMenu tab={tab} setTab={setTab} />
          </div>
        </div>
        {/* market clock drops to its own row on small screens so it never crowds the nav */}
        <div className="flex justify-end border-t border-zinc-900/80 px-4 py-1.5 md:hidden">
          <MarketClock />
        </div>
      </header>

      <div className={`mx-auto px-3 py-5 sm:px-4 sm:py-6 ${portfolioTab ? 'max-w-none lg:pr-[28rem]' : 'max-w-5xl'}`}>
        {tab === 'feed' && <Feed onOpen={setSymbol} />}
        {tab === 'tickers' && <Tickers onOpen={setSymbol} />}
        {tab === 'portfolio' && <Portfolio onOpen={setSymbol} onAskZ={() => setChatOpen(true)} />}
        {tab === 'allocation' && <AllocationLedger onOpen={setSymbol} />}
        {tab === 'alerts' && <Alerts onOpen={setSymbol} />}
        {tab === 'accounts' && <Accounts />}
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
