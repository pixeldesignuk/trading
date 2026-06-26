# 🥷 Dojo Signals — local web dashboard

Run the Telegram signal digest from your browser and browse daily chat summaries,
graded against `../dojo-library/ZERO-BIBLE.md` (§20). **Educational, not live-trading.**

## What it does
- **Daily summary** — a scheduled run (default 08:00) summarises the day's chat: mood, key players, notable calls.
- **Run now** — pick a window (6h/12h/1d/3d) and trigger a fresh graded digest.
- **Signals feed** — browse past runs; per-ticker SPOT signals with §20 grades + chart thumbnails. Futures parked.
- **Players & watchlist** — live dashboard of who's who and recurring tickers.

## How it works
The browser → Express API → spawns **Claude Code headless** (`claude -p`), which runs
`../tg-reader/tg.py` (read-only Telegram pull + chart images), grades against the bible,
and writes a structured `digest.json`. The server ingests that into SQLite and the React UI renders it.

```
cron / Run button → POST /api/runs → runner (claude -p) → digest.json → SQLite → UI
```

## Setup
```bash
cd ~/Developer/personal/trading/signals-web
pnpm install
pnpm seed        # loads today's real digest so the UI isn't empty
pnpm build       # build the React app
pnpm start       # → http://localhost:8910
```
Dev mode (hot reload): `pnpm dev` (UI on :5273, API on :8787).

## Prereqs
- The Telegram client must be logged in: `cd ../tg-reader && ./.venv/bin/python tg.py whoami`.
  If the session expired, re-run `tg.py send-code` / `sign-in` (see tg-reader).
- `claude` CLI available. Override path/model/schedule via env:
  - `CLAUDE_BIN` (default cmux path), `CLAUDE_MODEL` (default: inherit), `RUN_TIMEOUT_MS`
  - `DAILY_CRON` (default `0 8 * * *`), `DAILY_WINDOW_HOURS` (24), `ENABLE_SCHEDULER=0` to disable
  - `PORT` (default 8787)

## Notes
- The runner uses `--permission-mode bypassPermissions` so the headless run is non-interactive.
  It only ever runs the read-only `tg.py digest` and writes the digest/images/tracker. It never sends Telegram messages.
- Runs on your Mac only; secrets + Telegram session never leave the machine.
