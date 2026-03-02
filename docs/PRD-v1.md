# SNI automation: product requirements document

## Problem statement

The SNI weekly report takes a full working day to produce manually. The process involves searching for stories across five sectors, verifying publication dates, cross-checking against previous weeks, writing 3,000–4,000 words of analysis and checking every hyperlink. Most of this labour is repetitive and mechanisable. The creative judgement – theme selection, editorial voice, what matters and what doesn't – is where the human time should go.

A research methodology doc and tool specification already exist (SNI-Research-Methodology.md). An automated research tool has been built against this specification at `~/Projects/sni-research-v2`. The gap analysis below maps what exists against what's needed for the full 7-step automated pipeline.

## Existing app: what's already built

The app at `sni-research-v2` is a JavaScript/Bun application with six scripts, a Chrome browser extension and a macOS menubar app. It covers roughly 60% of the infrastructure needed for full automation. Here's what exists.

### Automated fetch pipeline (fetch.js – 418 lines)

RSS feed monitoring across nine feed categories (biopharma, medtech, manufacturing, insurance, cross-sector, AI labs, tech press, newsletters, wire services) with 23 active RSS feeds. Brave Search integration for general AI news using 22 pre-defined queries with `freshness=pw` (past week). URL deduplication across all sources. Rate limiting at 1.5 seconds between requests. Paywall detection against a configurable domain list. Content length gate (300 chars minimum – rejects thin/paywalled pages). Configurable date windows via CLI flags (`--test`, `--start-date`, `--end-date`, `--sector`). Run stats saved to JSON after each execution.

### Date verification (verify.js – 251 lines)

Eight-method priority chain fully implemented: RSS pubDate, schema.org JSON-LD, Open Graph `article:published_time`, meta tags (`date`, `publish_date`, `article:published_time`), HTML `<time>` elements, URL date patterns (compact, slashes, dashes, stories-prefix), visible date text parsing (four format patterns) and HTTP `Last-Modified` headers. Each method returns a confidence level (high, medium, low). Date normalisation handles multiple input formats. Window checking validates against start/end date range.

### Sector categorisation (categorise.js – 173 lines)

Dual-group keyword matching: articles must match at least one term from each of two required-any groups per sector. Boost terms provide tiebreaking between sectors. Matching runs against title + first 800 characters only (prevents deep-article false positives). Source-sector hints from RSS feeds override when they match. Five sectors fully defined in `config/sectors.yaml` with display names, required groups and boost terms. General AI is the fallback for frontier news with no clear sector match.

### Off-limits checking (categorise.js)

Company + topic matching against a cumulative YAML config. Both must appear in title + first 500 characters. Topic keyword matching uses a 50% threshold (at least half the topic words must appear). Week 7 and Week 8 entries are already loaded; Week 9 entries exist but need adding to `config/off-limits.yaml`.

### Relevance scoring (score.js – 452 lines)

Two-mode scorer. LLM mode uses Claude Haiku 4.5 via the Anthropic API – sends title + 300-char snippet with a sector-specific relevance prompt, expects JSON response with `relevant`, `confidence` and `reason`. Heuristic fallback mode (zero cost) uses regex-based AI signal detection in titles and snippets, plus negative title patterns (people moves, legal matters, weather, sports, financial results with no AI angle). Articles scored as irrelevant are moved to `data/review/` with a reason file – never deleted. Dry-run mode available for preview.

### Research pack generation (report.js – 309 lines)

Reads verified articles from `data/verified/`, groups by sector, deduplicates by URL, runs off-limits check, generates a structured markdown research pack with headlines overview, per-sector story details (title, URL, source, published date, verification method, confidence, snippet), off-limits conflict report and collection statistics. Outputs to `output/` directory.

### Manual article ingestion (server.js + ingest.js + Chrome extension)

Local HTTP server on port 3847 accepts POST requests to `/ingest` with URL and optional pre-captured HTML. Runs the same pipeline as the automated fetcher (fetch, parse, date verify, categorise, off-limits check, duplicate check, save) but with a lower content gate (100 chars vs 300) since the user explicitly chose the article. CLI wrapper (`ingest.js`) for terminal-based ingestion. Chrome extension (Manifest V3) adds a save button to Google Search results pages – captures the rendered HTML from the active tab and sends it to the local server with optional sector override. macOS menubar app (Python/rumps) manages the server lifecycle with auto-restart on crash, health checks every 5 seconds, and menu items for data folder access and log viewing.

