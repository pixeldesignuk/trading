import React from 'react'
import { api } from '../api.js'
import ChatCore from './ChatCore.jsx'

// Per-ticker study desk — a thin ticker-scoped config over the shared ChatCore.
const SUGGESTIONS = [
  'Is this a valid spot setup right now?',
  'Grade it on the §20 scorecard',
  'Size a position for me',
  'What invalidates the thesis?',
]

export default function ChatPanel({ symbol, open = false, onClose, onOpenTicker }) {
  return (
    <ChatCore
      resetKey={symbol}
      send={(messages, opts) => api.chat(symbol, messages, opts)}
      title={`Study desk · ${symbol}`}
      subtitle="bible-grounded · not advice"
      placeholder={`Message about ${symbol}…`}
      suggestions={SUGGESTIONS}
      emptyText={`Ask anything about ${symbol} — graded against Zero's bible, the Masterclass and this ticker's live context.`}
      open={open}
      onClose={onClose}
      onOpenTicker={onOpenTicker}
    />
  )
}
