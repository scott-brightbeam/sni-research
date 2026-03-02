# SNI automation: product requirements document (v2)

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

### Layer 2: Draft generation + self-review (Friday) – 0% built

This is the largest new component. It takes the research pack from report.js and produces a complete, review-ready SNI report in markdown.

**What needs building:**

A `draft.js` script that: loads the verified + scored articles for the week, loads the style guide and prohibited language list from `config/prompts/`, loads the previous week's published report from `output/published/` as a voice and structural reference, calls Claude (Opus or Sonnet) with a carefully constructed prompt requiring 3 candidate themes with reasoning before autonomously committing to one, generates the full report structure (welcome line, tl;dr with sector bullets, transition, body sections with story headings and analysis, closing line), and saves the draft to `output/`.

A self-review step that sends the draft back to Claude with the prohibited language list, structural template and a checklist rubric. Returns a JSON evaluation flagging issues. Flagged issues are included in the delivery notification.

A link verification step that fetches every URL in the draft and content-matches entity names and claims against the page content. Unreachable or mismatched links are flagged, not removed.

The prompt engineering is the critical path here. All prompts are stored in `config/prompts/` as versioned files. The theme selection, writing and self-review prompts need extensive testing against Weeks 8 and 9 data until the retrospective draft scores below the 20% override rate target.

### Layer 3: Multi-model evaluation (Friday) – 10% built

The Anthropic API integration pattern from score.js transfers. The structured-prompt-to-JSON-response pattern is proven.

**What needs building:**

API clients for GPT-4o and Gemini Pro. An evaluation rubric with weighted criteria covering: factual accuracy, style guide compliance, prohibited language detection, structural compliance, link validity, theme coherence, story selection quality. An orchestrator that aggregates feedback from all models, applies accept/reject logic with reasoning, and either patches or regenerates the draft.

### Layer 4: Scheduling and notification (Friday 6am) – 0% built

**What needs building:**

A pipeline orchestrator script (`pipeline.js`) that chains: fetch → score → report → draft → self-review → verify links → notify. Retry logic at every stage (3 attempts with exponential backoff). Graceful degradation – if draft generation fails after retries, the research pack is delivered instead. A launchd plist for macOS scheduling (daily fetch Mon–Fri, full pipeline Friday pre-dawn). An iMessage notification sender via AppleScript from the existing menubar app. A pipeline health summary showing which stages succeeded, retried or failed.

### Layer 5: Multi-model story discovery – 0% built

**What needs building:**

A `discover.js` script that takes the week's article list, sends it to 2–3 models with a sector-specific gap-detection prompt, collects returned URLs, and runs them through `ingestArticle()`. This is architecturally simple because the existing ingest pipeline handles all the verification – the new code only needs to generate the prompts and parse the model responses.

## Interaction model

The pipeline is fully autonomous from Monday fetch through Friday delivery. Scott's involvement is limited to post-delivery review and publishing.

| Pipeline stage | Timing | Mode | Scott's role |
|----------------|--------|------|-------------|
| Fetch + score | Mon–Fri, automated via launchd | Autonomous | None (can manually ingest via Chrome extension) |
| Research pack generation | Friday, pre-dawn | Autonomous | None |
| Theme selection | Friday, within draft generation | Autonomous | None – redirects in review if needed |
| Draft generation | Friday, pre-dawn | Autonomous | None |
| Self-review | Friday, after draft | Autonomous | None |
| Link verification | Friday, after self-review | Autonomous | None |
| Delivery notification | Friday, 6am iMessage | Autonomous | Receives notification |
| Editorial review | Friday morning | Human | Reviews draft, edits <20% target |
| Publish | Friday | Human | Publishes to Substack |
| Save published version | After publish | Human (lightweight) | Saves final markdown to `output/published/` for next week's reference |
| Off-limits update | After publish | Autonomous | `update-off-limits.js` parses published markdown |

