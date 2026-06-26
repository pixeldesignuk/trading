import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../config.js'

// Best-effort Telegram send. No-op (not a throw) when unconfigured so a run still
// records its events and returns a summary.
export async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[alerts] TELEGRAM_BOT_TOKEN/CHAT_ID unset — skipping send')
    return { ok: false, skipped: true }
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    })
    if (!res.ok) {
      console.warn('[alerts] telegram send failed', res.status, (await res.text()).slice(0, 200))
      return { ok: false, status: res.status }
    }
    return { ok: true }
  } catch (e) {
    console.warn('[alerts] telegram send error', e.message)
    return { ok: false, error: e.message }
  }
}
