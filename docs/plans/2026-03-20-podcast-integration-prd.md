# PRD: Podcast Integration for SNI Research

**Date:** 2026-03-20
**Author:** Scott Wilkinson + Claude
**Status:** Draft
**Branch:** `feature/web-ui`

---

## 1. Problem statement

SNI's automated fetch pipeline captures news articles from RSS feeds and Brave search. But the editor also consumes ~14 AI-focused podcasts daily, producing transcripts via a separate pipeline. These transcripts contain:

- **Story leads** that fetch misses — particularly from two editorially trusted sources (AI Daily Brief, Moonshots) whose hosts curate the most important AI developments each day.
- **Analysis and framing** that enriches newsletter drafting — expert commentary, cross-sector connections, notable quotes.
- **Material for LinkedIn posts** — the co-pilot currently lacks podcast context entirely.

Additionally, the newsletter has no systematic mechanism for detecting content overlap across editions. Stories can recur without the editor noticing until manual review.

## 2. Success criteria

| Criterion | Measure |
|---|---|
| Transcripts imported automatically | New episodes appear in SNI data within 3 hours of transcript pipeline delivery |
| Zero missed stories from trust sources | >90% recall on stories mentioned in AI Daily Brief and Moonshots, validated against manually labelled test set |
| Co-pilot has podcast awareness | Digests for all weekly episodes visible in co-pilot context; full transcripts loadable on demand |
| Cross-edition overlap detection | Pre-publish checker catches all genuine duplicates with <10% false positive rate, validated against labelled test set |
| No existing pipeline modifications | All existing `scripts/*.js` files unchanged; new scripts and modules added alongside |
| Prompts empirically validated | All three LLM prompts tested and iterated to meet accuracy thresholds before code integration |
| Dedup thresholds empirically calibrated | Tier 1 similarity threshold and Tier 2 confidence threshold determined by testing, not assumed |

## 3. Architecture overview

```
                          ┌──────────────────────┐
                          │  Transcript Pipeline  │
                          │  (external, 06:00)    │
                          └──────────┬─────────────┘
                                     │ .md files
                                     ▼
                    ~/Desktop/Podcast Transcripts/
                                     │
                          ┌──────────┴─────────────┐
                          │  podcast-import.js      │
                          │  (launchd, 07:00 daily) │
                          └──────────┬─────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                  ▼
            data/podcasts/    Story extraction     data/podcast-articles/
            (transcripts +    (AI Daily Brief      (gap-fill articles —
             digests)          + Moonshots only)    separate from verified/)
                    │                                   │
                    ▼                                   ▼
              Co-pilot context              Draft stage reads both
              (digests + full                verified/ + podcast-articles/
               transcript on demand)
                    │
                    ▼
           ┌───────────────────┐
           │  Overlap Checker  │
           │  (UI button,      │
           │   pre-publish)    │
           └───────────────────┘
```

### Constraints

**Hard constraints (inherited from project):**

- Existing `scripts/*.js` files are **never modified**. New scripts can be added to `scripts/`.
- Existing `config/` files (sectors.yaml etc.) are **never modified**. New config files can be added.
- Runtime: Bun, ES modules, sync file I/O. No `__dirname` — use `import.meta.dir`.
- New files in `scripts/` use `import.meta.dir` (Bun-native) for path resolution, not the older `dirname(fileURLToPath(import.meta.url))` pattern used by existing pipeline scripts.
- No external services — all data is local files. No database.
- API server reads data directories — never imports pipeline modules directly.
- The API server reads from and writes to `output/` (overlap cache, thread history). This is the existing convention — thread JSONL files are already written by the API server.
- Web UI on `feature/web-ui` branch; pipeline runs from `master` via launchd.

**CLAUDE.md amendment required:** The existing instruction 'All new code goes in `web/`' was written before the podcast integration requirement. This PRD adds new scripts to `scripts/` (a new independent pipeline) and new config files to `config/prompts/`. CLAUDE.md must be updated to reflect: 'All new web UI code goes in `web/`. New pipeline scripts may be added to `scripts/`. New config files may be added to `config/`. Existing files in `scripts/` and `config/` are never modified.'

**Clarification on 'no pipeline modification':** The constraint means we do not change the behaviour of existing scripts (`fetch.js`, `score.js`, `discover.js`, `draft.js`, `review.js`, `evaluate.js`, `verify-links.js`, `notify.js`, `pipeline.js`). We **can** add new files to `scripts/` and `scripts/lib/`, and we **can** add new files to `config/`. The podcast-import script is a new, independent pipeline — not a modification to the existing one.

**Implication for dedup enhancement:** The original design proposed modifying `fetch.js` and `discover.js` to use the new two-tier dedup. This violates the constraint. Instead, the two-tier dedup is used **only** by the new podcast-import script and the web API overlap checker. Enhancing fetch/discover dedup is deferred to a future phase where the existing scripts can be intentionally refactored.

## 4. Transcript pipeline dependencies

### 4.1 URL frontmatter field

The external transcript pipeline must add a `**URL:**` field to its markdown frontmatter. This is a **hard dependency** for the newsletter linking feature.

**Expected frontmatter format (after update):**

```markdown
# Episode Title

**Date:** 2026-03-18
**Source:** AI Daily Brief
**URL:** https://www.youtube.com/watch?v=abc123
**Duration:** 27 min
**Transcript source:** whisper-api (gpt-4o-mini-transcribe)

---

Transcript body...
```

**Handling missing URLs:**

- Import proceeds without URL (backward compatibility with existing transcripts that predate the update).
- A warning is logged: `WARN: No URL in frontmatter for <filename>`.
- The episode is not linkable in newsletter output.
- The digest JSON stores `episodeUrl: null`.

**Work item:** Updating the transcript pipeline to emit the URL field is part of this project's implementation plan, not a separate external request.

### 4.2 Frontmatter variations

Real transcripts show consistent frontmatter across all 14 feeds:

```
# Title
**Date:** YYYY-MM-DD
**Source:** <podcast name>
**Duration:** NN min
**Transcript source:** <method>
```

The parser must handle:
- Title extracted from H1 (`# ...`) on line 1.
- Bold-key-value pairs (`**Key:** Value`) for metadata.
- `---` separator before transcript body.
- The `_pipeline_report.md` file (starts with `#` but is not a transcript — filter by presence of `**Date:**` field).
- The `Previous/` subdirectory (not scanned — only top-level `.md` files).

## 5. Component design

### 5.1 Podcast import script — `scripts/podcast-import.js`

**Trigger:** Separate launchd job, daily at 07:00 local time.

**Plist:** `com.sni.podcast-import.plist`, symlinked to `~/Library/LaunchAgents/`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sni.podcast-import</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/scott/.bun/bin/bun</string>
    <string>/Users/scott/Projects/sni-research-v2/scripts/podcast-import.js</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>WorkingDirectory</key>
  <string>/Users/scott/Projects/sni-research-v2</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/scott/.bun/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/scott/Projects/sni-research-v2/logs/podcast-import.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/scott/Projects/sni-research-v2/logs/podcast-import-error.log</string>
  <key>Nice</key>
  <integer>10</integer>