The only manual steps are the editorial review, the Substack publish and the save-back of the published version. The save-back could be automated in a future version via the Substack API.

## Updated requirements

### Must-have (P0)

**Draft generation.** This is the primary value unlock. Without it, the pipeline produces a research pack that still needs a full day of writing. The draft must follow the SNI structure, style guide and prohibited language rules. Theme selection is fully autonomous – the model selects and commits.

*Done when:* A retrospective draft for Week 9 data scores below 20% editorial override (measured by word-level diff against the published Week 9 report). Theme selection produces a coherent theme without human input. Zero prohibited language instances. Structure matches the Week 9 template exactly: welcome line → tl;dr with sector bullets → transition line → body sections with story headings and analysis → closing line. The model references the previous week's published report (saved to `output/published/`) as a voice and structural guide.

**Self-review step.** After draft generation and before delivery, the draft is sent back to Claude with the prohibited language list, style guide rules, structural template and a checklist rubric. The model returns a JSON evaluation flagging: prohibited language instances (with line locations), structural deviations from the template, missing sector coverage and any claims not supported by a linked source. Flagged issues are included in the delivery notification. This is a lightweight quality gate, not the full multi-model evaluation loop (which is P1).

*Done when:* The review pass catches 100% of prohibited language instances and flags any structural deviations from the template. Cost per run is below $0.25.

**Link verification in draft.** Every URL in the generated draft must be fetched and content-matched before delivery. The existing `fetchPage()` and `extractArticleText()` functions provide the infrastructure – the new code matches entity names and claims against the fetched page content.

*Done when:* Every URL in the draft is fetched and content-matched. Dead or unreachable links are flagged in the delivery notification with a warning marker – not silently dropped or removed. Scott decides in review whether to keep, replace or cut flagged stories.

**Pipeline orchestrator.** An end-to-end script (`pipeline.js`) that chains fetch → score → report → draft → self-review → verify links → notify.

*Done when:* `bun scripts/pipeline.js --week <N>` runs the full pipeline without manual intervention and produces a draft in the expected format. Retry logic handles transient failures at every stage. A pipeline health summary is generated showing which stages succeeded, retried or failed.

**Off-limits update.** Two parts: (a) One-time task: add Week 9 entries to `config/off-limits.yaml` from the documented list in CLAUDE.md. (b) Systemic feature: `scripts/update-off-limits.js` parses a published markdown report and appends new company + topic pairs to the YAML automatically.

*Done when:* (a) Week 9 entries are in the YAML and verified against the published Week 9 report. (b) Running `bun scripts/update-off-limits.js output/published/week-9.md` appends the correct entries without duplicating existing ones.

**Friday delivery notification.** The pipeline completes and Scott receives an iMessage via AppleScript with the draft file path and a structured summary.

*Done when:* iMessage arrives containing: draft file path, pipeline run summary (articles found / scored / included per sector), self-review results (pass/fail + any flagged issues), link verification results (all good / N warnings) and any error or warning details from the pipeline run.

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

The app runs on Bun (JavaScript runtime) locally on Scott's Mac. The menubar app manages the server process. Scheduled automation uses a launchd plist on the Mac – the local-first approach keeps API keys on-device and avoids cloud hosting costs. The Mac must be awake at pipeline time; a macOS wake schedule or Power Nap should be configured to ensure reliability. If on-time delivery falls below 95% in the first quarter, migration to a VPS with cron is the fallback.

### API costs

The existing pipeline uses Brave Search API (free tier or minimal cost) and Claude Haiku 4.5 for relevance scoring (fractions of a cent per article). The new components add:

Draft generation: one Claude Opus/Sonnet call with ~20–40 articles context + style guide + previous report. Estimate $0.50–1.50 per run.

Self-review step: one Claude Sonnet/Haiku call with draft + prohibited language list + rubric. Estimate $0.15–0.25 per run.