### Article storage

Three-tier storage: `data/verified/{date}/{sector}/` for confirmed articles (JSON metadata + markdown + raw HTML), `data/flagged/` for articles with unverified dates, `data/review/` for articles scored as irrelevant. Each article gets a slugified filename. JSON includes full metadata (title, URL, source, source_type, date_published, verification method, confidence, sector, keywords, snippet, full text, scrape timestamp).

## Gap analysis: what exists vs what's needed

The table below maps Scott's 7-step workflow against the existing app.

### Step 1: Check for missed stories using multiple AI models

**Status: not built.** The current pipeline uses RSS feeds + Brave Search only. There is no multi-model story discovery. Building this requires: API integration with GPT-4o and Gemini Pro (or equivalent), a prompt that takes the week's verified article list and asks each model to identify gaps, and a pipeline to run returned URLs through the existing verification chain. The existing `ingestArticle()` function in server.js could be reused for this – it already accepts a URL and runs the full pipeline.

### Step 2: Scrape returned URLs, read pages, add to library

**Status: fully built.** The fetch pipeline (fetch.js) and manual ingest pipeline (server.js) both handle URL fetching, HTML parsing, date verification, sector assignment, off-limits checking and article storage. The `ingestArticle()` function is the clean entry point for any new URL regardless of source.

### Step 3: Write the first draft

**Status: not built.** The report.js script generates a research pack (structured article summaries grouped by sector) but does not write editorial prose. The entire writing layer needs building: theme selection from the research pack, tl;dr generation with sector bullets, body section writing with analysis paragraphs, inline hyperlink embedding, style guide compliance and prohibited language avoidance. This is the largest new component.

### Step 4: Send draft to other AI models for evaluation

**Status: partially built.** The score.js script demonstrates working Anthropic API integration with structured prompts and JSON response parsing. The pattern (send content + evaluation prompt → parse JSON response) transfers directly to draft evaluation. What's missing: the evaluation prompt itself (rubric, weighted criteria, style guide reference), integration with GPT-4o and Gemini APIs, and response aggregation logic.

### Step 5: Evaluate feedback – decide what to accept/reject

**Status: not built.** The orchestrator logic needs designing. The score.js accept/reject pattern (relevant → keep, not relevant → move to review) is a simpler version of what's needed. The draft evaluation orchestrator must handle nuanced feedback: factual corrections should almost always be accepted, stylistic suggestions need weighing against the style guide, structural changes need evaluating against the report format spec.

### Step 6: Update draft with accepted changes

**Status: not built.** Requires either a patch-based approach (apply specific edits to the markdown) or a regeneration approach (re-prompt the writing model with the accepted feedback). The regeneration approach is simpler and more reliable for a first version.

### Step 7: Notify Scott at 6am every Friday

**Status: not built.** No scheduling or notification infrastructure exists. The app runs on demand via CLI. Needs: a cron-like scheduler (cron job, launchd plist, or GitHub Actions), a notification sender (email, Slack or iMessage) and a pipeline orchestrator that chains fetch → score → draft → evaluate → revise → notify.

## Revised architecture

Given the existing app, the four-layer architecture maps as follows.

### Layer 1: Research engine (daily, Monday–Friday) – 80% built

The fetch pipeline, date verification, sector categorisation, off-limits checking and article storage are production-ready. The relevance scorer adds a quality filter. The Chrome extension and menubar app provide manual override capability.

**Remaining work:**

Update `config/off-limits.yaml` with Week 9 stories (currently only Weeks 7–8 are loaded).

Add a `--week` flag to fetch.js that calculates the Monday–Friday date window for a given ISO week number, simplifying scheduled runs.

Add a post-fetch step that runs score.js automatically (currently separate CLI invocation).

### Layer 2: Draft generation (Friday) – 0% built

This is the largest new component. It takes the research pack from report.js and produces a complete SNI report in markdown.

**What needs building:**

