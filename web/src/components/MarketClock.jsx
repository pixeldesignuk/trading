import React, { useEffect, useState } from 'react'

// Market-session clock — shows whether the exchanges Mansoor trades are open and
// the countdown to the next open/close. Pure client-side from the browser clock +
// IANA timezones (DST-correct); regular sessions only, holidays not modelled.
const MARKETS = [
  { code: 'LSE', tz: 'Europe/London', open: 8 * 60, close: 16 * 60 + 30 },     // 08:00–16:30
  { code: 'US', tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },    // 09:30–16:00
]

// Wall-clock weekday (0=Sun) + minutes-of-day in a timezone.
function tzNow(tz, date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map((x) => [x.type, x.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  const hour = parseInt(p.hour, 10) % 24
  return { wd, min: hour * 60 + parseInt(p.minute, 10) }
}

function session(m, date) {
  const { wd, min } = tzNow(m.tz, date)
  const weekday = wd >= 1 && wd <= 5
  if (weekday && min >= m.open && min < m.close) return { open: true, mins: m.close - min }
  // Minutes until the next weekday open (walk forward over the weekend).
  let mins
  if (weekday && min < m.open) mins = m.open - min
  else {
    let days = 1; let nwd = (wd + 1) % 7
    while (nwd === 0 || nwd === 6) { days++; nwd = (nwd + 1) % 7 }
    mins = (1440 - min) + (days - 1) * 1440 + m.open
  }
  return { open: false, mins }
}

const fmtDur = (m) =>
  m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
    : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m`
      : `${m}m`

export default function MarketClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return (
    <div className="flex items-center gap-3">
      {MARKETS.map((m) => {
        const s = session(m, now)
        return (
          <span key={m.code} className="flex items-center gap-1.5 font-mono text-[10px]" title={`${m.code} ${s.open ? 'open' : 'closed'} — ${s.open ? 'closes' : 'opens'} in ${fmtDur(s.mins)}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.open ? 'bg-emerald-400 shadow-[0_0_5px] shadow-emerald-400/60' : 'bg-zinc-600'}`} />
            <span className="text-zinc-300">{m.code}</span>
            <span className="text-zinc-600">{s.open ? 'closes' : 'opens'} {fmtDur(s.mins)}</span>
          </span>
        )
      })}
    </div>
  )
}