Multi-model evaluation (P1): sending a 4,000-word draft to 3 models. Estimate $2–5 per run.

Multi-model discovery (P1): 2–3 model calls + URL verification. Estimate $1–3 per run.

P0 weekly cost (draft + self-review + scoring): $0.70–1.75. Annual: $36–91.

Full pipeline weekly cost (P0 + P1): $3.70–9.75. Annual: $192–507.

### Rate limits and politeness

Already handled. The fetch pipeline enforces 1.5-second delays between requests and uses a standard browser User-Agent string. Paywall domains are skipped entirely.

### Storage

Already handled. Articles stored in dated/sectored directories with JSON + markdown + raw HTML. Annual accumulation is trivially small.

### Model selection

Primary writing model: Claude Opus 4.5 or Sonnet 4.5 – strongest adherence to complex style guides based on Week 8–9 experience.

Self-review model: Claude Sonnet or Haiku – lightweight checklist evaluation against the style guide and prohibited language list.

Relevance scorer: Claude Haiku 4.5 (already configured in score.js).

Evaluation models (P1): GPT-4o and Gemini Pro for diversity of perspective.

Orchestrator (P1): Claude, to maintain consistency with the editorial voice.

### Context window budget (draft generation)

The draft generation call is the most context-intensive. Estimated token usage:

| Component | Estimated tokens | Notes |
|-----------|-----------------|-------|
| System prompt + style guide | ~3,000 | Prohibited language list, formatting rules, structural template from SNI-Research-Methodology.md |
| Previous published report | ~5,000 | Week N-1 as voice/structure reference, loaded from `output/published/` |
| Research pack (article summaries) | ~8,000–15,000 | Variable: titles + snippets + URLs for 15–40 scored articles across 5 sectors |
| Theme selection reasoning | ~1,000 | 3 candidate themes generated in-context before committing to one |
| Output (3,000–4,000 word draft) | ~5,000–6,000 | |
| **Total** | **~22,000–30,000** | Well within Claude Opus/Sonnet context limits |

If article volume exceeds the budget on a high-volume week, the research pack should be truncated to top-scored articles per sector (using score.js confidence levels). This keeps the most relevant stories and drops marginal ones. The truncation threshold should be logged in the pipeline summary.

### Prompt management

Prompts are the product. They must be stored as versioned files in `config/prompts/`, not inline in scripts:

- `config/prompts/draft-system.md` – System prompt for draft generation (style guide, prohibited language, structural template)
- `config/prompts/draft-theme.md` – Theme selection prompt (3 candidates with reasoning)
- `config/prompts/draft-write.md` – Section writing prompt (sector-by-sector body generation)
- `config/prompts/self-review.md` – Self-review checklist prompt (quality gate rubric)
- `config/prompts/score.md` – Relevance scoring prompt (migrate from inline in score.js)

Changes to prompts are tested against the Week 9 regression baseline before deploying to the live pipeline. The published Week 9 report is the quality target – any prompt change that increases the override rate against that baseline should be reverted or reworked.

## Failure modes and recovery

The pipeline runs unattended at pre-dawn hours. Every stage has a defined failure behaviour. The design principle is graceful degradation – the pipeline continues through failures where possible rather than aborting entirely.

| Stage | Failure | Behaviour |
|-------|---------|-----------|
| Fetch (RSS/Brave) | API timeout, feed errors | Retry 3x with exponential backoff (2s, 8s, 32s). Log failed sources. Continue with available data. |
| Score (Claude Haiku) | API outage | Fall back to heuristic scorer (already built in score.js). Flag in run summary. |
| Draft generation (Claude Opus/Sonnet) | API outage | Retry 3x. If still failing, deliver research pack only + error alert via iMessage. |
| Self-review | API failure | Skip self-review. Deliver draft with 'UNREVIEWED' warning in notification. |
| Link verification | URL unreachable | Flag in notification. Do not remove the story – Scott decides in review. |
| iMessage notification | AppleScript failure | Write draft to `output/` and log the error. Scott finds it on next Mac login. |
| Pipeline orchestrator | Any unhandled exception | Catch at top level. Send iMessage with error details + research pack path if available. |

