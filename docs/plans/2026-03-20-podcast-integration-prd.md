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
| No pipeline modifications | All existing `scripts/` behaviour unchanged; new scripts added alongside |
| Prompts empirically validated | All three LLM prompts tested and iterated to meet accuracy thresholds before code integration |

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
            data/podcasts/    Story extraction     data/verified/
            (transcripts +    (AI Daily Brief      (gap-fill articles
             digests)          + Moonshots only)    tagged podcast-extract)
                    │                                   │
                    ▼                                   ▼
              Co-pilot context              Existing score/draft pipeline
              (digests + full                (these articles skip scoring)
               transcript on demand)
                    │
                    ▼
           ┌───────────────────┐
           │  Overlap Checker  │
           │  (UI button,      │
           │   pre-publish)    │
           └───────────────────┘
```

### Constraints (inherited from project)

- All new code in `web/` or `scripts/` — pipeline scripts never modified.
- Runtime: Bun, ES modules, sync file I/O.
- No external services — all data is local files. No database.
- API server reads data directories — never imports pipeline modules.
- Web UI on `feature/web-ui` branch; pipeline runs from `master` via launchd.

## 4. Transcript pipeline dependency

The external transcript pipeline must add a `**URL:**` field to its markdown frontmatter. This is a **hard dependency** for the newsletter linking feature.

### Expected frontmatter format (after update)

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

### Handling missing URLs

- Import proceeds without URL (backward compatibility with existing transcripts).
- A warning is logged: `WARN: No URL in frontmatter for <filename>`.
- The episode is not linkable in newsletter output.
- The digest JSON stores `episodeUrl: null`.

## 5. Component design

### 5.1 Podcast import script — `scripts/podcast-import.js`

**Trigger:** Separate launchd job, daily at 07:00 local time.

**Plist:** `com.sni.podcast-import.plist`, symlinked to `~/Library/LaunchAgents/`.

```xml
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
```

**Input:** `~/Desktop/Podcast Transcripts/*.md`

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
    "storiesExtracted": true,
    "storiesCount": 7,
    "isTrustSource": true
  }
}
```

If a filename already exists in the manifest, the file is skipped entirely. This handles the user not moving files to `Previous/` — the import is idempotent.

**Processing steps per new file:**

1. **Parse frontmatter** — extract Date, Source, URL, Duration, Title (from H1).
2. **Determine editorial week** — using `getWeekNumber()` from `scripts/lib/week.js`.
3. **Copy transcript** — to `data/podcasts/<date>/<podcast-slug>/<title-slug>.md`.
4. **Generate digest** — LLM call using `transcript-digest` prompt (see §6). Save as `.digest.json` alongside.
5. **Story extraction** (AI Daily Brief and Moonshots only) — LLM call using `story-extract` prompt (see §6). For each extracted story, run gap-fill (see §5.2).
6. **Update manifest** — write entry for this file.

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

**Error handling:**

- Frontmatter parse failure → log error, skip file, do not add to manifest (will retry next run).
- LLM call failure (digest or extraction) → log error, save transcript without digest, do not mark as digested in manifest (will retry digest on next run).
- File I/O failure → log error, skip file, do not add to manifest.
- Partial completion is safe — manifest only updates after successful processing.

**Logging:** Same format as main pipeline. Structured log lines with timestamps.

```
[07:00:05] Scanning ~/Desktop/Podcast Transcripts/
[07:00:05] Found 17 files, 3 new (14 already imported)
[07:00:05] Importing: 2026-03-19-ai-daily-brief-what-people-really-want-from-ai.md
[07:00:06]   Source: AI Daily Brief | Date: 2026-03-19 | Week: 12
[07:00:06]   Trust source: yes — will extract stories
[07:00:12]   Digest generated (847 tokens)
[07:00:18]   Stories extracted: 6 identified
[07:00:19]     "NVIDIA GTC announcements" — MATCH (existing: nvidia-gtc-2026-jensen-huang.json)
[07:00:20]     "OpenAI Dispatch feature" — NO MATCH — fetching https://...
[07:00:25]     Saved to data/verified/2026-03-19/general/openai-dispatch-feature.json
[07:00:25]   ✓ Import complete
```

### 5.2 Story gap-fill

Runs as part of podcast import for trust sources only.

**Input:** Structured story list from `story-extract` prompt.

**For each extracted story:**

1. **URL match** — if the story has a URL, check all articles in `data/verified/` for the editorial week by exact URL. If found, skip.
2. **Tier 1 headline match** — compute normalised token overlap between the extracted story headline and all article titles in the week. The similarity threshold is empirically determined during the prompt development phase (see §7). Any pair above the threshold proceeds to Tier 2.
3. **Tier 2 content match** — LLM call using `content-match` prompt (see §6). Sends the extracted story description + the candidate article's snippet/full_text. Returns: `{ sameStory: boolean, confidence: number, explanation: string }`. If `sameStory: true` with confidence above a calibrated threshold, skip.
4. **Fetch and save** — if no match found and a URL is available:
   - Fetch the page using existing `fetchPage()` from `scripts/lib/extract.js`.
   - Extract text using `extractArticleText()`.
   - Save using `saveArticle()` with metadata:
     ```json
     {
       "found_by": ["podcast-extract"],
       "podcast_source": "AI Daily Brief",
       "podcast_episode": "How to Use Agent Skills",
       "podcast_episode_url": "https://...",
       "podcast_extract_confidence": 0.95,
       "skip_scoring": true
     }
     ```
   - The `skip_scoring` flag tells the score stage to leave this article as-is. It enters the corpus as pre-approved editorial content.
5. **No URL** — log as 'podcast-mentioned, unfetched'. Stored in the manifest's story list for editorial reference but does not enter the article corpus.

**Applying two-tier matching to existing dedup:**

The two-tier matching system is also applied to:

- **Fetch dedup** (`scripts/fetch.js`) — currently URL-only. Add Tier 1 + Tier 2 as a fallback when URLs differ but stories might be the same. This catches the common case of multiple outlets covering the same press release with different URLs.
- **Discover gap-fill** (`scripts/discover.js`) — currently uses its own matching. Standardise on the same two-tier system.

Implementation: extract the matching logic into a shared module `scripts/lib/dedup.js` that all three callers use.

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
  "sector_tags": ["general-ai", "manufacturing"],
  "key_stories": [
    {
      "headline": "Anthropic maps 28,000+ agent skills into nine categories",
      "entities": ["Anthropic", "Claude"],
      "sector": "general-ai",
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

#### Token budget increase

- `TOKEN_BUDGET` changes from `28000` to `64000`.
- This accommodates: article context (~10k) + podcast digests (~7k) + full transcript on demand (~8k) + pins (~2k) + thread history (~35k remaining).

#### Full transcript on demand

- The existing article picker in the Co-pilot UI is extended to also list podcast episodes for the current week.
- When selected, `loadPodcastFullText(date, podcastSlug, titleSlug)` reads the full `.md` transcript and injects it into context, capped at 16,000 characters (increased from the 8,000 char article cap, since transcripts are longer and less dense).
- Only one full transcript or full article can be injected at a time (same constraint as today).

#### Context assembly order (updated)

```
1. System prompt (COPILOT_SYSTEM or DRAFT_SYSTEM)
2. Article context (top 30 detailed + rest title-only)
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

1. **Parse current draft** — split into story sections by H2/H3 headings. Extract: heading text, body text, any cited sources/URLs.
2. **Load archive** — scan `output/` for all `draft-week-*.md` files. For each, check for a `published` flag (file metadata or companion JSON). Use published version if flagged, otherwise latest draft. Exclude the current week.
3. **Extract archived story summaries** — for each archived draft, split into story sections (same heading-based parser). Cache these summaries in `output/overlap-cache/week-{N}.json` so they're only computed once.
4. **Tier 1 scan** — for each current story section vs each archived story section, compute normalised token overlap on headings. Pairs above the empirically calibrated threshold proceed to Tier 2.
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

**UI display:**

- Results appear in a slide-out panel on the right side of the draft editor (similar to the existing review overlay pattern).
- Each overlap is a card showing:
  - The current section heading (clickable — scrolls to it in the editor)
  - The matched section heading + week number
  - Confidence badge (colour-coded: >0.8 red, 0.5–0.8 amber, <0.5 grey)
  - The LLM explanation
  - A 'Dismiss' button to mark as reviewed
- Summary bar at top: 'N overlaps found across M previous editions'
- If no overlaps: green banner 'No content overlap detected'

**Published flag convention:**

The system identifies published drafts by checking for a companion file `output/draft-week-{N}.published` (empty marker file). When the editor publishes (existing or future workflow), this file is created. Where no `.published` marker exists, the latest `draft-week-{N}*.md` (by version suffix or modification time) is treated as canonical.

## 6. Prompt design

All prompts live in `config/prompts/` as versioned text files, loaded at runtime by the import script. This separates prompt engineering from code.

### 6.1 `config/prompts/story-extract.v1.txt`

**Purpose:** Extract structured news stories from AI Daily Brief and Moonshots transcripts.

**Input:** Full transcript text.

**Output:** JSON array of story objects.

**Prompt structure:**

```
You are a news analyst extracting structured story references from a podcast transcript.

## Task
Identify every distinct news story, product launch, company announcement, research finding, or significant industry development mentioned in this transcript. Include stories from headline segments, deep-dive segments, and passing references.

## Output format
Return a JSON array. Each element:
{
  "headline": "Short descriptive headline for the story (max 15 words)",
  "entities": ["Company or person names central to the story"],
  "url": "URL if explicitly mentioned in the transcript, otherwise null",
  "date_context": "When this happened, if mentioned (e.g. 'this week', 'March 17', 'yesterday')",
  "sector": "Most likely SNI sector: general-ai | biopharma | medtech | manufacturing | insurance",
  "detail": "2-3 sentence summary of what was said about this story",
  "confidence": "high | medium — how clearly this was identified as a distinct story vs background commentary"
}

## Rules
- Include ALL stories, even briefly mentioned ones. Err on the side of inclusion.
- Do NOT include: sponsor reads, self-promotion, meta-commentary about the podcast itself.
- If a story spans multiple segments (e.g. headline + later deep-dive), merge into one entry.
- Preserve the podcast's framing — capture what the host said was important about the story.
- If a URL is read aloud or shown on screen (referenced in transcript), include it exactly.
- For sector classification, use these definitions:
  - general-ai: AI industry broadly, foundational models, AI companies, regulation, compute infrastructure
  - biopharma: AI in drug discovery, clinical trials, pharmaceutical R&D
  - medtech: AI in medical devices, clinical decision support, health IT, diagnostics
  - manufacturing: AI in industrial automation, robotics, supply chain, digital twins
  - insurance: AI in underwriting, claims, risk assessment, insurtech

## Few-shot examples

<example_input>
...Jensen Huang has kicked off GTC with a massive prediction that the company will see a trillion dollars in revenue between now and 2027...
</example_input>

<example_output>
[
  {
    "headline": "NVIDIA CEO predicts $1 trillion revenue by 2027 at GTC",
    "entities": ["NVIDIA", "Jensen Huang"],
    "url": null,
    "date_context": "GTC 2026, this week",
    "sector": "general-ai",
    "detail": "Jensen Huang opened GTC 2026 with a prediction that NVIDIA will reach $1 trillion in cumulative revenue by 2027, highlighting the scale of AI infrastructure demand.",
    "confidence": "high"
  }
]
</example_output>

## Transcript

{transcript}
```

### 6.2 `config/prompts/content-match.v1.txt`

**Purpose:** Determine whether two pieces of content describe the same news story.

**Input:** Story A text + Story B text.

**Output:** Match assessment.

**Prompt structure:**

```
You are a news deduplication analyst. Determine whether two pieces of content describe the SAME specific news story or event.

## Definitions
- SAME STORY: Both pieces cover the same specific event, announcement, or development. Example: two articles about "OpenAI acquiring Windsurf" are the same story even if they emphasise different aspects.
- RELATED BUT DIFFERENT: Both cover the same broad topic but describe different events. Example: "OpenAI launches GPT-5.4" and "OpenAI pivots to enterprise" are related but different stories.
- UNRELATED: No meaningful connection.

## Output format
Return JSON:
{
  "sameStory": true | false,
  "confidence": 0.0 to 1.0,
  "explanation": "One sentence explaining your reasoning"
}

## Rules
- Be STRICT about "same story". Two articles about AI regulation are NOT the same story unless they cover the same specific regulation, vote, or announcement.
- Recurring themes (e.g. "AI is transforming healthcare") appearing in multiple weeks are NOT duplicates.
- Follow-up coverage IS a potential duplicate if it's recapping the same event rather than reporting new developments.
- A higher confidence means you are more certain of your judgement (whether match or non-match).

## Story A
{story_a}

## Story B
{story_b}
```

### 6.3 `config/prompts/transcript-digest.v1.txt`

**Purpose:** Generate a structured summary of a podcast transcript.

**Input:** Full transcript text + podcast metadata.

**Output:** Structured digest JSON.

**Prompt structure:**

```
You are an editorial analyst creating a structured digest of a podcast episode for use in an AI news intelligence system.

## Task
Summarise this podcast transcript into a structured digest that captures the key stories, notable quotes, and themes discussed. The digest will be used by an editorial co-pilot to provide context when drafting newsletters and LinkedIn posts.

## Output format
Return JSON:
{
  "sector_tags": ["Array of relevant SNI sectors: general-ai, biopharma, medtech, manufacturing, insurance"],
  "key_stories": [
    {
      "headline": "Short descriptive headline (max 15 words)",
      "entities": ["Key company/person names"],
      "sector": "primary sector",
      "url": "URL if mentioned, otherwise null"
    }
  ],
  "notable_quotes": [
    {
      "speaker": "Name or 'Host' if unnamed",
      "quote": "Exact quote from the transcript (max 50 words, preserve original wording)",
      "context": "Brief context for when/why this was said"
    }
  ],
  "themes": ["High-level theme labels, max 5"],
  "summary": "200-word narrative summary capturing the episode's key arguments and insights. Written in present tense, analytical tone."
}

## Rules
- Capture ALL distinct news stories mentioned, not just the main topic.
- Select quotes that are insightful, surprising, or quotable — not filler.
- Limit to 3-5 quotes per episode.
- Themes should be abstract enough to connect across episodes (e.g. "enterprise AI adoption" not "Jensen Huang's GTC keynote").
- The summary should be useful to an editor deciding whether to reference this episode in a newsletter.
- Sector tags: include ALL sectors touched by the episode, not just the primary one.

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
- Manually listen/read each and list every news story mentioned (ground truth).
- Label each with: headline, entities, URL if mentioned, sector.

**For content matching (`content-match`):**
- Take real stories from draft weeks 8–12. Extract story sections by heading.
- Manually label ~50 pairs across three categories:
  - **Same story** (~15 pairs): genuine duplicates from different sources or weeks.
  - **Related but different** (~15 pairs): same topic, different events.
  - **Unrelated** (~20 pairs): no meaningful connection.
- Include edge cases: same event covered from different angles, follow-up stories, recurring themes (e.g. 'AI regulation' appearing weekly but covering different developments).

**For transcript digest (`transcript-digest`):**
- Take 4–6 transcripts from different podcasts.
- Manually identify: key stories, best quotes, themes.
- Evaluate digest quality subjectively (does it capture what an editor would care about?).

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
| `story-extract` | Recall (stories found / stories in ground truth), precision (valid stories / total extracted), false positives |
| `content-match` | True positive rate, false positive rate, false negative rate, optimal confidence threshold |
| `transcript-digest` | Manual quality score (1–5), story coverage (stories captured / stories in ground truth), quote relevance |

### 7.3 Threshold calibration for Tier 1 similarity

The headline similarity threshold for Tier 1 (which determines what goes to the LLM for Tier 2) must be empirically determined:

1. Compute normalised token overlap for all labelled pairs in the content-match dataset.
2. Sweep thresholds from 2% to 30% in 1% increments.
3. At each threshold, measure:
   - **Recall**: what fraction of true 'same story' pairs would be sent to Tier 2?
   - **Tier 2 load**: how many pairs total would be sent to Tier 2?
4. Select the threshold that achieves **100% recall** (never misses a true duplicate) with the lowest Tier 2 load.
5. If no threshold achieves 100% recall, the Tier 1 matching algorithm needs redesign (e.g. add entity matching alongside token overlap).

The chosen threshold is stored in `config/prompts/thresholds.yaml`:

```yaml
tier1_headline_similarity: 0.12  # empirically determined, see test results
tier2_confidence_threshold: 0.65  # minimum confidence to flag as duplicate
calibrated_at: 2026-03-22
test_results:
  recall: 1.0
  tier2_load: 23  # pairs sent to tier 2 out of 50
  false_positive_rate: 0.04
```

### 7.4 Iteration protocol

1. Run test harness with v1 prompts.
2. Analyse failures — which stories were missed? Which matches were wrong?
3. Revise prompt (add examples, adjust instructions, clarify edge cases).
4. Bump version: `story-extract.v2.txt`.
5. Re-run test harness.
6. Repeat until targets met (minimum 3 iterations).
7. Document final metrics alongside the committed prompt.

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
│   ├── 2026-03-18/
│   │   ├── ai-daily-brief/
│   │   │   ├── how-to-use-agent-skills.md          (full transcript)
│   │   │   └── how-to-use-agent-skills.digest.json  (structured digest)
│   │   └── big-technology-podcast/
│   │       ├── are-we-screwed-if-ai-works.md
│   │       └── are-we-screwed-if-ai-works.digest.json
│   └── 2026-03-19/
│       └── ...
├── verified/                    (existing — gap-fill articles land here)
│   ├── 2026-03-18/
│   │   ├── general/
│   │   │   ├── existing-article.json
│   │   │   └── openai-dispatch-feature.json  ← podcast-extract article
│   │   └── ...
│   └── ...
└── test/                        (prompt evaluation datasets)
    ├── story-extract-labels.json
    ├── content-match-labels.json
    └── digest-labels.json
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
      "digest": { ... }
    }
  ]
}
```

**`GET /api/podcasts/transcript?date={YYYY-MM-DD}&source={slug}&title={slug}`**

Returns the full transcript text for injection into co-pilot context.

**`POST /api/draft/check-overlap?week={N}`**

Runs the overlap checker. Returns the overlap report (see §5.5).

### 9.2 Modified endpoints

**`POST /api/chat`** — context assembly updated to include podcast digests and support podcast transcript injection.

**`GET /api/draft?week={N}`** — response extended with `podcastEpisodes` count for the week, so the draft editor can show podcast availability.

## 10. UI changes

### 10.1 Draft Editor — Overlap Checker

- **Button:** 'Check Overlap' next to the existing review pill in the toolbar.
- **Loading state:** Button shows spinner + 'Checking...' while the API call runs.
- **Results panel:** Slide-out panel on the right (same pattern as review highlights).
- **Empty state:** Green banner 'No content overlap detected ✓'.
- **Overlap cards:** As described in §5.5.

### 10.2 Co-pilot — Podcast Picker

- The existing article picker dropdown is extended with a 'Podcasts' section.
- Lists all episodes for the current week with: title, source, date.
- Selecting an episode injects its full transcript into the co-pilot context.
- Visual indicator on selected episode (same as selected article today).

### 10.3 Dashboard — Podcast Status

- A new card or row on the dashboard showing: episodes imported this week, last import time, any import warnings.
- Links to the podcast list view if we add one (stretch goal — not in this PRD).

## 11. Configuration

### 11.1 New config files

**`config/podcast-trust-sources.yaml`**

```yaml
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

**`scripts/lib/dedup.js`** — new shared module used by:

- `scripts/podcast-import.js` (story gap-fill matching)
- `scripts/fetch.js` (article dedup — enhanced with content matching)
- `scripts/discover.js` (discovery dedup — standardised)
- `web/api/routes/draft.js` (overlap checker)

**Exports:**

```javascript
/**
 * Tier 1: headline similarity using normalised token overlap.
 * @param {string} headlineA
 * @param {string} headlineB
 * @returns {number} Similarity score 0.0–1.0
 */