</dict>
</plist>
```

**Wake schedule dependency:** The existing `pmset repeat wakeorpoweron MTWRFSU 03:55:00` wakes the Mac at 03:55 for the 04:00 daily pipeline. The Mac typically stays awake for hours after (daily runs take 250–490 min). However, if the daily run completes before 07:00 and the Mac sleeps, launchd will fire the podcast import when the Mac next wakes. This is acceptable — the import is idempotent and will catch up. If same-day import is critical, update pmset to include a 06:55 wake: `pmset repeat wakeorpoweron MTWRFSU 03:55:00` → a second scheduled wake event.

**Input:** `~/Desktop/Podcast Transcripts/*.md` (top-level only, not `Previous/` subdirectory).

**File filtering:**
- Only files matching pattern `YYYY-MM-DD-*.md`.
- Skip `_pipeline_report.md` and any file without a `**Date:**` frontmatter field.
- Skip files already in the manifest.
- Files with `Source: On-demand request` in frontmatter are imported as regular episodes but are NOT eligible for trust source story extraction, regardless of their content. The trust source match is strictly on the `Source` field.
- Files with `Transcript source: newsletter` in frontmatter are imported normally (they contain useful editorial content) but are labelled as `type: 'newsletter'` in the manifest and digest, not `type: 'podcast'`. The co-pilot displays them under a 'Newsletters' subsection, separate from podcasts.

**Anthropic client:** The import script creates its own client: `import Anthropic from '@anthropic-ai/sdk'; import { loadEnvKey } from './lib/env.js'; const client = new Anthropic({ apiKey: loadEnvKey('ANTHROPIC_API_KEY') });` This follows the same pattern as `web/api/lib/claude.js` but uses the `scripts/lib/env.js` workaround for the Bun .env bug.

**Deduplication:** Manifest file at `data/podcasts/manifest.json`:

```json
{
  "2026-03-18-ai-daily-brief-how-to-use-agent-skills.md": {
    "importedAt": "2026-03-19T07:00:12.345Z",
    "week": 12,
    "date": "2026-03-18",
    "source": "AI Daily Brief",
    "episodeUrl": "https://www.youtube.com/watch?v=abc123",
    "title": "How to Use Agent Skills",
    "duration": "27 min",
    "digestPath": "data/podcasts/2026-03-18/ai-daily-brief/how-to-use-agent-skills.digest.json",
    "transcriptPath": "data/podcasts/2026-03-18/ai-daily-brief/how-to-use-agent-skills.md",
    "digestGenerated": true,
    "storiesExtracted": true,
    "storiesCount": 7,
    "storiesFetched": 2,
    "isTrustSource": true
  }
}
```

If a filename already exists in the manifest **and** all processing stages are complete (`digestGenerated: true` and, for trust sources, `storiesExtracted: true`), the file is skipped entirely. If a previous run partially completed (e.g. transcript copied but digest failed), the import retries the incomplete stages.

**Processing steps per new file:**

1. **Parse frontmatter** — extract Date, Source, URL, Duration, Title (from H1). Validate Date is a valid ISO date. Validate Source is non-empty. **Quality check:** If the transcript body (after the `---` separator) is shorter than 1,000 characters AND the Duration field indicates >10 minutes, log a warning: `WARN: Suspiciously short transcript for <filename> (<N> chars for <M> min episode)`. The transcript is still imported but the warning appears in the dashboard.
2. **Determine editorial week** — using `getWeekWindow()` from `scripts/lib/week.js`. **Note:** The pipeline's week module exports `getWeekWindow(weekNum, year)` returning `{ start, end }`. The web API's equivalent is `getWeekDateRange(week, year)` in `web/api/lib/week.js`. Each codebase uses its own module. **Editorial week assignment:** A transcript dated Friday starts a NEW editorial week (the Fri–Thu cycle). `getWeekWindow()` handles this correctly — a Friday date maps to the week that starts on that Friday. The manifest stores the editorial week number, not the ISO week number.
3. **Copy transcript** — to `data/podcasts/<date>/<podcast-slug>/<title-slug>.md`. The source file is **copied, not moved** — the user manages the source folder themselves.
4. **Generate digest** — LLM call using `transcript-digest` prompt (see §6). Save as `.digest.json` alongside the transcript.
5. **Story extraction** (trust sources only) — LLM call using `story-extract` prompt (see §6). For each extracted story, run gap-fill (see §5.2).
6. **Update manifest** — write entry for this file using write-validate-swap pattern (write `.tmp`, parse back, `.bak`, rename).

**Concurrency protection:** The import script acquires a lockfile (`data/podcasts/.import.lock`) at start and releases it on completion (or crash — lockfile includes PID for stale lock detection). This prevents concurrent runs (e.g. launchd + manual) from corrupting the manifest. Pattern matches the existing `scripts/lib/lock.js` PID-based locking.

**Trust source identification:** Match `Source` frontmatter field against a config list:

```yaml
# config/podcast-trust-sources.yaml
trust_sources:
  - name: AI Daily Brief
    slug: ai-daily-brief
    extract_stories: true
  - name: Moonshots
    slug: moonshots
    extract_stories: true
```

This is a config file so new trust sources can be added without code changes.

**Slugification:** `slugify()` from `scripts/lib/extract.js` is a pure function (no pipeline dependencies). It is importable by the podcast-import script. Rules: lowercase, strip non-alphanumeric except spaces and hyphens, collapse whitespace to hyphens, truncate to 60 chars, strip trailing hyphens. Podcast slugs come from `config/podcast-trust-sources.yaml`; title slugs are computed via `slugify(title)`.

**LLM model selection:** All podcast-import LLM calls use `claude-sonnet-4-20250514` (same model as score.js and the co-pilot). This balances quality with cost. The model is configurable via `config/podcast-trust-sources.yaml`:

```yaml
model: claude-sonnet-4-20250514
```

**JSON output enforcement:** All prompts include 'Return ONLY JSON, no markdown fencing' in their instructions. The code parses JSON from the response text using `JSON.parse()` within a try/catch. On parse failure, a single retry is attempted with a follow-up message: 'Your response was not valid JSON. Please return ONLY a JSON object/array with no other text.' If the retry also fails, the stage is marked as failed.

**Error handling:**

- Frontmatter parse failure → log error, skip file, do not add to manifest (will retry next run).
- LLM call failure (digest or extraction) → log error, save transcript without digest, add to manifest with `digestGenerated: false` (will retry digest on next run).
- File I/O failure → log error, skip file, do not add to manifest.
- JSON parse failure from LLM → single retry with corrective prompt, then log error and mark as failed.
- Partial completion is safe — manifest tracks completion status per stage.

**Manifest write pattern** (matches `web/api/routes/config.js` putConfig): (1) `writeFileSync(manifest + '.tmp', JSON.stringify(data, null, 2))`, (2) `JSON.parse(readFileSync(manifest + '.tmp', 'utf8'))` — verify round-trip, (3) if current file exists: `copyFileSync(manifest, manifest + '.bak')`, (4) `renameSync(manifest + '.tmp', manifest)`. On failure: `rmSync(manifest + '.tmp')` and log error.

**Logging:** Same format as main pipeline. Structured log lines with timestamps.

```
[07:00:05] Scanning ~/Desktop/Podcast Transcripts/
[07:00:05] Found 17 .md files, 3 new (14 already imported)
[07:00:05] Skipped: _pipeline_report.md (not a transcript)
[07:00:05] Importing: 2026-03-19-ai-daily-brief-what-people-really-want-from-ai.md
[07:00:06]   Source: AI Daily Brief | Date: 2026-03-19 | Week: 12
[07:00:06]   Trust source: yes — will extract stories
[07:00:12]   Digest generated (847 tokens)
[07:00:18]   Stories extracted: 6 identified
[07:00:19]     "NVIDIA GTC announcements" — MATCH (existing: nvidia-gtc-2026-jensen-huang.json)
[07:00:20]     "OpenAI Dispatch feature" — NO MATCH — fetching https://...
[07:00:25]     Saved to data/podcast-articles/2026-03-19/general/openai-dispatch-feature.json
[07:00:25]   ✓ Import complete (digest + 6 stories, 2 fetched)
[07:00:26] Retrying failed digest: 2026-03-18-big-technology-podcast-are-we-screwed-if-ai-works.md
[07:00:32]   Digest generated (923 tokens)
[07:00:32]   ✓ Retry complete
[07:00:32] ═══ Import complete: 3 new, 1 retried, 0 failed ═══
```

**Run summary:** Saved to `output/runs/podcast-import-YYYY-MM-DD.json` with the following schema:

```json
{
  "runId": "podcast-2026-03-20-1773979205",
  "date": "2026-03-20",
  "weekNumber": 12,
  "year": 2026,
  "startedAt": "2026-03-20T07:00:05.000Z",
  "completedAt": "2026-03-20T07:02:32.000Z",
  "totalDuration": 147000,
  "stats": {
    "filesScanned": 17,
    "newImports": 3,
    "skippedAlreadyImported": 14,
    "retried": 1,
    "failed": 0,
    "digestsGenerated": 4,
    "storiesExtracted": 12,
    "storiesFetched": 3,
    "storiesMatched": 7,
    "storiesNoUrl": 2,
    "fetchFailed": 0
  },
  "warnings": ["No URL in frontmatter for 2026-03-17-jim-rutt-..."],
  "errors": []
}
```

### 5.2 Story gap-fill

Runs as part of podcast import for trust sources only.

**Input:** Structured story list from `story-extract` prompt.

**Critical design decision — separate storage directory:** Gap-fill articles are saved to `data/podcast-articles/<date>/<sector>/` — NOT to `data/verified/`. This is because:

1. `score.js` scans all of `data/verified/` and would re-score (and potentially reject) podcast-extract articles. There is no `skip_scoring` mechanism in score.js and we cannot modify it.
2. `data/podcast-articles/` is a parallel corpus that the draft stage, co-pilot, and web API can read alongside `data/verified/`.
3. This cleanly separates machine-curated (fetch+score) from editorially-curated (podcast-extract) content.

**Note on sector directory names:** The sector slug `general` is used in directory paths and article metadata. The full name 'general AI' appears only in display labels. Real articles use `general`, `biopharma`, `medtech`, `manufacturing`, `insurance` — NOT `general-ai`.

**Concurrent access safety:** The gap-fill step reads `data/verified/` to check for existing articles. If the main pipeline is running simultaneously and writing to `data/verified/`, a partially-written JSON file could cause a parse error. The gap-fill reader wraps each `JSON.parse(readFileSync(...))` in a try/catch — on parse failure, the article is treated as not-found (erring on the side of fetching a potential duplicate, which is harmless and will be caught by future dedup).

**Intra-run dedup:** The gap-fill step maintains an in-memory set of URLs and extracted story headlines processed during the current run. When processing the second trust source episode (e.g. Moonshots after AI Daily Brief), the gap-fill checks both the on-disk corpus AND the in-memory set from earlier in the same run. This prevents duplicate fetches when both podcasts cover the same story.

**For each extracted story:**

1. **URL match** — if the story has a URL, check all articles in both `data/verified/` and `data/podcast-articles/` for the editorial week by exact URL. If found, skip.
2. **Tier 1 headline match** — compute normalised token overlap between the extracted story headline and all article titles in the week (both directories). The similarity threshold is empirically determined during the prompt development phase (see §7). Any pair above the threshold proceeds to Tier 2.
3. **Tier 2 content match** — LLM call using `content-match` prompt (see §6). Sends the extracted story description + the candidate article's snippet/full_text. Returns: `{ sameStory: boolean, confidence: number, explanation: string }`. If `sameStory: true` with confidence above a calibrated threshold, skip.
4. **Fetch and save** — if no match found and a URL is available:
   - Fetch the page using Bun's native `fetch()` (not importing from `scripts/lib/extract.js` — the import script has its own lightweight fetch+extract implementation to avoid importing pipeline modules).
   - Extract article text using cheerio (same library the pipeline uses, but our own extraction function).
   - **Quality gate:** If the extracted text is shorter than 200 characters, the article is logged as 'fetch-failed: content too short (likely paywalled or non-article page)' and is NOT saved. If the HTTP response is 403/401/paywall, logged as 'fetch-failed: paywall'. If 404 or network error, logged as 'fetch-failed: dead link'. Failed fetches are recorded in the manifest with the reason, so they are not retried.
   - Save to `data/podcast-articles/<date>/<sector>/<slug>.json` with metadata:
     ```json
     {
       "title": "OpenAI Launches Dispatch Feature for Claude Co-Work",
       "url": "https://...",
       "source": "techcrunch.com",
       "date_published": "2026-03-19",
       "sector": "general",
       "snippet": "First 500 chars of extracted text...",
       "full_text": "Full article text (up to 10k chars)...",
       "found_by": ["podcast-extract"],
       "podcast_source": "AI Daily Brief",
       "podcast_episode": "How to Use Agent Skills",
       "podcast_episode_url": "https://...",
       "podcast_extract_confidence": 0.95
     }
     ```
   - Article JSON follows the same schema as `data/verified/` articles for compatibility with the web API and co-pilot.
5. **No URL** — log as 'podcast-mentioned, unfetched'. Stored in the manifest's story list for editorial reference but does not enter the article corpus.

### 5.3 Digest JSON format

```json
{
  "filename": "2026-03-18-ai-daily-brief-how-to-use-agent-skills.md",
  "title": "How to Use Agent Skills",
  "source": "AI Daily Brief",
  "date": "2026-03-18",
  "episodeUrl": "https://www.youtube.com/watch?v=abc123",
  "duration": "27 min",
  "week": 12,
  "type": "podcast",
  "sector_tags": ["general", "manufacturing"],
  "key_stories": [
    {
      "headline": "Anthropic maps 28,000+ agent skills into nine categories",
      "entities": ["Anthropic", "Claude"],
      "sector": "general",
      "url": null
    }
  ],
  "notable_quotes": [
    {
      "speaker": "Host",
      "quote": "We're trending towards a practical framework for how organisations encode institutional knowledge into agentic systems.",
      "context": "Discussing Anthropic's skill taxonomy"
    }
  ],
  "themes": [
    "Agent skills as enterprise architecture",
    "Desktop-native agent convergence",
    "Agent-to-agent trust dynamics"
  ],
  "summary": "A ~200-word narrative summary of the episode's key points...",
  "tokenCount": 847
}
```

**Note:** `tokenCount` is computed by the import script after serialising the digest JSON (using `estimateTokens()` from `web/api/lib/context.js` or equivalent `Math.ceil(text.length / 4)`), not returned by the LLM. The `type` field is `'podcast'` for standard episodes or `'newsletter'` for files with `Transcript source: newsletter` in frontmatter.

### 5.4 Co-pilot integration

**Changes to `web/api/lib/context.js`:**

#### New function: `buildPodcastContext(week, year)`

- Reads all digest JSONs from `data/podcasts/` within the editorial week date range.
- Assembles a markdown block per episode:

```markdown
## Podcast: How to Use Agent Skills
- Source: AI Daily Brief | Date: 2026-03-18 | [Listen](https://...)
- Themes: Agent skills as enterprise architecture, Desktop-native agent convergence
- Key stories: Anthropic maps 28,000+ agent skills; NVIDIA NemoCloud security wrapper; ...
- Notable quote: "We're trending towards a practical framework..." — Host
```

- At ~300–500 tokens per digest (compressed from the full ~1k digest JSON), 15 episodes ≈ 4.5–7.5k tokens.

#### Updated function: `loadArticlesForWeek(week, year)`

- Currently reads only `data/verified/`. Updated to also read `data/podcast-articles/`, merging both sets. The API layer synthesises `source_type: 'podcast-extract'` from the `found_by` field when returning articles — articles with `found_by` containing `'podcast-extract'` get `source_type: 'podcast-extract'`, so the co-pilot and UI can distinguish them.

#### `assembleContext()` restructuring

The current `assembleContext()` concatenates all context blocks into a single `preamble` string. With the addition of podcast digests and the 64k budget, the function must be restructured to track token usage per block type, ensuring each category gets appropriate space. The new structure: (1) compute each block independently with its token count, (2) apply priority-based truncation if total exceeds budget (thread history is truncated first, then podcast digests, then article context).

#### Token budget increase

- `TOKEN_BUDGET` changes from `28000` to `64000`.
- Worst-case token accounting (based on real data — Week 11 had 28 episodes):
  - System prompt: ~500 tokens
  - Article context (top 30 detailed + rest title-only): ~10k tokens
  - Podcast digests (28 × 400): ~11.2k tokens
  - Full transcript on demand (16k chars ÷ 4): ~4k tokens
  - Pins: ~2k tokens
  - Published exemplar (if used): ~5k tokens
  - **Total worst case: ~32.7k tokens**
  - **Remaining for thread history: ~31.3k tokens** (comfortable within 64k but tighter than the typical case — ~15 episodes, ~6k digests, ~38k for history)
  - Response budget: 2k tokens (unchanged, deducted separately)

#### Full transcript on demand

- The existing article picker in the Co-pilot UI is extended to also list podcast episodes for the current week.
- When selected, `loadPodcastFullText(date, podcastSlug, titleSlug)` reads the full `.md` transcript from `data/podcasts/` and injects it into context, capped at 16,000 characters (increased from the 8,000 char article cap, since transcripts are longer and less dense).
- Only one full transcript or full article can be injected at a time (same constraint as today).

#### `podcastRef` persistence

When a user selects a podcast episode, the `podcastRef` is stored in the thread history JSONL alongside each message pair, identical to how `articleRef` is persisted today (see `chat.js` line 333). The `podcastRef` format is: `{ date: "YYYY-MM-DD", source: "podcast-slug", title: "title-slug" }` — the same triple used by the transcript endpoint.

#### System prompt update

`COPILOT_SYSTEM` is updated to inform the model about podcast context:

```
You have access to this week's article corpus, podcast episode digests, and any pinned editorial notes. When referencing podcast content, cite the podcast name and episode title. Episode URLs are provided for linking.
```

#### Context assembly order (updated)

```
1. System prompt (COPILOT_SYSTEM or DRAFT_SYSTEM — updated)
2. Article context (top 30 detailed + rest title-only, from both verified/ and podcast-articles/)
3. Podcast digest context (all episodes for the week)
4. Injected full article OR full transcript (if selected)
5. Pins
6. Published exemplar (if /compare-draft)
7. Thread history (fills remaining budget)
```

### 5.5 Overlap checker

**UI:** A button on the Draft Editor page, labelled 'Check Overlap'. Positioned next to the existing review pill.

**API endpoint:** `POST /api/draft/check-overlap?week={N}`

**Processing:**

1. **Parse current draft** — split into story sections. **Parser rules** (based on real newsletter structure in `output/draft-week-9.md`):
   - Lines matching `^## In (Biopharma|Medtech|Manufacturing|Insurance)` or `^## AI` or section-name-only headers like `^Biopharma$` are **container headers** — they group stories but are not stories themselves.
   - Lines matching `^## But what set podcast tongues` are **podcast container headers**.
   - Lines matching `^\[.+\]\(https?://.+\)$` (bare markdown links on their own line) are **story entries** — the link text is the headline, the URL is the source.
   - Lines matching `^### .+` within a container are **story entries** — the heading text is the headline.
   - All body text between one story entry and the next belongs to the preceding story.
   - The parser returns an array of `{ heading: string, body: string, urls: string[], container: string }` objects.

2. **Load archive** — two sources, in priority order:
   - `output/published/week-{N}.md` — the canonical published version (the existing `published.js` route already manages this directory with `.md` files and `-meta.json` companions).
   - `output/draft-week-{N}*.md` — fallback when no published version exists. If multiple versions exist (e.g. `draft-week-9.md`, `draft-week-9-v2.md`, `draft-week-9-v3.md`), use the highest version number. Exclude the current week.
   - **Note:** `output/published/` is currently empty (no newsletters have been formally published through the web UI yet). The draft fallback is therefore the primary working path and must be thoroughly tested. If both published and draft sources are empty for a given week, that week is skipped.
   - **Default lookback:** 8 weeks. Configurable in `config/podcast-trust-sources.yaml` as `overlap_lookback_weeks: 8`. Older editions are not checked.

3. **Extract archived story summaries** — for each archived draft, apply the same section parser. Cache results in `output/overlap-cache/week-{N}.json` so they're only computed once. Invalidate cache if the source file is newer than the cache.
4. **Tier 1 scan** — for each current story section vs each archived story section, compute normalised token overlap on the full section text (heading + body), not just headings. This is because the user explicitly requires deep matching — headline-only comparison is insufficient. Pairs above the empirically calibrated threshold proceed to Tier 2.
5. **Tier 2 LLM check** — send both story texts to Claude using the `content-match` prompt. Returns: `{ sameStory: boolean, confidence: number, explanation: string }`.
6. **Return results:**

```json
{
  "week": 12,
  "checkedAt": "2026-03-20T14:30:00.000Z",
  "archiveWeeksScanned": [8, 9, 10, 11],
  "overlaps": [
    {
      "currentSection": "OpenAI pivoted to enterprise",
      "currentHeading": "### OpenAI pivoted to enterprise",
      "matchedSection": "OpenAI's strategic pivot",
      "matchedWeek": 11,
      "matchedHeading": "### OpenAI's strategic pivot",
      "confidence": 0.87,
      "explanation": "Both sections cover OpenAI's announcement to staff about dropping side projects (Sora, Atlas, hardware) to focus on enterprise and coding."
    }
  ],
  "stats": {
    "currentSections": 12,
    "archivedSections": 48,
    "tier1Candidates": 7,
    "tier2Checks": 7,
    "overlapsFound": 1,
    "durationMs": 8500
  }
}
```

**Rate limiting:** Tier 2 LLM calls are sequential with a 200ms delay between calls to avoid rate limiting. For large archives (>100 archived sections), Tier 1 candidates are capped at 20 to keep the check under 60 seconds. If more than 20 candidates are found, the top 20 by Tier 1 score are checked.

**UI display:**

- Results appear in a slide-out panel on the right side of the draft editor (similar to the existing review overlay pattern).
- Each overlap is a card showing:
  - The current section heading (clickable — scrolls to it in the editor)
  - The matched section heading + week number
  - Confidence badge (colour-coded: >0.8 red, 0.5–0.8 amber, <0.5 grey)
  - The LLM explanation
  - A 'Dismiss' button to mark as reviewed (stored in session, not persisted)
- Summary bar at top: 'N overlaps found across M previous editions'
- If no overlaps: green banner 'No content overlap detected'
- Duration shown: 'Checked in N seconds'

## 6. Prompt design

All prompts live in `config/prompts/` as versioned text files, loaded at runtime. This separates prompt engineering from code. Adding new files to `config/` does not violate the 'no config modification' constraint — existing config files are untouched.

**Prompt loading:** A new utility function `loadAndRenderPrompt(promptName, variables)` in `scripts/lib/dedup.js` (or a separate `scripts/lib/prompts.js`): reads `config/prompts/<promptName>.txt`, performs `{key}` → value replacement for each variable, returns the rendered string. This is separate from the pipeline's existing `loadPrompt()` which expects `.md` files with YAML frontmatter and `{{key}}` double-brace syntax.

**Prompt template format:** Prompts use `{placeholder}` syntax (single braces). These are NOT loaded via the pipeline's existing `loadPrompt()` function (which expects `.md` with YAML frontmatter and `{{key}}` syntax). Instead, a simple loader reads the `.txt` file and performs string replacement: `prompt.replace('{transcript}', transcriptText)`. This is implemented in `scripts/lib/dedup.js` as `loadAndRenderPrompt(name, vars)`.

### 6.1 `config/prompts/story-extract.v1.txt`

**Purpose:** Extract structured news stories from AI Daily Brief and Moonshots transcripts.

**Input:** Full transcript text.

**Output:** JSON array of story objects.

**Model:** `claude-sonnet-4-20250514`

**Prompt structure:**

```
You are a news analyst extracting structured story references from a podcast transcript.

## Task
Identify every distinct news story, product launch, company announcement, research finding, or significant industry development mentioned in this transcript. Include stories from headline segments, deep-dive segments, and passing references.

## Output format
Return ONLY a JSON array, no markdown fencing, no explanation. Each element:
{
  "headline": "Short descriptive headline for the story (max 15 words)",
  "entities": ["Company or person names central to the story"],
  "url": "URL if explicitly mentioned in the transcript, otherwise null",
  "date_context": "When this happened, if mentioned (e.g. 'this week', 'March 17', 'yesterday')",
  "sector": "Most likely SNI sector: general | biopharma | medtech | manufacturing | insurance",
  "detail": "2-3 sentence summary of what was said about this story",
  "confidence": "high | medium — how clearly this was identified as a distinct story vs background commentary"
}

## Rules
- Include ALL stories, even briefly mentioned ones. Err on the side of inclusion.
- Do NOT include: sponsor reads, self-promotion, meta-commentary about the podcast itself, calls to action, subscription prompts, or community announcements (e.g. competitions, voting brackets).
- If a story spans multiple segments (e.g. headline + later deep-dive), merge into one entry with the richer detail.
- Preserve the podcast's framing — capture what the host said was important about the story.
- If a URL is read aloud or shown on screen (referenced in transcript), include it exactly.
- Whisper transcripts may contain misheard proper nouns. Use context to correct obvious errors (e.g. "Open Claw" → "OpenClaw", "Nemo Clo" → "NemoCloud").
- For sector classification, use these definitions:
  - general: AI industry broadly, foundational models, AI companies, regulation, compute infrastructure
  - biopharma: AI in drug discovery, clinical trials, pharmaceutical R&D
  - medtech: AI in medical devices, clinical decision support, health IT, diagnostics
  - manufacturing: AI in industrial automation, robotics, supply chain, digital twins
  - insurance: AI in underwriting, claims, risk assessment, insurtech

## Few-shot examples

<example_input>
...Jensen Huang has kicked off GTC with a massive prediction that the company will see a trillion dollars in revenue between now and 2027. We got confirmation of the new Grok-powered server focused on inference...
</example_input>

<example_output>
[
  {
    "headline": "NVIDIA CEO predicts $1 trillion revenue by 2027 at GTC",
    "entities": ["NVIDIA", "Jensen Huang"],
    "url": null,
    "date_context": "GTC 2026, this week",
    "sector": "general",
    "detail": "Jensen Huang opened GTC 2026 with a prediction that NVIDIA will reach $1 trillion in cumulative revenue by 2027, highlighting the scale of AI infrastructure demand.",
    "confidence": "high"
  },
  {
    "headline": "NVIDIA announces Grok-powered inference server at GTC",
    "entities": ["NVIDIA"],
    "url": null,
    "date_context": "GTC 2026",
    "sector": "general",
    "detail": "NVIDIA confirmed a new rack-mounted server system combining Grok chips, focused on inference workloads.",
    "confidence": "high"
  }
]
</example_output>

## Transcript

{transcript}
```

### 6.2 `config/prompts/content-match.v1.txt`

**Purpose:** Determine whether two pieces of content describe the same news story.

**Input:** Story A text + Story B text. These may be: a podcast story extract vs an article snippet, a newsletter section vs another newsletter section, or any combination.

**Output:** Match assessment.

**Model:** `claude-sonnet-4-20250514`

**Prompt structure:**

```
You are a news deduplication analyst. Determine whether two pieces of content describe the SAME specific news story or event.

## Definitions
- SAME STORY: Both pieces cover the same specific event, announcement, or development. Example: two articles about "OpenAI acquiring Windsurf" are the same story even if they emphasise different aspects or are written in different styles.
- RELATED BUT DIFFERENT: Both cover the same broad topic or company but describe different events. Example: "OpenAI launches GPT-5.4" and "OpenAI pivots to enterprise" are related but different stories.
- UNRELATED: No meaningful connection.

## Output format
Return ONLY JSON, no markdown fencing, no explanation outside the JSON:
{
  "sameStory": true | false,
  "confidence": 0.0 to 1.0,
  "explanation": "One sentence explaining your reasoning"
}

## Rules
- Be STRICT about "same story". Two articles about AI regulation are NOT the same story unless they cover the same specific regulation, vote, or announcement.
- Recurring themes (e.g. "AI is transforming healthcare") appearing in multiple weeks are NOT duplicates.
- Follow-up coverage IS a potential duplicate if it's recapping the same event rather than reporting new developments.
- New developments about the same company or topic are NOT duplicates (e.g. "NVIDIA Q4 earnings" in week 9 vs "NVIDIA GTC keynote" in week 12).
- A higher confidence means you are more certain of your judgement (whether match or non-match).
- The two inputs may have different formats (article headline vs newsletter paragraph vs podcast summary). Focus on the underlying news event, not the writing style.

## Story A
{story_a}

## Story B
{story_b}
```

### 6.3 `config/prompts/transcript-digest.v1.txt`

**Purpose:** Generate a structured summary of a podcast transcript.

**Input:** Full transcript text + podcast metadata.

**Output:** Structured digest JSON.

**Model:** `claude-sonnet-4-20250514`

**Prompt structure:**

```
You are an editorial analyst creating a structured digest of a podcast episode for use in an AI news intelligence system.

## Task
Summarise this podcast transcript into a structured digest that captures the key stories, notable quotes, and themes discussed. The digest will be used by an editorial co-pilot to provide context when drafting newsletters and LinkedIn posts about AI developments.

## Output format
Return ONLY JSON, no markdown fencing, no explanation outside the JSON:
{
  "sector_tags": ["Array of relevant SNI sectors from: general, biopharma, medtech, manufacturing, insurance"],
  "key_stories": [
    {
      "headline": "Short descriptive headline (max 15 words)",
      "entities": ["Key company/person names"],
      "sector": "primary SNI sector",
      "url": "URL if mentioned in transcript, otherwise null"
    }
  ],
  "notable_quotes": [
    {
      "speaker": "Name of speaker, or 'Host' if unnamed/unclear",
      "quote": "Exact quote from the transcript (max 50 words, preserve original wording)",
      "context": "Brief context for when/why this was said"
    }
  ],
  "themes": ["High-level theme labels, max 5"],
  "summary": "200-word narrative summary capturing the episode's key arguments and insights. Written in present tense, analytical tone. Use UK English (single quotes, spaced en dashes, no Oxford commas)."
}

## Rules
- Capture ALL distinct news stories mentioned, not just the main topic.
- Select quotes that are insightful, surprising, or quotable — not filler or greetings.
- Limit to 3-5 quotes per episode. Prefer quotes with named speakers over unnamed hosts.
- Themes should be abstract enough to connect across episodes (e.g. "enterprise AI adoption" not "Jensen Huang's GTC keynote").
- The summary should be useful to an editor deciding whether to reference this episode in a newsletter.
- Sector tags: include ALL sectors touched by the episode, not just the primary one.
- Whisper transcripts may contain errors in proper nouns. Use context to infer correct names.
- If the episode is primarily about non-AI topics (geopolitics, culture, etc.), sector_tags should be empty and the summary should note limited AI relevance.

## Podcast metadata
Title: {title}
Source: {source}
Date: {date}
Duration: {duration}

## Transcript
{transcript}
```

## 7. Prompt development and threshold calibration

**This phase runs BEFORE any integration code is written.** Prompts and thresholds are empirically validated, iterated, and only committed once they meet accuracy targets.

### 7.1 Test data assembly

Build a labelled test dataset from existing material:

**For story extraction (`story-extract`):**
- Take 4–6 real AI Daily Brief and Moonshots transcripts from the current `~/Desktop/Podcast Transcripts/` folder.
- Manually read each and list every news story mentioned (ground truth).
- Label each with: headline, entities, URL if mentioned, sector.
- Include at least one episode with many stories (>8) and one with few (<4) to test both ends.

**For content matching (`content-match`):**
- Take real stories from draft weeks 8–11 (current week excluded) and real articles from `data/verified/`. Extract story sections by heading.
- Manually label ~50 pairs across three categories:
  - **Same story** (~15 pairs): genuine duplicates from different sources or weeks.
  - **Related but different** (~15 pairs): same topic, different events.
  - **Unrelated** (~20 pairs): no meaningful connection.
- Include edge cases: same event covered from different angles, follow-up stories, recurring themes (e.g. 'AI regulation' appearing weekly but covering different developments), same company different announcements.
- **Cross-format pairs**: include pairs where one item is a podcast story extract (2–3 sentences) and the other is a full article (500+ words), since this is a real use case for gap-fill matching.

**For transcript digest (`transcript-digest`):**
- Take 4–6 transcripts from different podcasts (mix of AI Daily Brief, Moonshots, a16z, Cognitive Revolution).
- Manually identify: key stories, best quotes, themes.
- Evaluate digest quality subjectively (does it capture what an editor would care about?).
- Include at least one non-AI-focused episode (e.g. Intelligence Squared on ancient myths) to test graceful handling of irrelevant content.

### 7.2 Test harness

**Script:** `scripts/tests/prompt-eval.js`

Standalone evaluation script, not part of the main test suite. Runs prompts against labelled data and reports metrics.

```
bun scripts/tests/prompt-eval.js --prompt story-extract --dataset data/test/story-extract-labels.json
bun scripts/tests/prompt-eval.js --prompt content-match --dataset data/test/content-match-labels.json
bun scripts/tests/prompt-eval.js --prompt transcript-digest --dataset data/test/digest-labels.json
bun scripts/tests/prompt-eval.js --threshold-sweep --dataset data/test/content-match-labels.json
```

**Metrics tracked:**

| Prompt | Metrics |
|---|---|
| `story-extract` | Recall (stories found / stories in ground truth), precision (valid stories / total extracted), false positives, per-transcript breakdown |
| `content-match` | True positive rate, false positive rate, false negative rate, per-category breakdown, optimal confidence threshold |
| `transcript-digest` | Manual quality score (1–5), story coverage (stories captured / stories in ground truth), quote relevance, sector tag accuracy |

### 7.3 Threshold calibration for Tier 1 similarity

The headline/content similarity threshold for Tier 1 (which determines what goes to the LLM for Tier 2) must be empirically determined:

1. Compute normalised token overlap for all labelled pairs in the content-match dataset.
2. Sweep thresholds from 2% to 30% in 1% increments.
3. At each threshold, measure:
   - **Recall**: what fraction of true 'same story' pairs would be sent to Tier 2?
   - **Tier 2 load**: how many pairs total would be sent to Tier 2?
4. Select the threshold that achieves **100% recall** (never misses a true duplicate) with the lowest Tier 2 load.
5. If no threshold achieves 100% recall, the Tier 1 matching algorithm needs redesign (e.g. add entity matching alongside token overlap, or use TF-IDF weighting to give more weight to distinctive terms like company names).
6. Additionally calibrate the Tier 2 confidence threshold: at what confidence level does the content-match prompt reliably distinguish same-story from related-but-different? Sweep from 0.4 to 0.9 in 0.05 increments.

The chosen thresholds are stored in `config/prompts/thresholds.yaml`:

```yaml
tier1_similarity: 0.12  # empirically determined, see test results
tier2_confidence: 0.65   # minimum confidence to flag as duplicate
calibrated_at: 2026-03-22
dataset_version: "v1"
test_results:
  tier1:
    recall: 1.0
    tier2_load: 23     # pairs sent to tier 2 out of 50
  tier2:
    false_positive_rate: 0.04
    false_negative_rate: 0.00
```

### 7.4 Iteration protocol

1. Run test harness with v1 prompts.
2. Analyse failures — which stories were missed? Which matches were wrong? Why?
3. Revise prompt (add examples, adjust instructions, clarify edge cases).
4. Bump version: `story-extract.v2.txt`.
5. Re-run test harness.
6. Repeat until targets met (minimum 3 iterations).
7. Document final metrics alongside the committed prompt as `config/prompts/<name>.results.json`.

**Targets:**

| Prompt | Target |
|---|---|
| `story-extract` | Recall >90%, precision >80% |
| `content-match` | False negative rate <5%, false positive rate <10% |
| `transcript-digest` | Manual quality score ≥4/5, story coverage >85% |

## 8. Data storage layout

```
data/
├── podcasts/
│   ├── manifest.json
│   ├── .import.lock
│   ├── 2026-03-18/
│   │   ├── ai-daily-brief/
│   │   │   ├── how-to-use-agent-skills.md          (full transcript copy)
│   │   │   └── how-to-use-agent-skills.digest.json  (structured digest)
│   │   └── big-technology-podcast/
│   │       ├── are-we-screwed-if-ai-works.md
│   │       └── are-we-screwed-if-ai-works.digest.json
│   └── 2026-03-19/
│       └── ...
├── podcast-articles/                (NEW — gap-fill articles, parallel to verified/)
│   ├── 2026-03-19/
│   │   ├── general/
│   │   │   └── openai-dispatch-feature.json
│   │   └── medtech/
│   │       └── ...
│   └── ...
├── verified/                        (EXISTING — unchanged, fetch+score articles)
│   └── ...
└── test/                            (prompt evaluation datasets)
    ├── story-extract-labels.json
    ├── content-match-labels.json
    └── digest-labels.json

config/
├── sectors.yaml                     (EXISTING — unchanged)
├── podcast-trust-sources.yaml       (NEW)
└── prompts/                         (NEW directory)
    ├── story-extract.v1.txt
    ├── story-extract.results.json
    ├── content-match.v1.txt
    ├── content-match.results.json
    ├── transcript-digest.v1.txt
    ├── transcript-digest.results.json
    └── thresholds.yaml

output/
├── runs/
│   ├── pipeline-2026-03-20.json     (EXISTING — main pipeline)
│   └── podcast-import-2026-03-20.json (NEW — import run summary)
├── overlap-cache/                   (NEW — cached section extractions)
│   ├── week-8.json
│   └── week-9.json
├── published/                       (EXISTING — published newsletters)
│   ├── week-9.md
│   └── week-9-meta.json
└── draft-week-12.md                 (EXISTING)
```

## 9. API changes

### 9.1 New endpoints

**`GET /api/podcasts?week={N}`**

Returns all podcast episodes for the given editorial week.

```json
{
  "week": 12,
  "episodes": [
    {
      "filename": "2026-03-18-ai-daily-brief-how-to-use-agent-skills.md",
      "title": "How to Use Agent Skills",
      "source": "AI Daily Brief",
      "date": "2026-03-18",
      "episodeUrl": "https://...",
      "duration": "27 min",
      "isTrustSource": true,
      "storiesExtracted": 6,
      "storiesFetched": 2,
      "digest": { ... }
    }
  ],
  "lastImport": "2026-03-20T07:00:32.000Z",
  "importWarnings": ["No URL in frontmatter for 2026-03-17-jim-rutt-..."]
}
```

**`GET /api/podcasts/transcript?date={YYYY-MM-DD}&source={slug}&title={slug}`**

Returns the full transcript text for injection into co-pilot context.

Response: `{ transcript: string, metadata: { title, source, date, episodeUrl, duration } }`

**`POST /api/draft/check-overlap?week={N}`**

Runs the overlap checker. Returns the overlap report (see §5.5).

### 9.2 Modified endpoints

**`POST /api/chat`** — context assembly updated to include podcast digests and support podcast transcript injection via a new `podcastRef` parameter (parallel to existing `articleRef`). The `podcastRef` format is: `podcastRef: { date: "YYYY-MM-DD", source: "podcast-slug", title: "title-slug" }` — the same triple used by the transcript endpoint. `podcastRef` is persisted in thread history alongside messages (same as `articleRef`).

**`GET /api/draft?week={N}`** — response extended with `podcastEpisodes` count for the week, so the draft editor can show podcast availability.

**`GET /api/articles?week={N}`** — response includes articles from both `data/verified/` and `data/podcast-articles/`, with a `source_type` field to distinguish them. The `source_type` is synthesised from the `found_by` field: articles with `found_by` containing `'podcast-extract'` get `source_type: 'podcast-extract'`.

**`GET /api/status`** — extended with `podcastImport` field containing `{ lastRun, episodesThisWeek, storiesGapFilled, warnings }`. The dashboard already uses this endpoint.

### 9.3 New route file

**`web/api/routes/podcasts.js`** — handles all podcast-related endpoints. Reads from `data/podcasts/` (manifest, digests, transcripts) and `data/podcast-articles/`.

Route entries to add to `web/api/server.js`:
```javascript
// Podcast routes
if (path === '/api/podcasts' && method === 'GET') return handleGetPodcasts(req, url)
if (path === '/api/podcasts/transcript' && method === 'GET') return handleGetTranscript(req, url)
if (path === '/api/draft/check-overlap' && method === 'POST') return handleCheckOverlap(req, url)
```

**Note on project structure:** The routes directory contains `published.js` alongside `articles.js`, `status.js`, `draft.js`, `chat.js`, and `config.js`.

## 10. UI changes

### 10.1 Draft Editor — Overlap Checker

- **Button:** 'Check Overlap' next to the existing review pill in the toolbar.
- **Loading state:** Button shows spinner + 'Checking...' while the API call runs (may take 10–60 seconds).
- **Results panel:** Slide-out panel on the right (same pattern as review highlights).
- **Empty state:** Green banner 'No content overlap detected ✓'.
- **Overlap cards:** As described in §5.5.
- **CSS:** Uses existing design tokens from `tokens.css`. No new colours — reuses the existing red/amber/green semantic tokens.

### 10.2 Co-pilot — Podcast Picker

- The existing article picker dropdown is extended with a 'Podcasts' section, visually separated by a divider.
- Lists all episodes for the current week with: title, source, date, episode URL.
- Selecting an episode injects its full transcript into the co-pilot context (via `podcastRef` parameter on the chat API).
- Visual indicator on selected episode (same highlight pattern as selected article today).
- Deselecting clears the transcript from context.

### 10.3 Dashboard — Podcast Status

- A new card on the dashboard showing:
  - Episodes imported this week (count)
  - Last import timestamp
  - Stories gap-filled this week (count)
  - Any import warnings (expandable)
- Data sourced from `output/runs/podcast-import-YYYY-MM-DD.json` and `data/podcasts/manifest.json`.

### 10.4 Implementation patterns (for developers)

- **Slide-out panel:** Follow the `DraftChatPanel` pattern (`web/app/src/components/DraftChatPanel.jsx`) — CSS class toggle with `open` class for animation.
- **Podcast picker:** Extend the existing inline picker in `Copilot.jsx` (lines 159-185) — add a divider and 'Podcasts' subsection within the same `div.article-picker-dropdown`. Add `podcastRef` state parallel to existing `articleRef`.
- **Dashboard card:** Follow existing card pattern in `Dashboard.jsx`. Data via `useStatus()` hook (already used by dashboard).
- **State management:** Local React state (`useState`/`useEffect`). No Redux. New hooks: `usePodcasts(week)` returning `{ data, loading, error }`, `useOverlapCheck(week)` returning `{ check, loading, results }`.
- **API calls:** Use `apiFetch()`/`apiPost()` from `web/app/src/lib/api.js`.
- **CSS:** CSS modules per component. All colours from `tokens.css`. No inline styles. No hardcoded `rgba()`.
- **Server routing:** Add manual route entries to `web/api/server.js` following the existing `if (path === ... && method === ...)` pattern. Import handlers from `web/api/routes/podcasts.js`.

## 11. Configuration

### 11.1 New config files

**`config/podcast-trust-sources.yaml`**

```yaml
model: claude-sonnet-4-20250514
transcript_source: ~/Desktop/Podcast Transcripts
overlap_lookback_weeks: 8
trust_sources:
  - name: AI Daily Brief
    slug: ai-daily-brief
    extract_stories: true
  - name: Moonshots
    slug: moonshots
    extract_stories: true
```

**`config/prompts/story-extract.v1.txt`** — as in §6.1.

**`config/prompts/content-match.v1.txt`** — as in §6.2.

**`config/prompts/transcript-digest.v1.txt`** — as in §6.3.

**`config/prompts/thresholds.yaml`** — as in §7.3.

### 11.2 Modified config

None. Existing config files are not modified.

## 12. Shared dedup module

**`scripts/lib/dedup.js`** — new module (not a modification to any existing file).

**Shared library boundary:** Modules in `scripts/lib/` that (a) have no imports from pipeline execution scripts like `fetch.js`, `score.js`, `pipeline.js` etc., and (b) contain only pure utility logic, are classified as shared libraries importable by both pipeline scripts and the web API. This category includes:
- `scripts/lib/dedup.js` (new — two-tier dedup logic)
- `scripts/lib/week.js` (existing — week number calculations)

**Used by:**

- `scripts/podcast-import.js` (story gap-fill matching)
- `web/api/routes/draft.js` (overlap checker — imported via relative path since the API server can import from `scripts/lib/` as a pure utility with no pipeline dependencies)

**Note:** The original design proposed also integrating this into `fetch.js` and `discover.js`. This is deferred because it would modify existing pipeline scripts. The dedup module is designed so that future integration is straightforward — the function signatures match what fetch.js and discover.js would need.

**Exports:**

```javascript
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Load thresholds from config/prompts/thresholds.yaml.
 * @returns {{ tier1: number, tier2: number }}
 */
