# Zero Lives → trading-hub archive (design)

**Date:** 2026-06-26
**Status:** Approved design — pilot first, then batch
**Owner:** Mansoor

## Problem

Zero's full trading history lives in the **Telegram channel "Zero's Dojo"** (1,716 messages since
April 2024: ~1,418 annotated chart photos, **61 live-session videos**, plus text). The terminal
**Hub** only keeps a rolling window of ~24 recent setups — old ones age off and are unretrievable.
trading-hub therefore surfaces almost none of Zero's back-catalogue.

The back-catalogue holds real, studyable trade setups, and some are **still actionable today**
(levels not yet hit, thesis still valid). We want to mine it and surface it.

Goal: **mine the whole video history, surface every setup as a studyable archive, and flag the
subset that is still live.**

### Hard constraints discovered during shaping (these shaped the design)

1. **Source is Telegram, not the Dojo API.** Only the last ~2 lives exist in the terminal with
   API chapters. The other ~59 are Telegram `MessageMediaDocument` video attachments.
2. **Chapters are not universal.** They cannot be the cornerstone. Availability tiers:
   - 2026 weekly lives → chapter timestamps **in the Telegram caption** (`LABEL -> MM:SS`, free to parse)
   - last ~2 → Dojo API chapters
   - mid-2025 "video analysis" + older → **no chapters**
   - some **Mr. PA** versions → no timestamps at all
3. **Not all 61 are setup videos.** Several 2024 posts are guide-launch announcements
   ("Stop Loss Guide is live") — not chart walkthroughs; they must be triaged out.
4. **Token cost is the reason for the redesign.** The current `/dojo-live` flow summarizes a
   whole video at once, so every chart pays for every other chart's irrelevant context
   (full SRT read to guess timestamps + vision-read of ~20 full screenshots + contact sheet).
   Rough current cost ≈ $0.30–0.70/video. Target ≈ $0.06–0.12/video.

### Decisions made during shaping
- **Scope:** videos first (photos/text a later phase). Both historical archive **and** live-flag.
- **Rollout:** pilot 3 videos first, validate accuracy + cost, then batch the rest.
- **Extraction runtime:** via Claude Code **subagents** (Haiku-tier), not a separate Anthropic API
  key / Batch API. Keeps heavy work out of the main conversation context.
- **Pilot set (one per chapter-resolution path):**
  - `1879` (2026-06-05) — caption chapters
  - `1504` (2025-05-09) — first video-analysis, likely no chapters → scene-detect fallback
  - `1876` (2026-05-26) — Mr. PA version, no timestamps

## Core reframe

**Unit of work = one chart ("chapter setup"), not one video.** The LLM produces structured JSON
from a single ticker's evidence packet; it never summarizes a whole video. This is the change that
removes the token waste and makes accuracy per-setup auditable.

## Pipeline

### Step 0 — Triage manifest (text-only, near-zero cost)
Build a manifest of all 61 video messages from the **archive captions we already have**
(`tg-reader/archive/zero-s-dojo.jsonl`). Per video: `{msg_id, date, sender, caption, class}` where
`class ∈ {weekly-live, video-analysis, guide-announcement, mr-pa, unknown}`. Only
`weekly-live` / `video-analysis` (and `mr-pa` if opted in) proceed. This decides what is even worth
downloading.

### Step 1 — Chapter resolution cascade (deterministic, free)
For each in-scope video, resolve chart segments by the first source that works:
1. **Caption parse** — lines matching `^[-•]?\s*(?<label>.+?)\s*->\s*(?<t>\d{1,2}:\d{2})` →
   ordered `{label, start_sec}`.
2. **Dojo API chapters** — for the ~2 that have them (`payload.chapters`, start_ms).
3. **Scene-detect + symbol OCR** — `ffmpeg select='gt(scene,THRESH)'` (or PySceneDetect) to find
   chart switches, then OCR the TradingView symbol (top-left crop) on each candidate frame to label
   and de-duplicate segments. Zero LLM tokens.

Record which path was used per video (for the pilot accuracy report).

### Step 2 — Per-video prep (deterministic, free)
- **Download** the video doc via tg-reader: add a `download <msg_id> [<out_dir>]` command that
  re-fetches the message by id (`client.get_messages(channel, ids=[id])`) and `download_media()`s it.
