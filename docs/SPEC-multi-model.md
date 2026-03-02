# Multi-Model Discovery and Evaluation — Product Specification

**Version:** 1.0
**Date:** 2026-02-27
**Status:** Draft — awaiting approval

---

## 1. Problem statement

The SNI pipeline currently operates as a single-model system. Claude handles everything: fetching signal, scoring relevance, selecting themes, writing the draft and reviewing its own work. This creates two blind spots:

1. **Discovery blind spot.** RSS feeds and Brave Search are keyword-driven. Stories that use different terminology, or that break in outlets not in our feed list, get missed. A model with a different training distribution will catch stories Claude's fetch pipeline missed.

2. **Evaluation blind spot.** Claude reviewing its own draft is like a student marking their own exam. Self-review catches mechanical errors (prohibited words, formatting, missing links) but not editorial weaknesses: buried ledes, missed angles, tonal drift, structural monotony. Independent reviewers with different editorial sensibilities will catch what self-review cannot.

## 2. What we're building

Two new pipeline stages and one config change:

| Change | Type | What it does |
|--------|------|--------------|
| `discover.js` | New stage | GPT-5.2 + Gemini Pro 3.1 independently review the scored article list and return URLs of stories we missed. New URLs get fetched, scored, and merged if they meet the existing quality bar. |
| `evaluate.js` | New stage | GPT-5.2 + Gemini Pro 3.1 independently provide editorial feedback on the finished draft. Their feedback is aggregated into a structured evaluation report alongside Claude's self-review. |
| `draft-write.md` | Config change | Model field changes from `claude-sonnet-4-20250514` to `claude-opus-4-6`. |

## 3. Pipeline flow change

### Current Friday pipeline
```
fetch → score → report → draft → review → verify-links → notify
```

### New Friday pipeline
```
fetch → score → discover → score(new) → report → draft(Opus) → review → evaluate → verify-links → notify
```

