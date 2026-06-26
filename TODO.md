# Trading Hub — Backlog

Running feature backlog. Newest asks at the top of "Up next".

## Up next

- [ ] **Reconcile the picks/crypto structural deviation from the bible** — audited
  2026-06-25 (`dojo-library/INVESTING-MASTERCLASS.md` L42–135, transcript L244–248).
  Two known, *intentional* divergences left as-is for now: (1) **Picks are their own
  L1 bucket at 12%** of portfolio, but Zero puts picks as the High-risk tip *inside the
  satellite* (5–10% of satellite ≈ 1.5–3% of portfolio) — we're ~4–8× his size and
  promoted to a peer sleeve (the conscious "picks-centric" / passive-vs-active Hybrid
  choice). (2) **Crypto** is correctly a satellite theme (~3% at default = within Zero's
  2–5%) but the theme slider is *unbanded*, so it can silently breach 5%. Coherence cost:
  "high risk" now lives in two disconnected places — the picks bucket sits *outside* the
  derived satellite pyramid, so that pyramid understates true book-level risk. Options
  when picked up: soft band + override-warning on picks; band-warning on crypto; optional
  whole-portfolio risk view that folds picks into the High tier. Decided to defer; structure
  stays as-is.
- [ ] **Dynamic Kanban Portfolio + Trading 212 / Bitget sync** — Portfolio becomes a
  Kanban board (Potential → Watched → Active → Closed); holdings sync from Trading 212
  (multi-account) + Bitget via the finance app, so Active mirrors real positions and
  available funds become synced (not `ACCOUNT_SIZE` config). Full handover:
  `docs/superpowers/specs/2026-06-23-kanban-portfolio-t212-handover.md`.
- [ ] **Merge the alerts system into this app** — fold the standalone price-alert bot
  (`trading/alerts/`, Trigger.dev hourly, watchlist levels via Twelve Data → Telegram)
  into trading-hub so alerts are driven by the hub's ticker plans/levels (entry/stop/TP)
  instead of a separate watchlist. Decide: keep Trigger.dev scheduler vs in-app cron.
- [ ] **TanStack Query-style data layer** — replace the ad-hoc `useEffect` + `useState`
  fetching (api.ticker/quotes/history/config, synthesize, sharia) with a React Query
  / RTK Query-style wrapper: keyed caching, background refetch, and optimistic updates
  (status changes, plan edits, re-screen/re-synth show instantly then reconcile).

## Done

- [x] Skeptical-editor synthesis layer (conflict-aware plan + conviction)
- [x] Editor reads source charts (image wins over text)
- [x] Per-ticker live reads (fixed the global-tldr ingestion leak)
- [x] Spot position cap + % of account (Zero §II.3)
- [x] Change vs previous close (not vs entry) on every surface
- [x] Portfolio reuses the Tickers list UI
- [x] Live 2-of-3 Sharia screen (Zoya / Musaffa / MuslimXchange)
- [x] Filter the ticker list by source (URL state) + Other bucket
- [x] Exclude watching/in/dismissed from the Tickers list (they live in Portfolio)
- [x] Count chip on the Portfolio nav tab
- [x] Filter the ticker list by asset type (stocks / crypto / commodities)
