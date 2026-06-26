// SnapTrade — aggregator that connects brokerages without a direct API (e.g. an
// AJ Bell JISA). Uses the official SDK with the app's PERSONAL keys
// (SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY). Personal keys carry one
// pre-provisioned user (registerUser is disabled): we read it via
// listSnapTradeUsers and mint a fresh userSecret with resetSnapTradeUserSecret.
//
// An account stores just { userId } as its credentials + the SnapTrade account id
// as provider_ref; each sync mints a short-lived secret. Positions are priced in
// their native currency (often USD) and converted to the book's GBP via fx.js,
// with the account's GBP balance as the authoritative total.
import { Snaptrade } from 'snaptrade-typescript-sdk'
import { getUsdGbp } from './fx.js'

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : 0
}

export const key = 'snaptrade'
export const name = 'SnapTrade (AJ Bell)'

export function client() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY
  if (!clientId || !consumerKey) throw new Error('SnapTrade keys not configured (SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY)')
  return new Snaptrade({ clientId, consumerKey })
}

// The personal user's id (pre-provisioned). SNAPTRADE_USER_ID overrides.
export async function personalUserId(s = client()) {
  if (process.env.SNAPTRADE_USER_ID) return process.env.SNAPTRADE_USER_ID
  const users = (await s.authentication.listSnapTradeUsers()).data
  if (!users?.length) throw new Error('No SnapTrade user provisioned for these keys')
  return users[0]
}

// Mint a fresh userSecret for the user (rotates the previous one).
async function freshSecret(userId, s = client()) {
  return (await s.authentication.resetSnapTradeUserSecret({ userId })).data.userSecret
}

// Connection-portal URL to link a NEW brokerage.
export async function loginUser(userId, userSecret, s = client()) {
  const out = (await s.authentication.loginSnapTradeUser({ userId, userSecret })).data
  return out.redirectURI || out.redirectUri
}

// Linked brokerage accounts for the personal user.
export async function listAccounts(userId, userSecret, s = client()) {
  return (await s.accountInformation.listUserAccounts({ userId, userSecret })).data
}

// Normalise an account + its positions into the broker snapshot contract. Native
// (non-GBP) positions are FX-converted to GBP; the account's GBP balance is the
// authoritative total. `usdGbp` injectable for deterministic tests.
export async function normalizeSnapshot(account, positions, { usdGbp } = {}) {
  const rate = usdGbp != null ? usdGbp : await getUsdGbp().catch(() => 0.79)
  const toGbp = (amt, ccy) => (ccy && ccy !== 'GBP' ? amt * rate : amt) // non-GBP ≈ USD
  const holdings = (positions || []).map((p) => {
    const inst = p.symbol?.symbol || p.symbol || {}
    const ticker = inst.symbol || inst.raw_symbol || '?'
    const ccy = inst.currency?.code || 'GBP'
    const units = num(p.units ?? p.fractional_units)
    const price = num(p.price)
    return {
      symbol: ticker,
      name: inst.description || ticker,
      quantity: units,
      price: toGbp(price, ccy),
      value: toGbp(units * price, ccy),
      cost: p.average_purchase_price != null ? toGbp(num(p.average_purchase_price) * units, ccy) : undefined,
      pnl: p.open_pnl != null ? toGbp(num(p.open_pnl), ccy) : undefined,
      currency: 'GBP',
    }
  })
  const invested = holdings.reduce((s, h) => s + h.value, 0)
  const totalValue = num(account?.balance?.total?.amount) || invested
  return {
    totalValue,
    currency: 'GBP',
    cash: Math.max(0, totalValue - invested),
    invested,
    pnl: holdings.reduce((s, h) => s + (h.pnl || 0), 0) || null,
    holdings,
  }
}

// Pull a snapshot for a linked SnapTrade account. creds = { userId }; the target
// SnapTrade account id is provider_ref. A fresh secret is minted per call.
export async function fetchSnapshot(creds, deps = {}) {
  const s = deps.client || client()
  const userId = creds.userId || (await personalUserId(s))
  const userSecret = await freshSecret(userId, s)
  const accountId = creds.providerRef || deps.providerRef
  const accounts = await listAccounts(userId, userSecret, s)
  const account = (accounts || []).find((a) => a.id === accountId) || accounts?.[0]
  if (!account) throw new Error('SnapTrade: no linked account found — link a brokerage first')
  const positions = (await s.accountInformation.getUserAccountPositions({ userId, userSecret, accountId: account.id })).data
  return normalizeSnapshot(account, positions, deps)
}

// Connect helpers for the admin API: list linked accounts (mints a secret).
export async function listLinkedAccounts() {
  const s = client()
  const userId = await personalUserId(s)
  const userSecret = await freshSecret(userId, s)
  const accounts = await listAccounts(userId, userSecret, s)
  return { userId, accounts }
}