**Key insertion points:**
- `discover` runs after the first `score` and before `report`. It needs the scored article list as input.
- `evaluate` runs after `review` (Claude's self-review) and before `verify-links`. It needs the draft and Claude's review as input.
- Daily pipeline (Mon–Thu) is unchanged: `fetch → score`.

## 4. New environment variables

```
OPENAI_API_KEY=sk-...
GOOGLE_AI_API_KEY=...
```

Both are required for discover and evaluate. If either is missing, the stage logs a warning and skips gracefully (the pipeline continues without it — same pattern as score.js falling back to heuristic mode).

## 5. SDK dependencies

```json
{
  "openai": "^5.x",
  "@google/genai": "^1.x"
}
```

These are the current stable packages for GPT-5.2 and Gemini Pro 3.1 respectively.

---

# Stage 1: discover.js

## 5.1 Purpose

Find stories the RSS + Brave fetch missed. Two models with different training data independently review what we've already found and suggest what's absent.

## 5.2 Input

The scored article list — specifically, all articles remaining in `data/verified/` for the current week after `score.js` has run. This is the same data `draft.js` loads via `loadArticles(dateWindow)`.

The discover stage reads this list and formats it as a compact summary for each model:

```
Week 9, 2026 (2026-02-23 to 2026-02-28)
Sectors: General AI, Biopharma, MedTech, Complex Manufacturing, Insurance

Articles already collected (47 total):
- [General AI] "OpenAI launches GPT-5.2 with reasoning benchmarks" (openai.com)
- [General AI] "Anthropic raises $3.5bn Series D" (reuters.com)
- [Biopharma] "Recursion AI discovers novel cancer target" (statnews.com)
...
```

This is a title + source + sector listing. No snippets, no full text — we're asking 'what's missing?', not 'analyse what we have'.

## 5.3 Prompt design

Each model gets the same prompt:

```
You are a senior AI industry analyst reviewing the article list for a weekly
intelligence briefing covering these sectors: frontier AI, biopharma, medtech,
complex manufacturing and insurance.

The articles below were collected from RSS feeds and search APIs between
{{start_date}} and {{end_date}}.

{{article_list}}

Your task: identify 5-15 significant AI stories from this week that are
MISSING from the list above. Focus on:

1. Major announcements, funding rounds, product launches or regulatory actions
   in AI that would matter to senior leaders in the sectors listed
2. Stories that broke on outlets not typically covered by RSS feeds
   (e.g. company blogs, government press releases, niche trade publications)
3. Stories using different terminology that keyword search might have missed

For each missing story, provide:
- title: The article headline or a descriptive title
- url: The direct URL to the article (must be a real, accessible URL)
- source: The publication name
- sector: One of: general, biopharma, medtech, manufacturing, insurance
- reason: One sentence explaining why this story matters and why it was likely missed

Return JSON only:
{
  "missing_stories": [
    {
      "title": "...",
      "url": "https://...",
      "source": "...",
      "sector": "...",
      "reason": "..."
    }
  ]
}
```

**Prompt is stored as:** `config/prompts/discover.md` with YAML frontmatter following existing pattern.

## 5.4 Model calls

Both models are called **in parallel** using `Promise.allSettled`:

```javascript
const [openaiResult, geminiResult] = await Promise.allSettled([
  callOpenAI(prompt),
  callGemini(prompt),
]);
```

If one model fails, the other's results still get used. If both fail, the stage logs a warning and the pipeline continues (graceful degradation, same as all other stages).

## 5.5 Response processing

1. Parse JSON from each model's response (same `text.match(/\{[\s\S]*\}/)` pattern used in score.js and draft.js)
2. Merge results from both models into a single candidate list
3. **Deduplicate** by URL (exact match) and by title similarity (normalised lowercase, >80% overlap = duplicate)
4. **Deduplicate against existing articles** — skip any URL already present in `data/verified/`
5. For each surviving candidate:
   a. Fetch the URL using the existing `fetchPage()` from `lib/extract.js`
   b. Verify the page is accessible (HTTP 200, not paywalled)
   c. Extract title, snippet and date using existing `extractArticleText()` + `verifyDate()`
   d. Verify the article falls within the current week's date window
   e. Save to `data/verified/{date}/{sector}/` using existing `saveArticle()` — same format as fetch.js output
   f. Mark the article JSON with `"source_stage": "discover"` so downstream stages know its provenance

6. **Score the new articles** — the pipeline will run `score.js` again on just the new articles (pass their date range). Articles that fail scoring get moved to `data/review/` as normal.

## 5.6 Output

```javascript
{
  candidatesFromOpenAI: number,
  candidatesFromGemini: number,
  totalCandidates: number,      // after dedup
  fetched: number,              // URLs successfully retrieved
  dateVerified: number,         // passed date window check
  added: number,                // saved to data/verified/
  failed: number,               // fetch/date/paywall failures
  errors: string[],             // model-level errors
}
```

Saved to the pipeline context (`ctx.stages`) via the existing `runStage()` wrapper.

## 5.7 Rate limiting and cost control

- Models called in parallel, but URL fetching is sequential with 1.5s delay (same as verify-links.js) to avoid hammering sources
- Maximum 15 candidates per model (prompt instructs 5-15; we cap at 15 in parsing)
- Maximum 30 URLs fetched per discover run (after dedup)
- If a model returns >15 items, we take the first 15 and log a warning

**Estimated cost per run:**
- GPT-5.2: ~2,000 input tokens + ~1,500 output tokens
- Gemini Pro 3.1: ~2,000 input tokens + ~1,500 output tokens
- Plus Haiku scoring for new articles (~10-20 score calls)

## 5.8 Failure modes

| Failure | Behaviour |
|---------|-----------|
| OpenAI API key missing | Log warning, skip OpenAI, continue with Gemini only |
| Google API key missing | Log warning, skip Google, continue with OpenAI only |
| Both keys missing | Log warning, skip entire discover stage |
| OpenAI returns invalid JSON | Log error, use Gemini results only |
| Gemini returns invalid JSON | Log error, use OpenAI results only |
| Both return invalid JSON | Stage returns with 0 candidates, pipeline continues |
| URL fetch fails (404, timeout) | Skip that candidate, increment `failed` counter |
| Article outside date window | Skip that candidate, log as date-rejected |
| All candidates already in verified/ | Stage returns with 0 added (this is fine — our fetch was comprehensive) |

## 5.9 File structure

```
scripts/discover.js          — main stage module
config/prompts/discover.md   — prompt template with frontmatter
```

## 5.10 Export signature

```javascript
// Matches existing stage pattern (score.js, draft.js, review.js)
export async function runDiscover(args = {}) → Promise<DiscoverStats>
```

Called from pipeline.js as:
```javascript
await runStage('discover', () => runDiscover({
  week: ctx.weekNumber,
  year: ctx.year,
}), ctx);
```

---

# Stage 2: evaluate.js

## 6.1 Purpose

Get independent editorial feedback on the draft from two models that didn't write it. This is not a pass/fail gate — it's an advisory layer that surfaces issues the self-review couldn't catch.

## 6.2 Input

Two files:

1. **The draft** — `output/draft-week-{N}.md` (same file review.js reads)
2. **Claude's self-review** — `output/review-week-{N}.json` (output from review.js)

Both paths are passed as arguments, matching the pattern review.js uses (`args.draft`).

## 6.3 Prompt design

Each model gets the same prompt. This is an editorial evaluation prompt, not a mechanical checklist — the self-review already handles mechanical checks.

```
You are a senior editorial consultant reviewing a weekly AI intelligence
briefing called SNI. The briefing covers frontier AI, biopharma, medtech,
complex manufacturing and insurance for an audience of senior industry leaders.

The draft has already passed a mechanical quality check (prohibited language,
structure, formatting, links). Your job is EDITORIAL evaluation — things a
mechanical check cannot catch.

## Draft

{{draft}}

## Self-review results

The draft was reviewed by the authoring model. Here are the findings:

{{self_review}}

## Evaluation criteria

Score each criterion 1-5 (1 = poor, 5 = excellent) and provide specific,
actionable feedback with line references where possible.

1. **Lede strength**: Does the tl;dr intro grab attention with a specific,
   non-obvious insight? Or is it generic/predictable?

2. **Theme coherence**: Does the theme genuinely connect stories across sectors,
   or is it forced/superficial? Is it echoed naturally in body sections?

3. **Analytical depth**: Does the report explain WHY things matter, not just
   WHAT happened? Are causal connections drawn between events?

4. **Story selection**: Are the most significant stories given appropriate
   prominence? Are any minor stories over-covered or major stories under-covered?

5. **Narrative flow**: Does the report read as a coherent briefing, or as a
   disconnected list of summaries? Do section openers create momentum?

6. **Voice consistency**: Is the tone consistently that of a senior analyst?
   Any lapses into marketing language, cheerleading or unnecessary hedging?

7. **Factual precision**: Are claims specific (names, numbers, dates) or vague?
   Any assertions that seem unsupported by the linked sources?

8. **Structural balance**: Are sector sections appropriately weighted by
   news significance? Is any sector over- or under-served?

Return JSON only:
{
  "scores": {
    "lede_strength": { "score": N, "feedback": "..." },
    "theme_coherence": { "score": N, "feedback": "..." },
    "analytical_depth": { "score": N, "feedback": "..." },
    "story_selection": { "score": N, "feedback": "..." },
    "narrative_flow": { "score": N, "feedback": "..." },
    "voice_consistency": { "score": N, "feedback": "..." },
    "factual_precision": { "score": N, "feedback": "..." },
    "structural_balance": { "score": N, "feedback": "..." }
  },
  "overall_score": N,
  "top_strengths": ["...", "..."],
  "top_improvements": ["...", "...", "..."],
  "rewrite_suggestions": [
    {
      "location": "section or line reference",
      "current": "brief quote of current text",
      "suggested": "how it could be improved",
      "reason": "why this change matters"
    }
  ]
}
```

**Prompt is stored as:** `config/prompts/evaluate.md` with YAML frontmatter.

## 6.4 Model calls

Both models called **in parallel** using `Promise.allSettled`, same as discover.js:

```javascript
const [openaiResult, geminiResult] = await Promise.allSettled([
  callOpenAI(prompt),
  callGemini(prompt),
]);
```

## 6.5 Response processing

1. Parse JSON from each model's response
2. Build an aggregated evaluation report:

```javascript
{
  claude_review: {
    overall_pass: true/false,     // from review.js output
    issue_count: number,
    issues: { ... }               // the full self-review result
  },
  gpt_evaluation: {
    scores: { ... },
    overall_score: number,
    top_strengths: [...],
    top_improvements: [...],
    rewrite_suggestions: [...]
  },
  gemini_evaluation: {
    scores: { ... },
    overall_score: number,
    top_strengths: [...],
    top_improvements: [...],
    rewrite_suggestions: [...]
  },
  consensus: {
    average_score: number,        // mean of both models' overall_score
    agreed_strengths: [...],      // strengths mentioned by both
    agreed_improvements: [...],   // improvements mentioned by both
    divergent_views: [...]        // where models disagree significantly (>1 point)
  },
  evaluated_at: ISO timestamp,
  models_used: ["gpt-5.2", "gemini-pro-3.1"]
}
```

3. The `consensus` section is computed locally (no LLM call) by:
   - Averaging overall scores
   - Finding thematic overlap in strengths/improvements using simple keyword matching
   - Flagging criteria where the two models' scores differ by >1 point

## 6.6 Output

The aggregated evaluation is saved as `output/evaluate-week-{N}.json`.

Stats returned to the pipeline:

```javascript
{
  evaluationPath: string,
  gptScore: number | null,      // null if GPT call failed
  geminiScore: number | null,   // null if Gemini call failed
  averageScore: number | null,
  modelsUsed: string[],
  divergentCriteria: string[],  // criteria with >1 point disagreement
}
```

## 6.7 Rate limiting and cost control

- Both models called in parallel (no sequential dependency)
- Draft text is included in full (3,000-4,000 words = ~4,000-5,000 tokens)
- Self-review JSON is typically 500-1,500 tokens

**Estimated cost per run:**
- GPT-5.2: ~6,000 input tokens + ~2,000 output tokens
- Gemini Pro 3.1: ~6,000 input tokens + ~2,000 output tokens

## 6.8 Failure modes

| Failure | Behaviour |
|---------|-----------|
| OpenAI API key missing | Skip GPT evaluation, run Gemini only |
| Google API key missing | Skip Gemini evaluation, run OpenAI only |
| Both keys missing | Skip entire evaluate stage |
| Draft file not found | Throw error (same as review.js) |
| Review file not found | Run evaluation without self-review context (still useful) |
| OpenAI returns invalid JSON | Log error, include only Gemini in report |
| Gemini returns invalid JSON | Log error, include only GPT in report |
| Both return invalid JSON | Stage fails, pipeline continues |

## 6.9 File structure

```
scripts/evaluate.js            — main stage module
config/prompts/evaluate.md     — prompt template with frontmatter
```

## 6.10 Export signature

```javascript
export async function runEvaluate(args = {}) → Promise<EvaluateStats>
```

Called from pipeline.js as:
```javascript
await runStage('evaluate', () => runEvaluate({
  draft: draftPath,
  review: reviewPath,
}), ctx);
```

---

# Config change: draft model upgrade

## 7.1 Change

In `config/prompts/draft-write.md`, change frontmatter:

```yaml
# Before
model: claude-sonnet-4-20250514

# After
model: claude-opus-4-6
```

Theme selection (`draft-theme.md`) stays on Sonnet — no change.

No code changes needed. `draft.js` already reads the model from `meta.model`.

---

# Shared infrastructure: multi-model client

## 8.1 New lib module: `scripts/lib/multi-model.js`

Both discover.js and evaluate.js need to call OpenAI and Google. Rather than duplicating SDK init code, a shared module provides:

```javascript
/**
 * multi-model.js — Shared multi-model client for SNI Research Tool
 *
 * Initialises OpenAI and Google Generative AI clients.
 * Provides a unified call interface with retry and JSON extraction.
 */

import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { withRetry } from './retry.js';

// Uses the same loadEnvKey pattern as score.js, review.js, draft.js
function loadEnvKey(key) { ... }

const OPENAI_MODEL = 'gpt-5.2';
const GEMINI_MODEL = 'gemini-3.1-pro';

/**
 * Call a model and extract JSON from its response.
 *
 * @param {'openai' | 'gemini'} provider
 * @param {string} prompt — the user message
 * @param {object} [opts]
 * @param {string} [opts.system] — system prompt (OpenAI only; Gemini uses systemInstruction)
 * @param {number} [opts.maxTokens=4000]
 * @returns {Promise<{ provider: string, model: string, raw: string, parsed: object }>}
 */
export async function callModel(provider, prompt, opts = {}) { ... }

/**
 * Call both models in parallel. Returns results keyed by provider.
 * Never throws — failed models return { provider, error, parsed: null }.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @returns {Promise<{ openai: ModelResult, gemini: ModelResult }>}
 */
export async function callBothModels(prompt, opts = {}) { ... }

/**
 * Check which API keys are available.
 * @returns {{ openai: boolean, gemini: boolean }}
 */
export function availableProviders() { ... }
```

**Key design decisions:**
- `callBothModels` uses `Promise.allSettled` internally — one failure doesn't block the other
- JSON extraction uses the same `text.match(/\{[\s\S]*\}/)` pattern as every other module
- Retry uses the existing `withRetry` from `lib/retry.js` — same backoff formula
- `loadEnvKey` is extracted from score.js's pattern (the Bun .env workaround)

## 8.2 loadEnvKey consolidation

Currently `loadEnvKey` is copy-pasted in score.js, review.js, draft.js and notify.js. As part of this work, we extract it into `lib/env.js` and import it everywhere. This is a mechanical refactor that doesn't change behaviour.

```javascript
// scripts/lib/env.js
export function loadEnvKey(key) { ... }
```

---

# Pipeline integration

## 9.1 Updated pipeline.js

### New imports
```javascript
import { runDiscover } from './discover.js';
import { runEvaluate } from './evaluate.js';
```

### Updated Friday pipeline flow

```javascript
async function runFridayPipeline(ctx) {
  // Fetch
  await runStage('fetch', () => runFetch({ week, year }), ctx);

  // Score (first pass)
  await runStage('score', () => runScore({ week, year }), ctx);

  // Discover — multi-model story discovery
  const discoverResult = await runStage('discover', () => runDiscover({
    week, year,
  }), ctx);

  // Score (second pass — only if discover added new articles)
  if (discoverResult.stats?.added > 0) {
    await runStage('score-discover', () => runScore({ week, year }), ctx);
  }

  // Report
  await runStage('report', () => runReport({ week, year }), ctx);

  // Draft (now using Opus 4.6 via prompt frontmatter)
  const draftResult = await runStage('draft', () => runDraft({ week, year }), ctx);

  if (draftResult.status !== 'failed' && draftResult.stats?.draftPath) {
    const draftPath = draftResult.stats.draftPath;

    // Review (Claude self-review)
    const reviewResult = await runStage('review', () => runReview({
      draft: draftPath,
    }), ctx);

    // Evaluate (GPT-5.2 + Gemini Pro 3.1 editorial review)
    const reviewPath = reviewResult.stats?.reviewPath;
    await runStage('evaluate', () => runEvaluate({
      draft: draftPath,
      review: reviewPath,
    }), ctx);

    // Verify links
    await runStage('verify-links', () => runLinkCheck({
      draft: draftPath,
    }), ctx);
  }

  // Notify
  await runStage('notify', () => runNotify({ context: ctx }), ctx);
}
```

### Updated dry-run output

```
Stages:
  1.  fetch          — RSS feeds + Brave Search
  2.  score          — LLM relevance scoring
  3.  discover       — Multi-model story discovery (GPT-5.2 + Gemini Pro 3.1)
  4.  score-discover — Score newly discovered articles
  5.  report         — Research pack generation
  6.  draft          — Theme selection + draft writing (Opus 4.6)
  7.  review         — Self-review quality gate (Claude)
  8.  evaluate       — Editorial evaluation (GPT-5.2 + Gemini Pro 3.1)
  9.  verify-links   — Link verification
  10. notify         — iMessage notification
```

---

# Build order

## Phase 1: Foundation (no new stages yet)

1. **Install SDKs**: `bun add openai @google/genai`
2. **Add env vars**: `OPENAI_API_KEY` and `GOOGLE_AI_API_KEY` to `.env` and `.env.example`
3. **Extract `lib/env.js`**: Pull `loadEnvKey` out of score.js/review.js/draft.js/notify.js into shared module
4. **Build `lib/multi-model.js`**: Shared client with `callModel`, `callBothModels`, `availableProviders`
5. **Test multi-model client**: Standalone test hitting both APIs with a simple prompt

## Phase 2: discover.js

6. **Create `config/prompts/discover.md`**: Prompt template
7. **Build `scripts/discover.js`**: Full stage implementation
8. **Test standalone**: `bun scripts/discover.js --week 9 --dry-run`
9. **Wire into pipeline.js**: Add discover + second score pass

## Phase 3: evaluate.js

10. **Create `config/prompts/evaluate.md`**: Prompt template
11. **Build `scripts/evaluate.js`**: Full stage implementation
12. **Test standalone**: `bun scripts/evaluate.js --draft output/draft-week-9.md`
13. **Wire into pipeline.js**: Add evaluate after review

## Phase 4: Draft model upgrade

14. **Update `config/prompts/draft-write.md`**: Change model to `claude-opus-4-6`

## Parallelisable work

- Steps 1-5 (foundation) are sequential prerequisites
- Steps 6-8 (discover) and 10-12 (evaluate) can be built in parallel — they share lib/multi-model.js but don't depend on each other
- Steps 9, 13, 14-15 are sequential (pipeline integration)

---

# What this spec does NOT cover

- **Pipeline resumability** (P1 item 3) — separate concern, not in scope
- **Substack API publish** (P2 item 5) — further out
- **Automatic draft re-generation** based on evaluation feedback — the evaluate stage is advisory only. A human decides whether to regenerate.
- **Model fallback chains** — if GPT-5.2 is unavailable, we don't fall back to GPT-4o. We skip that provider and use whatever's available.

---

# Decisions (confirmed 2026-02-27)

1. **Score threshold for discovered articles.** Normal scoring. Discovered articles go through the same Haiku relevance check as fetched articles. No free pass.

2. **Evaluation visibility.** No. Evaluation JSON saved to `output/evaluate-week-{N}.json` only. iMessage notification does not include evaluation scores.

3. **Draft-theme model.** No. Theme selection stays on Sonnet. Only `draft-write.md` upgrades to Opus 4.6.