The delivery notification always includes a pipeline health summary showing which stages succeeded, retried or failed.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Model API outage on Friday | Medium | Draft not delivered | Retry 3x → deliver research pack. Fallback model chain: Opus → Sonnet → Haiku draft. |
| Model updates degrade output quality | Medium | Draft quality regresses silently | Version-lock model IDs where possible. Run Week 9 regression test monthly. Alert if editorial override rate spikes above 30%. |
| RSS feed breakage | High (feeds die regularly) | Thin research pack for affected sector | Feed health check in daily fetch. Log dead feeds. Alert if a sector has fewer than 2 articles for 3+ consecutive days. |
| Context window overflow | Low | Draft generation fails | Token budget calculated per component (see Technical considerations). Research pack truncated to top-scored articles if volume exceeds budget. |
| Prompt drift over model versions | Medium | Gradual quality shift | Prompts stored in `config/prompts/` as versioned files, not inline strings. Regression test against Week 9 baseline. |
| Mac asleep at pipeline time | Medium | Pipeline doesn't run | Configure macOS wake schedule or Power Nap. launchd runs the job when Mac wakes if the scheduled time was missed. |
| Single point of failure (Scott's Mac) | Low | Complete pipeline failure | Acceptable for v1 (local-first design). Migrate to VPS if reliability becomes an issue after the pilot. |

## Decisions

The following questions were resolved during the v2 review process.

| Decision | Answer | Rationale |
|----------|--------|-----------|
| Notification channel | iMessage via AppleScript | Leverages the existing menubar app. No external dependencies. Draft file path + pipeline summary delivered at 6am. |
| Where the pipeline runs | Mac via launchd | Local-first. API keys stay on device. No hosting cost. Requires Mac awake at pipeline time (configure macOS wake schedule or Power Nap). Acceptable for v1; migrate to VPS if reliability becomes an issue. |
| Theme selection | Fully autonomous | The model selects the theme and writes the draft. Scott redirects in review if the theme doesn't land. No mid-pipeline checkpoint. Simplest architecture. |
| Quality bar | <20% editorial override | The delivered draft should be close to publishable. Light editing only – tone, tightening, swapping a story. If Scott is rewriting sections, the pipeline isn't delivering value yet. |
| Self-review step | Added to P0 | Lightweight quality gate before delivery (~$0.20/run). Catches prohibited language, structural deviations and unsupported claims. |
| Failure handling | Retry 3x then escalate | Exponential backoff. If still failing, deliver research pack + error summary via iMessage. Graceful degradation, not hard abort. |
| Previous week reference | Scott's published version | The draft generation model uses the published/edited version of Week N-1, not the pipeline's raw output. Creates a quality feedback loop where Scott's corrections teach the model. Requires a lightweight save-back step after publishing. |
| Story count per sector | Variable | The model matches what the news gives us, not a fixed count. Some weeks insurance has 2 stories, general has 8. |
| Off-limits automation | Parse published markdown | After Scott publishes, `update-off-limits.js` extracts company + topic pairs from the published report and appends them to `config/off-limits.yaml`. |
| API budget | No hard ceiling | The full P0 pipeline adds ~$0.70–1.70 per weekly run. The full P1 pipeline adds $3.50–9.50. Both acceptable. |

**Remaining design task (Phase 2):** The evaluation rubric for the self-review step and the future multi-model evaluation loop should be co-developed during prompt engineering, using Weeks 8–9 as the quality baseline.

## Success metrics

**Editorial override rate (primary metric).** Word-level diff between the delivered draft and the published version stays below 20% within 4 weeks of deployment. Track weekly. This is the single most important quality signal – it measures whether the draft is close to publishable or just a starting point.

**Time to publish.** Scott's total time from notification to published report drops from a full day to under 90 minutes. Measured by self-report for the first 8 weeks.

**Story coverage accuracy.** Of the stories in the final published version, 90%+ came from the automated pipeline (not found manually by Scott). Measured by comparing published story URLs against the research pack.

**Link accuracy.** Zero broken links in the delivered draft. Every URL fetched and content-matched before delivery.

**Style compliance.** Zero prohibited language instances in the delivered draft. The self-review step catches these before delivery.

**Delivery reliability.** Draft delivered by 6am every Friday. Target: 95%+ on-time in the first quarter. Misses logged with root cause.

**Draft-to-publish delta trend.** Track the override rate week-over-week. It should trend downward as the published-version feedback loop teaches the model Scott's preferences. If the trend flattens or reverses, investigate prompt degradation or model changes.

## Revised phasing

The existing app eliminates most of Phase 1 from the original estimate. The critical path shifts to draft generation and prompt engineering, where the <20% override rate target demands extensive iteration.

**Phase 1 (1 week): Housekeeping and infrastructure.**

- Add Week 9 entries to `config/off-limits.yaml` from the documented list in CLAUDE.md.
- Build `scripts/update-off-limits.js` to auto-parse published reports.
- Add `--week` flag to fetch.js for ISO week-based date windows.
- Chain fetch + score + report into a single pipeline command.
- Migrate the score.js inline prompt to `config/prompts/score.md`.
- Create the `config/prompts/` directory structure.
- Regression test the full fetch → score → report pipeline against Week 9 data and compare output against the manually curated story list.
- Create `output/published/` directory and save Weeks 8–9 published reports as reference files.

**Phase 2 (2–3 weeks): Draft generation + self-review.**

- Build `draft.js`: theme selection, tl;dr generation, body section writing, link embedding.
- Build the self-review step: prohibited language scan, structural compliance check, unsupported claims detection.
- Build link verification in the generated draft using existing `fetchPage()` and `extractArticleText()`.
- Implement the published-version save-back workflow (`output/published/week-N.md`).
- Write all prompts to `config/prompts/` as versioned files.
- Test by generating retrospective drafts for Weeks 8 and 9 and measuring word-level diff against the published versions.
- Iterate on prompt engineering until the Week 9 retrospective draft scores below 20% override rate.

This is the critical path. The <20% quality bar may require multiple prompt iterations.

**Phase 3 (1 week): Pipeline orchestrator and scheduling.**

- Build `pipeline.js` end-to-end script with retry logic and graceful degradation.
- Build the iMessage notification sender via AppleScript.
- Create the launchd plist for scheduled execution (daily fetch Mon–Fri, full pipeline Friday pre-dawn).
- Configure macOS wake schedule or Power Nap for reliability.
- Run a live pilot for 2 weeks alongside the manual process. Measure override rate, delivery reliability and time to publish.

**Phase 4 (1–2 weeks): Multi-model evaluation (P1).**

- Build API clients for GPT-4o and Gemini Pro.
- Design the evaluation rubric with weighted criteria.
- Build the orchestrator that aggregates feedback and applies accept/reject logic.
- Can be developed in parallel with the Phase 3 pilot.

**Phase 5 (ongoing): Multi-model story discovery (P1).**

- Build `discover.js` with gap-detection prompts sent to 2–3 models.
- Feed returned URLs through the existing `ingestArticle()` pipeline.
- Measure incremental story coverage improvement.

**Total estimated build time: 5–7 weeks** to a production-ready P0 pipeline. Slightly longer than the original 4–6 week estimate due to the self-review step, the published-version feedback loop and the ambitious <20% override rate target. The existing app saves approximately 2–3 weeks of development by providing the entire research engine, relevance scoring and manual ingest infrastructure.