A `draft.js` script that: loads the verified + scored articles for the week, loads the style guide (prohibited language, formatting rules, structural template), loads the previous week's report as a structural reference, calls Claude (Opus or Sonnet) with a carefully constructed prompt requiring 3 candidate themes with reasoning before committing, generates the full report structure (welcome line, tl;dr with sector bullets, transition, body sections with story headings and analysis, closing line), and saves the draft to `output/`.

The prompt engineering is the critical path here. The theme selection prompt and the writing prompt need extensive testing against Weeks 8 and 9 data before going live.

### Layer 3: Multi-model evaluation (Friday) – 10% built

The Anthropic API integration pattern from score.js transfers. The structured-prompt-to-JSON-response pattern is proven.

**What needs building:**

API clients for GPT-4o and Gemini Pro. An evaluation rubric with weighted criteria covering: factual accuracy, style guide compliance, prohibited language detection, structural compliance, link validity, theme coherence, story selection quality. An orchestrator that aggregates feedback from all models, applies accept/reject logic with reasoning, and either patches or regenerates the draft.

### Layer 4: Scheduling and notification (Friday 6am) – 0% built

**What needs building:**

A pipeline orchestrator script (`pipeline.js`) that chains: fetch → score → report → draft → evaluate → revise → verify links → notify. A scheduling mechanism (launchd plist for macOS, or cron on a VPS). A notification sender. An error handling layer that catches failures at any stage and includes them in the notification rather than silently failing.

### Layer 5: Multi-model story discovery – 0% built

**What needs building:**

A `discover.js` script that takes the week's article list, sends it to 2–3 models with a sector-specific gap-detection prompt, collects returned URLs, and runs them through `ingestArticle()`. This is architecturally simple because the existing ingest pipeline handles all the verification – the new code only needs to generate the prompts and parse the model responses.

## Updated requirements

### Must-have (P0)

**Draft generation.** This is the primary value unlock. Without it, the pipeline produces a research pack that still needs a full day of writing. The draft must follow the SNI structure, style guide and prohibited language rules. Theme selection must produce themes at the quality level of Weeks 8–9.

**Link verification in draft.** Every URL in the generated draft must be fetched and content-matched before delivery. The existing `fetchPage()` and `extractArticleText()` functions provide the infrastructure – the new code matches entity names and claims against the fetched page content.

**Pipeline orchestrator.** A single command that runs the full Monday-to-Friday pipeline and produces a review-ready draft.

**Off-limits update.** Week 9 stories must be added to `config/off-limits.yaml`. The system should also support automated off-limits updates from approved reports.

**Friday delivery notification.** The pipeline completes and Scott receives a notification with the draft and a summary of any issues.

### Should-have (P1)

**Multi-model evaluation loop.** Draft sent to 2–3 models for structured evaluation with an orchestrator applying accepted changes. High value for quality assurance, but the core draft quality may be sufficient without it for v1.

**Multi-model story discovery.** Gap-detection step using other AI models. Adds incremental coverage improvement.

**Scheduled daily fetch.** Automated Monday–Friday fetching without manual invocation. Currently each run is triggered manually via CLI.

**Source expansion.** Systematic discovery of new RSS feeds and sources. The insurance sector is notably thin (only one working RSS feed – Insurance Thought Leadership – with Brave Search supplementing).

### Dropped from this version

**Word document generation.** Scott confirmed the Word doc can be ditched. Output is markdown only. This eliminates the entire build-docx.js layer and the dual-edit problem.

### Future considerations (P2)

**Subscriber analytics integration.** Click tracking fed back into story selection weighting.

**Automated Substack publishing.** Push the markdown to Substack API.

**Historical trend tracking.** Company, topic and theme frequency analysis across quarters.

**Custom sector alerting.** Real-time notifications for high-significance stories.

## Technical considerations

### Runtime and hosting

The app runs on Bun (JavaScript runtime) locally on Scott's Mac. The menubar app manages the server process. For scheduled automation, options are: a launchd plist on the Mac (simplest, but requires the machine to be on), a VPS with cron, or GitHub Actions on a schedule. The local-first approach keeps API keys on-device and avoids cloud hosting costs.

### API costs

The existing pipeline uses Brave Search API (free tier or minimal cost) and Claude Haiku 4.5 for relevance scoring (fractions of a cent per article). The new components add:

