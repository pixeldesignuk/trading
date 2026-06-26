import { GoogleGenAI } from '@google/genai'
import { GEMINI_API_KEY, NEWS_MODEL } from './config.js'

// Web-grounded news + sentiment via Gemini + Google Search (the chat agent's
// get_news tool). Reuses GEMINI_API_KEY — no extra provider/key. Returns a short
// synthesis, a parsed sentiment tag, and the grounded sources; the chat model
// reads the synthesis and reframes it through Zero's lens, and the sources also
// surface in a small news widget the user can click through.

const SENTIMENTS = new Set(['bullish', 'bearish', 'mixed', 'neutral'])
const RECENCY_HINT = { day: 'the past 24 hours', week: 'the past week', month: 'the past month', year: 'the past year' }

export const newsReady = () => !!GEMINI_API_KEY

let _ai
const genai = () => (_ai ??= GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null)

const SYSTEM = `You are a markets news researcher with web search. Given a ticker, surface the MOST MATERIAL recent news and the prevailing sentiment from reputable financial sources.
Rules:
- First line, exactly: "SENTIMENT: <bullish|bearish|mixed|neutral>" — the balance of the news for the stock.
- Then 3–6 tight sentences: the concrete catalysts (earnings, guidance, analyst moves, macro, sector) driving it, most important first. Prefer specifics (numbers, dates) over vibes.
- Factual and source-grounded only. No price predictions, no investment advice.`

// Sources from the grounding metadata: each chunk carries the publisher title +
// a (redirect) uri that resolves to the article.
function extractSources(resp, max = 6) {
  const chunks = resp?.candidates?.[0]?.groundingMetadata?.groundingChunks || []
  const out = []
  for (const c of chunks) {
    const w = c?.web
    if (w?.uri) out.push({ title: w.title || w.uri, url: w.uri, date: null })
    if (out.length >= max) break
  }
  return out
}

export async function fetchNews({ symbol, name, query = '', recency = 'month', signal } = {}) {
  const ai = genai()
  if (!ai) throw new Error('news unavailable: set GEMINI_API_KEY in .env')
  const window = RECENCY_HINT[recency] || RECENCY_HINT.month
  const ask = `${name ? `${name} ` : ''}(${symbol}) stock. What is the latest news and the overall market sentiment, focusing on ${window}${query ? `, specifically: ${query}` : ''}?`
  const resp = await ai.models.generateContent({
    model: NEWS_MODEL,
    contents: ask,
    config: {
      systemInstruction: SYSTEM,
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 }, // retrieval+summary, keep it cheap/snappy
      abortSignal: signal,
    },
  })
  const content = (resp?.text || '').trim()
  if (!content) throw new Error('news search returned nothing')
  // Parse the leading "SENTIMENT: x" line, keep the rest as the synthesis.
  let sentiment = null
  let summary = content
  const m = summary.match(/^\s*SENTIMENT:\s*([a-z]+)\s*\n?/i)
  if (m) {
    const tag = m[1].toLowerCase()
    sentiment = SENTIMENTS.has(tag) ? tag : null
    summary = summary.slice(m[0].length).trim()
  }
  return { symbol, query: query || null, recency, sentiment, summary, sources: extractSources(resp), model: NEWS_MODEL }
}