export function loadThresholds() { ... }

/**
 * Tier 1: normalised token overlap between two texts.
 * Tokenises by splitting on whitespace and punctuation, lowercases,
 * removes stop words, computes Jaccard similarity on remaining tokens.
 * @param {string} textA
 * @param {string} textB
 * @returns {number} Similarity score 0.0–1.0
 */
export function textSimilarity(textA, textB) { ... }

/**
 * Tier 2: LLM-based content matching.
 * Loads prompt from config/prompts/content-match.v{N}.txt.
 * @param {string} contentA — story text or article text
 * @param {string} contentB — story text or article text
 * @param {object} options — { client, model }
 * @returns {Promise<{sameStory: boolean, confidence: number, explanation: string}>}
 */
export async function contentMatch(contentA, contentB, options) { ... }

/**
 * Full two-tier dedup check against a corpus.
 * @param {object} candidate — { headline, content }
 * @param {Array<object>} corpus — [{ headline, content, metadata }]
 * @param {object} [thresholds] — { tier1: number, tier2: number } (loaded from config if omitted)
 * @returns {Promise<{matched: boolean, matchedItem: object|null, tier: 1|2, confidence: number, explanation: string}>}
 */
export async function checkDuplicate(candidate, corpus, thresholds) { ... }

/**
 * Load and render a prompt template from config/prompts/.
 * Reads config/prompts/<name>.txt, performs {key} → value replacement.
 * @param {string} name — prompt filename without extension (e.g. 'content-match.v1')
 * @param {object} vars — key-value pairs for replacement
 * @returns {string} Rendered prompt text
 */