Draft generation: one Claude Opus/Sonnet call with ~20 articles context + style guide. Estimate $0.50–1.50 per run.

Multi-model evaluation (P1): sending a 4,000-word draft to 3 models. Estimate $2–5 per run.

Multi-model discovery (P1): 2–3 model calls + URL verification. Estimate $1–3 per run.

Total weekly cost for the full pipeline: $3.50–9.50. Annual: $180–500.

### Rate limits and politeness

Already handled. The fetch pipeline enforces 1.5-second delays between requests and uses a standard browser User-Agent string. Paywall domains are skipped entirely.

### Storage

Already handled. Articles stored in dated/sectored directories with JSON + markdown + raw HTML. Annual accumulation is trivially small.

### Model selection

Primary writing model: Claude Opus 4.5 or Sonnet 4.5 – strongest adherence to complex style guides based on Week 8–9 experience.

Relevance scorer: Claude Haiku 4.5 (already configured in score.js).

Evaluation models (P1): GPT-4o and Gemini Pro for diversity of perspective.

Orchestrator (P1): Claude, to maintain consistency with the editorial voice.

## Open questions

These need answers before or during implementation.

**Which notification channel?** Email, Slack or iMessage for the 6am Friday delivery notification? The menubar app already runs on the Mac, so iMessage via AppleScript would be the simplest integration. Slack would need a webhook or bot token.

**Where does the scheduled pipeline run?** The Mac (via launchd) is simplest but requires the machine to be awake. A VPS or cloud function provides reliability but adds hosting complexity and cost.

**What's the API budget?** The full pipeline adds $3.50–9.50 per weekly run. Is there a monthly ceiling?

**What evaluation rubric should the models use?** The evaluation prompt needs expanding into weighted criteria. This should be co-developed – the rubric defines the quality gate.

**How should theme selection work?** The automated version will propose candidates. Should Scott pre-approve the theme before drafting begins (adds a human checkpoint mid-pipeline), or should the model commit and Scott redirects in review (fully autonomous)?

**Brave Search API key.** Is this already provisioned and working? The app checks for `BRAVE_API_KEY` in `.env` but falls back gracefully if missing.

## Success metrics

**Time to review.** Scott's total time from notification to published report drops from a full day to under 90 minutes within 4 weeks of deployment.

**Story coverage.** The multi-model discovery step (when built) surfaces at least 2 additional relevant stories per week that weren't in the standard source sweep.

**Link accuracy.** Zero link errors in the delivered draft. Every URL verified before delivery.

**Style compliance.** Zero instances of prohibited language in the delivered draft.

**Delivery reliability.** Draft delivered by 6am every Friday. Target: 95%+ on-time in the first quarter.

## Revised phasing

The existing app eliminates most of Phase 1 from the original estimate. The critical path shifts to draft generation.

**Phase 1 (1 week): Housekeeping and integration testing.** Update off-limits.yaml with Week 9 stories. Run the full fetch → score → report pipeline against the Week 9 date window and compare output against the manually curated story list. Fix any gaps in source coverage or categorisation. Add `--week` flag for easier scheduling. Chain fetch + score + report into a single pipeline command.

**Phase 2 (2–3 weeks): Draft generation.** Build the writing pipeline – theme selection, tl;dr generation, body section writing, link embedding, link verification. This is the critical path. Test by generating retrospective drafts for Weeks 8 and 9 and comparing against the published versions. Iterate on prompt engineering until output quality matches manual drafts.

**Phase 3 (1 week): Pipeline orchestrator and scheduling.** Build the end-to-end pipeline script. Wire up the scheduler (launchd or cron). Build the notification sender. Run a live pilot for 2 weeks alongside the manual process.

**Phase 4 (1–2 weeks): Multi-model evaluation.** Build the evaluation loop – prompt design, model routing, orchestrator logic, accept/reject decisions. Can be developed in parallel with Phase 3 pilot testing.

**Phase 5 (ongoing): Multi-model story discovery.** Add the gap-detection step using other AI models.

**Total estimated build time: 4–6 weeks** to a production-ready pipeline, down from the original 6–8 week estimate. The existing app saves approximately 2–3 weeks of development by providing the entire research engine, relevance scoring and manual ingest infrastructure.
