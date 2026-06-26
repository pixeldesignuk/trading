import React from 'react'
import { api } from '../api.js'
import ChatCore from './ChatCore.jsx'

// Portfolio desk — same ChatCore, portfolio scope. Reasons over the whole roster
// (standouts + active trades at risk); the shortlist cards open a ticker via onOpen.
const SUGGESTIONS = [
  'Any active trades at risk?',
  "What's the standout worth a look?",
  'Show me my held positions',
  'Which watchlist names are setting up?',
]

export default function PortfolioChat({ open = false, onClose, onOpen }) {
  return (
    <ChatCore
      variant="docked"
      resetKey="portfolio"
      send={(messages, opts) => api.portfolioChat(messages, opts)}
      title="Portfolio desk"
      subtitle="standouts · risk · not advice"
      placeholder="Ask about your portfolio…"
      suggestions={SUGGESTIONS}
      emptyIcon="🗂️"
      emptyText="Ask across your whole list — what needs attention, the standouts worth a look, or what you hold. Tap a card to open that ticker."
      open={open}
      onClose={onClose}
      onOpenTicker={onOpen}
    />
  )
}