export function loadAndRenderPrompt(name, vars) { ... }
```

The caller provides the Anthropic client instance. `scripts/podcast-import.js` creates its own client via `new Anthropic({ apiKey: loadEnvKey('ANTHROPIC_API_KEY') })`. `web/api/routes/draft.js` passes the client from `getClient()` in `web/api/lib/claude.js`.

**Import path note:** The web API server (`web/api/`) can import `../../scripts/lib/dedup.js` because dedup.js is a pure utility module with no pipeline dependencies — it only imports `fs`, `path`, and makes Anthropic API calls. This is consistent with the constraint that the API server 'never imports pipeline modules' — dedup.js is not a pipeline module, it's a shared library.

## 13. Deployment

### 13.1 Branch strategy

- All development on `feature/web-ui` branch (existing).
- Pipeline-side files (`scripts/podcast-import.js`, `scripts/lib/dedup.js`, `com.sni.podcast-import.plist`, `config/podcast-trust-sources.yaml`, `config/prompts/*`) are checked out onto `master` when ready, same as the Fri–Thu reorientation deployment.
- Web UI changes stay on `feature/web-ui`.

### 13.2 Launchd setup

After merging to `master`:

```bash
# Symlink the plist (same pattern as main pipeline)
ln -s /Users/scott/Projects/sni-research-v2/com.sni.podcast-import.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.sni.podcast-import.plist

# Verify it's loaded
launchctl list | grep podcast
```

### 13.3 Transcript pipeline update

Update the external transcript pipeline to include `**URL:**` in frontmatter. This is part of the implementation plan. The podcast import script works without it (logs warnings, imports proceed), but the newsletter linking feature requires it.

### 13.4 Data directory creation

```bash
mkdir -p data/podcasts data/podcast-articles data/test output/overlap-cache config/prompts
```

## 14. Testing strategy

### 14.1 Prompt evaluation (pre-integration)

As described in §7. Standalone test harness, manually labelled data, iterative refinement. This phase must complete and meet all targets before any integration code is written.

### 14.2 Unit tests

| Module | Tests |
|---|---|
| `scripts/lib/dedup.js` | `textSimilarity()` — edge cases (empty strings, identical strings, partial overlap, unicode, stop word handling). `contentMatch()` — mocked LLM responses (valid JSON, invalid JSON, retry logic). `checkDuplicate()` — tier routing logic (below tier1 threshold → no match, above tier1 → tier2 called, tier2 above/below confidence). `loadThresholds()` — YAML parsing, missing file handling. |
| `scripts/podcast-import.js` | Frontmatter parsing (all fields present, missing URL, missing Date, malformed markdown, `_pipeline_report.md` skipped). Manifest dedup (new file, existing complete file, existing incomplete file triggers retry). Trust source identification (exact match, case sensitivity). File filtering (only top-level `.md`, skip `Previous/`). |
| `web/api/routes/podcasts.js` | Podcast list endpoint — empty week, populated week, manifest filtering. Transcript endpoint — valid path, missing file, path traversal prevention. |
| `web/api/routes/draft.js` | Overlap checker endpoint — mocked dedup module. Draft section parser — tested against real draft structure (sectoral headers, link-headed stories, podcast subsections). Archive loading with published/ priority over draft files. Version selection (highest version number). Cache invalidation. |
| `web/api/lib/context.js` | `buildPodcastContext()` — digest loading, token estimation, empty week, malformed digest. `loadArticlesForWeek()` — reads from both `verified/` and `podcast-articles/`. Updated `assembleContext()` with 64k budget. `podcastRef` injection. |

### 14.3 Integration tests

- Import a real transcript → verify digest generated → verify manifest updated → verify transcript copied to `data/podcasts/`.
- Import a trust source transcript → verify stories extracted → verify gap-fill articles created in `data/podcast-articles/`.
- Import same transcript twice → verify idempotent (no re-processing).
- Import transcript with failed digest → verify retry on next run.
- Run overlap checker against real drafts (weeks 8–9) → verify results structure and plausible overlaps.
- Co-pilot chat with podcast context → verify digests appear in assembled context.
- Co-pilot with podcast transcript selected → verify full text injected.

### 14.4 Existing test suite

The existing 68 tests (279 assertions) must continue to pass. Known changes required:
- Update any tests asserting `TOKEN_BUDGET === 28000` to `64000`.
- Update any tests asserting `loadArticlesForWeek` reads only from `verified/` (now reads both directories).

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Transcript pipeline doesn't add URL field promptly | Episodes not linkable in newsletter | Import works without URL; warning logged; linking degrades gracefully; URL update is in our implementation plan |
| LLM story extraction misses stories | Gap-fill incomplete | >90% recall target; manual spot-checking; prompts iterated before integration |
| Content match false negatives | Duplicates slip through overlap checker | Tier 1 threshold calibrated for 100% recall; Tier 2 is safety net; threshold sweep documented |
| Content match false positives | Editor wastes time dismissing | <10% FP target; dismiss button in UI; threshold tuned empirically |
| Large transcript blows co-pilot context | Thread history squeezed | 64k budget; digests are compact; full transcript is opt-in and capped at 16k chars |
| Manifest corruption | Re-imports or missed imports | JSON write-validate-swap pattern (.tmp → parse → .bak → rename). Manifest tracks per-stage completion for safe retries. |
| API cost from LLM calls | Unexpected spend | Story extraction: max 2 trust source episodes/day. Content match: shortlist-only (capped at 20 Tier 2 calls per overlap check). Digest: ~15 episodes/week. Estimated: <$2/day at Sonnet pricing. |
| Score.js re-scores podcast-extract articles | Pre-approved articles rejected | Gap-fill articles stored in `data/podcast-articles/`, not `data/verified/`. Score.js only scans `verified/`. |
| Mac asleep at 07:00 | Podcast import doesn't run | Launchd fires when Mac next wakes; import is idempotent and catches up. Acceptable for non-time-critical import. |
| Overlap checker slow on large archive | Poor UX | Tier 2 calls capped at 20; section cache prevents re-parsing; 200ms delay prevents rate limiting. Target: <60 seconds. |
| Whisper transcription errors in proper nouns | Story extraction produces wrong entity names | Prompt instructs LLM to correct obvious errors using context. Test harness validates against known entities. |

## 16. Out of scope

- Modifying existing pipeline scripts (`fetch.js`, `score.js`, `discover.js`, `draft.js`, etc.).
- Enhancing fetch/discover dedup with two-tier matching (deferred — requires modifying existing scripts).
- Automatic LinkedIn post generation (co-pilot is interactive, not automated).
- Podcast-specific UI page (stretch goal for future phase).
- Audio playback or embedded players.
- Automatic movement of transcripts to `Previous/` folder.

## 17. Open questions

All design decisions have been resolved through the brainstorming process. The following items are noted for awareness but do not block development:

1. **Transcript pipeline update timing:** The URL frontmatter addition is in our plan, but the external pipeline tool may need its own update cycle. Import works without URLs; linking is the only feature that depends on them.
2. **Archive depth for overlap checker:** Currently checks 8 weeks back (configurable). If performance becomes an issue with larger archives, the lookback window can be reduced.
3. **Year parameter bug:** The chat API does not pass `year` to `assembleContext()`, so `loadArticlesForWeek(week, undefined)` defaults to the current calendar year. Podcast context loading inherits this limitation. This is pre-existing and not addressed in this PRD.

## 18. Revision log

| Date | Change | Reason |
|---|---|---|
| 2026-03-20 | Initial draft | — |
| 2026-03-20 | Red-team revision: 14 issues fixed | See §18.1 |
| 2026-03-20 | Sub-agent review revision: 38 issues fixed | See §18.2 |

### 18.1 Issues found and fixed in red-team review

1. **CRITICAL: Pipeline modification contradiction.** PRD said 'pipeline scripts never modified' but §5.2 proposed modifying `fetch.js` and `discover.js`. **Fix:** Removed. Two-tier dedup only used by new code. Enhancement to existing scripts deferred.
2. **CRITICAL: `skip_scoring` flag doesn't exist.** `score.js` scans all of `data/verified/` with no skip mechanism. Saving podcast-extract articles there would cause them to be re-scored and potentially rejected. **Fix:** Gap-fill articles saved to `data/podcast-articles/` (new parallel directory). Score.js never sees them.
3. **CRITICAL: `saveArticle()` import violates constraint.** The import script proposed using `saveArticle()` from `scripts/lib/extract.js`, but the API server constraint says 'never imports pipeline modules'. **Fix:** Podcast-import script has its own lightweight fetch+save implementation. The article JSON schema is identical for compatibility.
4. **Missing: LLM model specification.** No mention of which model to use for the three prompts. **Fix:** Added `claude-sonnet-4-20250514` (same as score.js and co-pilot DEFAULT_MODEL) with config override.
5. **Missing: JSON output enforcement.** Prompts request JSON but no mechanism to ensure valid JSON output. **Fix:** Added 'Return ONLY JSON, no markdown fencing' instruction to all prompts. Code uses try/catch with single retry.
6. **Missing: Wake schedule for 07:00.** pmset wakes Mac at 03:55. If daily run finishes before 07:00, Mac may sleep. **Fix:** Documented that launchd fires on next wake; import is idempotent. Optional pmset addition noted.
7. **Missing: Co-pilot system prompt update.** COPILOT_SYSTEM didn't mention podcast context. **Fix:** Added updated system prompt text.
8. **Missing: Whisper transcription errors.** Proper nouns often misheard. **Fix:** Added correction instruction to story-extract and transcript-digest prompts.
9. **Wrong: Published flag convention.** PRD proposed `.published` marker files but `output/published/` directory with `week-{N}.md` and `week-{N}-meta.json` already exists. **Fix:** Overlap checker uses existing `published.js` route's `listPublished()`/`getPublished()` functions.
10. **Wrong: Overlap checker Tier 1 on headings only.** User explicitly required deep matching beyond headlines. **Fix:** Tier 1 computes similarity on full section text (heading + body), not headings alone.
11. **Wrong: Token budget arithmetic.** Original math didn't account for system prompt and left no room for the published exemplar case. **Fix:** Detailed token accounting added showing 36.5k remaining for thread history.
12. **Missing: Rate limiting for overlap checker.** Many Tier 2 LLM calls could hit rate limits. **Fix:** Sequential calls with 200ms delay, cap at 20 Tier 2 checks.
13. **Missing: Draft section parser specification.** The newsletter has a specific structure (sectoral H2 headers, link-headed stories, podcast subsections) that a generic H2/H3 parser wouldn't handle. **Fix:** Detailed parser specification added.
14. **Missing: Podcast import run summary.** No way for the dashboard to show import status. **Fix:** Added `output/runs/podcast-import-YYYY-MM-DD.json` output.

### 18.2 Issues found and fixed in sub-agent review (38 fixes)

**Agent 1 — Internal Consistency:**
1. `source_type` vs `found_by` mismatch: API layer now synthesises `source_type: 'podcast-extract'` from the `found_by` field (§5.4, §9.2).
2. Sector directory names: Changed all `general-ai` references to `general` in prompts (§6.1–§6.3), data layout (§8), and article schema (§5.2). Added note on slug vs display name.
3. `scripts/lib/` import policy: Strengthened shared library boundary definition. Added `week.js` alongside `dedup.js` (§12).
4. `published.js` route: Confirmed existence and added to project structure note (§9.3).
5. Week number range in §17: Changed "weeks 8-12" to "weeks 8-11 (current week excluded)".
6. `tokenCount` in digest: Added note that it is computed by import script, not LLM (§5.3).
7. `podcastRef` format: Specified triple format and persistence in thread history (§5.4, §9.2).
8. Dashboard API: Added `GET /api/status` as modified endpoint with `podcastImport` field (§9.2).
9. Overlap cache writes: Added note to §3 constraints that API server writes to `output/` (existing convention).

**Agent 2 — Implementation Feasibility:**
10. CRITICAL: Removed `response_format: { type: "json_object" }` — Anthropic API does not support this. Replaced with prompt-based JSON enforcement + retry strategy (§5.1).
11. Function name: Changed `getWeekDateRange()` to `getWeekWindow()` with note on dual module paths (§5.1).
12. `dedup.js` client parameter: Changed `contentMatch()` signature to accept `{ client, model }`. Added client provisioning details (§12).
13. Prompt template format: Added subsection to §6 explaining `{placeholder}` syntax vs pipeline's `{{key}}` syntax and `loadAndRenderPrompt()`.
14. `assembleContext()` restructuring: Added block-level token tracking and priority-based truncation specification (§5.4).
15. `podcastRef` persistence: Added explicit note about JSONL storage matching `articleRef` pattern (§5.4).
16. Year parameter bug: Added as open question §17.3.

**Agent 3 — Edge Cases & Gaps:**
17. CLAUDE.md amendment: Added note to §3 constraints about updating the 'all code in web/' instruction.
18. Empty `output/published/`: Added note to §5.5 step 2 about draft fallback being primary path.
19. Token budget worst case: Replaced estimates with worst-case numbers based on real Week 11 data (28 episodes) in §5.4.
20. Manifest lockfile: Added concurrency protection with PID-based lockfile (§5.1).
21. On-demand transcripts: Added filtering rule for `Source: On-demand request` files (§5.1).
22. Race condition with main pipeline: Added try/catch safety for concurrent `data/verified/` access (§5.2).
23. Friday week assignment: Added editorial week note explaining Fri–Thu cycle mapping (§5.1).
24. EV Newsletter files: Added `type: 'newsletter'` labelling for `Transcript source: newsletter` files (§5.1, §5.3).
25. Paywall/dead link handling: Added quality gate for fetch failures with categorised logging (§5.2).
26. Intra-run dedup: Added in-memory dedup set for same-run duplicate prevention (§5.2).
27. Overlap checker lookback: Added configurable 8-week default in `config/podcast-trust-sources.yaml` (§5.5, §11.1).
28. Minimum transcript quality: Added character count vs duration warning check (§5.1).

**Agent 4 — Developer Completeness:**
29. Dependencies appendix: Added §A confirming all packages already installed.
30. Claude client setup: Added Anthropic client creation pattern for podcast-import (§5.1).
31. Prompt loader: Added `loadAndRenderPrompt()` specification to §6 and §12.
32. `slugify()` reuse: Added importability note and rule specification (§5.1).
33. Write-validate-swap: Added concrete implementation steps for manifest writes (§5.1).
34. Run summary schema: Replaced prose description with concrete JSON schema (§5.1).
35. Draft section parser: Replaced generic description with detailed regex-based rules (§5.5).
36. UI component patterns: Added §10.4 with implementation patterns for developers.
37. `import.meta.dir`: Added to §3 constraints for new `scripts/` files.
38. Server routing: Added concrete route entries for `web/api/server.js` (§9.3).

## 19. Glossary

| Term | Definition |
|---|---|
| **Trust source** | A podcast whose editorial curation is trusted — stories mentioned are pre-approved for the corpus without scoring |
| **Digest** | A ~1k token structured summary of a podcast episode, generated by LLM |
| **Gap-fill** | The process of identifying stories mentioned in trust source podcasts that are missing from the article corpus, then fetching them |
| **Tier 1** | Fast text similarity check using normalised token overlap (Jaccard on non-stop-word tokens) |
| **Tier 2** | LLM-based content comparison for precise same-story determination |
| **Overlap checker** | Pre-publish tool comparing the current draft against all previous editions for content duplication |
| **Manifest** | JSON file tracking which transcripts have been imported and their processing status |
| **Podcast-articles** | Gap-fill articles stored in `data/podcast-articles/`, separate from `data/verified/` to avoid score.js interference |

## Appendix A: Dependencies

All required packages are already installed at the project root: `@anthropic-ai/sdk@^0.78.0`, `cheerio@^1.0.0`, `js-yaml@^4.1.0`, `date-fns@^3.6.0`. No new package installations required.
