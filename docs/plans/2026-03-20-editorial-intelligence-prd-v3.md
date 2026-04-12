# PRD: SNI Editorial Intelligence System

**Date:** 2026-03-21
**Author:** Scott Wilkinson + Claude
**Status:** Draft v3 (post-review + UX design integration)
**Branch:** `feature/web-ui` (development); `master` (deployment — see §10.1)
**Previous version:** `docs/plans/2026-03-20-editorial-intelligence-prd-v2.md` (rollback target)

---

## 1. Problem statement

SNI's newsletter production depends on two disconnected workflows. The automated pipeline (fetch → score → discover → score → report → draft → review → evaluate → verify-links → notify) produces sector article bullets but has no editorial intelligence — it cannot synthesise themes, identify cross-story connections, or write in Brightbeam's voice. Meanwhile, Scott runs manual ANALYSE sessions in a Claude.ai Project where Opus 4.6 processes podcast transcripts into rich analytical state documents — Analysis Index, Theme Registry, Post Backlog, Decision Log — that fuel both the newsletter's podcast section and ad hoc LinkedIn posts.

The manual sessions produce excellent output but require Scott to sit in every session. The automated pipeline produces volume but no editorial reasoning. Neither system drafts the complete newsletter. Scott currently assembles the final publication manually from both sources.

This PRD defines an autonomous editorial intelligence system that: (a) replaces manual ANALYSE sessions with automated transcript processing that matches Session 1–15 quality, (b) discovers and scrapes news stories referenced in podcasts as Tier 1 articles, (c) drafts the complete weekly newsletter through a multi-model write-critique-revise loop, and (d) surfaces LinkedIn post candidates as transcripts arrive through the week.

**Terminology note:** This system uses "ANALYSE" (not "INGEST") for podcast transcript processing, to avoid confusion with the existing `scripts/ingest.js` which handles manual article submission — a separate operation.

## 2. Success criteria

