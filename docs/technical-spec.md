# SNI Research v2 — Technical & Functional Specification

**Version:** 1.0
**Date:** 2026-02-27
**Audience:** Scott and Claude (building together)
**Scope:** Full pipeline — P0 + P1 interfaces
**Codebase:** `~/Projects/sni-research-v2/`
**PRD:** `SNI-Automation-PRD-v2.md`

---

## Table of contents

1. [Conventions and runtime](#1-conventions-and-runtime)
2. [Directory structure and new files](#2-directory-structure-and-new-files)
3. [Shared data schemas](#3-shared-data-schemas)
4. [Prompt file format](#4-prompt-file-format)
5. [Component specifications](#5-component-specifications)
6. [Retry logic specification](#6-retry-logic-specification)
7. [Configuration specifications](#7-configuration-specifications)
8. [Scheduling (launchd)](#8-scheduling-launchd)
9. [Notification format](#9-notification-format)
10. [P1 interface stubs](#10-p1-interface-stubs)
11. [Target output format reference](#11-target-output-format-reference)
12. [Build order and dependency graph](#12-build-order-and-dependency-graph)
13. [Script boilerplate and code reuse map](#13-script-boilerplate-and-code-reuse-map)
14. [Edge cases and failure modes](#14-edge-cases-and-failure-modes)

---

## 1. Conventions and runtime

### 1.1 Runtime environment

- **Runtime:** Bun (>=1.3), ES modules (`"type": "module"` in package.json)
- **Imports:** Always `import`, never `require`
- **Root path pattern:**
  ```javascript
  import { dirname, join } from 'path';
  import { fileURLToPath } from 'url';
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const ROOT = join(__dirname, '..');
  ```
- **File I/O:** Synchronous throughout — `readFileSync`, `writeFileSync`, `mkdirSync({ recursive: true })`
- **Encoding:** Always pass `'utf8'` explicitly
- **Naming:** kebab-case files, camelCase functions, UPPER_SNAKE constants
- **Date strings:** Always `YYYY-MM-DD`. String comparison works for window checks:
  ```javascript
  dateStr >= startDate && dateStr <= endDate
  ```

### 1.2 API key loading

Bun >=1.3 filters `ANTHROPIC_API_KEY` from `.env` auto-loading. Every script that calls the Anthropic API must use the `loadEnvKey()` workaround from `score.js`:

```javascript
function loadEnvKey() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) throw new Error('.env file not found');
  const envContent = readFileSync(envPath, 'utf8');
  const match = envContent.match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (!match) throw new Error('ANTHROPIC_API_KEY not found in .env');
  return match[1].trim();
}
```

### 1.3 CLI argument parsing

Manual `process.argv.slice(2)` loop. No library. Consistent with every existing script:

```javascript
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week')      args.week = parseInt(argv[++i], 10);
    if (argv[i] === '--year')      args.year = parseInt(argv[++i], 10);
    if (argv[i] === '--start-date') args.startDate = argv[++i];
    if (argv[i] === '--end-date')   args.endDate = argv[++i];
    if (argv[i] === '--model')     args.model = argv[++i];
    if (argv[i] === '--draft')     args.draft = argv[++i];
    if (argv[i] === '--published') args.published = argv[++i];
    if (argv[i] === '--summary')   args.summary = argv[++i];
    if (argv[i] === '--mode')      args.mode = argv[++i];
    if (argv[i] === '--dry-run')   args.dryRun = true;
  }
  return args;
}
```

### 1.4 Logging helpers

Timestamped output using the pattern from `score.js`. Every new script must adopt this:

```javascript
const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);
const skip = (...a) => console.log(`[${ts()}] ⊘`, ...a);
```

### 1.5 Script modularity pattern

**Problem:** All existing scripts (`fetch.js`, `score.js`, `report.js`) call `process.exit()` at the end — they are CLI-only and cannot be imported as modules. Only `server.js` has the `if (import.meta.main)` guard pattern.

**Solution:** Refactor each existing script to wrap its logic in an exported async function, guarded by `import.meta.main`. This lets `pipeline.js` import and call them directly (no subprocess overhead, shared context).

```javascript
// BEFORE (CLI-only — cannot be imported):
async function main() { /* ... */ }
main();

// AFTER (importable + CLI):
export async function runFetch(args) {
  // ... returns stats object
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  runFetch(args)
    .then(stats => {
      log(`Done: ${JSON.stringify(stats)}`);
      process.exit(0);
    })
    .catch(err => {
      warn(err.message);
      process.exit(1);
    });
}
```

**Scripts to refactor:**
| Script | Exported function |
|--------|-------------------|
| `scripts/fetch.js` | `export async function runFetch(args)` |
| `scripts/score.js` | `export async function runScore(args)` |
| `scripts/report.js` | `export async function runReport(args)` |

New scripts (`draft.js`, `review.js`, `verify-links.js`, `notify.js`, `pipeline.js`) must use this pattern from the start.

### 1.6 Anthropic API call patterns

**Shape 1 — User-only messages** (existing, used by `score.js`):

```javascript
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: loadEnvKey() });

const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: prompt }],
});
const text = response.content[0].text.trim();
```

**Shape 2 — System + user messages** (new, for `draft.js` and `review.js`):

```javascript
const response = await anthropic.messages.create({
  model: meta.model,           // from prompt frontmatter
  max_tokens: meta.max_tokens,
  system: systemPrompt,        // style guide, structure, prohibited words
  messages: [{ role: 'user', content: userPrompt }],
});
const text = response.content[0].text;
```

The Anthropic SDK supports `system:` as a top-level field (not inside the messages array). Draft generation and self-review use Shape 2. Score continues using Shape 1.

### 1.7 JSON response extraction pattern

Reuse from `score.js` everywhere a JSON response is expected from an LLM:

```javascript
const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) throw new Error('No JSON in response');
const result = JSON.parse(jsonMatch[0]);
```

### 1.8 Files to reference for patterns

| File | Patterns to reuse |
|------|-------------------|
| `scripts/lib/extract.js` | ROOT path, `slugify()`, `ensureDir()`, `fetchPage()`, `extractArticleText()`, `saveArticle()`, `USER_AGENT` |
| `scripts/score.js` | `loadEnvKey()`, log/ok/warn/skip helpers, Anthropic API Shape 1, heuristic fallback, JSON extraction |
| `scripts/server.js` | `import.meta.main` guard pattern, `ingestArticle()` 10-step pipeline |
| `scripts/report.js` | `getAllVerifiedArticles()`, sector grouping loop, markdown report generation |

---

## 2. Directory structure and new files

### 2.1 New directories

```
config/prompts/          — all prompt files (markdown with YAML frontmatter)
output/published/        — Scott's published reports for feedback loop
output/runs/             — pipeline run summaries (JSON)
logs/                    — launchd stdout/stderr logs
```

### 2.2 New files

| File | Purpose | Phase |
|------|---------|-------|
| `scripts/lib/prompt.js` | Shared prompt loader + template renderer | 1 |
| `scripts/lib/retry.js` | Shared retry-with-backoff utility | 1 |
| `scripts/lib/lock.js` | File-based locking (prevent concurrent runs) | 1 |
| `scripts/lib/week.js` | ISO week calculation using date-fns | 1 |
| `scripts/update-off-limits.js` | Parse published report, append off-limits entries | 1 |
| `scripts/measure-override.js` | Measure edit distance between draft and published version | 1 |
| `scripts/draft.js` | Draft generation (theme selection + writing) | 2 |
| `scripts/review.js` | Self-review quality gate | 2 |
| `scripts/verify-links.js` | Link verification in generated draft | 2 |
| `scripts/notify.js` | iMessage notification via osascript | 3 |
| `scripts/pipeline.js` | End-to-end orchestrator with state tracking | 3 |
| `config/prompts/score.md` | Migrated from inline in score.js | 1 |
| `config/prompts/draft-system.md` | Style guide, prohibited language, structure template | 2 |
| `config/prompts/draft-theme.md` | Theme selection (3 candidates, commit to 1) | 2 |
| `config/prompts/draft-write.md` | Section-by-section body generation | 2 |
| `config/prompts/self-review.md` | Quality gate checklist rubric | 2 |
| `config/sector-names.yaml` | Canonical sector display name mapping | 1 |
| `com.sni.fetch.plist` | launchd: daily fetch Mon-Thu 4am | 3 |
| `com.sni.pipeline.plist` | launchd: full pipeline Friday 4am | 3 |

### 2.3 Existing files to modify

| File | Change | Phase |
|------|--------|-------|
| `scripts/fetch.js` | Add `--week <N>` flag; refactor to `export runFetch(args)` + `import.meta.main` guard; wrap `writeFileSync` in try/catch | 1 |
| `scripts/score.js` | Migrate inline prompt to `config/prompts/score.md`; persist `confidence` and `score_reason` to article JSON; refactor to `export runScore(args)` + `import.meta.main` guard | 1 |
| `scripts/report.js` | Fix `getWeekNumber()` to use `scripts/lib/week.js`; refactor to `export runReport(args)` + `import.meta.main` guard | 1 |
| `scripts/lib/extract.js` | Wrap `writeFileSync`/`renameSync` in try/catch; fix YAML front-matter injection (quote titles) | 1 |
| `package.json` | Add `js-tiktoken` and `diff` dependencies | 1 |

---

## 3. Shared data schemas

### 3a. PipelineContext

Created by `pipeline.js`, passed to every stage:

```json
{
  "runId": "2026-W09-1740650400",
  "weekNumber": 9,
  "year": 2026,
  "dateWindow": { "start": "2026-02-23", "end": "2026-02-27" },
  "mode": "daily | friday",
  "stages": [],
  "startedAt": "2026-02-27T04:00:00.000Z",
  "lockFile": "data/.pipeline.lock"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `runId` | string | `{year}-W{weekNumber}-{unixTimestamp}` |
| `weekNumber` | number | ISO week number (from date-fns) |
| `year` | number | ISO year (from date-fns `getISOWeekYear`) |
| `dateWindow` | object | `{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }` |
| `mode` | string | `'daily'` (Mon-Thu: fetch+score) or `'friday'` (full pipeline) |
| `stages` | StageResult[] | Accumulates as pipeline progresses |
| `startedAt` | string | ISO timestamp |
| `lockFile` | string | Path to lock file |

### 3b. StageResult

One per pipeline stage:

```json
{
  "name": "fetch",
  "status": "success",
  "attempts": 1,
  "duration": 892000,
  "stats": { "saved": 47, "flagged": 3, "fetchErrors": 12 },
  "errors": [],
  "model": null,
  "fallback": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Stage identifier: `'fetch'`, `'score'`, `'report'`, `'draft'`, `'review'`, `'verify-links'`, `'notify'` |
| `status` | string | `'success'` / `'retried'` / `'failed'` / `'skipped'` |
| `attempts` | number | Total attempts (including retries) |
| `duration` | number | Milliseconds |
| `stats` | object | Stage-specific (article counts, paths, etc.) |
| `errors` | string[] | Error messages from failed attempts |
| `model` | string or null | Which model was used (for LLM stages) |
| `fallback` | boolean | `true` if fallback model/method was used |

### 3c. ArticleSummary

Lightweight projection for draft context (not full article JSON):

```json
{
  "title": "Anthropic raises $3.5bn at $61.5bn valuation",
  "url": "https://techcrunch.com/...",
  "source": "TechCrunch",
  "date_published": "2026-02-24",
  "sector": "general",
  "snippet": "Anthropic has closed a $3.5 billion funding round...",
  "confidence": "high",
  "score_reason": "Direct AI industry funding news"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Article headline |
| `url` | string | Source URL |
| `source` | string | Publisher name |
| `date_published` | string | `YYYY-MM-DD` |
| `sector` | string | `'general'` / `'biopharma'` / `'medtech'` / `'manufacturing'` / `'insurance'` |
| `snippet` | string | First 300 chars of full_text |
| `confidence` | string | `'high'` / `'medium'` / `'low'` — **NEW field** (added by score.js) |
| `score_reason` | string | Why article was kept — **NEW field** (added by score.js) |

### 3d. ReviewResult

Returned by self-review:

```json
{
  "overall_pass": false,
  "prohibited_found": [{ "line": 42, "text": "leveraging AI capabilities", "term": "leveraging" }],
  "structural_issues": [{ "issue": "Missing transition line", "location": "between tl;dr and body" }],
  "unsupported_claims": [{ "line": 88, "claim": "revenue doubled", "url": "https://..." }],
  "missing_sectors": ["insurance"],
  "word_count": 3420,
  "formatting_issues": [{ "issue": "Oxford comma detected", "location": "line 55" }]
}
```

### 3e. LinkCheckResult

Per-URL verification:

```json
{
  "url": "https://techcrunch.com/...",
  "status": "ok",
  "httpStatus": 200,
  "entityFound": true,
  "responseTimeMs": 1240,
  "error": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `'ok'` / `'dead'` / `'timeout'` / `'content_mismatch'` / `'paywall'` |
| `httpStatus` | number or null | HTTP response code |
| `entityFound` | boolean | Did the page mention the entity from the draft's anchor text? |
| `responseTimeMs` | number | Fetch duration |
| `error` | string or null | Error message if applicable |

### 3f. Existing article JSON schema

Full shape as written by `fetch.js`/`server.js`, plus two new fields added by `score.js`:

```json
{
  "title": "string",
  "url": "string",
  "source": "string",
  "source_type": "rss | brave",
  "date_published": "YYYY-MM-DD",
  "date_verified_method": "rss_pubDate | schema_org | og_published | ...",
  "date_confidence": "high | medium | low",
  "sector": "general | biopharma | medtech | manufacturing | insurance",
  "keywords_matched": ["string"],
  "snippet": "string (first 300 chars of full_text)",
  "full_text": "string (up to 10,000 chars)",
  "scraped_at": "ISO timestamp",
  "_raw_html": "string (full HTML)",
  "confidence": "high | medium | low",
  "score_reason": "string"
}
```

The last two fields (`confidence`, `score_reason`) are **NEW** — added by `score.js` after LLM or heuristic scoring. See Section 7b.

### 3g. Sector display name mapping

Three different naming schemes exist across the codebase. Canonical mapping in `config/sector-names.yaml`:

```yaml
general:
  config: "General AI"
  tldr: "In AI & tech"
  body: "AI industry"
  order: 1
biopharma:
  config: "Pharma & Biopharma"
  tldr: "In Biopharma"
  body: "Biopharma"
  order: 2
medtech:
  config: "MedTech"
  tldr: "In Medtech"
  body: "MedTech and digital health"
  order: 3
manufacturing:
  config: "Complex & Advanced Manufacturing"
  tldr: "In Manufacturing"
  body: "Complex manufacturing"
  order: 4
insurance:
  config: "Insurance"
  tldr: "In Insurance"
  body: "Insurance"
  order: 5
```

**Usage:** `loadSectorNames()` utility reads this file once, returns the mapping. Used by `report.js`, `draft.js`, and `review.js`. Replaces inline `SECTOR_DISPLAY_NAMES` in `report.js`.

### 3h. Existing run stats format

Written by `fetch.js` to `data/last-run-{date}.json`:

```json
{
  "saved": 239,
  "flagged": 16,
  "fetchErrors": 47,
  "feedErrors": 0,
  "paywalled": 124,
  "offLimits": 5,
  "startTime": "2026-02-26T...",
  "window": { "startDate": "2026-02-23", "endDate": "2026-02-26" },
  "elapsed": "1463s",
  "completedAt": "2026-02-26T..."
}
```

This existing shape is preserved. `pipeline.js` wraps it in a StageResult (3b) with status, timing, and error fields.

---

## 4. Prompt file format

### 4.1 Format

Markdown file with YAML frontmatter:

```markdown
---
model: claude-sonnet-4-20250514
max_tokens: 8000
temperature: 0.7
version: 1
---

You are writing the SNI weekly AI newsletter...

## Research pack
{{research_pack}}

## Previous report
{{previous_report}}
```

### 4.2 Shared loader — `scripts/lib/prompt.js`

```javascript
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'js-yaml';
import { encodingForModel } from 'js-tiktoken';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PROMPTS_DIR = join(ROOT, 'config/prompts');

const tokenEncoder = encodingForModel('gpt-4');  // cl100k_base, close enough for Claude

export function loadPrompt(name) {
  const filePath = join(PROMPTS_DIR, `${name}.md`);
  const raw = readFileSync(filePath, 'utf8');
  if (raw.length === 0) throw new Error(`Prompt file is empty: ${name}.md`);

  const parts = raw.split('---');
  if (parts.length < 3) throw new Error(`Invalid frontmatter in ${name}.md: expected --- fences`);

  const meta = YAML.load(parts[1]);
  const template = parts.slice(2).join('---').trim();
  return { meta, template };
}

export function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in vars)) throw new Error(`Missing template variable: {{${key}}}`);
    return vars[key];
  });
}

export function countTokens(text) {
  return tokenEncoder.encode(text).length;
}
```

### 4.3 Prompt files

| Prompt file | Variables | Expected response format |
|-------------|-----------|--------------------------|
| `score.md` | `{{sector_description}}`, `{{title}}`, `{{snippet}}` | JSON: `{ relevant, confidence, reason }` |
| `draft-system.md` | `{{prohibited_words}}`, `{{style_rules}}`, `{{structure_template}}` | N/A (system prompt) |
| `draft-theme.md` | `{{research_pack}}`, `{{previous_report_theme}}` | JSON: `{ themes: [{ title, rationale, angle }], selected: number }` |
| `draft-write.md` | `{{theme}}`, `{{research_pack}}`, `{{previous_report}}`, `{{sector_order}}` | Markdown (full draft) |
| `self-review.md` | `{{draft}}`, `{{prohibited_words}}`, `{{structure_template}}` | JSON: ReviewResult schema |

---

## 5. Component specifications

### 5a. `scripts/lib/week.js` — ISO week utilities

Fixes the broken `getWeekNumber()` in `report.js`. Uses `date-fns` (already in package.json but currently unused).

**Problem:** Current `getWeekNumber()` in report.js uses `Math.ceil(dayOfYear / 7)`. This breaks at year boundaries — Dec 31, 2025 is ISO Week 1 of 2026, but the current code returns Week 53.

```javascript
import { getISOWeek, getISOWeekYear, startOfISOWeek, endOfISOWeek, isValid, parseISO, addWeeks, startOfYear } from 'date-fns';

export function getISOWeekNumber(dateStr) {
  const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
  if (!isValid(d)) throw new Error(`Invalid date: ${dateStr}`);
  return getISOWeek(d);
}

export function getISOYearForWeek(dateStr) {
  const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
  if (!isValid(d)) throw new Error(`Invalid date: ${dateStr}`);
  return getISOWeekYear(d);
}

export function getWeekWindow(weekNum, year) {
  // Find the Monday of the given ISO week
  const jan4 = new Date(year, 0, 4); // Jan 4 is always in ISO week 1
  const startOfWeek1 = startOfISOWeek(jan4);
  const weekStart = addWeeks(startOfWeek1, weekNum - 1);
  const weekEnd = endOfISOWeek(weekStart);

  return {
    start: weekStart.toISOString().slice(0, 10),
    end: weekEnd.toISOString().slice(0, 10),
  };
}

export function getCurrentWeek() {
  const now = new Date();
  return {
    week: getISOWeek(now),
    year: getISOWeekYear(now),
  };
}
```

### 5b. `scripts/lib/retry.js` — Retry with backoff

```javascript
export async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 2000,
    onRetry = () => {},
    shouldRetry = () => true,
  } = opts;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !shouldRetry(err)) throw err;
      const delay = baseDelayMs * Math.pow(4, attempt - 1); // 2s, 8s, 32s
      onRetry(attempt, err, delay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// Standard shouldRetry for Anthropic API calls
export function shouldRetryApiError(err) {
  const status = err?.status || err?.response?.status;
  if ([429, 503, 529].includes(status)) return true;      // rate limit, unavailable, overloaded
  if (err?.code === 'ECONNRESET') return true;             // network reset
  if (err?.code === 'ETIMEDOUT') return true;              // network timeout
  if ([400, 401, 404].includes(status)) return false;      // bad request, auth, not found
  return true; // retry unknown errors
}
```

### 5c. `scripts/lib/lock.js` — File locking

```javascript
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCK_DIR = join(ROOT, 'data');
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export function acquireLock(name) {
  const lockPath = join(LOCK_DIR, `.${name}.lock`);
  const lockData = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  // Check for existing lock
  if (existsSync(lockPath)) {
    try {
      const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
      const age = Date.now() - new Date(existing.startedAt).getTime();

      // Check if PID is still alive
      try {
        process.kill(existing.pid, 0); // signal 0 = check existence
        // PID is alive — check if stale (PID reuse scenario)
        if (age > STALE_THRESHOLD_MS) {
          warn(`Stealing stale lock (PID ${existing.pid}, age ${Math.round(age / 60000)}min)`);
          // Fall through to create
        } else {
          return { acquired: false, lockPath };
        }
      } catch {
        // PID is dead — stale lock
        warn(`Removing stale lock (PID ${existing.pid} is dead)`);
        // Fall through to create
      }
    } catch {
      // Corrupt lock file — remove and recreate
      warn('Removing corrupt lock file');
    }
  }

  // Atomic create (exclusive flag prevents race condition)
  try {
    writeFileSync(lockPath, lockData, { flag: 'wx' });
    return { acquired: true, lockPath };
  } catch (err) {
    if (err.code === 'EEXIST') {
      return { acquired: false, lockPath }; // Another process beat us
    }
    throw err;
  }
}

export function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // Lock already removed — not an error
  }
}
```

### 5d. `scripts/update-off-limits.js` — Off-limits automation

**CLI:** `bun scripts/update-off-limits.js <published-report.md>`

```javascript
export function extractStories(markdown) {
  // Returns: [{ company: string, topic: string }]
  //
  // Algorithm:
  // 1. Split markdown by sector headings (## AI industry, ## Biopharma, etc.)
  // 2. Within each sector, find story headings:
  //    - Lines matching /^### / (H3 headings)
  //    - Linked headings: [Title](url)
  // 3. For each heading:
  //    a. Strip markdown link syntax: [Title](url) → Title
  //    b. Company = first capitalised multi-word phrase (stop at lowercase word or verb)
  //    c. Topic = remaining words minus stopwords
  // 4. Return array of { company, topic }
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'to', 'for', 'and', 'with', 'its',
  'on', 'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'has',
  'have', 'had',
]);

export function appendToOffLimits(entries, weekNumber) {
  // Load config/off-limits.yaml
  // Add new week_{N} key with entries
  // Deduplicate: company match AND ≥50% keyword overlap in topic
  // Write back to YAML
}

export async function runUpdateOffLimits(args) {
  // Parse args, load published report file, extract stories, append to YAML
  // Report stats: "Added N entries for week M (K duplicates skipped)"
}
```

**Entity extraction detail:**
- Company name = first capitalised multi-word phrase in heading (stop at lowercase word or common verb)
- Topic = remaining heading words minus stopwords
- Deduplication = company match AND 50%+ keyword overlap (same logic as existing off-limits matching in `fetch.js`)
- If company can't be extracted: use full heading text as both company and topic, log warning

**Ground truth:** Week 9 published report contains ~42 stories. The extraction script must produce output matching this set (regression test during Phase 1).

### 5e. `scripts/draft.js` — Draft generation

**CLI:** `bun scripts/draft.js --week <N> [--year <YYYY>] [--model claude-sonnet-4-20250514] [--dry-run]`

#### Function signatures

```javascript
export function loadArticles(weekDir) → ArticleSummary[]
  // Read data/verified/{dates}/{sectors}/*.json
  // Filter to date window from week number
  // Sort by confidence desc, then date desc
  // Strip _raw_html and full_text (keep snippet only)

export function loadPreviousReport(weekNumber) → string | null
  // Read output/published/week-{N-1}.md
  // If missing, return null (first run case)

export function buildResearchContext(articles, tokenBudget) → string
  // Group by sector (order: general, biopharma, medtech, manufacturing, insurance)
  // Per sector: list articles with title, url, source, date, snippet, confidence
  // If total tokens > budget: truncate lowest-confidence articles per sector
  // Log truncation: "Truncated: removed 3 general, 1 insurance (budget: 15000 tokens)"

export async function selectTheme(context, previousTheme) → { theme, rationale }
  // Load config/prompts/draft-theme.md
  // Call Claude API (Shape 2)
  // Parse JSON: 3 candidate themes, model selects 1

export async function generateDraft(theme, context, previousReport) → string
  // Load config/prompts/draft-system.md + draft-write.md
  // Call Claude API (Shape 2)
  // Return markdown draft

export async function runDraft(args) → { draftPath, theme, stats }
  // Orchestrate: loadArticles → buildResearchContext → selectTheme → generateDraft
  // Save to output/draft-week-{N}.md
```

#### Research context format

`buildResearchContext()` produces this markdown:

```markdown
# Research Context: Week 9, 2026
Date range: 2026-02-23 – 2026-02-27
Total articles: 31

## AI & tech (12 articles)

### Anthropic raises $3.5bn at $61.5bn valuation
- Source: TechCrunch | Published: 2026-02-24
- URL: https://techcrunch.com/...
- Confidence: high
- Snippet: Anthropic has closed a $3.5 billion funding round...

### Microsoft expands Copilot to manufacturing
- Source: The Verge | Published: 2026-02-25
- URL: https://theverge.com/...
- Confidence: high
- Snippet: Microsoft announced the expansion of its Copilot AI...

## Biopharma (5 articles)
[same structure]

## Medtech (4 articles)
## Manufacturing (6 articles)
## Insurance (4 articles)
```

Differs from `report.js` output: no "Headlines Overview" section, no date verification method, articles sorted by confidence then date, snippet limited to 300 chars, `_raw_html` and `full_text` stripped entirely.

#### Two-call API pattern

**Call 1 — Theme selection** (cheaper model):

```javascript
const { meta, template } = loadPrompt('draft-theme');
const prompt = renderPrompt(template, {
  research_pack: researchContext,
  previous_report_theme: previousTheme || 'none (first issue)',
});

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',  // or from prompt frontmatter
  max_tokens: 1000,
  messages: [{ role: 'user', content: prompt }],
});
// Returns JSON: { themes: [{ title, rationale, angle }, ...], selected: 0 }
```

**Call 2 — Full draft generation** (primary model):

```javascript
const { meta: writeMeta, template: writeTemplate } = loadPrompt('draft-write');
const { meta: sysMeta, template: sysTemplate } = loadPrompt('draft-system');

const systemPrompt = renderPrompt(sysTemplate, {
  prohibited_words: PROHIBITED_WORDS_LIST,
  style_rules: STYLE_RULES,
  structure_template: STRUCTURE_TEMPLATE,
});

const userPrompt = renderPrompt(writeTemplate, {
  theme: selectedTheme.title,
  research_pack: researchContext,
  previous_report: previousReport || 'Not available (first issue)',
  sector_order: 'AI & tech, Biopharma, Medtech, Manufacturing, Insurance',
});

const response = await anthropic.messages.create({
  model: writeMeta.model,            // from frontmatter or CLI --model
  max_tokens: writeMeta.max_tokens,  // 8000
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }],
});
// Returns: markdown string (the complete draft)
```

#### Token budget management

| Component | Token budget |
|-----------|-------------|
| System prompt + style guide | ~3,000 |
| Previous report | ~5,000 (truncate to tl;dr + structure if needed) |
| Research context | 15,000 max |
| Output | ~6,000 (3,000-4,000 words) |
| **Total** | **~30,000** (well within 200K context limit) |

Use `countTokens()` from `prompt.js` to verify before each API call.

**Truncation strategy:** When research context exceeds 15,000 tokens, remove lowest-confidence articles sector-by-sector (round-robin from largest sector first) until under budget. Log every removed article.

**Hard minimum:** 2 articles per sector (or all if sector has ≤2). If still over budget: increase `max_tokens` and log warning.

#### Model fallback chain

1. Try primary model (from prompt frontmatter or CLI `--model`)
2. On 429/overloaded/5xx: retry 3x with backoff via `withRetry()`
3. After 3 failures on primary: try secondary model (Sonnet if primary was Opus)
4. After 3 failures on secondary: abort draft generation, deliver research pack instead
5. Log which model was used + whether fallback was triggered in StageResult

#### Zero-article sector handling

- 0 articles in a sector: include one-line note in draft body ("No significant AI stories in [sector] this week.")
- Prompt instructs the model to handle this gracefully
- tl;dr section skips empty sectors entirely

### 5f. `scripts/review.js` — Self-review quality gate

**CLI:** `bun scripts/review.js --draft <path> [--model claude-sonnet-4-20250514]`

**Critical behavioural spec:** Self-review is a quality gate, NOT a re-generation step.
- It flags issues but does NOT attempt to fix the draft
- The draft is delivered AS-IS with the ReviewResult attached
- Scott reads the ReviewResult alongside the draft and decides what to edit
- On API failure (all retries exhausted): skip review, deliver draft with `UNREVIEWED` prefix in notification
- On review FAIL (issues found): deliver draft + review JSON. Notification shows "Self-review: FAIL (N issues)"
- On review PASS: deliver draft + review JSON. Notification shows "Self-review: PASS"
- The pipeline NEVER blocks on review failure — always delivers what it has

```javascript
export async function runReview(args) → ReviewResult
  // Load draft markdown from args.draft
  // Load config/prompts/self-review.md
  // Render with: draft text, prohibited word list, structure template
  // Call Claude API (Sonnet — cheaper model for review):
  //
  //   const response = await anthropic.messages.create({
  //     model: 'claude-sonnet-4-20250514',
  //     max_tokens: 4000,
  //     system: 'You are a strict editorial quality reviewer for a professional newsletter.',
  //     messages: [{ role: 'user', content: renderedPrompt }],
  //   });
  //
  // Parse JSON response into ReviewResult schema
  // Save to output/review-week-{N}.json
```

**Self-review checklist** (encoded in `self-review.md` prompt):

1. **Prohibited language scan** — every word/phrase from the full list (30+ terms)
2. **Structural compliance:**
   - Welcome line present and matches pattern
   - tl;dr section: theme title + 2 intro paragraphs + sector subheadings + bullets with links
   - Transition line: "And if you're still hungry for more, here's the detail on each:"
   - Body sections in order: AI & tech, Biopharma, Medtech, Manufacturing, Insurance
   - Each body section: opening paragraph + linked story headings + 1-3 paragraphs
   - Closing line: "Thank you for reading this week's report..."
3. **Formatting:**
   - UK English (single quotes, spaced en dashes, no Oxford commas)
   - Numbers: 1-9 spelled, 10+ numerals; always numerals for money/percentages
   - No bold in body copy, no emojis
   - Sentence case headings
   - Currency: $11.2bn not $11.2 billion
4. **Link presence:** every story has at least one `[text](url)` inline link
5. **Unsupported claims:** flag any assertion not attributable to a linked source
6. **Word count:** 3,000-4,000 words
7. **Missing sectors:** flag if any sector omitted without explanation

### 5g. `scripts/verify-links.js` — Link verification

**CLI:** `bun scripts/verify-links.js --draft <path>`

```javascript
export function extractLinks(markdown) → [{ url, anchorText, line }]
  // Regex: /\[([^\]]+)\]\(([^)]+)\)/g
  // Return all markdown links with anchor text and line number

export async function verifyLink(url, anchorText) → LinkCheckResult
  // Reuse fetchPage() from extract.js (15s timeout)
  // If HTTP error: return { status: 'dead', httpStatus }
  // If timeout: return { status: 'timeout' }
  // If paywall domain (reuse isPaywalled() from extract.js): return { status: 'paywall' }
  // If HTTP 200:
  //   Extract text via extractArticleText()
  //   Check if first 3 words of anchor text appear in page text
  //   entityFound = true/false
  //   status = entityFound ? 'ok' : 'content_mismatch'
  // Rate limit: 1.5s between ALL requests, extra 3s between same-domain requests

export async function runLinkCheck(args) → { results: LinkCheckResult[], summary }
  // Extract links from draft, verify each, compile summary
  // Save to output/links-week-{N}.json
  // Summary: { total, ok, dead, timeout, mismatch, paywall }
```

**"Content-matched" definition:** Shallow entity match. Fetch the page, extract text, check if the primary entity name from the anchor text appears anywhere in the page content. Catches dead links, redirects to unrelated pages, and paywalls. Does NOT verify factual claims — that's the self-review's job.

### 5h. `scripts/notify.js` — iMessage notification

**CLI:** `bun scripts/notify.js --summary <path> [--recipient <email>]`

```javascript
export function sendIMessage(message, recipient) → { sent, error }
  // recipient defaults to Scott's iCloud email (from .env: NOTIFY_RECIPIENT)
  // AppleScript via Bun.spawn:
  //
  //   const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  //   const script = `tell application "Messages"
  //     send "${escaped}" to buddy "${recipient}" of (service 1 whose service type is iMessage)
  //   end tell`;
  //   const proc = Bun.spawn(['osascript', '-e', script], { timeout: 10000 });
  //
  // Returns { sent: true } on success
  // On failure: returns { sent: false, error: message }

export function formatNotification(pipelineSummary) → string
  // Multi-line plain text (see Section 9 for exact template)

export async function runNotify(args) → void
  // Load pipeline summary JSON
  // Format notification
  // Send via iMessage
  // Fallback: if iMessage fails, write to output/notification-week-{N}.txt
```

### 5i. `scripts/measure-override.js` — Override rate measurement

**CLI:** `bun scripts/measure-override.js --draft <path> --published <path>`

Not part of the automated pipeline. Run manually after each publish:
```bash
bun scripts/measure-override.js --draft output/draft-week-9.md --published output/published/week-9.md
```

```javascript
import { diffWords } from 'diff';

export function measureOverrideRate(draftText, publishedText) {
  const changes = diffWords(draftText, publishedText);
  let totalWords = 0, changedWords = 0, additions = 0, deletions = 0;

  for (const part of changes) {
    const wordCount = part.value.trim().split(/\s+/).filter(w => w).length;
    if (!part.added && !part.removed) {
      totalWords += wordCount;  // unchanged
    } else if (part.added) {
      totalWords += wordCount;
      changedWords += wordCount;
      additions += wordCount;
    } else if (part.removed) {
      changedWords += wordCount;
      deletions += wordCount;
    }
  }

  return {
    overrideRate: Math.round((changedWords / totalWords) * 100 * 10) / 10,
    totalWords,
    changedWords,
    additions,
    deletions,
  };
}

export async function runMeasureOverride(args) {
  const draft = readFileSync(args.draft, 'utf8');
  const published = readFileSync(args.published, 'utf8');
  const result = measureOverrideRate(draft, published);
  const outPath = args.draft.replace('draft-', 'override-').replace('.md', '.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  ok(`Override rate: ${result.overrideRate}% (${result.changedWords}/${result.totalWords} words)`);
  return result;
}
```

**Success metric:** <20% override rate is the target from the PRD.

**Dependency:** `diff` npm package (add to package.json).

### 5j. `scripts/pipeline.js` — Pipeline orchestrator

**CLI:** `bun scripts/pipeline.js --week <N> [--year <YYYY>] [--mode daily|friday] [--dry-run]`

```javascript
import { runFetch } from './fetch.js';
import { runScore } from './score.js';
import { runReport } from './report.js';
import { runDraft } from './draft.js';
import { runReview } from './review.js';
import { runLinkCheck } from './verify-links.js';
import { runNotify } from './notify.js';
import { acquireLock, releaseLock } from './lib/lock.js';
import { getCurrentWeek, getWeekWindow } from './lib/week.js';
import { withRetry, shouldRetryApiError } from './lib/retry.js';

async function runStage(name, fn, context) → StageResult
  // Wraps fn with: timing, retry (via withRetry), error capture
  // On success: status 'success'
  // On retry-then-success: status 'retried'
  // On total failure: status 'failed', pipeline continues (graceful degradation)
  // Appends StageResult to context.stages

async function runDailyPipeline(ctx) → void
  // Stages: fetch → score
  // Runs Mon-Thu via launchd

async function runFridayPipeline(ctx) → void {
  const fetchResult = await runStage('fetch', () => runFetch({
    week: ctx.weekNumber, year: ctx.year
  }), ctx);

  const scoreResult = await runStage('score', () => runScore({
    startDate: ctx.dateWindow.start, endDate: ctx.dateWindow.end
  }), ctx);

  const reportResult = await runStage('report', () => runReport({
    week: ctx.weekNumber
  }), ctx);

  // Draft depends on score completing (needs confidence fields)
  const draftResult = await runStage('draft', () => runDraft({
    week: ctx.weekNumber, year: ctx.year
  }), ctx);

  // Review and link-check only run if draft succeeded
  if (draftResult.status !== 'failed') {
    await runStage('review', () => runReview({
      draft: draftResult.stats.draftPath
    }), ctx);
    await runStage('verify-links', () => runLinkCheck({
      draft: draftResult.stats.draftPath
    }), ctx);
  }

  // Always notify
  await runStage('notify', () => runNotify({
    summary: ctx
  }), ctx);
}

export async function runFullPipeline(args) → void {
  // 1. Parse args (--week, --year, --mode, --dry-run)
  // 2. Acquire lock — abort if another pipeline is running
  const lock = acquireLock('pipeline');
  if (!lock.acquired) {
    warn('Pipeline already running — exiting');
    process.exit(0);
  }

  try {
    // 3. Check disk space (abort if <10MB, warn if <100MB)
    // 4. Create PipelineContext
    // 5. Run daily or friday pipeline based on --mode
    // 6. Save output/runs/pipeline-{date}.json
  } finally {
    releaseLock(lock.lockPath);
  }
}
```

**State tracking:** Each run saves `output/runs/pipeline-{date}.json` with the full PipelineContext. NOT resumable in v1 (restart from scratch). Full resumability is P1.

**`--dry-run` flag:** Prints execution plan (stages, date window, article counts) without calling APIs or writing files. Each `run*()` function checks `args.dryRun`.

---

## 6. Retry logic specification

### 6.1 Formula

```
delay = baseDelayMs * 4^(attempt - 1)
Attempts: 3
Delays: 2s → 8s → 32s (total wait: ~42s before final failure)
```

### 6.2 Per-stage retry table

| Stage | Retries | Fallback on total failure |
|-------|---------|---------------------------|
| Fetch (RSS/Brave) | 3x per source | Log failed source, continue with rest |
| Score (Haiku) | 3x per article | Heuristic scorer (built-in in score.js) |
| Draft (primary model) | 3x, then try secondary model 3x | Deliver research pack |
| Self-review | 3x | Skip, deliver with UNREVIEWED warning |
| Link verification | 3x per URL | Flag as `'timeout'`, include in report |
| Notification (iMessage) | 3x | Write to file, log error |

### 6.3 `shouldRetry` logic

**Retry:** 429 (rate limit), 503 (unavailable), 529 (overloaded), ECONNRESET, ETIMEDOUT
**Do NOT retry:** 400 (bad request), 401 (auth failure), 404 (not found)

---

## 7. Configuration specifications

### 7a. `--week` flag for `fetch.js`

```
bun scripts/fetch.js --week 9
→ calculates: --start-date 2026-02-23 --end-date 2026-02-27
   (Monday to Friday of ISO week 9, 2026)
```

Uses `getWeekWindow()` from `scripts/lib/week.js`. The `--week` flag overrides `--start-date`/`--end-date` if both are provided.

### 7b. Score persistence (`score.js` modification)

After LLM or heuristic scoring, write `confidence` and `score_reason` back to the article JSON:

```javascript
article.confidence = result.confidence;     // 'high' | 'medium' | 'low'
article.score_reason = result.reason;       // why article was kept
writeFileSync(article._jsonPath, JSON.stringify(article, null, 2));
```

This enables `draft.js` to sort articles by confidence for token-budget truncation.

### 7c. `output/published/` naming convention

- `output/published/week-9.md` (simple, human-readable)
- Scott copies/pastes published markdown after Substack publish
- Future: automate via Substack API (P2)

### 7d. Bootstrap tasks (Phase 1, day 1)

1. Create `config/prompts/` directory
2. Extract `score.js` inline prompt → `config/prompts/score.md`
3. Create `output/published/` directory
4. Save Week 8 and Week 9 published reports as `week-8.md`, `week-9.md`
5. Add Week 9 entries to `config/off-limits.yaml` (existing entries from CLAUDE.md)
6. Create `output/runs/` directory
7. Create `logs/` directory

---

## 8. Scheduling (launchd)

### 8.1 Two plist files

**`com.sni.fetch.plist`** — Mon-Thu at 4:00am local:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sni.fetch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/scott/.bun/bin/bun</string>
    <string>/Users/scott/Projects/sni-research-v2/scripts/pipeline.js</string>
    <string>--mode</string>
    <string>daily</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>4</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>4</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>4</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>4</integer></dict>
  </array>
  <key>StandardOutPath</key>
  <string>/Users/scott/Projects/sni-research-v2/logs/fetch.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/scott/Projects/sni-research-v2/logs/fetch-error.log</string>
  <key>WorkingDirectory</key>
  <string>/Users/scott/Projects/sni-research-v2</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/scott/.bun/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
```

**`com.sni.pipeline.plist`** — Friday at 4:00am local:

Same structure as above, with:
- `Label` = `com.sni.pipeline`
- `Weekday` = `5` (Friday only)
- `--mode` = `friday`
- Log paths: `logs/pipeline.log` and `logs/pipeline-error.log`

### 8.2 Missed execution handling

`StartCalendarInterval` does NOT reschedule missed jobs. If the Mac was asleep at 4am:

- macOS Power Nap (if enabled) will wake for the job
- If not: job runs next time Mac is awake AND the calendar interval matches
- **Mitigation:** Configure Energy Saver to wake at 3:55am on weekdays:
  ```bash
  sudo pmset repeat wakeorpoweron MTWRF 03:55:00
  ```
- **Date safety:** `pipeline.js` uses the current date at execution time, not the scheduled date. If it runs at 10am instead of 4am, the week calculation is still correct.

### 8.3 Installation

```bash
cp com.sni.fetch.plist ~/Library/LaunchAgents/
cp com.sni.pipeline.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.sni.fetch.plist
launchctl load ~/Library/LaunchAgents/com.sni.pipeline.plist
```

---

## 9. Notification format

### 9.1 Success message

```
SNI Week 9 — Draft ready

Draft: ~/Projects/sni-research-v2/output/draft-week-9.md
Theme: The price of position

Pipeline: 7 stages in 4m 12s
Articles: 47 found → 31 scored relevant → 18 in draft
Sectors: general (7), biopharma (3), medtech (2), manufacturing (3), insurance (3)

Self-review: PASS (0 issues)
Links: 18/18 verified (0 warnings)
```

### 9.2 Failure message (draft failed)

```
SNI Week 9 — Research pack only (draft failed)

Research pack: ~/Projects/sni-research-v2/output/2026-02-27-week-9-research.md
Error: Draft generation failed after 3 attempts (claude-sonnet-4-20250514: 529 overloaded)

Pipeline: 7 stages in 2m 48s (1 failed)
Articles: 47 found → 31 scored relevant
```

### 9.3 Partial success (review failed)

```
SNI Week 9 — Draft ready (UNREVIEWED)

Draft: ~/Projects/sni-research-v2/output/draft-week-9.md
Theme: The price of position

Pipeline: 7 stages in 3m 55s (1 skipped)
Articles: 47 found → 31 scored relevant → 18 in draft

Self-review: SKIPPED (API unavailable after 3 retries)
Links: 16/18 verified (2 timeouts)
```

---

## 10. P1 interface stubs

### 10a. `scripts/evaluate.js` — Multi-model evaluation (Phase 4)

Interface only — not implemented in P0:

```javascript
export async function runEvaluation(draftPath) → EvaluationResult
  // Send draft to GPT-4o + Gemini Pro + Claude
  // Each returns structured feedback (rubric TBD)
  // Orchestrator aggregates, applies accept/reject
  // Returns revised draft or patch instructions
```

**Dependencies to add in Phase 4:** OpenAI SDK, Google Generative AI SDK.

### 10b. `scripts/discover.js` — Multi-model story discovery (Phase 5)

Interface only:

```javascript
export async function runDiscovery(articleList) → discoveredUrls[]
  // Send article list to 2-3 models with gap-detection prompt
  // Collect returned URLs
  // Run each through ingestArticle() from server.js
```

---

## 11. Target output format reference

### 11.1 Structural template

The generated draft must match this structure, derived from the Week 9 published report:

```
1. Welcome line
   - 1 sentence, lists 4 sectors, spaced en dash
   - Example: "Welcome to this week's report – covering AI & tech, biopharma, medtech, manufacturing and insurance."

2. tl;dr section
   a. Theme title: "tl;dr: [thematic phrase]"
   b. Two intro paragraphs (3-4 sentences each, thematic context)
   c. Sector subheadings ("In AI & tech", "In Biopharma", etc.)
   d. Bullets under each: "[Claim](url), analytical consequence"
      - Claim is linked, consequence is plain text
      - 2-7 bullets per sector

3. Transition line
   - "And if you're still hungry for more, here's the detail on each:"

4. Body sections (one per sector, in order)
   a. Section heading: "## AI industry" / "## Biopharma" / etc.
   b. Sector opening paragraph (3-5 sentences, week significance)
   c. Story subsections:
      - Heading: "### [Story title](url)" (sentence case, linked)
      - 1-3 paragraphs per story (facts, context, significance)

5. Closing
   - "Thank you for reading this week's report..."
```

### 11.2 Formatting rules (encoded in `draft-system.md` prompt)

- **Language:** UK English throughout
- **Quotes:** Single quotes ('not "double"')
- **Dashes:** Spaced en dashes ( – not — or -)
- **Commas:** No Oxford commas
- **Numbers:** 1-9 spelled out, 10+ as numerals; always numerals for money/percentages
- **Currency:** $11.2bn, £50m (symbol before, 'bn'/'m' not 'billion'/'million')
- **Bold:** None in body copy
- **Emojis:** None
- **Headings:** Sentence case
- **Links:** Embedded mid-sentence or at end of headline, never at sentence start
- **Voice:** Third-person objective, mixed present/past tense, analytical
- **Theme:** Should recur across sectors (Week 9: "The price of position" appeared literally twice + structured all 5 sector narratives)

### 11.3 Prohibited language (complete list)

```
landscape, realm, spearheading, game-changer, paradigm shift,
ecosystem (non-literal), synergy, leverage (verb), utilize,
cutting-edge, state-of-the-art, best-in-class, world-class,
next-generation, revolutionize, disrupt (marketing), transform (vague),
harness, unlock, empower, enable (empty), drive (vague), robust,
seamless, holistic, innovative, groundbreaking, double down, lean in,
move the needle, boil the ocean, stakeholder, deep dive, circle back,
low-hanging fruit, at the end of the day, going forward, in terms of,
it's worth noting, it's important to note, interestingly,
"This isn't just an X, it's a Y"
```

### 11.4 Week 9 calibration data

Measured from the published Week 9 report. These serve as targets in the `draft-write.md` prompt:

| Metric | Value |
|--------|-------|
| Total word count | ~3,500 words |
| tl;dr intro paragraphs | 68 words (2 paragraphs, 3-4 sentences each) |
| tl;dr bullets | 18 total: AI&tech 7, biopharma 2, medtech 2, manufacturing 3, insurance 4 |
| AI industry section | ~1,390 words (largest — 7+ stories) |
| Biopharma section | ~425 words |
| Medtech section | ~460 words |
| Manufacturing section | ~690 words |
| Insurance section | ~620 words |
| Story paragraphs | Typically 1-2 per story; exceptional stories get 3-4 |
| Links per story | 1-3 inline links |

The model should aim for similar proportions but adapt to actual article volumes per sector each week.

---

## 12. Build order and dependency graph

### 12.1 Phase 1 — Shared utilities + refactoring

```
Day 1 — Bootstrap + independent utilities (parallel):
  ├── Bootstrap tasks (create dirs, copy reports, extract prompts)
  ├── scripts/lib/week.js          (no dependencies)
  ├── scripts/lib/retry.js         (no dependencies)
  ├── scripts/lib/lock.js          (no dependencies)
  └── config/sector-names.yaml     (no dependencies)

Day 2 — Prompt system + dependencies:
  ├── bun add js-tiktoken diff     (package.json)
  ├── scripts/lib/prompt.js        (depends on: js-tiktoken, js-yaml)
  └── config/prompts/score.md      (extract from score.js inline prompt)

Day 3 — Existing script refactoring (sequential):
  ├── scripts/lib/extract.js       (fix: writeFileSync error handling, YAML escaping)
  ├── scripts/fetch.js             (refactor: import.meta.main, export runFetch, --week flag)
  ├── scripts/score.js             (refactor: import.meta.main, export runScore, prompt.js, persist confidence)
  └── scripts/report.js            (refactor: import.meta.main, export runReport, fix getWeekNumber)

Day 4 — Phase 1 validation + standalone utilities:
  ├── scripts/update-off-limits.js (depends on: js-yaml, published reports)
  ├── scripts/measure-override.js  (depends on: diff package)
  └── Validate: run fetch → score → report with --week 9, compare output
```

### 12.2 Phase 2 — Draft pipeline

```
Day 5-6 — Prompts + draft (sequential):
  ├── config/prompts/draft-system.md
  ├── config/prompts/draft-theme.md
  ├── config/prompts/draft-write.md
  └── scripts/draft.js             (depends on: prompt.js, week.js, sector-names.yaml, retry.js)

Day 7 — Review + links (parallel after draft works):
  ├── config/prompts/self-review.md
  ├── scripts/review.js            (depends on: prompt.js, retry.js)
  └── scripts/verify-links.js      (depends on: extract.js fetchPage/extractArticleText)

Day 8 — Validate Phase 2:
  └── Run draft.js --week 9, review.js, verify-links.js
      Compare generated draft to published Week 9 report
      Measure override rate with measure-override.js
```

### 12.3 Phase 3 — Orchestration

```
Day 9 — Pipeline + notification:
  ├── scripts/notify.js            (standalone osascript wrapper)
  └── scripts/pipeline.js          (depends on: ALL scripts, lock.js, week.js)

Day 10 — Scheduling:
  ├── com.sni.fetch.plist
  ├── com.sni.pipeline.plist
  ├── pmset wake schedule
  └── End-to-end validation: pipeline.js --mode friday --week 9
```

### 12.4 Parallel work identification

| Can be built simultaneously | Why |
|----------------------------|-----|
| week.js, retry.js, lock.js | Zero shared dependencies |
| draft-system.md, draft-theme.md, draft-write.md, self-review.md | All prompts are independent text files |
| review.js, verify-links.js | Both depend only on Phase 1 utilities, not each other |
| notify.js, pipeline.js | notify.js has no deps; pipeline.js can be built while notify.js is tested |
| measure-override.js, update-off-limits.js | Both are standalone Phase 1 utilities |

---

## 13. Script boilerplate and code reuse map

### 13.1 New script boilerplate template

Every new script starts from this template:

```javascript
#!/usr/bin/env bun
// scripts/{name}.js — {description}

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --- Logging helpers ---
const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);
const skip = (...a) => console.log(`[${ts()}] ⊘`, ...a);

// --- CLI argument parsing ---
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week')    args.week = parseInt(argv[++i], 10);
    if (argv[i] === '--year')    args.year = parseInt(argv[++i], 10);
    if (argv[i] === '--dry-run') args.dryRun = true;
    // Add script-specific flags here
  }
  return args;
}

// --- Main exported function ---
export async function runName(args) {
  const startTime = Date.now();
  log('Starting {name}...');

  // ... implementation ...

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  ok(`Done in ${elapsed}s`);
  return { /* stats */ };
}

// --- CLI entry point ---
if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  runName(args)
    .then(stats => {
      log(`Result: ${JSON.stringify(stats)}`);
      process.exit(0);
    })
    .catch(err => {
      warn(`Fatal: ${err.message}`);
      process.exit(1);
    });
}
```

### 13.2 Code reuse map

| New component | Copy from | What to copy | Then modify |
|--------------|-----------|-------------|-------------|
| `lib/prompt.js` loadPrompt() | `score.js:271-290` | API call pattern, JSON extraction regex | Add YAML frontmatter parsing, template rendering |
| `lib/prompt.js` countTokens() | N/A (new) | — | Import js-tiktoken, use cl100k_base encoding |
| `lib/retry.js` withRetry() | `score.js:271-290` | Try/catch + fallback pattern | Generalise to configurable retry count + backoff |
| `lib/week.js` | `report.js:33-45` | getWeekNumber() | Replace naive math with date-fns getISOWeek/getISOWeekYear |
| `lib/lock.js` | N/A (new) | — | writeFileSync with `{ flag: 'wx' }` for atomic create |
| `draft.js` loadArticles() | `report.js:47-74` | getAllVerifiedArticles() | Add confidence sorting, strip full_text, keep snippet only |
| `draft.js` buildResearchContext() | `report.js:155-215` | generateReport() sector loop | Simplify format, add confidence field, truncation logic |
| `draft.js` API call | `score.js:271-280` | Anthropic SDK create() call | Add system: parameter, use prompt.js for template loading |
| `review.js` API call | Same as draft.js | Same pattern | Different prompt, parse ReviewResult JSON |
| `verify-links.js` fetchPage() | `lib/extract.js:37-77` | fetchPage() | Direct reuse (import), no modification needed |
| `verify-links.js` extractArticleText() | `lib/extract.js:79-104` | extractArticleText() | Direct reuse (import), check for entity name in result |
| `notify.js` Bun.spawn | N/A (new) | — | AppleScript via Bun.spawn(['osascript', '-e', script]) |
| `pipeline.js` runStage() | N/A (new) | — | Wraps each stage with timing, retry, error capture |
| `update-off-limits.js` YAML handling | `fetch.js` off-limits loading | YAML.load pattern | Add YAML.dump for writing back |
| `measure-override.js` | N/A (new) | — | Import diff, use diffWords() |

### 13.3 Dry-run mode

Every script that calls an external API or sends notifications supports `--dry-run`:

| Script | `--dry-run` behaviour |
|--------|----------------------|
| `fetch.js` | Print source list + date window, skip fetches. Show "Would fetch N RSS feeds, M Brave queries" |
| `score.js` | Load articles, print count per sector, skip API calls. Show "Would score N articles" |
| `draft.js` | Load articles, build research context, print token count. Skip API calls. Save context to `output/draft-context-week-{N}.md` |
| `review.js` | Load draft, print word count + local structure check (regex only). Skip LLM review |
| `verify-links.js` | Extract links from draft, print URL list. Skip fetches. Show "Would verify N links" |
| `notify.js` | Format notification message, print to console. Skip osascript/iMessage |
| `pipeline.js` | Run all stages in dry-run mode. Print execution plan with stage order + estimated counts |

### 13.4 Configuration constants

All magic numbers collected from across the codebase:

```javascript
// Timeouts
const FETCH_TIMEOUT_MS = 15000;           // extract.js fetchPage() — 15s per page
const RSS_PARSER_TIMEOUT = 10000;          // fetch.js rss-parser — 10s per feed
const OSASCRIPT_TIMEOUT_MS = 10000;        // notify.js — 10s for iMessage send

// Rate limits
const FETCH_RATE_LIMIT_MS = 1500;          // fetch.js — 1.5s between page fetches
const SCORE_RATE_LIMIT_MS = 300;           // score.js — 300ms between Haiku calls
const LINK_CHECK_RATE_MS = 1500;           // verify-links.js — 1.5s between link checks
const LINK_SAME_DOMAIN_EXTRA_MS = 3000;    // verify-links.js — extra 3s between same-domain

// Retry
const RETRY_MAX_ATTEMPTS = 3;              // All stages
const RETRY_BASE_DELAY_MS = 2000;          // 2s → 8s → 32s

// Token budgets
const SYSTEM_PROMPT_BUDGET = 3000;         // draft.js — system prompt + style guide
const PREVIOUS_REPORT_BUDGET = 5000;       // draft.js — previous report context
const RESEARCH_CONTEXT_BUDGET = 15000;     // draft.js — article research context
const DRAFT_OUTPUT_BUDGET = 6000;          // draft.js — expected output tokens
const TOTAL_TOKEN_BUDGET = 30000;          // draft.js — total

// Content limits
const ARTICLE_TEXT_MAX_CHARS = 10000;      // extract.js extractArticleText()
const SNIPPET_MAX_CHARS = 300;             // ArticleSummary snippet
const CONTENT_GATE_MIN_CHARS = 100;        // server.js ingestArticle() — minimum for valid article
const FETCH_CONTENT_MIN_CHARS = 300;       // fetch.js — minimum for keeping article

// Disk space
const DISK_WARN_THRESHOLD_MB = 100;        // pipeline.js — warn if <100MB
const DISK_ABORT_THRESHOLD_MB = 10;        // pipeline.js — abort if <10MB

// Link verification
const LINK_NETWORK_FAIL_THRESHOLD = 0.8;   // verify-links.js — skip if >80% fail with network errors
```

Values live in each script's source (not a shared config file — keeps scripts self-contained). This table is the single reference for consistency.

---

## 14. Edge cases and failure modes

### 14.1 Inherited vulnerabilities in existing code

These exist today and must be addressed during Phase 1 refactoring:

**E1. Unprotected `writeFileSync` across all scripts (HIGH)**

- `extract.js:saveArticle()` — three `writeFileSync` calls (JSON, MD, HTML) with zero error handling
- `extract.js:saveFlagged()` — one `writeFileSync` with zero error handling
- `score.js:moveToReview()` — `renameSync` for .json and .md files unprotected
- `report.js` — final `writeFileSync` for the report output is unprotected
- `fetch.js` — final `writeFileSync` for `last-run-{date}.json` is unprotected
- **Impact:** Disk full or permission error crashes the process mid-operation, leaving partial writes
- **Fix:** Wrap all `writeFileSync`/`renameSync` in try/catch. On failure: log warning, increment error counter, continue. For `saveArticle()`, if JSON write fails, skip MD and HTML writes for that article.
- **When:** Phase 1, during the `import.meta.main` refactoring of each script

**E2. YAML front-matter injection in markdown templates (MEDIUM)**

- `extract.js:saveArticle()` uses unescaped `${article.title}` in markdown YAML front-matter
- Titles containing `:`, `"`, `'`, `#`, newlines will break YAML parsing
- **Fix:** Quote the title value: `title: ${JSON.stringify(article.title)}`
- **When:** Phase 1

**E3. Slug collision (LOW)**

- `slugify()` can produce identical slugs for different titles (e.g. "AI's Impact" and "AI Impact" both become `ai-impact`)
- Second article silently overwrites first
- **Fix:** Not blocking for v1. Document as known limitation. Future: append date or hash suffix on collision.

**E4. Inconsistent error handling in `score.js:moveToReview()` (MEDIUM)**

- Raw HTML rename has try/catch, but .json and .md renames do not
- If .json rename succeeds but .md rename fails: article split across directories
- **Fix:** Wrap all three renames in a single try/catch. On failure: log error, leave article in original location.
- **When:** Phase 1

### 14.2 New component edge cases

**E5. `scripts/lib/lock.js` — Race conditions**

| Scenario | Fix |
|----------|-----|
| Stale lock after crash | PID check + steal if PID is dead |
| Two processes check lock simultaneously | `{ flag: 'wx' }` atomic create — second process gets EEXIST |
| Stale lock with PID reuse | Store PID + timestamp. If lock >2hrs AND process name doesn't contain 'bun'/'node', treat as stale |

**E6. `scripts/lib/prompt.js` — Template rendering failures**

| Scenario | Fix |
|----------|-----|
| Missing placeholder variable | `renderPrompt()` throws with variable name — intentional (catches typos). `runStage()` catches it. |
| Malformed YAML frontmatter | Validate exactly 2 `---` fences exist. Throw with prompt file name. |
| Empty prompt file | Check `raw.length > 0` before parsing. Throw descriptive error. |

**E7. `scripts/lib/week.js` — Date boundary edge cases**

| Scenario | Fix |
|----------|-----|
| ISO Week 1 in December | Use `getISOWeekYear()` from date-fns (not `getFullYear()`) everywhere |
| Week 53 years | date-fns handles correctly — no special handling needed |
| Invalid date input | Validate with `isValid()` from date-fns. Throw descriptive error. |

**E8. `scripts/draft.js` — LLM response failures**

| Scenario | Fix |
|----------|-----|
| Theme selection returns invalid JSON | Same JSON extraction regex as score.js. After 3 failures: use generic theme ("This week in AI"), log warning |
| Draft truncated (hit max_tokens) | Check `stop_reason: 'end_turn'` vs `'max_tokens'`. If truncated: append `[TRUNCATED]` marker. Self-review will flag it. |
| Model returns prohibited language | Expected occasionally. Self-review flags it. Not a pipeline failure. |
| `response.content[0]` undefined | Check `response.content?.length > 0`. If empty: treat as API failure, trigger retry. |
| Token budget exceeded after truncation | Hard minimum 2 articles/sector. If still over: increase max_tokens, log warning. 200K context gives massive headroom. |
| Previous report missing (first run) | `loadPreviousReport()` returns null. Prompt receives 'Not available (first issue)'. Theme selection works without it. |

**E9. `scripts/review.js` — Review-specific failures**

| Scenario | Fix |
|----------|-----|
| Self-review returns FAIL | NOT a pipeline failure. Draft delivered with ReviewResult JSON. Notification shows issue count. |
| Self-review API fails entirely | Draft delivered with UNREVIEWED prefix. Pipeline continues. |
| False positive in prohibited language | Scott reviews flagged items, makes final call. Review is advisory. |
| ReviewResult JSON is malformed | Same JSON extraction regex. If fails after retries: skip review, UNREVIEWED warning. |

**E10. `scripts/verify-links.js` — Network failures**

| Scenario | Fix |
|----------|-----|
| All links dead/timeout (offline) | If >80% fail with network errors: log "Network appears unavailable", skip, deliver with UNCHECKED warning |
| Paywall domains | Reuse `isPaywalled()` from extract.js. Return `{ status: 'paywall' }` — informational, not an error |
| Rate limiting by target sites | 1.5s delay between ALL requests. Extra 3s between same-domain requests. |
| Infinite redirect loops | Accept browser default (20 redirects). On redirect error: return `{ status: 'dead', error: 'redirect_loop' }` |
| JavaScript-rendered content (SPAs) | Accept limitation. `fetchPage()` gets raw HTML only. Flag as `content_mismatch`. Document as known limitation. |

**E11. `scripts/notify.js` — iMessage failures**

| Scenario | Fix |
|----------|-----|
| Messages.app not running | AppleScript launches it. 10s timeout via Bun.spawn. |
| Recipient not iMessage-capable | Catch osascript error. Fallback: write to `output/notification-week-{N}.txt` |
| Special characters in message | Escape `"` → `\"`, `\` → `\\`. Newlines preserved (iMessage supports multi-line). |
| Mac in clamshell/screen locked | iMessage still sends (no screen interaction required). |

**E12. `scripts/pipeline.js` — Orchestration failures**

| Scenario | Fix |
|----------|-----|
| launchd double-fire (wake from sleep) | Lock file (E5) prevents concurrent runs. Second process exits cleanly. |
| Stage dependency cascade (fetch fails) | Each stage checks prerequisites. Score runs on articles from previous daily runs. Draft with 0 articles generates "light week" or falls back to research pack. |
| SIGKILL mid-run | `finally` block calls `releaseLock()`. For uncatchable SIGKILL: stale lock detection on next run. |
| Disk space exhaustion | Check at pipeline start. <100MB: warn. <10MB: abort. `Bun.spawn(['df', '-k', ROOT])`. |

**E13. `scripts/update-off-limits.js` — Extraction failures**

| Scenario | Fix |
|----------|-----|
| Published report format changes | If 0 stories extracted: warn and abort. Do not write empty week to YAML. |
| Company name extraction fails | Use full heading text as both company and topic. Log warning. |
| YAML write corruption | Read existing, parse, modify in-memory, dump. If parse fails: abort (do not overwrite valid data). |
| Duplicate false positive | Require company match AND ≥50% keyword overlap. "Apple AI Siri" and "Apple AI overhaul" are distinct (different topics). |

### 14.3 Failure mode summary table

| Component | Failure | Severity | Pipeline action | User sees |
|-----------|---------|----------|-----------------|-----------|
| fetch.js | RSS/Brave feed errors | LOW | Log, continue with remaining sources | "N feed errors" |
| fetch.js | Disk full on article save | HIGH | Skip article, continue (after fix) | Pipeline continues |
| score.js | API failure (all retries) | MEDIUM | Heuristic fallback (built-in) | "Heuristic fallback used" |
| score.js | writeFileSync fails | HIGH | Skip article, continue (after fix) | Pipeline continues |
| report.js | Zero articles for week | LOW | Generate empty report | "0 articles found" |
| draft.js | Theme selection fails | MEDIUM | Use generic theme, continue | "Generic theme used" |
| draft.js | Draft generation fails (all models) | HIGH | Deliver research pack | "Research pack only" |
| draft.js | Response truncated (max_tokens) | MEDIUM | Deliver truncated draft + marker | Self-review flags it |
| review.js | API failure (all retries) | LOW | Skip, deliver with UNREVIEWED | "UNREVIEWED" |
| review.js | Review finds issues | LOW | Deliver draft + issue list | "FAIL (N issues)" |
| verify-links.js | Network unavailable | LOW | Skip, deliver with UNCHECKED | "UNCHECKED" |
| verify-links.js | Content mismatch | LOW | Flag in results | "N mismatches" |
| notify.js | iMessage send fails | LOW | Write to file as fallback | File at output/notification-week-N.txt |
| pipeline.js | Lock contention | LOW | Second process exits | "Already running" |
| pipeline.js | SIGKILL mid-run | MEDIUM | Stale lock detection next run | Next run steals lock + warns |
| pipeline.js | Disk space <10MB | HIGH | Abort before starting | "Insufficient disk space" |
| update-off-limits.js | Zero stories extracted | MEDIUM | Abort, don't write YAML | "No stories found" |
| week.js | Invalid date input | LOW | Throw descriptive error | Stage fails, logged |
| prompt.js | Missing template variable | LOW | Throw with variable name | Stage fails, logged |
| lock.js | Race condition on create | LOW | Atomic `wx` flag | Second process exits |

---

## Appendix: Gaps closed

28 gaps identified across two rounds of codebase exploration, all resolved in this spec:

| # | Gap | Resolution |
|---|-----|------------|
| 1 | Pipeline state/resumability | Run summary JSON saved to output/runs/. Full resumability is P1. |
| 2 | Concurrency/locking | File-based lock via scripts/lib/lock.js with atomic creation. |
| 3 | Token counting | js-tiktoken added. countTokens() in prompt.js. Budget-aware truncation in draft.js. |
| 4 | Model fallback chain | Primary → 3x retry → secondary model → 3x retry → deliver research pack. |
| 5 | Published save-back | Manual copy to output/published/week-N.md. Automate via Substack API in P2. |
| 6 | Week number broken | Fix with date-fns in scripts/lib/week.js. Replace naive calculation in report.js. |
| 7 | Article volume variability | Score persistence enables confidence-based truncation when token budget exceeded. |
| 8 | Zero-article sectors | Prompt handles gracefully: one-line note in body, skip in tl;dr. |
| 9 | Existing script modifications | --week flag (fetch.js), score persistence (score.js), week calc fix (report.js). All get import.meta.main guard. |
| 10 | Config/prompts bootstrap | Phase 1 day-1 tasks: create dirs, extract prompts, save reference reports. |
| 11 | Off-limits extraction | Deterministic heading parser. 42-entry Week 9 ground truth for regression testing. |
| 12 | Draft structure validation | Full checklist in self-review prompt: 7 categories, ~20 checks. |
| 13 | Link verification depth | Shallow entity match: fetch page, check anchor-text entity in content. |
| 14 | iMessage AppleScript | osascript via Bun.spawn. Multi-line. Fallback to file. |
| 15 | launchd missed execution | StartCalendarInterval + pmset wake schedule. Pipeline uses current date. |
| 16 | Scripts not importable | Refactor to export function + import.meta.main guard. Pipeline imports directly. |
| 17 | API message structure | Score uses user-only messages. Draft/review use system + user (SDK system: parameter). |
| 18 | Sector display name inconsistency | config/sector-names.yaml as single source of truth. Three naming schemes mapped. |
| 19 | Override rate measurement | scripts/measure-override.js using diff package. diffWords() for word-level comparison. |
| 20 | Self-review behaviour ambiguity | Flags only, does NOT re-generate. UNREVIEWED on API failure. Pipeline never blocks. |
| 21 | Research context format | Exact markdown format documented. Differs from report.js (simpler, confidence-sorted). |
| 22 | Draft calibration data | Week 9 word counts per section. tl;dr 68 words, body 425-1390 words/sector. |
| 23 | Unprotected writeFileSync | All writeFileSync/renameSync across existing scripts lack error handling. Fix in Phase 1. |
| 24 | YAML front-matter injection | extract.js saveArticle() uses unescaped title. Fix: JSON.stringify for YAML values. |
| 25 | Lock file race condition | Atomic { flag: 'wx' }. Stale detection via PID + age + process name. |
| 26 | LLM response edge cases | Empty content, max_tokens truncation, non-JSON — all have explicit checks + fallbacks. |
| 27 | Network-wide link check failure | >80% network errors: skip verification, deliver with UNCHECKED warning. |
| 28 | Disk space pre-check | Pipeline checks disk at start. <100MB: warn. <10MB: abort. |

---

## Verification checklist

After each phase, verify:

### Phase 1
- [ ] `bun scripts/fetch.js --week 9` produces same articles as a manual date-range run
- [ ] `bun scripts/score.js` persists `confidence` and `score_reason` to article JSON files
- [ ] `bun scripts/report.js` produces correct ISO week number for boundary dates (Dec 31 → Week 1)
- [ ] All three scripts still work as CLI tools (`bun scripts/fetch.js --start-date ... --end-date ...`)
- [ ] All three scripts can be imported: `import { runFetch } from './fetch.js'` does not crash
- [ ] `bun scripts/update-off-limits.js output/published/week-9.md` extracts ~42 stories
- [ ] `bun scripts/measure-override.js --draft ... --published ...` produces override percentage

### Phase 2
- [ ] `bun scripts/draft.js --week 9 --dry-run` prints token counts and article counts without API calls
- [ ] `bun scripts/draft.js --week 9` generates a draft matching the Section 11 structural template
- [ ] `bun scripts/review.js --draft output/draft-week-9.md` returns a valid ReviewResult JSON
- [ ] `bun scripts/verify-links.js --draft output/draft-week-9.md` checks all links and produces summary
- [ ] Override rate: `measure-override.js` on generated draft vs published Week 9 shows baseline

### Phase 3
- [ ] `bun scripts/pipeline.js --mode friday --week 9 --dry-run` prints full execution plan
- [ ] `bun scripts/pipeline.js --mode friday --week 9` runs all stages end-to-end
- [ ] Lock file prevents second concurrent pipeline run
- [ ] iMessage notification arrives (or fallback file is created)
- [ ] `output/runs/pipeline-{date}.json` contains complete PipelineContext with all StageResults
- [ ] launchd plist files load without errors
