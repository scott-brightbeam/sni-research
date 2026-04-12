# PRD: SNI Editorial Intelligence System

**Date:** 2026-03-20
**Author:** Scott Wilkinson + Claude
**Status:** Draft v2 (post-review)
**Branch:** `feature/web-ui` (development); `master` (deployment — see §10.1)

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
**Trigger:** Manual (`bun scripts/editorial-analyse.js ~/Desktop/Podcast\ Transcripts/*.md`) or launchd `WatchPaths` on the transcript directory
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
**Trigger:** Manual (`bun scripts/editorial-discover.js --session 16`) or called automatically after ANALYSE
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
**Trigger:** Manual (`bun scripts/editorial-draft.js --week 12`) or launchd (Thursday 18:00)
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
**Trigger:** Manual (Scott runs after publishing)

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

New API routes in `web/api/routes/editorial.js`:
- `GET /api/editorial/state?section=themeRegistry` — returns state document section
- `GET /api/editorial/search?q=recursive+self-improvement` — searches Analysis Index
- `GET /api/editorial/backlog?priority=high` — filtered post backlog
- `GET /api/editorial/render?section=analysisIndex` — renders JSON state to readable markdown

The co-pilot context assembly (`web/api/lib/context.js`) is extended to include editorial state. The TOKEN_BUDGET (currently 64k) is reviewed — may need to increase for editorial context, or use selective inclusion (e.g., only this week's Analysis Index entries + theme definitions without evidence).

The API route reads from `data/editorial/` (JSON files) — does NOT import pipeline modules.

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

| File | Change |
|------|--------|
| `web/api/routes/editorial.js` | **New file** — editorial state API endpoints |
| `web/api/lib/context.js` | Extended — include editorial state in co-pilot context |

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

| Step | Task | Dependencies |
|------|------|-------------|
| E1 | Write `web/api/routes/editorial.js` — state document API | A5 |
| E2 | Extend `web/api/lib/context.js` — editorial state in co-pilot | E1 |
| E3 | Test: co-pilot can reference state documents, backlog, themes | E2 |

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

## 12. Appendix: Prerequisites checklist

Before implementation begins, Scott must provide:

| Artifact | Destination | Notes |
|----------|------------|-------|
| Master state documents (accumulated across Sessions 1-15) | `data/editorial/state.json` (converted from markdown) | Developer writes conversion script; Scott provides the source markdown masters |
| Brightbeam editorial prompt | `config/prompts/editorial-context.v1.txt` | Full prompt, not abbreviated. Extract from Claude.ai Project |
| Week 12 published newsletter | `output/editorial-draft-week-12.md` | Quality reference for Phase C testing |
| Confirmation of published items (post IDs, dates) | `data/editorial/published.json` | Seed the tracking file with already-published posts (#43, #71) |
