import { synthesize } from './synthesize.js'

// Serial, in-process queue for auto-synthesis on new-ticker ingest. A /feed run
// can create many new tickers in a burst; spawning a headless Claude per ticker
// concurrently would thrash the machine. So we run them ONE at a time, in the
// background, deduped by symbol. synthesize() caches on the event-set hash, so a
// symbol that gains more events before it's processed re-synthesizes once with
// the fuller set and is a cheap no-op if nothing changed.
const queued = new Set()
const order = []
let running = false

export function enqueueSynth(symbol) {
  if (!symbol || queued.has(symbol)) return
  queued.add(symbol)
  order.push(symbol)
  pump()
}

async function pump() {
  if (running) return
  running = true
  while (order.length) {
    const symbol = order.shift()
    queued.delete(symbol)
    try {
      await synthesize(symbol)
      console.log(`[synth-queue] synthesized ${symbol}`)
    } catch (e) {
      console.warn(`[synth-queue] ${symbol} skipped: ${e.message}`)
    }
  }
  running = false
}

// Inspectable for tests / a future status endpoint.
export function synthQueueDepth() {
  return order.length + (running ? 1 : 0)
}