- whisper.cpp transcript (reuse `prep.sh` logic minus the yt-dlp step).
- ffmpeg: one frame at each chapter segment midpoint.
- **tesseract OCR** (to be installed) on each frame: crop price axis + annotation labels → numeric levels.
- Slice transcript into per-chapter chunks by segment time ranges.
- **Download → process → delete** the mp4 to manage disk (~290 MB × 61 ≈ 17 GB).

### Step 3 — Per-chart extraction (the only routine LLM step)
One **Haiku subagent per chart**, given a tight evidence packet
`{label, ticker_hint, chapter_transcript, ocr_levels}` → structured setup:
```json
{ "ticker": "...", "asset_class": "crypto|stock|commodity|fx",
  "bias": "long|short|spot", "entry": [...], "targets": [...],
  "invalidation": [...], "key_levels": [...], "rationale": "...",
  "timestamp_sec": 0, "confidence": 0.0 }
```
Shared system prompt + schema + grading rubric + Sharia policy are stable (reused across all
charts). **Vision is a fallback only** — escalate a single chapter's frame to a vision subagent when
transcript+OCR disagree or numbers are missing. Numbers come from transcript/OCR; vision maps
"this line" to a labelled level, it is not the primary numeric reader.

### Step 4 — Grade + Sharia (Haiku, text-only)
From the structured setup alone (no transcript/image). Deterministic prechecks first
(leverage/options/futures/perp language → non-spot flag / Sharia review), then the rubric score +
Sharia status. Spot-first.

### Step 5 — Resolution resolver (deterministic, no LLM)
Do **not** ask the LLM how it played out. Store the setup, then walk OHLCV forward from the video
date (existing market-data source):
- entry never triggered → `not_triggered`
- entry then target before invalidation → `won`
- invalidation before target → `lost`
- still open, not invalidated → **`still-active`** ← the **live-opportunity flag**
- both in one candle → `ambiguous_intrabar`
Also store MFE/MAE for study.

### Step 6 — Seed into trading-hub
Upsert into `tickers`/`events` reusing the `/feed` seed path. `source: zero_live`. Each event keyed
`zero_live:<msg_id>:<chart_index>` for idempotent re-runs. Payload carries levels, grade, Sharia,
resolution status, video date, and a deep-link `t.me/c/2039653167/<msg_id>` + timestamp.

## Components & boundaries
- `tg.py download` — fetch one video doc by msg id (additive, read-only).
- `lives/triage.(py|mjs)` — captions → manifest + class. Pure function over the archive.
- `lives/chapters.(py|mjs)` — caption/API/scene-detect cascade → ordered segments. Each source is
  an independent resolver behind one interface.
- `lives/prep.sh` — download+transcribe+frame+OCR for one video (extends existing `prep.sh`).
- extraction subagent prompt (schema + rubric + Sharia policy) — one stable artifact.
- `lives/resolve.(py|mjs)` — OHLCV path → outcome. Pure, testable against fixtures.
- `seed-zero-live.js` — manifest of structured setups → `tickers`/`events` (mirrors `seed-feed.js`).

## Error handling
- Any step's external dep missing (not logged in, tesseract absent, video gone) → fail that **one
  video** cleanly, record it in the manifest, continue the rest.
- Scene-detect that yields too few/too many segments → flag the video for manual chapter entry
  rather than guessing.
- Extraction `confidence < threshold` → escalate to vision, then to a Sonnet repair subagent; if
  still low, store as `needs_review` (never silently drop).
- Idempotency: event keys are deterministic, so re-running a video overwrites, never duplicates.

## Testing
- `chapters` caption parser: unit tests over real captions (1879, 1868, 1874) + a no-chapter case.
- `resolve`: fixture OHLCV → each outcome branch.
- triage classifier: assert guide-announcement posts (384, 495, 726) are excluded and lives included.
- **Pilot acceptance:** run the 3 pilot videos end-to-end; for the two we already hand-summarized,
  diff extracted levels against the manual `summary.md`; report per-video token cost vs the estimate.

## Out of scope (this phase)
- The 1,418 chart photos and text-only setups (later phase).
- Backfilling the photo archive's resolution history beyond what the resolver computes.
- Any UI work beyond surfacing `zero_live` events through the existing tickers/events views.

## Open questions (non-blocking)
- Whether Mr. PA videos are kept long-term or just piloted (1876 is in the pilot to learn the cost).
- Exact rubric reuse: §20 (leverage bible) vs the Investing-Masterclass framework for spot equities.
  Default: spot-first, §20 for crypto/leverage flags, Masterclass lens for ISA-style equities.
