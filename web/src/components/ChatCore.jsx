import React, { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import AlertsWidget from './AlertsWidget.jsx'
import NewsWidget from './NewsWidget.jsx'
import ChartWidget from './ChartWidget.jsx'
import ShortlistWidget from './ShortlistWidget.jsx'

// Generic chat rail — the reusable core shared by the per-ticker (ChatPanel) and
// portfolio (PortfolioChat) desks. Scope-specific bits come in as props:
//   resetKey   — changing it starts a fresh conversation
//   send       — (messages, { onText, onEvent, signal }) => Promise<usage>
//   title/subtitle/placeholder/suggestions/emptyText — chrome
//   onOpenTicker(symbol) — for widgets that navigate (the shortlist cards)
//   floating   — true = always an overlay (portfolio); false = static rail on lg (ticker)

const block = (s) => ({ __html: marked.parse(String(s ?? '')) })

// Model pricing is USD-native; show the running session cost in £ at an approx rate.
const GBP_PER_USD = 0.79
const fmtCost = (usd) => {
  const gbp = (usd || 0) * GBP_PER_USD
  if (gbp <= 0) return '£0'
  return gbp < 1 ? `£${gbp.toFixed(3)}` : `£${gbp.toFixed(2)}`
}

function Usage({ u }) {
  if (!u) return null
  const tag = u.cached > 0 ? `${(u.cached / 1000).toFixed(1)}k cached`
    : u.write > 0 ? `${(u.write / 1000).toFixed(1)}k cache write`
    : `${u.input} in`
  const hit = u.cached > 0
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-600" title="prompt-cache usage this turn">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${hit ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
      {tag} · {u.output} out
    </span>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

function Widget({ w, onOpenTicker }) {
  if (w.widget === 'alerts') return <AlertsWidget data={w.data} focus={w.focus} />
  if (w.widget === 'news') return <NewsWidget data={w.data} />
  if (w.widget === 'chart') return <ChartWidget data={w.data} />
  if (w.widget === 'shortlist') return <ShortlistWidget data={w.data} onOpen={onOpenTicker} />
  return null
}

// variant: 'inline' — static in-flow rail on lg (ticker detail's flex split);
//          'docked' — fixed right rail, always visible on lg (host pads for it).
// Both are a slide-over (toggled by `open`) on mobile.
export default function ChatCore({
  resetKey, send, title, subtitle, placeholder, suggestions = [], emptyText, emptyIcon = '📈',
  open = false, onClose, onOpenTicker, variant = 'inline',
}) {
  const inline = variant !== 'docked'
  const [msgs, setMsgs] = useState([])      // [{ role, content, widgets? }]
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [usage, setUsage] = useState(null)
  const [costUsd, setCostUsd] = useState(0)
  const [model, setModel] = useState(null)
  const scrollRef = useRef(null)
  const taRef = useRef(null)
  const acRef = useRef(null)
  const stickRef = useRef(true)

  // New scope → fresh conversation.
  useEffect(() => { acRef.current?.abort(); setMsgs([]); setErr(null); setUsage(null); setCostUsd(0); setModel(null); setInput('') }, [resetKey])
  useEffect(() => () => acRef.current?.abort(), [])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [msgs])

  function onScroll() {
    const el = scrollRef.current
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function grow() {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }

  async function submit(textArg) {
    const text = (typeof textArg === 'string' ? textArg : input).trim()
    if (!text || busy) return
    setErr(null)
    setInput('')
    requestAnimationFrame(grow)
    stickRef.current = true
    const history = [...msgs, { role: 'user', content: text }]
    setMsgs([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    const ac = new AbortController()
    acRef.current = ac
    try {
      const u = await send(history, {
        signal: ac.signal,
        onText: (t) => setMsgs((m) => {
          const next = m.slice()
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, content: last.content + t }
          return next
        }),
        onEvent: (evt) => setMsgs((m) => {
          const next = m.slice()
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, widgets: [...(last.widgets || []), evt] }
          return next
        }),
      })
      setUsage(u)
      if (u) { setCostUsd((c) => c + (u.costUsd || 0)); if (u.model) setModel(u.model) }
    } catch (e) {
      if (!ac.signal.aborted) {
        setErr(String(e.message || e))
        setMsgs((m) => m.filter((x, i) => !(i === m.length - 1 && x.role === 'assistant' && !x.content && !(x.widgets || []).length)))
      }
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  const stop = () => acRef.current?.abort()
  const reset = () => { acRef.current?.abort(); setMsgs([]); setErr(null); setUsage(null); setCostUsd(0); setModel(null) }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={onClose} />}

      <aside
        className={[
          'chat-rail flex h-screen w-full max-w-[30rem] flex-col border-l border-zinc-800/80 fixed inset-y-0 right-0 z-40 lg:w-[27rem] lg:max-w-none',
          inline ? 'lg:static lg:z-auto lg:shrink-0' : '',
          open ? 'flex rail-in' : 'hidden lg:flex',
        ].join(' ')}
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 font-mono text-xs font-bold text-emerald-300">Z</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-100">{title}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">{subtitle}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {costUsd > 0 && (
              <span title={`Running session cost${model ? ` · ${model}` : ''} — approximate £, converted from USD model pricing`}
                className="rounded-md border border-zinc-800 bg-black/30 px-2 py-1 font-mono text-[10px] text-zinc-400">
                ≈{fmtCost(costUsd)}
              </span>
            )}
            {msgs.length > 0 && (
              <button onClick={reset} title="New chat"
                className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            )}
            {onClose && (
              <button onClick={onClose} title="Close" className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200 lg:hidden">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </header>

        <div ref={scrollRef} onScroll={onScroll} className="chat-scroll flex-1 overflow-y-auto px-4 py-5">
          {msgs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-xl">{emptyIcon}</span>
              <p className="mt-4 max-w-[18rem] text-sm leading-relaxed text-zinc-400">{emptyText}</p>
              <div className="mt-5 flex w-full max-w-[20rem] flex-col gap-2">
                {suggestions.map((q) => (
                  <button key={q} onClick={() => submit(q)}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-2.5 text-left text-sm text-zinc-300 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.06] hover:text-zinc-100">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {msgs.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} className="msg-in flex justify-end">
                    <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-sky-500/20 bg-sky-500/10 px-3.5 py-2 text-sm leading-relaxed text-zinc-100">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="msg-in flex gap-2.5">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-emerald-500/25 bg-emerald-500/10 font-mono text-[10px] font-bold text-emerald-300">Z</span>
                    <div className="min-w-0 flex-1">
                      {m.content && <div className="prose-chat" dangerouslySetInnerHTML={block(m.content)} />}
                      {(m.widgets || []).map((w, wi) => <Widget key={wi} w={w} onOpenTicker={onOpenTicker} />)}
                      {!m.content && !(m.widgets || []).length && <div className="typing flex h-5 items-center pt-1"><span /><span /><span /></div>}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </div>

        {err && (
          <div className="mx-4 mb-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-300">{err}</div>
        )}
        {usage?.truncated && !busy && (
          <div className="mx-4 mb-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">Response hit the length limit — ask "continue" for the rest.</div>
        )}

        <div className="border-t border-zinc-800/80 p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-zinc-800 bg-black/40 px-3 py-2 focus-within:border-zinc-700">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => { setInput(e.target.value); grow() }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="chat-scroll max-h-40 flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
            {busy ? (
              <button onClick={stop} title="Stop"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-200 text-black hover:bg-white">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-black" />
              </button>
            ) : (
              <button onClick={() => submit()} disabled={!input.trim()} title="Send"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500 text-black transition hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600">
                <SendIcon />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1">
            <span className="font-mono text-[10px] text-zinc-700">↵ send · ⇧↵ newline</span>
            <Usage u={usage} />
          </div>
        </div>
      </aside>
    </>
  )
}