| Criterion | Measure |
|---|---|
| State document quality | Analysis Index entries, Theme Registry updates, Post Backlog candidates, and Decision Log entries match the quality and format of Sessions 11–15. Scott would accept them as-is or make minor edits only |
| Newsletter draft quality | Sub-edit only — Scott's changes are polish (word choice, tightening), not structural (reordering sections, rewriting arguments, adding missing analysis) |
| Podcast section quality | Reads as analytical synthesis with cross-episode themes and Brightbeam enterprise framing — not episode recaps. Indistinguishable from Scott's Week 12 podcast section |
| Introduction quality | Identifies the week's through-line by synthesising across general, sector, and podcast content. Narrative structure, not list structure |
| News story discovery | ≥80% of concrete stories referenced in podcasts (surveys, acquisitions, product launches, funding rounds) are found and scraped |
| Multi-model critique | Drafts measurably improve through the critique loop. Pre-critique and post-critique versions retained for comparison |
| Editorial voice fidelity | FT editorial standard. Descriptive not prescriptive. Evidence before labels. No prohibited structures ('it's not X, it's Y'). UK English throughout |
| Post backlog continuity | Numbering continues from current (#92+). Published items tracked and excluded from future drafts |
| Processing reliability | 20+ transcripts/week processed without failure or state document corruption |
| Sector pipeline integration | Existing sector articles (biopharma, medtech, manufacturing, insurance) appear in the newsletter draft. No modifications to existing pipeline scripts |
| Web UI — editorial workbench | All four state documents (Analysis Index, Theme Registry, Post Backlog, Decision Log) browsable, searchable and filterable. Contextual Opus 4.6 chat available on every Editorial sub-tab. Click-to-draft navigation from any editorial element to the Draft page with content pre-loaded |
| Web UI — draft editor | Side-by-side markdown editor + AI critique panel. Version toggle (v1 pre-critique / final). Critique points with accept/reject status. Word count, review badge, week navigation |
| Web UI — Database page | Unified article + podcast + flagged content view (renamed from Articles). Podcast episodes show tier badge, theme tags, stories extracted count. Sector and date filtering |
| Web UI — contextual chat | Opus 4.6 streaming chat panel (380px) on Editorial page. Context tag updates per active tab (State → analysis index entries; Themes → theme evidence; Backlog → post arguments; Decisions → decision log). Conversation persisted per tab per session |
| Web UI — click-to-draft | Every editorial element (analysis index entries, themes, backlog posts, Opus chat suggestions, podcast episodes) navigable to Draft page with content pre-loaded for expansion and editing |
| Web UI — pipeline triggers | ANALYSE, DISCOVER and DRAFT triggerable from the web UI with progress feedback. Lock status visible in sidebar |

## 3. Architecture overview

```
                    Podcast Transcripts
                    (manual download or file watcher)
                          │
                          ▼
              ~/Desktop/Podcast Transcripts/
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
    ┌──────────────────┐     ┌──────────────────────┐
    │ editorial-       │     │ podcast-import.js    │
    │ analyse.js       │     │ (existing — produces  │
    │                  │     │  digests for web UI   │
    │ Opus 4.6:        │     │  co-pilot. Unchanged) │
    │ • Analysis Index │     └──────────────────────┘
    │ • Theme Registry │
    │ • Post Backlog   │     ┌──────────────────────┐
    │ • Decision Log   │     │ Existing sector      │
    │ • Story refs     │     │ pipeline             │
    └───────┬──────────┘     │ fetch → score →      │
            │                │ discover → draft →   │
            │                │ review → evaluate    │
            ▼                └──────────┬───────────┘
  ┌──────────────────┐                  │
  │ editorial-       │                  │
  │ discover.js      │                  │
  │                  │                  │
  │ Search & scrape  │                  │
  │ referenced news  │                  │
  │ → Tier 1 articles│                  │
  └───────┬──────────┘                  │
          │                             │
          ▼                             ▼
  data/verified/              data/verified/ (sector)
  (general — podcast-sourced)
          │                             │
          └──────────┬──────────────────┘
                     ▼
           ┌──────────────────┐
           │ editorial-draft  │  Thursday evening
           │   .js            │
           │                  │
           │ 1. Opus 4.6      │  ← state docs + sector articles
           │    drafts        │    + podcast intelligence
           │ 2. Gemini 3.1   │    + previous newsletter
           │    + GPT-5.4    │    + published tracking
           │    critique      │
           │ 3. Opus 4.6     │
           │    revises       │
           └───────┬──────────┘
                   │
                   ▼
           output/editorial-draft-week-N.md
           (publication-ready)
                   │
                   ▼
           Scott sub-edits → publishes
                   │
                   ▼
           ┌──────────────────┐
           │ editorial-track  │  Scott logs published items
           │   .js            │
           └──────────────────┘
```

### Web UI integration point

The web UI (port 3900 API + port 5173 Vite SPA) reads all editorial data from `data/editorial/` and pipeline data from `data/verified/`, `output/`, `logs/`. It provides:
- **Dashboard** — editorial status summary, post candidates, pipeline health, cost tracking
- **Database** (renamed from Articles) — unified view of articles, podcasts and flagged content
- **Draft** — side-by-side markdown editor with AI critique panel, version comparison, review overlay
- **Editorial** — state document browser with contextual Opus 4.6 chat (5 tabs: State, Themes, Backlog, Decisions, Activity)
- **Co-pilot** — general-purpose streaming chat with editorial context assembly
- **Sources / Config** — pipeline configuration and source health monitoring

The web UI can trigger ANALYSE, DISCOVER and DRAFT runs and displays lock/progress status in the sidebar footer.

### Relationship to existing systems

**Existing sector pipeline:** Retained in full. Continues to fetch and score articles for biopharma, medtech, manufacturing, insurance, and general. Produces `data/verified/` articles that the editorial draft system reads. No modifications to any existing pipeline scripts.

**Existing `podcast-import.js`:** Continues to run alongside `editorial-analyse.js`. It produces digests and gap-fill articles for the web UI co-pilot (`buildPodcastContext()`). The editorial system produces state documents for the editorial pipeline. They process the same transcripts for different purposes, writing to different directories (`data/podcasts/` vs `data/editorial/`). No conflict.

**General-AI article discovery:** Podcast-sourced articles discovered by `editorial-discover.js` are written to `data/verified/{date}/general/` with `confidence: "high"` and carry a presumption of newsletter inclusion. Over time, these may prove sufficient to replace the fetch pipeline for general-AI — but that is an editorial decision Scott makes, not a technical switch. Both sources coexist.

### Constraints

**Inherited from project (non-negotiable):**
- Existing `scripts/*.js` and `scripts/lib/*.js` files are **never modified**
- Existing `config/` files are **never modified**
- New scripts added to `scripts/`, new config to `config/`, new data to `data/`
- Runtime: Bun, ES modules, sync file I/O. `import.meta.dir` for path resolution
- No external services beyond LLM APIs — all data is local files
- API server reads data directories — never imports pipeline modules

**New constraints for this system:**
- All analytical processing and drafting via **Opus 4.6** (`claude-opus-4-20250514`)
- Critique via **Gemini 3.1** (`gemini-3.1-pro-preview`) and **GPT-5.4** (`gpt-5.4`)
- State documents in JSON (source of truth) with markdown rendering on demand
- Full Brightbeam editorial prompt injected into every Opus call producing analytical or written output
- Newsletter structure: Introduction → General AI → Sectors → Podcast synthesis
- Output filename: `output/editorial-draft-week-N.md` (distinct from existing `draft-week-N.md`)

## 4. Data architecture

### 4.1 State documents

State documents move from the Claude.ai Project knowledge base to local JSON files. Scott exports the current masters once; local files become the single source of truth. The Claude.ai Project is dropped once the system is running.

**Location:** `data/editorial/`

| File | Format | Purpose |
|------|--------|---------|
| `state.json` | JSON | Single master state file: four state documents (Analysis Index, Theme Registry, Post Backlog, Decision Log) + counters, corpus statistics, rotation candidates |
| `published.json` | JSON | Publication tracking — items Scott has published |
| `backups/state-{timestamp}.json` | JSON | Timestamped backup before each mutation |

**`state.json` schema:**

```json
{
  "counters": {
    "nextSession": 16,
    "nextDocument": 126,
    "nextPost": 92
  },
  "analysisIndex": {
    "120": {
      "title": "What People Really Want From AI",
      "source": "AI Daily Brief",
      "host": "Nathaniel Whittemore",
      "date": "2026-03-19",
      "dateProcessed": "2026-03-20",
      "session": 15,
      "tier": 1,
      "status": "active",
      "themes": ["T01", "T10", "T23", "T25"],
      "summary": "Analysis of Anthropic's qualitative survey — 81,000 people interviewed by Claude across 159 countries in 70 languages. Three enterprise-relevant findings: (a) Benefits are experiential, fears are hypothetical — 91% of those citing learning benefits had experienced them vs 46% of those fearing cognitive atrophy...",
      "keyThemes": "Anthropic 81,000-person survey, experiential benefits vs hypothetical fears, independent workers capturing AI value, freelancers as exposed middle, intellectual NIMBYism in AI policy",
      "postPotential": "high",
      "postPotentialReasoning": "experiential-vs-hypothetical gap, independent worker advantage, freelancer exposed middle"
    }
  },
  "themeRegistry": {
    "T01": {
      "name": "Enterprise Diffusion Gap",
      "created": "Session 1",
      "lastUpdated": "Session 15",
      "documentCount": 34,
      "evidence": [
        {
          "session": 15,
          "source": "AI Daily Brief (19 March)",
          "content": "Anthropic 81,000-person survey — benefits are experiential, fears are hypothetical. 91% of those citing learning benefits had experienced them vs 46% of those fearing cognitive atrophy. The experiential-hypothetical gap maps directly onto the enterprise adoption challenge: teams using AI see value, teams not using it project fear."
        },
        {
          "session": 15,
          "source": "Cognitive Revolution/Zvi (19 March)",
          "content": "Model release fatigue — even GPT-5.4 got muted reception. Benchmarks 'kind of over' as useful signals. Reinforces that the bottleneck is organisational absorption, not technical advancement."
        }
      ],
      "crossConnections": [
        { "theme": "T05", "reasoning": "model release fatigue + Google's integration problem both illustrate that capability without organisational absorption is wasted" },
        { "theme": "T10", "reasoning": "independent workers capturing value while institutional employees don't extends the displacement evidence — the institution is the barrier" },
        { "theme": "T23", "reasoning": "intelligence abundance without organisational absorption = the diffusion gap" }
      ]
    }
  },
  "postBacklog": {
    "88": {
      "title": "The Benefits Are Real, the Fears Are Imagined",
      "workingTitle": "Your Employees' AI Fears Don't Match Their AI Experience",
      "status": "suggested",
      "dateAdded": "2026-03-20",
      "session": 15,
      "coreArgument": "Anthropic's 81,000-person survey found that people living with AI report real benefits at roughly double the rate that people fearing AI have experienced real harm...",
      "format": "news-decoder",
      "sourceDocuments": [120],
      "freshness": "timely-evergreen",
      "priority": "high",
      "notes": "The independent worker vs institutional employee split is the sharpest enterprise hook..."
    }
  },
  "decisionLog": [
    {
      "id": "15.1",
      "session": 15,
      "title": "Tier classification of new documents",
      "decision": "4 Tier 1, 2 Tier 2, 1 STUB.",
      "reasoning": "Complex Systems debt collection episode has no direct AI content but offers a useful structural analogy..."
    }
  ],
  "corpusStats": {
    "totalDocuments": 125,
    "activeTier1": 82,
    "activeTier2": 9,
    "retired": 27,
    "stubs": 5,
    "referenceDocuments": 2,
    "activeThemes": 26,
    "totalPosts": 91,
    "postsPublished": 2,
    "postsApproved": 1
  },
  "rotationCandidates": [
    { "docId": 112, "reason": "a16z LLMs/AGI — technical, abstract", "priority": "low" },
    { "docId": 115, "reason": "Moonshots Musk — STUB, low info density", "priority": "low" }
  ]
}
```

**Design rationale:** JSON source of truth eliminates the parsing fragility of markdown↔JSON bidirectional conversion. Merge operations are well-defined JSON mutations. The `editorial-state.js` library (§9) generates readable markdown on demand when Scott wants to review.

**State mutation pattern:**
1. Read `state.json`
2. Back up to `backups/state-{ISO-timestamp}.json`
3. Apply mutations (new entries, updated themes, incremented counters)
4. Write-validate-swap (write .tmp, parse back, rename)
5. No session-suffixed update files — direct mutation with backup is simpler and the backup serves the same auditability purpose

### 4.2 Tier classification

| Tier | Definition | Newsletter role |
|------|-----------|----------------|
| **Tier 1** | AI/enterprise technology — direct fuel for posts and newsletter sections | Primary content. Podcast-sourced articles carry presumption of newsletter inclusion |
| **Tier 2** | Geopolitical/economic context — ambient backdrop | Enriches analysis but not directly featured. Rachman Review, Intelligence Squared, Complex Systems episodes typically Tier 2 |
| **STUB** | Header only or <30 lines of content | Logged, not analysed. Flagged for re-analysis if full transcript arrives later |

### 4.3 Published content tracking

`data/editorial/published.json`:

```json
{
  "newsletters": [
    {
      "week": 12,
      "date": "2026-03-21",
      "articleUrls": ["https://techcrunch.com/...", "https://www.pymnts.com/..."],
      "podcastThemes": ["Skills as enterprise architecture", "The desktop convergence"],
      "postIdsIncluded": [49]
    }
  ],
  "linkedin": [
    { "postId": 43, "date": "2026-03-15", "title": "Multi-agent team dysfunction" },
    { "postId": 71, "date": "2026-03-18", "title": "..." }
  ]
}
```

The ANALYSE and DRAFT pipelines read this to:
- Exclude published article URLs from newsletter selection (exact match)
- Exclude published podcast themes from re-synthesis
- Avoid re-suggesting published post ideas (by postId)
- Skip post backlog entries with status `published`

### 4.4 Compaction strategy

State documents grow indefinitely. These rules prevent context overflow:

| Document | Compaction rule | Trigger |
|----------|----------------|---------|
| Theme Registry evidence | Keep last 3 sessions of evidence per theme. Older evidence archived to `evidence-archive.json` | Automatic on each ANALYSE run |
| Post Backlog | Posts not actioned for 4 weeks at MEDIUM priority or below → status `archived`. Archived posts excluded from ANALYSE context | Weekly maintenance pass |
| Analysis Index (ANALYSE context) | Only current week + highest-value entries from previous 2 weeks included in Opus context | Per-call context assembly |
| Theme Registry (total themes) | At T40+, flag themes with no new evidence for 8+ weeks as retirement candidates | Log in Decision Log for Scott's review |
| Rotation candidates | Maintained in state.json. Scott reviews and confirms retirements | Manual |

## 5. Pipeline stages

### 5.1 ANALYSE — transcript processing

**Script:** `scripts/editorial-analyse.js`
**Trigger:** Manual (`bun scripts/editorial-analyse.js ~/Desktop/Podcast\ Transcripts/*.md`), launchd `WatchPaths` on the transcript directory, or web UI trigger button (POST `/api/editorial/trigger/analyse` — see §8.3)
**Model:** Opus 4.6
**Input:** One or more podcast transcript (.md) files
**Output:** Mutated `state.json` + story references file for DISCOVER

**Process (batch-level):**

0. **Acquire lock** — write `data/editorial/.analyse.lock` with PID and timestamp. If lock exists and is <30 minutes old, abort with error. Prevents concurrent runs from corrupting `state.json`. Release lock on batch completion or unhandled error (try/finally).
0b. **Validate `state.json`** — parse and validate schema on startup. If invalid, attempt restore from most recent backup in `data/editorial/backups/`. If no valid backup, abort with instructions.

**Process per transcript:**

1. **Parse frontmatter** — extract title, source, date, duration, URL (reuse existing `transcript-parser.js` patterns). Skip files that are 0 bytes, non-UTF-8, or have unparseable frontmatter (log warning, continue)
2. **Dedup check** — skip if a document with this title+source+date already exists in `state.json.analysisIndex`
3. **Stub check** — if <30 lines, classify as STUB, add minimal entry to Analysis Index, skip further processing
4. **Assemble context** for Opus call:
   - Brightbeam editorial prompt (`config/prompts/editorial-context.v1.txt`)
   - Theme registry — all theme definitions with last 3 sessions of evidence
   - Post backlog — titles + status + priority for all active entries (archived excluded)
   - Previous entries from this batch (if processing multiple transcripts sequentially)
   - ANALYSE task prompt (`config/prompts/editorial-analyse.v1.txt`)
   - The transcript itself
5. **Call Opus 4.6** — single call with `max_tokens: 16384`, producing structured JSON (see §6.2 for schema)
6. **Validate Opus response** — JSON schema validation:
   - Document number matches expected `nextDocument`
   - Theme codes reference existing themes or are valid new proposals (T27+)
   - Post numbers are sequential from `nextPost`
   - Required fields present and non-empty
7. **Enrich Opus output** — the script adds fields Opus doesn't produce:
   - Analysis Index entry: add `dateProcessed` (today ISO), `session` (current session number), key = `nextDocument`
   - Post Backlog entries: add `dateAdded` (today ISO), `status: "suggested"`, key = sequential from `nextPost`
   - Decision Log entries: add `id` (format `"{session}.{n}"`, e.g. `"16.1"`), `session` (current session number)
   - Theme evidence entries: add `session` (current session number)
8. **Mutate `state.json`** — backup first, then:
   - Append Analysis Index entry (keyed by document number)
   - Update Theme Registry (append new evidence to existing themes; add new themes; merge cross-connection reasoning — see §4.1)
   - Append Post Backlog entries
   - Append Decision Log entries
   - Increment counters (`nextDocument`, `nextPost`, `nextSession` once per batch)
   - Recompute corpus statistics by scanning current state (not manual increment)
   - Write-validate-swap
9. **Write story references** — `data/editorial/story-references-session-{N}.json` for DISCOVER
10. **Surface high-priority posts** — if any post candidate has priority IMMEDIATE or HIGH:
   - Log to stdout: `⚡ POST CANDIDATE: #92 "The Contract Clause Nobody Is Talking About" [IMMEDIATE]`
   - Append to `data/editorial/notifications.json` (array of `{ postId, title, priority, date }` — web UI dashboard polls this in Phase E)
   - macOS notification: `osascript -e 'display notification "..." with title "SNI Post Candidate"'` (when running via launchd)

**Batch processing:** A session = one invocation of `editorial-analyse.js`. The session counter (`nextSession`) increments once at the start of each invocation, before processing any transcripts. Transcripts are processed sequentially within that session. Each gets its own Opus call. Previous transcripts' outputs (compacted: title, tier, themes, keyThemes only) are added to context for subsequent calls. Story references from all transcripts in the batch are aggregated into a single `story-references-session-{N}.json` file. If a partial batch fails, completed transcripts are in state.json; the next invocation gets a new session number and the dedup check (step 2) skips already-processed transcripts.

**Context budget:**

| Component | Tokens | Notes |
|-----------|--------|-------|
| Editorial prompt | ~2,500 | Brightbeam positioning, editorial preferences, learnings |
| Theme registry (compacted) | ~8,000 | Theme definitions + last 3 sessions of evidence. Grows to ~15k at T40 |
| Post backlog (active index) | ~4,000 | Titles + status + priority. Archived excluded. Grows to ~6k at #150 |
| Previous batch entries | ~3,000–4,000 | Compacted: only `title`, `tier`, `themes`, `keyThemes` from previous entries in this batch (~200 tokens each). At 20th transcript: 19 × 200 = ~3,800 tokens |
| ANALYSE task prompt | ~2,000 | Instructions + JSON schema example |
| Transcript | 3,000–55,000 | Short episode ~3k; 3-hour Zvi episode ~55k |
| Response headroom | ~10,000 | 5 structured outputs need room |
| **Total** | **~33,000–85,000** | Well within 200k. At T40 + #150 backlog: ~40,000–92,000 — still within budget |

**Crash recovery:** Each transcript's state mutation is atomic (backup + write-validate-swap). If the process crashes between transcripts in a batch, completed transcripts are already in `state.json`. The dedup check (step 2) prevents re-processing on restart.

### 5.2 DISCOVER — news story search and scrape

**Script:** `scripts/editorial-discover.js`
**Trigger:** Manual (`bun scripts/editorial-discover.js --session 16`), called automatically after ANALYSE, or web UI trigger button (POST `/api/editorial/trigger/discover` — see §8.3)
**Input:** `data/editorial/story-references-session-{N}.json`
**Output:** Tier 1 articles in `data/verified/{date}/general/`

**Story references file format:**

```json
[
  {
    "headline": "Anthropic 81,000-person qualitative survey on AI attitudes",
    "entities": ["Anthropic", "Claude"],
    "approximateDate": "2026-03-17",
    "urlMentioned": null,
    "searchQuery": "Anthropic 81000 person AI survey Claude interviews 2026",
    "sourceEpisode": "AI Daily Brief — What People Really Want From AI",
    "context": "Survey interviewed 81,000 people across 159 countries in 70 languages using Claude as interviewer"
  }
]
```

**Process per story reference:**

1. **Receive story reference** from the JSON file
2. **Search for original article** using Gemini with Google Search grounding (`callGeminiWithSearch` from `editorial-multi-model.js` — which re-uses the pattern from existing `multi-model.js` without modifying it)
3. **Fetch article content** — HTML parsing and text extraction via Cheerio (reuse patterns from existing `extract.js`)
4. **Dedup check** — two-tier: (a) exact URL match against all articles in `data/verified/`, (b) title similarity (Jaccard on normalised tokens, threshold ≥0.8) within ±3 days. Reuse `dedup.js` patterns
5. **Write to `data/verified/{date}/general/`** — both `.json` and `.md` files (matching existing pipeline format used by `draft.js` and web UI). Additional JSON fields: `{ "discoverySource": "podcast-referenced", "confidence": "high", "sourceEpisode": "..." }`
6. **Log results** — track which references were found, which were unfetchable (paywalled, ambiguous), which were already in corpus

**Failure handling:**
- Paywalled: log as unfetchable, retain the podcast's description as a fallback snippet in the story reference file
- Ambiguous: take highest-relevance result from a credible source
- Rate limiting: respect robots.txt, 2-second delay between fetches. Gemini Search calls processed sequentially with 1-second delay (or use `withConcurrency(3, tasks)` for controlled parallelism)
- Gemini Search failure: log and skip (graceful degradation — the story reference still exists in the Analysis Index entry)
- Crash recovery: maintain `data/editorial/discover-progress-session-{N}.json` tracking processed references. On restart, skip already-processed entries

### 5.3 DRAFT — newsletter assembly with multi-model critique

**Script:** `scripts/editorial-draft.js`
**Trigger:** Manual (`bun scripts/editorial-draft.js --week 12`), launchd (Thursday 18:00), or web UI trigger button (POST `/api/editorial/trigger/draft` — see §8.3)
**Models:** Opus 4.6 (draft + revise), Gemini 3.1 (critique), GPT-5.4 (critique)
**Input:** State documents + sector articles + podcast intelligence + previous newsletter + published tracking
**Output:** `output/editorial-draft-week-N.md` (publication-ready)

**Pre-flight checks:**
1. Verify ANALYSE has run for this week (check `state.json` for entries with current week's dates)
2. Verify sector articles exist in `data/verified/` for the current week
3. Warn (but don't abort) if fewer than 10 transcripts processed this week

#### Stage 1: Context assembly

1. **State documents** — Analysis Index entries for this week (by date range), Theme Registry (full, compacted), Post Backlog (HIGH + IMMEDIATE items)
2. **Sector articles** — from `data/verified/` for the current week's date range: general, biopharma, medtech, manufacturing, insurance. Loaded using date-range filtering (map week number → Friday-Thursday editorial week). Articles with `discoverySource: "podcast-referenced"` are presented separately as `podcastSourcedArticles` so Opus can apply the presumption-of-inclusion rule
3. **Podcast intelligence** — Analysis Index entries for this week's podcast episodes, including theme cross-connections
4. **Previous newsletter** — `output/editorial-draft-week-{N-1}.md` for continuity (truncated to tl;dr + structure if over 10k tokens). Falls back to the most recent file matching `output/editorial-draft-week-*.md` if the exact predecessor doesn't exist
5. **Published tracking** — `data/editorial/published.json` to exclude already-published stories

#### Stage 2: Opus 4.6 drafts

Single Opus call with the editorial draft prompt (§6.3). Produces:

- **tl;dr introduction** — identifies the week's through-line. Opens with the most surprising or consequential development. Weaves sector signals. Narrative structure, not list
- **General AI section** — 5-7 article bullets with links. Podcast-sourced articles (`discoverySource: "podcast-referenced"`) carry presumption of inclusion. Each bullet: `[Linked headline](url)`, one sentence of significance
- **Sector sections** — biopharma, medtech, manufacturing, insurance. 2-4 bullets each. Same format
- **Podcast synthesis section** — 3-5 analytical themes drawn from cross-episode analysis. Format per §5.3.1

Saved as `output/editorial-draft-week-N-v1.md`.

#### Stage 3: Independent critique

Two parallel calls using `scripts/lib/editorial-multi-model.js`:

**Gemini 3.1** and **GPT-5.4** each receive:
- The v1 draft
- The Brightbeam editorial prompt
- This week's Analysis Index entries (same set used in Stage 2 — populates `{week_analysis_entries}` in the critique prompt for fact-checking)
- The FT-standard critique prompt (§6.4)

Both critiques are independent — neither sees the other's output.

#### Stage 4: Opus 4.6 evaluates and revises

Opus receives:
- The v1 draft
- Both critique documents
- The editorial prompt
- Instruction: evaluate each critique point on merit. Accept valid points, reject noise. Produce a revised draft. Log which points were accepted/rejected and why.

**Output files:**
- `output/editorial-draft-week-N.md` — final revised draft (publication-ready)
- `output/editorial-draft-week-N-v1.md` — pre-critique draft (retained)
- `output/editorial-draft-week-N-critiques.json` — both critiques + Opus's evaluation

#### 5.3.1 Podcast section format

The podcast section is analytical synthesis across episodes, not episode recaps. Target format (from Week 12):

```markdown
## But what set podcast tongues a-wagging?

### Skills as enterprise architecture.

Anthropic mapped 28,000+ agent skills into nine categories and surfaced
a distinction that matters for regulated industries.

[2-3 paragraphs of analysis — structural mechanism, enterprise
relevance, Brightbeam framing]

AI Daily Brief — 'How to Use Agent Skills' (18 March)

### The desktop convergence.

In one week, Manus, Adaptive, NVIDIA and OpenAI all announced
desktop-native agent tools.

[2-3 paragraphs — cross-episode synthesis, specific details,
enterprise implication]

AI Daily Brief — 'The Race to Put AI Agents Everywhere' (17 March)
```

**Key characteristics:**
- Themes, not episodes — a theme may draw from 2-3 episodes
- Source attribution at the end of each theme block
- Analytical framing — what this means for enterprises, not what the podcast host said
- Concrete details — specific numbers, companies, mechanisms
- 3-5 theme blocks per week, each 100-200 words

### 5.4 TRACK — publication tracking

**Script:** `scripts/editorial-track.js`
**Trigger:** Manual (Scott runs after publishing) or web UI (POST `/api/editorial/track` — see §8.3)

```bash
# Log a published newsletter
bun scripts/editorial-track.js --newsletter --week 12

# Log a published LinkedIn post
bun scripts/editorial-track.js --linkedin --post 43 --title "Multi-agent team dysfunction"

# View published items
bun scripts/editorial-track.js --list

# Mark a post backlog entry as published
bun scripts/editorial-track.js --mark-published --post 43
```

Updates `data/editorial/published.json` and sets the post's status to `published` in `state.json`.

**Note:** This is a manual step. If Scott forgets to track a publication, the next draft may re-include published stories. Acceptable — Scott will catch duplicates during sub-editing.

## 6. Prompt designs

### 6.1 Brightbeam editorial prompt

**File:** `config/prompts/editorial-context.v1.txt`
**Owner:** Scott (exports from Claude.ai Project)
**Status:** PREREQUISITE — must exist before any implementation begins

This is the master editorial context injected into every Opus call. It is the prompt Scott has refined across 15+ sessions. Contents include:
- Purpose & context (Brightbeam positioning, target audience, intellectual positioning)
- Key learnings (source title ≠ retirement basis; deploy full research weight; descriptive over prescriptive; evidence before labels; calibrated confidence)
- Editorial preferences (open with counterintuitive finding; prohibited structures; named formats; word targets)
- Corpus structure (two-tier system; theme conventions; post backlog conventions)
- Named frameworks (Schelling Point Framework, Embed, robust as a pair)
- Client references (AXA, Zurich, Acorn, Skillnet Ireland)

**Scott's action:** Extract the full prompt from the Claude.ai Project and save to this path. This file is the single most critical input to the system.

### 6.2 ANALYSE task prompt

**File:** `config/prompts/editorial-analyse.v1.txt`

This prompt is appended to the editorial context for each ANALYSE call. It defines the task and the JSON output schema.

**Output schema (5 top-level keys):**

```json
{
  "analysisIndexEntry": {
    "title": "string — episode title",
    "source": "string — podcast name",
    "host": "string — host name(s)",
    "participants": "string | null — key guests",
    "date": "string — ISO date of content",
    "tier": "number — 1 or 2",
    "status": "string — 'active' | 'stub'",
    "themes": ["array of theme codes — e.g. T01, T05"],
    "keyThemes": "string — comma-separated key theme descriptions",
    "summary": "string — 200-500 word analytical summary. NOT descriptive. Identify structural arguments, enterprise relevance, cross-connections. Deploy full analytical weight.",
    "postPotential": "string — none | low | medium | medium-high | high | very-high",
    "postPotentialReasoning": "string — specific reasoning for the rating"
  },
  "themeUpdates": [
    {
      "themeCode": "string — e.g. T01, or T27 for new theme proposals",
      "themeName": "string — only required for new themes",
      "newEvidence": "string — specific quotes, data points, mechanisms. NOT restatements of existing evidence.",
      "crossConnectionUpdates": [
        { "theme": "string — theme code e.g. T05", "reasoning": "string — specific causal claim or mechanism, not just 'relates to'" }
      ]
    }
  ],
  "postCandidates": [
    {
      "title": "string — working title",
      "workingTitle": "string — alternative title for A/B consideration",
      "coreArgument": "string — the specific defensible CLAIM, not a topic description",
      "format": "string — quiet-observation | concept-contrast | news-decoder | honest-confession | behavioural-paradox | practitioners-take",
      "sourceDocuments": "array of numbers — document IDs from Analysis Index (e.g. [120, 122])",
      "freshness": "string — very-timely | timely-evergreen | evergreen",
      "priority": "string — immediate | high | medium-high | medium",
      "notes": "string — editorial risks, sequencing, cross-references to existing backlog items"
    }
  ],
  "decisionLogEntries": [
    {
      "title": "string — brief decision title",
      "decision": "string — the decision itself",
      "reasoning": "string — why this decision was made"
    }
  ],
  "storyReferences": [
    {
      "headline": "string — story as mentioned in podcast",
      "entities": ["array of company/person/product names"],
      "approximateDate": "string — ISO date or null",
      "urlMentioned": "string | null — URL if explicitly mentioned",
      "searchQuery": "string — optimised query that would find the original article",
      "sourceEpisode": "string — podcast name and episode title (e.g. 'AI Daily Brief — What People Really Want From AI')",
      "context": "string — brief context of how the podcast discussed this story"
    }
  ]
}
```

**Prompt structure:**

```
You are processing a podcast transcript as part of an ANALYSE session
for Brightbeam's content intelligence system.

## Your task

Produce a JSON response with exactly 5 top-level keys matching the
schema below. Be precise with the schema — the output will be parsed
programmatically.

[Full JSON schema with example values — as shown above]

## Rules

- Structural mechanisms over surface descriptions. 'Apple's unified
  memory is accidentally optimised for inference' is analysis. 'Apple
  released new hardware' is a headline.
- The summary must deploy the full analytical weight. Thin summaries
  are rejected.
- Post ideas must have defensible, specific claims — not topic
  descriptions. 'The institutional context, not the technology, is
  the adoption barrier' is a claim. 'AI adoption in enterprises' is
  a topic.
- Theme updates must add NEW evidence, not restate what's already
  tracked. Reference the existing evidence to show what this
  document adds.
- Cross-connections are the highest-value output. Each must state a
  specific causal claim or mechanism — 'T10 (independent workers'
  disproportionate gains reinforce that institutional context is the
  adoption barrier)' is a cross-connection. 'T10 (relates to labour
  markets)' is not. Ignoring theme boundaries produces better insights
  than sequential analysis.
- Tier 2 documents (geopolitical, cultural, non-AI) still get full
  analysis — the mechanism might map onto the AI enterprise thesis
  even when the subject doesn't.
- For story references: extract concrete, searchable news stories
  with enough specificity to find the original article. Omit vague
  references ('some study') that cannot be reliably searched.

## Context

{editorial_context}

## Current Theme Registry

{theme_registry}

## Current Post Backlog (active items)

{post_backlog_index}

## Document metadata

Number: #{doc_number}
Title: {title}
Source: {source}
Date: {date}
Duration: {duration}

## Transcript

{transcript}
```

### 6.3 Newsletter draft prompt

**File:** `config/prompts/editorial-draft.v1.txt`

Receives the accumulated state documents, sector articles, and podcast intelligence. Produces the complete newsletter markdown.

```
You are drafting the weekly SNI newsletter for Brightbeam.

## Newsletter structure

1. **tl;dr introduction** (~200-300 words)
   - Identify the week's through-line
   - Open with the most surprising or consequential development
   - Weave in sector signals that reinforce the theme
   - Close with a forward-looking observation
   - Tone: analytical, confident, mildly wry. Not breathless

2. **General AI section** (5-7 bullets)
   - Podcast-sourced articles (discoverySource: "podcast-referenced")
     have presumption of inclusion
   - Each bullet: [Linked headline](url), one sentence of significance
   - Ordered by editorial significance

3. **Sector sections** (2-4 bullets each)
   - Biopharma, Medtech, Manufacturing, Insurance
   - Same format. Only include sectors with substantive stories

4. **Podcast synthesis section** (3-5 themes, 100-200 words each)
   - 'But what set podcast tongues a-wagging?'
   - Themes drawn from cross-episode analysis
   - Source attribution at end of each theme block
   - Enterprise framing throughout

## Editorial rules

{editorial_context}

## This week's Analysis Index entries

{week_analysis_entries}

## Sector articles (from pipeline)

{sector_articles}

## Previous newsletter (for continuity)

{previous_newsletter}

## Already published (exclude these)

{published_items}
```

### 6.4 FT-standard critique prompt

**File:** `config/prompts/editorial-critique.v1.txt`

```
You are a senior editor at the Financial Times reviewing a draft
newsletter for publication. The newsletter covers AI developments
for an enterprise audience in regulated industries.

You have the editorial brief that defines the publication's voice
and standards. Critique against THESE standards, not generic ones.

## Editorial brief

{editorial_context}

## Assess across three dimensions:

### 1. Structural
- Does the introduction identify a genuine through-line, or is it
  a list dressed as narrative?
- Does each section earn its place?
- Is the podcast section analytical synthesis, or episode recaps?
- Are cross-section connections made where they exist?

### 2. Tonal
- Descriptive and analytical, or prescriptive and instructional?
- Any prohibited structures? ('It's not X, it's Y', stating the
  obvious, celebratory tone, parallel equivalents)
- Confidence calibrated to evidence?
- UK English throughout? (single quotes, spaced en dashes, no
  Oxford commas, -ise/-isation)

### 3. Factual
- Claims supported by the evidence provided?
- Numbers, names, dates accurate?
- Hedging appropriate where uncertainty exists?

## For each issue:
- Quote the passage
- Explain why it falls short
- Show what better looks like (specific fix, not 'make this better')

## Overall verdict
- PUBLISH: Ready with minor copy-edits at most
- REVISE: Structurally sound, needs specific improvements
- REWRITE: Fundamental issues

## Source material (for fact-checking)

{week_analysis_entries}

## Draft to review

{draft}
```

## 7. Multi-model orchestration

### 7.1 Model assignment

| Task | Model | Rationale |
|------|-------|-----------|
| ANALYSE processing | Opus 4.6 | Analytical depth, theme synthesis, editorial judgement |
| Story reference extraction | Opus 4.6 | Part of the ANALYSE call |
| News story search | Gemini 3.1 with Search | Google Search grounding. `callGeminiWithSearch` from `editorial-multi-model.js` (re-uses pattern from existing `multi-model.js` without modifying it) |
| Newsletter draft | Opus 4.6 | Editorial voice, corpus synthesis |
| Critique | Gemini 3.1 + GPT-5.4 | Two independent perspectives. 'Robust as a pair' |
| Draft revision | Opus 4.6 | Evaluates critiques, maintains editorial authority |

### 7.2 API infrastructure

**New file:** `scripts/lib/editorial-multi-model.js`

This file creates its own Anthropic, OpenAI, and Gemini clients. It does **not** modify the existing `scripts/lib/multi-model.js`. It imports shared utilities where applicable (e.g., `extractJSON`, `withRetry` from existing libs) but creates its own client instances.

```javascript
// scripts/lib/editorial-multi-model.js
import { withRetry } from './retry.js'
import { loadEnvKey } from './env.js'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'

const OPUS_MODEL = 'claude-opus-4-20250514'
const GPT_MODEL = 'gpt-5.4'
const GEMINI_MODEL = 'gemini-3.1-pro-preview'

export async function callOpus(prompt, opts = {}) { /* ... */ }
export async function callGPT(prompt, opts = {}) { /* ... */ }
export async function callGemini(prompt, opts = {}) { /* ... */ }
export async function callGeminiWithSearch(prompt, opts = {}) { /* ... */ }
export async function critiqueDraft(draft, editorialContext, sourceContext) {
  // Calls Gemini + GPT in parallel, returns both critiques
}
```

**API keys required:**
- `ANTHROPIC_API_KEY` — already in `.env`
- `OPENAI_API_KEY` — already in `.env`
- `GOOGLE_AI_API_KEY` — already in `.env`

### 7.3 Cost estimate

| Stage | Calls/week | Avg input tokens | Avg output tokens | Weekly cost |
|-------|-----------|-----------------|-------------------|-------------|
| ANALYSE (Opus) | 20 | 30,000 | 8,000 | ~$21 |
| DISCOVER (Gemini+Search) | ~60 | 1,000 | 2,000 | ~$1 |
| DRAFT (Opus) | 1 | 80,000 | 8,000 | ~$2 |
| CRITIQUE (Gemini + GPT) | 2 | 50,000 | 3,000 | ~$1 |
| REVISION (Opus) | 1 | 70,000 | 8,000 | ~$2 |
| **Total** | | | | **~$27/week** |

Rising to ~$40-55/week as state documents grow. Budget cap: **$60/week** — alert at $40/week. Configure in `config/editorial-sources.yaml`.

**Cost reduction:** Anthropic prompt caching (if available for Opus 4.6) would reduce ANALYSE costs by ~30% since the editorial prompt + theme registry + post backlog (~17k tokens) is shared across all 20 calls in a batch.

## 8. Integration with existing pipeline

### 8.1 Reading sector articles

The editorial draft reads articles from `data/verified/` — the same directory the existing pipeline writes to. No coupling to pipeline code; reads JSON files directly.

Article selection maps week number to a Friday-Thursday editorial week using `getWeekWindow()` from `scripts/lib/week.js` (imported as a utility, not modifying the file).

### 8.2 Coexistence with existing draft.js

The existing `draft.js` produces `output/draft-week-N.md`. The editorial system produces `output/editorial-draft-week-N.md`. Both can coexist. Scott uses the editorial version as primary. The existing draft serves as a fallback or comparison.

### 8.3 Web UI integration (Phase E)

The editorial web UI extends the existing Phase 1–4 workbench with editorial intelligence features. All new components follow the established design system and coding patterns (see `.claude/context/coding-patterns.md`). The API route reads from `data/editorial/` (JSON files) — does NOT import pipeline modules.

#### 8.3.1 Design system v2

Additions to `web/app/src/styles/tokens.css`:

| Token | Value | Purpose |
|-------|-------|---------|
| `--text-primary` | `#e8e6dc` | Primary text (headings, body) |
| `--text-secondary` | `#a09e94` | Secondary text, labels, meta (5.2:1 contrast on `--pampas`) |
| `--text-muted` | `#706e66` | Tertiary text, timestamps, placeholders |
| `--sp-1` through `--sp-10` | 4px–40px scale | Consistent spacing (4, 8, 12, 16, 24, 32, 40) |
| `--transition-fast` | `0.15s` | Hover, toggle |
| `--transition-normal` | `0.25s ease` | Panel open, tab switch |
| `--transition-slow` | `0.3s` | Progress bars, charts |

**Button system** (new shared component):
- Variants: `btn-primary` (terra fill), `btn-secondary` (surface fill, border), `btn-ghost` (transparent), `btn-danger` (danger-bg)
- Sizes: `btn-sm` (11px/4px 10px), `btn-md` (13px/6px 16px)
- All buttons: Poppins font-weight 500, `var(--radius)` corners, `var(--transition-fast)` hover

**Tab component** (unified pattern — replaces inconsistent tab implementations across pages):
- Poppins 13px weight 500, `--text-secondary` default, `--terra` active with 2px bottom border
- Optional count badge: `tab-count` span, 11px `--text-muted`
- Consistent across: Database page (Articles/Podcasts/Flagged), Editorial page (State/Themes/Backlog/Decisions/Activity), Draft panel (AI Critique/Preview/Review/Links/Chat), Config page (Off-limits/Sources/Sectors)

**Card alignment**: All cards use `--surface` (#2c2a27) background — not `--card-bg` which is reserved for inset/nested containers. `--shadow-subtle` applied to all cards.

**Badge system**:
- Priority: `badge-immediate` (danger), `badge-high` (warning), `badge-medium-high` (blue), `badge-medium` (brown)
- Tier: `badge-tier1` (sage), `badge-tier2` (purple), `badge-stub` (muted)
- Status: `badge-suggested` (blue), `badge-published` (sage)
- Format: `badge-format` (terra-15) for post format labels (quiet-observation, news-decoder, etc.)

#### 8.3.2 Sidebar

260px fixed width, `--sidebar-bg` (#1e1c1a) background. SVG Feather-style stroke icons (20×20, stroke-width 1.5, round caps/joins). Navigation items: Dashboard, Database, Draft, Editorial, Co-pilot, Sources, Config.

**Active state:** `--terra` text + 3px left border + `--terra-bg` background.

**Badge:** Editorial nav item shows notification count badge (danger red pill) when HIGH/IMMEDIATE post candidates exist in `data/editorial/notifications.json`.

**Footer status indicators:**
- Pipeline health: green dot + "Pipeline healthy · {time} ago" — polls `GET /api/status`
- ANALYSE/DISCOVER/DRAFT lock status: pulsing terra dot + "{STAGE} running · {n} of {total}" — polls `GET /api/editorial/status` which checks for `.analyse.lock`, `.discover.lock` files

#### 8.3.3 Dashboard page

**Stat grid** (4 columns):
1. **Articles this week** — count + "across 5 sectors"
2. **Editorial status** — "Draft ready" (sage) / "ANALYSE running" (terra) / "Awaiting transcripts" (muted). Sub-text shows pipeline stage checkmarks: ANALYSE ✓ · DISCOVER ✓ · DRAFT ✓
3. **Flagged articles** — count + "{n} unreviewed"
4. **Weekly cost** — dollar amount + "of $60 budget · {pct}%". Colour: sage (<60%), warning (60–80%), danger (>80%)

**Two-column grid below stats:**

Left column — **Editorial This Week** card:
- 2×2 inner grid: Transcripts ({processed} of {total}; "{n} Tier 1 · {n} Tier 2 · {n} STUB") + Stories found ({total} articles; "{n} found · {n} paywalled")
- Below divider: draft status line ("Week 12 draft — ready for sub-edit") + word count + "Open draft →" primary button navigating to Draft page

Right column — **Post Candidates** card:
- 3 notification items showing latest HIGH/IMMEDIATE post candidates from `data/editorial/notifications.json`
- Each item: priority badge, title with post ID, one-line description, "View" button (navigates to Backlog tab), "Dismiss" ghost button, timestamp

Second row — two-column:
- **Articles by Date** bar chart with toggle (This week / Last 7d / Last 30d), Y-axis labels
- **Last Pipeline Run** card — step list (fetch/score/draft) with checkmark/spinner, article counts, durations. Sub-section: Podcast Import — episode count + gap-filled count

#### 8.3.4 Database page (renamed from Articles)

Three tabs: **Articles** | **Podcasts** | **Flagged**

**Articles tab:**
- Filter bar: sector dropdown (All/General/Biopharma/Medtech/Manufacturing/Insurance), week dropdown, source dropdown, `discoverySource` filter (all/pipeline/podcast-referenced)
- Sort: Date / Score / Source
- Table columns: Title (Poppins 500, max-width 500px) + source sub-text, Sector badge, Score (colour-coded: sage ≥80, terra 50–79, muted <50), Date
- Row click → detail panel (slide-in from right, matching existing Articles page pattern)
- Podcast-sourced articles show small "podcast" indicator icon beside the score

**Podcasts tab:**
- Filter bar: source dropdown (All/AI Daily Brief/Cognitive Revolution/Moonshots/etc.), tier pills (All/Tier 1/Tier 2/STUB), session pills
- List items (card-based, not table): Episode title, source + host + date meta row, tier badge, theme tags (with hover tooltips showing theme name), "Stories: {n} extracted · {n} found" sub-text
- Expand → summary text, story reference list, "Open in Draft" click-to-draft link

**Flagged tab:**
- Filter bar: sector, status (unreviewed/reviewed/dismissed)
- Same table layout as Articles tab, filtered to flagged items
- Quick actions: Approve (→ verified), Dismiss, Open detail

#### 8.3.5 Draft page

**Toolbar** (three-zone layout: left / centre / right):
- Left: "Draft" title (Poppins 18px) + week navigator (‹ Week 12 ›) — left/right arrows, right disabled when on current week
- Centre: version toggle (v1 pre-critique | Final) segmented control + review pill (Pass sage / Fail terra) + word count
- Right: "Compare pipeline" secondary button + "Save" primary button

**Two-pane layout** (50/50 grid):

Left pane — markdown editor:
- Line-number gutter (40px, `--card-bg` background, SF Mono 12px)
- Editable content area (`contenteditable` or textarea) with markdown syntax highlighting (headings → terra, bold → primary, links → blue, bullets → terra-light)
- Header bar: "Editorial Draft · Week {N}"

Right pane — unified panel with 5 tabs:
- **AI Critique** (default): critique summary line ("5 points accepted · 2 rejected · Verdict: PUBLISH/REVISE"). Two-column grid: Gemini 3.1 + GPT-5.4 critiques. Each point: quoted passage, critique text, accepted/rejected verdict with icon. Accept/reject toggle buttons on each point
- **Preview**: rendered markdown (react-markdown, matching existing Draft page pattern)
- **Review**: existing review overlay with evaluation scores (carried forward from Phase 2)
- **Links**: link verification badges (carried forward from Phase 2)
- **Chat**: inline draft chat (reuses Co-pilot chat component, context scoped to current draft)

**Click-to-draft behaviour:** When navigating from Editorial page or Dashboard post candidates, the Draft page:
1. Loads the current week's editorial draft
2. Scrolls to the relevant section (if identifiable from the source element)
3. If the source is a post backlog entry → opens a new draft buffer with the post's core argument, source documents and format pre-loaded
4. If the source is a theme → opens a new draft buffer with theme evidence, cross-connections pre-loaded
5. If the source is an analysis index entry → scrolls to the podcast section containing that entry's source episode

#### 8.3.6 Editorial page

**Header:** "Editorial Intelligence" title + subtitle line ("Session {N} · {doc_count} documents · {theme_count} themes · {post_count} post candidates")

**Five tabs:** State | Themes | Backlog | Decisions | Activity — each with count badge.

**Split layout:** Content area (flex: 1) left, contextual Opus 4.6 chat panel (380px fixed) right.

**State tab:**
- Search bar: full-text search across title, source, themes, summary
- Filter row: tier pills (All/Tier 1/Tier 2/STUB) | session pills (Session 16/15/14) | source pills (AI Daily Brief/Cognitive Rev./Moonshots/EV Newsletter)
- List items in card container: document ID, title, tier badge, "Highest value" indicator (sage star) for top-rated entries, expand chevron
- Meta row: source, host, date, session, post potential (colour-coded)
- Theme tags with hover tooltips
- Expanded detail: summary paragraph, stories referenced count ("6 stories extracted · 5 found · 1 paywalled"), "Open in Draft" click-to-draft link

**Themes tab:**
- Search bar: search theme name, evidence, cross-connections
- Filter row: All / Active this week / Stale >3 sessions (warning-coloured) | Sort dropdown (Last updated / Evidence count / Alphabetical)
- List items: theme code tag (T01), theme name, doc count + last updated session
- Stale themes: warning-coloured tag border, "Rotation candidate" italic label
- Expanded detail: evidence blocks (terra left border, source label + text), cross-connections (terra left border, linked theme code in bold), "Draft T01 analysis" click-to-draft link, "Show archived evidence" link

**Backlog tab:**
- Search bar: search title, themes, arguments
- Filter row: status pills (Active/Published/Archived) | format pills (quiet-observation/news-decoder/concept-contrast/practitioners-take)
- Grouped by priority: IMMEDIATE → HIGH → MEDIUM-HIGH → MEDIUM
- Each group: priority badge header + count
- List items: post ID, title, format badge, status badge, expand chevron
- Meta row: session, source document IDs, freshness (colour: danger for very-timely, warning for timely-evergreen, muted for evergreen)
- Expanded detail: core argument paragraph, editorial notes, working title, source documents list, "Draft this post" + "Mark Published" + "Archive" action buttons

**Decisions tab:**
- Reverse-chronological list (newest first)
- Decision items: session-scoped ID (e.g. "15.1"), title (Poppins 14px 600), decision body text, reasoning block (muted, left border)
- No filtering needed — decisions are few per session

**Activity tab:**
- Trigger buttons row: "Run ANALYSE" + "Run DISCOVER" + "Run DRAFT" (primary/secondary buttons). Disabled when corresponding lock file exists
- Activity feed: reverse-chronological, colour-coded dots (terra = ANALYSE, blue = DISCOVER, sage = DRAFT, purple = TRACK, danger = error)
- Each item: title, detail text, timestamp
- Cost tracker card: progress bar (sage <60%, warning 60–80%, danger >80%), "${spent} of $60 budget · {pct}%", cost breakdown table (ANALYSE/DISCOVER/DRAFT/CRITIQUE rows with call count + cost)

#### 8.3.7 Contextual Opus 4.6 chat panel

380px fixed-width panel on the right side of the Editorial page. Shared across all 5 tabs — conversation persists when switching tabs but context tag updates.

**Header:** "Opus 4.6" title + context tag pill showing current tab context (e.g. "State: Analysis Index" / "Themes: T01 evidence" / "Backlog: Active posts")

**Messages area:** Scrollable, flex column. User messages: right-aligned, `--terra-bg` background, Poppins font. Assistant messages: left-aligned, `--surface` background, Lora font. Footer on assistant messages: "Opus 4.6" model badge (terra-15 pill) + timestamp.

**Draft links in responses:** When Opus suggests actionable content (post ideas, analysis angles, theme connections), responses include inline "Open in Draft →" links (terra-coloured, external-link SVG icon).

**Input area:** Textarea (auto-growing, min 36px, max 120px) + send button. Focus state: terra border + focus ring.

**Context assembly per tab:**

| Active tab | Context injected into Opus call |
|------------|-------------------------------|
| State | This week's Analysis Index entries (full summaries). ~8k tokens |
| Themes | All theme definitions + last 3 sessions of evidence. ~12k tokens |
| Backlog | Active post backlog entries (full core arguments). ~6k tokens |
| Decisions | Current session's decision log entries. ~2k tokens |
| Activity | Last 20 activity entries + cost summary. ~1k tokens |

**API endpoint:** `POST /api/editorial/chat` — streaming response (SSE), same pattern as existing `POST /api/chat` in Co-pilot. Request body: `{ message, context: { tab, filters, selectedItemId? } }`. The server assembles editorial context based on the tab and any active filters/selection.

**Conversation persistence:** Conversations stored in `data/editorial/chat-sessions/` as JSON files, keyed by `{date}-{tab}.json`. Loaded on tab activation, cleared weekly.

#### 8.3.8 Click-to-draft navigation

Every editorial element has a "Open in Draft" / "Draft this" affordance — a terra-coloured inline link with external-link SVG icon (12×12).

**Implementation:** `navigate('/draft', { state: { source, content } })` via React Router. The Draft page checks `location.state` on mount:

| Source type | Draft page behaviour |
|-------------|---------------------|
| Analysis Index entry | Load editorial draft, scroll to podcast section |
| Theme (from Themes tab) | Open new draft buffer: theme name as heading, evidence blocks as source material, cross-connections as analytical angles |
| Post backlog entry | Open new draft buffer: working title, core argument as opening, format label as template hint, source documents listed |
| Opus chat suggestion | Open new draft buffer: Opus's suggestion as seed text |
| Podcast episode (from Database) | Load editorial draft, scroll to podcast section for that episode's source |
| Dashboard post candidate | Navigate to Draft with post backlog entry pre-loaded (same as backlog entry above) |

**Visual affordance:** `.draft-link` class — inline-flex, 11px Poppins, `--terra-light` colour, hover → `--terra`. SVG icon: 12×12, stroke currentColor, external-link path.

#### 8.3.9 Cross-cutting UI improvements

These apply to all pages (existing and new):

| ID | Feature | Specification |
|----|---------|--------------|
| X1 | Toast notifications | Fixed bottom-right stack. Success (sage left border), error (danger left border). Auto-dismiss 5s. Slide-in animation 0.25s |
| X2 | Breadcrumbs | Poppins 12px, `--text-muted` separators, current item in `--text-primary`. Shown on: Draft (Dashboard > Draft > Week 12), Editorial sub-tabs (Editorial > Themes > T01) |
| X3 | Keyboard shortcuts | Cmd+S (save draft), Cmd+Enter (send chat), Cmd+K (global search), Cmd+1–7 (page navigation), Esc (close panels) |
| X4 | Responsive breakpoints | ≤1200px: sidebar collapses to 60px icons-only. ≤1400px: editorial chat panel collapses to toggle button. ≤900px: draft layout stacks vertically |
| X5 | Loading skeletons | Pulsing `--surface` → `--card-bg` blocks matching content layout. Applied to: stat cards, article tables, editorial list items, chat messages |
| X6 | Empty states | Centred icon (32px, 0.4 opacity) + title (Poppins 15px 600) + description (13px) + optional CTA button. Per-page: "No articles for this week", "No transcripts processed yet — run ANALYSE to begin", "No post candidates this session" |
| X7 | Error boundary | Catches React render errors. Shows: error icon, "Something went wrong" title, error message detail, "Reload page" button. Logs to console |
| X8 | Global search | Cmd+K opens modal. Searches across: articles (title, source), editorial state (Analysis Index, themes, backlog), drafts (content). Results grouped by type. Navigate to result on selection |
| X9 | Real-time updates | Polling-based (not WebSocket). Dashboard stats: 60s. Editorial state: 30s. Lock status: 10s. Cost tracker: 60s. Activity feed: 15s. Use `If-Modified-Since` header to avoid unnecessary re-renders |
| X10 | Export | "Export" ghost button on Editorial page → downloads `state.json` as formatted JSON. "Export" on Backlog → downloads active posts as markdown list. "Export" on Draft → downloads current draft as `.md` file |

#### 8.3.10 API routes

**New file:** `web/api/routes/editorial.js`

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/editorial/state?section={section}` | Returns state document section (analysisIndex, themeRegistry, postBacklog, decisionLog, corpusStats). Supports `?week=12` filter for Analysis Index |
| GET | `/api/editorial/search?q={query}` | Full-text search across Analysis Index entries (title, summary, keyThemes) |
| GET | `/api/editorial/backlog?priority={level}&status={status}&format={format}` | Filtered post backlog |
| GET | `/api/editorial/themes?active=true&stale=true` | Theme registry with optional filters |
| GET | `/api/editorial/render?section={section}&id={id}` | Renders JSON state section to readable markdown |
| GET | `/api/editorial/notifications` | Returns HIGH/IMMEDIATE post candidates from notifications.json |
| PUT | `/api/editorial/notifications/:id/dismiss` | Dismisses a notification |
| GET | `/api/editorial/status` | Lock status (which stages are running), progress counts |
| GET | `/api/editorial/cost?week={N}` | Weekly cost breakdown from run logs |
| GET | `/api/editorial/activity?limit=20` | Recent pipeline activity entries |
| POST | `/api/editorial/chat` | Streaming Opus 4.6 chat (SSE). Body: `{ message, context: { tab, filters, selectedItemId } }` |
| POST | `/api/editorial/trigger/analyse` | Spawns ANALYSE as child process. Returns `{ pid, sessionNumber }`. Requires no lock active |
| POST | `/api/editorial/trigger/discover` | Spawns DISCOVER. Body: `{ session }`. Returns `{ pid }` |
| POST | `/api/editorial/trigger/draft` | Spawns DRAFT. Body: `{ week }`. Returns `{ pid }` |
| POST | `/api/editorial/track` | Publication tracking from UI. Body: `{ type: "newsletter"|"linkedin", week?, postId?, title? }` |
| PUT | `/api/editorial/backlog/:id/status` | Update post status (suggested → approved → published / archived). Body: `{ status }` |

**Modified file:** `web/api/lib/context.js`

The co-pilot context assembly is extended to include editorial state. New context source: `buildEditorialContext(week)` → selects this week's Analysis Index entries (titles + summaries), active theme definitions, HIGH/IMMEDIATE post backlog entries. Token budget allocation: ~15k tokens for editorial context within the existing 64k TOKEN_BUDGET.

**Chat route implementation pattern** (matching existing `web/api/routes/chat.js`):

```javascript
// POST /api/editorial/chat — streaming Opus 4.6 with editorial context
export async function handleEditorialChat(req, res) {
  const { message, context } = await req.json()
  const editorialContext = assembleEditorialChatContext(context)
  // Stream SSE response using same pattern as existing chat.js
  res.headers.set('Content-Type', 'text/event-stream')
  // callOpus with editorial prompt + tab-specific context + user message
}
```

**Trigger route implementation pattern:**

```javascript
// POST /api/editorial/trigger/analyse — spawn child process
export async function handleTriggerAnalyse(req, res) {
  // Check for existing lock file
  if (existsSync('data/editorial/.analyse.lock')) {
    return Response.json({ error: 'ANALYSE already running' }, { status: 409 })
  }
  // Spawn as detached child process (survives API server restart)
  const proc = Bun.spawn(['bun', 'scripts/editorial-analyse.js', transcriptDir], {
    cwd: import.meta.dir + '/../../../..',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return Response.json({ pid: proc.pid, sessionNumber: nextSession })
}
```

## 9. File manifest

### New scripts

| File | Purpose |
|------|---------|
| `scripts/editorial-analyse.js` | ANALYSE pipeline — transcript → state document updates |
| `scripts/editorial-discover.js` | Search and scrape podcast-referenced news stories |
| `scripts/editorial-draft.js` | Thursday newsletter draft with multi-model critique |
| `scripts/editorial-track.js` | Publication tracking CLI |
| `scripts/lib/editorial-multi-model.js` | Anthropic + OpenAI + Gemini clients (new file, does not modify existing) |
| `scripts/lib/editorial-state.js` | State document read/write/validate/render utilities |
| `scripts/lib/editorial-context.js` | Context assembly for ANALYSE and DRAFT Opus calls |

### New config

| File | Purpose | Owner |
|------|---------|-------|
| `config/prompts/editorial-context.v1.txt` | Brightbeam editorial prompt (master) | **Scott provides** |
| `config/prompts/editorial-analyse.v1.txt` | ANALYSE task prompt with JSON schema | Developer |
| `config/prompts/editorial-draft.v1.txt` | Newsletter draft prompt | Developer |
| `config/prompts/editorial-critique.v1.txt` | FT-standard critique prompt | Developer |
| `config/editorial-sources.yaml` | Podcast source config, cost budget cap | Developer + Scott |

### New data

| File | Purpose | Initial content |
|------|---------|----------------|
| `data/editorial/state.json` | Master state (all 4 documents + counters) | **Scott exports from Claude.ai Project** |
| `data/editorial/published.json` | Publication tracking | `{ "newsletters": [], "linkedin": [{ "postId": 43, ... }, { "postId": 71, ... }] }` |
| `data/editorial/backups/` | Timestamped state backups | Empty (auto-populated) |
| `data/editorial/story-references-session-{N}.json` | DISCOVER input (aggregated per session) | Auto-generated by ANALYSE |
| `data/editorial/evidence-archive.json` | Compacted theme evidence older than 3 sessions | Auto-generated by compaction |
| `data/editorial/notifications.json` | HIGH/IMMEDIATE post candidates for web UI polling | Auto-generated by ANALYSE |
| `data/editorial/discover-progress-session-{N}.json` | DISCOVER resume tracking | Auto-generated by DISCOVER |

### New and modified web files

**API layer:**

| File | Change |
|------|--------|
| `web/api/routes/editorial.js` | **New file** — editorial state, search, notifications, chat, trigger, track endpoints (see §8.3.10) |
| `web/api/lib/context.js` | **Extended** — `buildEditorialContext(week)` adds editorial state to co-pilot context |
| `web/api/lib/editorial-chat.js` | **New file** — editorial chat context assembly per tab, Opus 4.6 streaming |
| `web/api/server.js` | **Extended** — register editorial routes |

**React pages:**

| File | Change |
|------|--------|
| `web/app/src/pages/Editorial.jsx` | **New file** — editorial intelligence page with 5 tabs + contextual Opus chat panel |
| `web/app/src/pages/Editorial.css` | **New file** — editorial page styles: split layout, activity feed, cost tracker, priority groups, decision items |
| `web/app/src/pages/Database.jsx` | **New file** — replaces Articles.jsx. Three tabs: Articles, Podcasts, Flagged |
| `web/app/src/pages/Database.css` | **New file** — database page styles (extends existing Articles.css patterns) |
| `web/app/src/pages/Articles.jsx` | **Deprecated** — replaced by Database.jsx. Remove after migration |
| `web/app/src/pages/Articles.css` | **Deprecated** — replaced by Database.css |
| `web/app/src/pages/Dashboard.jsx` | **Extended** — editorial summary card, post candidates card, cost stat |
| `web/app/src/pages/Dashboard.css` | **Extended** — dashboard-grid styles, notification items |
| `web/app/src/pages/Draft.jsx` | **Extended** — toolbar redesign (3-zone), version toggle, AI critique panel tab, click-to-draft state handling |
| `web/app/src/pages/Draft.css` | **Extended** — draft-toolbar, version-toggle, critique-grid, draft-gutter styles |

**React components:**

| File | Change |
|------|--------|
| `web/app/src/components/EditorialChat.jsx` | **New file** — contextual Opus 4.6 chat panel (380px, streaming, draft links) |
| `web/app/src/components/EditorialChat.css` | **New file** — chat panel styles: messages, input, model badge, context tag |
| `web/app/src/components/DraftLink.jsx` | **New file** — reusable click-to-draft link component (terra-coloured, SVG icon) |
| `web/app/src/components/Toast.jsx` | **New file** — toast notification container + individual toast items |
| `web/app/src/components/Toast.css` | **New file** — toast styles: slide-in animation, success/error variants |
| `web/app/src/components/EmptyState.jsx` | **New file** — reusable empty state component (icon, title, description, CTA) |
| `web/app/src/components/SearchModal.jsx` | **New file** — Cmd+K global search modal |
| `web/app/src/components/SearchModal.css` | **New file** — modal overlay, results grouped by type |
| `web/app/src/components/layout/Sidebar.jsx` | **Extended** — rename Articles→Database, add Editorial nav item with badge, add footer status indicators |
| `web/app/src/components/layout/Sidebar.css` | **Extended** — nav-badge, sidebar-footer, status-dot styles |

**React hooks:**

| File | Change |
|------|--------|
| `web/app/src/hooks/useEditorialState.js` | **New file** — fetches editorial state sections with filtering. Returns `{ data, loading, error }` |
| `web/app/src/hooks/useEditorialChat.js` | **New file** — manages editorial chat streaming, message history, context switching |
| `web/app/src/hooks/useEditorialStatus.js` | **New file** — polls lock status + progress. Returns `{ analyseLock, discoverLock, draftLock, progress }` |
| `web/app/src/hooks/useNotifications.js` | **New file** — polls notifications.json for post candidates. Returns `{ notifications, dismiss }` |
| `web/app/src/hooks/usePodcasts.js` | **New file** — fetches podcast episodes for Database page. Returns `{ episodes, loading, error }` |
| `web/app/src/hooks/useKeyboardShortcuts.js` | **New file** — registers Cmd+S, Cmd+Enter, Cmd+K, Cmd+1-7, Esc |

**Styles:**

| File | Change |
|------|--------|
| `web/app/src/styles/tokens.css` | **Extended** — text hierarchy tokens, spacing scale, transition tokens, button/badge/tab shared classes |

**Tests:**

| File | Change |
|------|--------|
| `web/api/tests/editorial.test.js` | **New file** — editorial API route tests |
| `web/api/tests/editorial-chat.test.js` | **New file** — editorial chat context assembly + streaming tests |

**No modifications to any existing pipeline scripts or config files.**

## 10. Build order

### Phase A: Foundation (state documents + ANALYSE)

This is the highest-value phase — it replaces the manual Claude.ai sessions.

| Step | Task | Owner | Dependencies | Parallel? |
|------|------|-------|-------------|-----------|
| A1 | Create `data/editorial/` directory structure + `config/editorial-sources.yaml` (podcast sources, cost budget cap) | Dev | None | — |
| A2 | Export master state documents from Claude.ai Project, convert to `state.json` | **Scott** | None | ∥ with A1 |
| A3 | Extract Brightbeam editorial prompt, save as `config/prompts/editorial-context.v1.txt` | **Scott** | None | ∥ with A1 |
| A4 | Save Week 12 published newsletter as `output/editorial-draft-week-12.md` (quality reference) | **Scott** | None | ∥ with A1 |
| A5 | Write `scripts/lib/editorial-state.js` — state read/write/validate/render | Dev | A2 (needs format reference) |
| A6 | Write `scripts/lib/editorial-context.js` — context assembly | Dev | A3, A5 | — |
| A7 | Write `config/prompts/editorial-analyse.v1.txt` — ANALYSE prompt with JSON schema | Dev | A3 | ∥ with A5, A6 |
| A8 | Write `scripts/lib/editorial-multi-model.js` — Opus/Gemini/GPT clients | Dev | None | ∥ with A5–A7 |
| A9 | Write `scripts/editorial-analyse.js` — main ANALYSE pipeline (includes locking, startup validation, enrichment, compaction per §4.4) | Dev | A5, A6, A7, A8 | — |
| A10 | Test: process 3 transcripts, compare output to Session 15 quality | Dev + Scott | A9 | — |
| A11 | Iterate: Scott reviews output, provides feedback, prompts are adjusted | Dev + Scott | A10 | — |

**Gate:** Phase A complete when Scott accepts 3 consecutive ANALYSE outputs without structural edits.

### Phase B: News discovery

| Step | Task | Dependencies | Parallel? |
|------|------|-------------|-----------|
| B1 | Write `scripts/editorial-discover.js` | A9 (produces story refs) | — |
| B2 | Test: process story references from Phase A runs | B1 | — |
| B3 | Verify articles land in `data/verified/{date}/general/` with correct format | B2 | — |

### Phase C: Newsletter draft + critique

| Step | Task | Dependencies | Parallel? |
|------|------|-------------|-----------|
| C1 | Write `config/prompts/editorial-draft.v1.txt` | A11 (validated ANALYSE) | — |
| C2 | Write `config/prompts/editorial-critique.v1.txt` | A3 (editorial context) | ∥ with C1 |
| C3 | Write `scripts/editorial-draft.js` — full draft pipeline | C1, C2, A8 | — |
| C4 | Test: produce Week 12 draft, compare to Scott's published version | C3, A4 | — |
| C5 | Iterate: Scott reviews draft output, adjusts prompts | C4 | — |
| C6 | Test critique loop: compare v1 and final drafts | C5 | — |

**Gate:** Phase C complete when draft output requires only sub-editing from Scott.

**Note on critique loop:** If single-pass Opus drafts (v1) are consistently good enough that the critique loop produces marginal improvement, the critique stages can be disabled via config flag. The infrastructure exists but the cost may not justify the value.

### Phase D: Publication tracking

| Step | Task | Dependencies |
|------|------|-------------|
| D1 | Write `scripts/editorial-track.js` | A5 (state utilities) |
| D2 | Test: full end-to-end cycle — ANALYSE → DISCOVER → DRAFT → TRACK | C5, B3, D1 |

### Phase E: Web UI integration

Phase E is subdivided into 5 sub-phases. All web work is on the `feature/web-ui` branch in `web/`.

#### Phase E1: Design system + API foundation

| Step | Task | Dependencies | Parallel? |
|------|------|-------------|-----------|
| E1.1 | Extend `tokens.css` — text hierarchy, spacing scale, transition, button/badge/tab tokens (§8.3.1) | None | — |
| E1.2 | Write `web/api/routes/editorial.js` — state document read endpoints: GET state, search, backlog, themes, notifications, status, cost, activity (§8.3.10) | A5 (state lib) | ∥ with E1.1 |
| E1.3 | Write `web/api/tests/editorial.test.js` — API route tests | E1.2 | — |
| E1.4 | Write shared components: `Toast.jsx`, `EmptyState.jsx`, `DraftLink.jsx` | E1.1 | ∥ with E1.2 |
| E1.5 | Extend Sidebar — rename Articles→Database, add Editorial nav item with badge, add footer status indicators | E1.1 | ∥ with E1.2 |

**Gate:** All editorial API read endpoints return correct data. Tests pass.

#### Phase E2: Editorial page + contextual chat

| Step | Task | Dependencies | Parallel? |
|------|------|-------------|-----------|
| E2.1 | Write `useEditorialState.js` hook — fetches state sections with filtering | E1.2 | — |
| E2.2 | Write `Editorial.jsx` + `Editorial.css` — 5-tab layout (State, Themes, Backlog, Decisions, Activity) | E2.1, E1.1 | — |
| E2.3 | Write `web/api/lib/editorial-chat.js` — context assembly per tab, Opus streaming | E1.2 | ∥ with E2.2 |
| E2.4 | Add POST `/api/editorial/chat` route + `editorial-chat.test.js` | E2.3 | — |
| E2.5 | Write `EditorialChat.jsx` + `EditorialChat.css` — 380px panel, streaming messages, context tags, draft links | E2.4 | — |
| E2.6 | Write `useEditorialChat.js` hook — message streaming, history, context switching | E2.5 | — |
| E2.7 | Integrate chat panel into Editorial page split layout | E2.2, E2.6 | — |
| E2.8 | Test: browse all 5 tabs, chat responds with tab-appropriate context | E2.7 | — |

**Gate:** All 5 Editorial tabs render correct data. Opus chat responds with contextual answers. Tab switching updates context tag.

#### Phase E3: Database page + Draft redesign

| Step | Task | Dependencies | Parallel? |
|------|------|-------------|-----------|
| E3.1 | Write `Database.jsx` + `Database.css` — 3 tabs (Articles, Podcasts, Flagged) | E1.1 | — |
| E3.2 | Write `usePodcasts.js` hook | E1.2 | ∥ with E3.1 |
| E3.3 | Redesign Draft page — 3-zone toolbar, version toggle, AI critique panel tab | E1.1 | ∥ with E3.1 |
| E3.4 | Remove deprecated Articles.jsx/Articles.css | E3.1 | — |
| E3.5 | Extend Dashboard — editorial summary card, post candidates card, cost stat card | E1.2, E1.4 | ∥ with E3.1 |
| E3.6 | Write `useNotifications.js` hook — polls notifications.json | E1.2 | ∥ with E3.5 |
| E3.7 | Test: Database shows articles + podcasts + flagged. Draft shows critique panel | E3.1, E3.3 | — |

**Gate:** Database page fully functional with all 3 tabs. Draft page shows AI critique panel. Dashboard shows editorial summary.

#### Phase E4: Click-to-draft + triggers + tracking

| Step | Task | Dependencies | Parallel? |
|------|------|-------------|-----------|
| E4.1 | Implement click-to-draft navigation (§8.3.8) — React Router state passing, Draft page location.state handling | E2.2, E3.3 | — |
| E4.2 | Add POST trigger endpoints — `/api/editorial/trigger/{analyse,discover,draft}` (§8.3.10) | E1.2 | ∥ with E4.1 |
| E4.3 | Write `useEditorialStatus.js` hook — polls lock status + progress | E4.2 | — |
| E4.4 | Wire trigger buttons on Activity tab + sidebar status indicators | E4.2, E4.3 | — |
| E4.5 | Add POST `/api/editorial/track` and PUT `/api/editorial/backlog/:id/status` endpoints | E1.2 | ∥ with E4.1 |
| E4.6 | Wire "Mark Published" and "Archive" buttons on Backlog tab | E4.5 | — |
| E4.7 | Test: click-to-draft from every source type. Trigger buttons spawn processes. Publication tracking updates state | E4.1, E4.4, E4.6 | — |

**Gate:** Click-to-draft works from all editorial elements. Trigger buttons spawn pipeline stages. Publication tracking from UI updates `published.json` and `state.json`.

#### Phase E5: Cross-cutting polish

| Step | Task | Dependencies | Parallel? |
|------|------|-------------|-----------|
| E5.1 | Write `SearchModal.jsx` — Cmd+K global search | E1.2 | — |
| E5.2 | Write `useKeyboardShortcuts.js` — register all shortcuts | E5.1 | — |
| E5.3 | Add loading skeletons to all data-fetching views | E2.2, E3.1 | ∥ with E5.1 |
| E5.4 | Add empty states to all filterable views | E2.2, E3.1 | ∥ with E5.1 |
| E5.5 | Add error boundary wrapper | None | ∥ with E5.1 |
| E5.6 | Add export buttons (Editorial state, Backlog, Draft) | E2.2, E3.3 | ∥ with E5.1 |
| E5.7 | Responsive breakpoints — sidebar collapse, chat panel collapse, draft stack | E2.7, E3.3 | — |
| E5.8 | Full integration test — end-to-end walkthrough of all pages | All E steps | — |
| E5.9 | Extend `web/api/lib/context.js` — editorial state in co-pilot context | E1.2 | ∥ with E5.1 |
| E5.10 | Test: co-pilot can reference state documents, backlog, themes | E5.9 | — |

**Gate:** All cross-cutting features functional. Vite builds clean (`cd web/app && bun run build` — 0 errors). All tests pass (`cd web/api && bun test`).

### 10.1 Deployment

New editorial scripts are developed on `feature/web-ui`. For launchd scheduling:
- Option A: Cherry-pick editorial scripts to `master` once Phase A gate is passed
- Option B: Configure launchd to run editorial scripts via absolute path, independent of branch
- Option C: Merge `feature/web-ui` to `master` (requires coordinating with the pipeline's launchd schedule)

Scott decides which approach during Phase A.

## 11. Risk register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| ANALYSE quality doesn't match manual sessions | HIGH | MEDIUM | Iterative prompt tuning in Phase A. Gate requires Scott's acceptance. Two-pass approach as fallback: extract facts first, synthesise against themes second |
| Context window tight for long transcripts + growing state | MEDIUM | LOW (now) → MEDIUM (at T40+) | Compaction strategy defined in §4.4. Budget monitored per call |
| Critique loop adds noise | LOW | MEDIUM | Retain pre/post comparison. Config flag to disable. Start simple, add if needed |
| News scraping hits paywalls | LOW | HIGH | Graceful degradation — log unfetchable, retain podcast context as fallback |
| State document corruption | HIGH | LOW | Atomic write-validate-swap. Timestamped backups before every mutation |
| API costs exceed budget | MEDIUM | LOW | $50/week cap. Prompt caching. Cost logged per run |
| Opus returns malformed JSON | MEDIUM | MEDIUM | Validate schema after parse. Retry with "return only valid JSON" instruction (existing pattern). Log failures |
| Theme overlap at T40+ | MEDIUM | MEDIUM | Retirement/consolidation flagged in Decision Log. Scott reviews quarterly |
| Editorial chat context overflow | MEDIUM | LOW | Tab-specific context assembly caps at ~15k tokens. Selective inclusion (summaries over full text). Monitor token counts per chat call |
| Click-to-draft content mismatch | LOW | MEDIUM | Draft page validates location.state on mount. Falls back to current week's draft if source content cannot be resolved |
| Trigger button race condition | MEDIUM | LOW | Lock file check before spawn. 409 response if lock exists. UI disables button while lock active (10s poll) |
| Editorial page performance with large state | MEDIUM | MEDIUM | Virtualised list rendering for Analysis Index (125+ items). Pagination on API side (50 items/page). Theme evidence lazy-loaded on expand |
| Polling overhead at scale | LOW | LOW | `If-Modified-Since` headers. Stale-while-revalidate pattern. Longest interval (60s) for cost; shortest (10s) for lock status only |

## 12. Appendix: Prerequisites checklist

Before implementation begins, Scott must provide:

| Artifact | Destination | Notes |
|----------|------------|-------|
| Master state documents (accumulated across Sessions 1-15) | `data/editorial/state.json` (converted from markdown) | Developer writes conversion script; Scott provides the source markdown masters |
| Brightbeam editorial prompt | `config/prompts/editorial-context.v1.txt` | Full prompt, not abbreviated. Extract from Claude.ai Project |
| Week 12 published newsletter | `output/editorial-draft-week-12.md` | Quality reference for Phase C testing |
| Confirmation of published items (post IDs, dates) | `data/editorial/published.json` | Seed the tracking file with already-published posts (#43, #71) |
