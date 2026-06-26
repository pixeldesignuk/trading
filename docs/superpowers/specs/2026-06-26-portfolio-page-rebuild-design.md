# Portfolio page rebuild — design

**Date:** 2026-06-26
**Status:** approved (decisions locked), pending implementation

## Problem

The Portfolio tab (`web/src/components/Portfolio.jsx`) and its chat agent
(`server/chat.js` portfolio scope) were both built **before** the solar-system /
allocation rework that introduced `layer` (trade vs hold), `role` (core vs
satellite), `bucket`, `theme`, `tier`, and per-owner accounts. As a result:

- Every ticker is treated as a **trade** that needs an entry/stop/target plan. A
  long-term hold (an ETF like HIESL/ISWDL/ISUSL, or a crypto/commodity hold) has
  no plan **by design**, but `priceVsPlan()` returns `no_plan`
  (`server/price-plan.js:21-24`) and the agent reads that as "at risk." This is
  the screenshot bug: holds flagged as trades with "no plan defined."
- The page has no real filtering/sorting, no owner scoping, a redundant
  board/list toggle, no row reordering, and no per-ticker alert arming.
- The "in profit" number on ticker detail is computed from the **plan's
  suggested entry**, not the **actual cost basis** of the held position
  (`web/src/components/TickerDetail.jsx:214`), so it's misleading.

## Locked decisions

1. **Owner filter** — scopes the header figures (funds) and the Active/held
   positions to the selected owner. The `new`/`watching` research pipeline stays
   **shared** across owners (it's universe-wide research, not owned by anyone).
2. **Manual order vs column sort** — hand-dragged order is the default `Manual`
   sort, persisted via a new `tickers.sort_order` column. Choosing a column sort
   (grade, P&L, R:R, % of acct, updated) overrides the **display** but preserves
   the manual order underneath.
3. **Scan bar** — deterministic, always-on, computed from layer-aware
   plan-state + near-invalidation + drift + grade/RR/regime fit. A button runs a
   deeper agentic "Ask Z" pass on demand (reuses the portfolio chat).

## Units

### Unit 0 — Data parity + at-risk fix (the screenshot bug)
- Surface effective classification (`layer`, `role`, `bucket`, `theme`, `tier`)
  on every portfolio row. The raw override columns exist on `tickers`, but the
  **derived** classification lives in `server/portfolio/classify.js`; attach
  `classify()` output to the tickers payload the page/chat consume (rather than
  re-deriving on the client).
- `server/chat.js`: `rosterLine()` and `PORTFOLIO_CONTEXT` become layer-aware.
  Holds are **never** flagged "no plan / at risk" — a hold's risk is drawdown vs
  thesis, not a missing stop. Only `layer==='trade'` tickers get plan-state risk
  (near/at invalidation, drifting). `no_price` is framed as a data gap, not risk.
- UI: a hold row shows its bucket/role/theme + drawdown-vs-thesis, not an empty
  entry rail labelled "no plan."

### Unit 1 — "In profit" correctness
- `TickerDetail.jsx`: when a position is held (`holding.avgPrice != null`),
  compute "in profit" and per-target % from `holding.avgPrice` (actual cost
  basis), not the plan entry. When flat, keep using the plan/suggested entry.
- Show both explicitly: `Setup entry 102.5 · Your entry 108.2` so the gauge is
  unambiguous. P&L money figure already uses broker `holding.pnl` (correct).

### Unit 2 — Allocation header + owner scope
- Replace `FundsBar` with the allocation-style header: owner/household selector
  (`scope`, `useUrlState('scope','me')`) + the Summary strip (deployed, dry
  powder, vs benchmark, unrealised P&L). Lift `Summary` + owner selector from
  `AllocationLedger.jsx` (they're pure display, reusable as-is).
- Page data becomes scope-aware: funds + holdings fetched with `?scope=`. The
  shared pipeline (`new`/`watching`) is **not** owner-filtered; only funds +
  Active/held rows are.

### Unit 3 — Filter & sort + list default
- Navattic-style bar (compact, chip-based) as **URL state** (nuqs/`useUrlState`,
  never local useState — house rule): `Search · Filter(N) · Sort · active chips ✕`.
- Facets: layer (trade/hold), bucket (core/satellite/picks), theme, sharia,
  grade range, asset class. (Owner is **not** a facet here — it's the header
  scope selector from Unit 2, the single source of truth for owner scoping.)
- Sorts: grade, R:R, P&L, % of acct, updated, **Manual** (default).
- Default view = **list**; remove the board/list `ViewToggle` (keep board code
  dormant, not deleted, so it can return later).

### Unit 4 — Scan/action bar
- A bar above the list that "spins through" the roster and surfaces **at-risk**
  (trade-layer near/at invalidation; holds in heavy drawdown vs thesis) and
  **worth-looking-into** (high grade + R:R + regime fit, not yet held). Uses the
  same layer-aware logic as the fixed chat (shared helper — no duplication).
- Optional "Ask Z" deep button → existing `streamPortfolioChat`.

### Unit 5 — Drag reorder + alert toggle
- **Reorder:** add `tickers.sort_order` (INTEGER, nullable) via CLI schema apply
  (house rule: apply, don't just write a migration). Drag moves between
  `new`/`watching` groups **and** reorders within a group; persist order. New
  endpoint to set order (e.g. `PATCH /api/tickers/:symbol/order` or a batch
  reorder). `in`/`closed` stay broker-driven (no manual order).
- **Alert toggle:** per-row toggle that arms plan-based alerts (buy-zone / stop /
  targets) from `resolvePlan()` → `createCustomAlert()`. Idempotent server helper
  (`POST /api/tickers/:symbol/alerts/arm`, `DELETE` to disarm), alerts tagged so
  the toggle reflects armed state. Disabled/hidden for holds with no plan.

## Build order
0 → 1 → 2 → 3 → 4 → 5. Unit 0 unblocks 4 (shared at-risk logic) and the chat
fix; 2 and 3 share the header bar; 5 carries the one schema change.

## Reuse / no-duplication
- At-risk logic: one layer-aware helper consumed by both the chat agent and the
  scan bar.
- Header `Summary` + owner selector: lifted from `AllocationLedger.jsx`.
- Alert arming: `resolvePlan` + `createCustomAlert` (already exist); add only the
  arm/disarm wrapper + UI toggle.
- Filter/sort: `useUrlState` (existing), Navattic chip pattern.

## Out of scope (for now)
- Placing real trades (long-term vision; spot-only/no-leverage when it lands).
- Deleting the board view (kept dormant).