export function headlineSimilarity(headlineA, headlineB) { ... }

/**
 * Tier 2: LLM-based content matching.
 * @param {string} contentA — story text or article text
 * @param {string} contentB — story text or article text
 * @returns {Promise<{sameStory: boolean, confidence: number, explanation: string}>}
 */
export async function contentMatch(contentA, contentB) { ... }

/**
 * Full two-tier dedup check.
 * @param {object} candidate — { headline, content }
 * @param {Array<object>} corpus — [{ headline, content, metadata }]
 * @param {object} thresholds — { tier1: number, tier2: number }
 * @returns {Promise<{matched: boolean, matchedItem: object|null, tier: 1|2, confidence: number, explanation: string}>}
 */
export async function checkDuplicate(candidate, corpus, thresholds) { ... }
```

## 13. Deployment

### 13.1 Branch strategy

- All development on `feature/web-ui` branch (existing).
- Pipeline-side scripts (`scripts/podcast-import.js`, `scripts/lib/dedup.js`, `com.sni.podcast-import.plist`) are cherry-picked or checked out onto `master` when ready, same as the Fri–Thu reorientation deployment.
- Web UI changes stay on `feature/web-ui`.

### 13.2 Launchd setup

After merging pipeline scripts to `master`:

```bash
ln -s /Users/scott/Projects/sni-research-v2/com.sni.podcast-import.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.sni.podcast-import.plist
```

### 13.3 Transcript pipeline update

The user updates their external transcript pipeline to include `**URL:**` in frontmatter. This is a prerequisite for the linking feature but not a blocker for import/digest/extraction.

## 14. Testing strategy

### 14.1 Prompt evaluation (pre-integration)

As described in §7. Standalone test harness, manually labelled data, iterative refinement.

### 14.2 Unit tests

| Module | Tests |
|---|---|
| `scripts/lib/dedup.js` | `headlineSimilarity()` — edge cases (empty, identical, partial overlap, unicode). `contentMatch()` — mocked LLM responses. `checkDuplicate()` — tier routing logic. |
| `scripts/podcast-import.js` | Frontmatter parsing (all fields, missing URL, malformed). Manifest dedup (new file, existing file, retry after failure). Trust source identification. |
| `web/api/routes/draft.js` | Overlap checker endpoint — mocked dedup module. Draft section parser. Archive loading with published flag logic. |
| `web/api/lib/context.js` | `buildPodcastContext()` — digest loading, token estimation, empty week. Updated `assembleContext()` with 64k budget. |

### 14.3 Integration tests

- Import a real transcript → verify digest generated → verify manifest updated.
- Import a trust source transcript → verify stories extracted → verify gap-fill articles created in `data/verified/`.
- Run overlap checker against real drafts → verify results structure.
- Co-pilot chat with podcast context → verify digests appear in assembled context.

### 14.4 Existing test suite

The existing 68 tests (279 assertions) must continue to pass. The token budget change will require updating any tests that assert on the 28k value.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Transcript pipeline doesn't add URL field | Episodes not linkable in newsletter | Import works without URL; warning logged; linking degrades gracefully |
| LLM story extraction misses stories | Gap-fill incomplete | >90% recall target; manual spot-checking; prompts iterated |
| Content match false negatives | Duplicates slip through | Tier 1 threshold calibrated for 100% recall; Tier 2 is safety net |
| Content match false positives | Editor wastes time dismissing | <10% FP target; dismiss button in UI; threshold tuned |
| Large transcript blows co-pilot context | Thread history squeezed | 64k budget; digests are compact; full transcript is opt-in |
| Manifest corruption | Re-imports or missed imports | JSON write-validate pattern (write .tmp, parse back, rename). Manifest is append-only. |
| API cost from LLM calls | Unexpected spend | Story extraction is 2 episodes/day max; content match is shortlist-only; usage tracked |

## 16. Out of scope

- Modifying the external transcript pipeline (beyond the URL frontmatter request).
- Automatic LinkedIn post generation (co-pilot is interactive, not automated).
- Podcast-specific UI page (stretch goal for future phase).
- Audio playback or embedded players.
- Modifying existing pipeline scripts' core logic (dedup enhancement is additive, via the shared module).

## 17. Open questions

None. All design decisions have been resolved through the brainstorming process.

## 18. Glossary

| Term | Definition |
|---|---|
| **Trust source** | A podcast whose editorial curation is trusted — stories mentioned are pre-approved for the corpus without scoring |
| **Digest** | A ~1k token structured summary of a podcast episode, generated by LLM |
| **Gap-fill** | The process of identifying stories mentioned in trust source podcasts that are missing from the article corpus, then fetching them |
| **Tier 1** | Fast headline similarity check using normalised token overlap |
| **Tier 2** | LLM-based content comparison for precise same-story determination |
| **Overlap checker** | Pre-publish tool comparing the current draft against all previous editions for content duplication |
| **Manifest** | JSON file tracking which transcripts have been imported and processed |
