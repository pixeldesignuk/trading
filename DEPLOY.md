# Deploying Trading Hub to Railway

The app is a single Node/Express service that serves the built Vite frontend from
`server/public` and talks to Postgres. Railway builds it from the `Dockerfile`
(multi-stage: build the frontend, then run prod deps + server).

## 1. Service + database
- Create a Railway project, add a **Postgres** plugin (or reuse the existing one).
- Add this repo as a service. Railway auto-detects the `Dockerfile`.
- The server listens on `$PORT` (Railway injects it) and binds `0.0.0.0`.
- On boot, `init()` applies `server/schema.sql` (idempotent) — no manual migration.

## 2. Required env vars (Railway → service → Variables)
| Var | Needed for | Notes |
|-----|-----------|-------|
| `DATABASE_URL` | everything | Railway Postgres connection string |
| `GEMINI_API_KEY` | the chat desks | or `ANTHROPIC_API_KEY` if `CHAT_MODEL` is claude-* |
| `CHAT_MODEL` | chat | default `gemini-2.5-pro` |

Optional (enable the matching feature): `NEWS_MODEL`, `TELEGRAM_BOT_TOKEN` +
`TELEGRAM_CHAT_ID` + `ALERTS_RUN_TOKEN` (alerts), `APP_ENCRYPTION_KEY` +
`T212_ACCOUNTS` / `BITGET_*` / `SNAPTRADE_*` (broker sync). See `.env.example`.

`APP_ENCRYPTION_KEY` must be **stable across deploys** — it decrypts stored broker
credentials; changing it makes existing accounts undecryptable (re-add them).

## 3. Frontend build
The `Dockerfile` runs `pnpm build` into `server/public`. The committed
`server/public` is a working fallback if you ever build outside Docker.

## Chart images — Railway volume
`media/` (≈118 MB of chart PNGs) is gitignored and not in the image. Mount a
Railway **volume at `/app/media`** (the default `MEDIA_DIR`) so charts persist and
`get_chart` / the ticker-page charts work. The volume starts empty; seed it once
(the chart files are produced by the local `/feed` + `import:*` scripts) — e.g.
copy them up with `railway run`/the volume tooling, or just let new charts
accumulate. Until seeded, `get_chart` degrades gracefully (a note, no image).

## Clean history (new repo)
The repo was never pushed, but real T212/Bitget keys lived in `.env.example` across
local history (now scrubbed). Rather than rotate, start the GitHub repo from a
**clean history** so no commit ever contained them:
```
# from a fresh checkout/copy of the working tree (scrubbed .env.example):
rm -rf .git && git init && git add -A && git commit -m "Trading Hub"
git remote add origin <new-github-repo> && git push -u origin main
```
Then connect Railway to that repo. (Keep the old local repo if you want the full
feature history; just don't push it.)

## Other notes
- **Synthesis (skeptical editor)** is local-only — it spawns a local `claude`
  binary (`CLAUDE_BIN`), absent on Railway. Run `/synthesize` locally; the deployed
  app reads results from the DB. `POST /api/tickers/:symbol/synthesize` 500s in prod.
- **Bible snapshot** at `server/reference/bible/` — re-vendor after a dojo-library
  sync with `pnpm vendor:bible` (then commit), or point `BIBLE_DIR` at a volume.
- **Alerts cron** — the hourly `POST /api/alerts/run` is poked by the separate
  `trading/alerts` Trigger.dev project; point its `TRADING_HUB_URL` at the Railway
  URL and share `ALERTS_RUN_TOKEN`.
