// Broker registry — maps a provider key to its snapshot function, rate-limit
// spacing, and the credential fields the add-account UI should render. Each
// broker module conforms to the same fetchSnapshot(creds) → snapshot contract.
import * as trading212 from './trading212.js'
import * as bitget from './bitget.js'
import * as snaptrade from './snaptrade.js'

export const REGISTRY = {
  trading212: {
    label: 'Trading 212',
    fetchSnapshot: trading212.fetchSnapshot,
    rateLimitMs: 1100, // T212 is 1 req/s
    connect: false,
    credentialFields: [
      { name: 'keyId', label: 'API key', secret: false },
      { name: 'secret', label: 'API secret', secret: true },
      { name: 'baseUrl', label: 'Base URL', secret: false, optional: true, placeholder: 'https://live.trading212.com' },
    ],
  },
  bitget: {
    label: 'Bitget',
    fetchSnapshot: bitget.fetchSnapshot,
    rateLimitMs: 250,
    connect: false,
    credentialFields: [
      { name: 'apiKey', label: 'API key', secret: false },
      { name: 'apiSecret', label: 'API secret', secret: true },
      { name: 'passphrase', label: 'API passphrase', secret: true },
    ],
  },
  snaptrade: {
    label: 'SnapTrade (AJ Bell JISA)',
    fetchSnapshot: snaptrade.fetchSnapshot,
    rateLimitMs: 300,
    connect: true, // no manual key fields — uses the connection-portal flow
    credentialFields: [],
  },
}

export const getProvider = (key) => REGISTRY[key] || null

// Provider metadata for the UI (no functions) — drives the add-account form.
export function providerCatalog() {
  return Object.entries(REGISTRY).map(([key, p]) => ({
    key, label: p.label, connect: !!p.connect, credentialFields: p.credentialFields,
  }))
}
