# Editorial DRAFT Pipeline Design

## Purpose

The DRAFT pipeline is the third stage of the editorial intelligence system (ANALYSE -> DISCOVER -> DRAFT -> TRACK). It generates the weekly SNI newsletter by synthesising the accumulated editorial state through a generate -> critique -> revise loop using the three-model architecture.

## Architecture

### Three-model flow

1. **Opus 4.6** generates the initial newsletter draft from editorial state
2. **Gemini 3.1 Pro + GPT-5.4** critique the draft in parallel (independent perspectives)
3. **Opus 4.6** revises based on merged critique feedback
4. Artifacts saved: draft versions, critique JSON, metrics

Both critique models receive the identical prompt and system message via `callCritiqueModels()`.

### Why fixed two-pass (not adaptive loop)

- Single critique round catches the highest-impact issues
- Predictable cost (~$2-4 per draft) vs unbounded adaptive loops
- Diminishing returns from additional passes do not justify the cost
- Matches the existing `callCritiqueModels()` in editorial-multi-model.js

## File structure

```
config/prompts/
  editorial-draft.v1.txt        # Draft generation instructions for Opus
  editorial-critique.v1.txt     # Critique instructions for Gemini + GPT
  editorial-revise.v1.txt       # Revision instructions for Opus

scripts/lib/
  editorial-draft-lib.js        # Pure business logic (testable, no I/O)
  editorial-draft-lib.test.js   # Tests

scripts/
  editorial-draft.js            # Orchestrator (CLI, I/O, LLM calls, prompt loading)

data/editorial/drafts/          # Output directory
  draft-session-{N}-v1.md       # Initial Opus draft
  draft-session-{N}-final.md    # Post-revision final draft
  critique-session-{N}.json     # Critique responses + merged feedback
  metrics-session-{N}.json      # Draft quality metrics
```

## Pure business logic (editorial-draft-lib.js)

All functions are pure (no file I/O, no side effects). Prompt loading lives in the orchestrator; template rendering lives here.

### Newsletter section constants

```javascript
const NEWSLETTER_SECTIONS = [
  'introduction',       // tl;dr opening with cross-section synthesis
  'general-ai',         // AI & Technology
  'biopharma',          // Biopharma
  'medtech',            // Medtech
  'manufacturing',      // Manufacturing
  'insurance',          // Insurance
  'podcast-analysis',   // Podcast synthesis (cross-episode themes, not recaps)
]
```

### Section heading aliases

Map alternative headings to canonical section names:
- `introduction`: 'tl;dr', 'introduction', 'summary', 'this week'
- `general-ai`: 'ai & technology', 'ai and technology', 'general ai', 'ai & tech'
- `biopharma`: 'biopharma', 'bio pharma', 'pharma'
- `medtech`: 'medtech', 'med tech', 'medical technology'
- `manufacturing`: 'manufacturing'
- `insurance`: 'insurance'
- `podcast-analysis`: 'podcast analysis', 'podcast', 'podcasts', 'podcast insights'

### Exported functions

#### `extractDraftMarkdown(rawResponse)`

Extract clean markdown from Opus response text. Opus may wrap the draft in preamble ('Here is the draft...') or code fences. Strips those to get pure markdown.

- Input: `string` (raw Opus response)
- Output: `string` (clean markdown)
- Edge cases: empty response returns empty string, no markdown found returns the raw response trimmed, response already clean markdown passes through unchanged
- If extraction yields empty string, caller should abort with error

#### `parseDraftSections(markdown)`

Parse newsletter markdown into labelled sections by splitting on `##` headings and matching against section heading aliases.

- Input: `string` (markdown)
- Output: `{ sections: Array<{ name: string, heading: string, content: string, wordCount: number }>, unmatched: string[] }`
- Matching: case-insensitive against heading aliases above

#### `validateDraftStructure(parsedSections)`

Validate that a draft has the required structure.

- Input: parsed sections from `parseDraftSections`
- Output: `{ valid: boolean, missing: string[], warnings: string[] }`
- `valid: false` if any required section is missing
- Warnings for: sections under 50 words, total word count under 800 or over 3000

#### `calculateDraftMetrics(markdown)`

Calculate quality metrics for a draft.

- Input: `string` (markdown)
- Output: `{ wordCount: number, sectionCount: number, readingTimeMinutes: number, sectionWordCounts: Record<string, number>, averageSectionWords: number }`
- Reading time: 250 words/minute

#### `mergeCritiques(critiqueResults)`

Merge critique responses from two models into unified feedback.

- Input: `{ gemini: { provider, raw, error }, openai: { provider, raw, error } }` (matches `callCritiqueModels()` return shape directly)
- Output: `{ merged: string, sources: Array<{ provider: string, available: boolean }>, hasCritique: boolean }`
- If one model fails, use the other's critique alone with a note about single-source limitation
- If both fail, `hasCritique: false` and the revision step is skipped
- Merged format: `## Gemini critique\n\n{text}\n\n## GPT critique\n\n{text}`

#### `renderCritiquePrompt(template, draft, opts)`

Render a pre-loaded critique prompt template with draft content embedded.

- Input: `string` (template text loaded by orchestrator), `string` (draft markdown), `{ themes?: string[], week?: number, sectionNames?: string[] }`
- Output: `string` (complete prompt for critique models)
- Template uses `{draft}`, `{themes}`, `{week}`, `{sections}` placeholders

#### `renderRevisionPrompt(template, draft, mergedCritique, opts)`

Render a pre-loaded revision prompt template with draft and critique feedback.

- Input: `string` (template), `string` (draft), `string` (merged critique), `{ week?: number }`
- Output: `string` (complete prompt for Opus revision)
- Template uses `{draft}`, `{critique}`, `{week}` placeholders

#### `buildDraftArtifact(data)`

Assemble the complete output artifact JSON.

- Input: `{ initialDraft: string, finalDraft: string, critiques: object, metrics: object, session: number, timestamp: string, costs: object }`
- Output:

```javascript
{
  version: 1,
  session: number,
  timestamp: string,
  initialDraft: string,        // v1 markdown
  finalDraft: string,          // post-revision markdown (same as initialDraft if --skip-critique)
  critiques: {
    gemini: { raw, error },    // raw critique text or error
    openai: { raw, error },
    merged: string,            // combined critique text
  },
  metrics: {
    initial: { wordCount, sectionCount, readingTimeMinutes, sectionWordCounts, averageSectionWords },
    final: { wordCount, sectionCount, readingTimeMinutes, sectionWordCounts, averageSectionWords },
  },
  costs: {
    opus: { calls, cost },
    gemini: { calls, cost },
    openai: { calls, cost },
    total: number,
  },
}
```

## Prompt templates

### editorial-draft.v1.txt

Instructions for Opus to generate the newsletter. Appended to the user message after the DRAFT context from `buildDraftContext()`. Key elements:
- Newsletter structure (tl;dr -> sectors -> podcast analysis)
- Cross-section synthesis in the introduction
- Analytical perspective (not summarisation)
- Podcast section: identify podcast-sourced entries in the analysis index and synthesise cross-episode themes (not episode recaps)
- Style rules reference (editorial-context.v1.txt covers these via system prompt)
- Explicit instruction to output only the newsletter markdown (no preamble, no code fences)

### editorial-critique.v1.txt

Instructions for critique models. Template placeholders: `{draft}`, `{themes}`, `{week}`, `{sections}`. Structured evaluation:
1. **Structure** - Are all sections present? Is the flow logical?
2. **Voice** - Does it match Scott's editorial voice? Any prohibited language?
3. **Analysis quality** - Evidence before labels? Specific not generic?
4. **Synthesis** - Does the intro connect cross-section themes?
5. **Podcast section** - Analytical synthesis, not episode recaps?
6. **Accuracy** - Any unsupported claims or misattributions?
7. **Actionable feedback** - Specific suggestions, not vague praise

Output format: numbered critique points, each with section reference and suggested fix.

### editorial-revise.v1.txt

Instructions for Opus revision pass. Template placeholders: `{draft}`, `{critique}`, `{week}`:
- Apply critique feedback selectively (not all feedback is correct)
- Maintain editorial voice during revision
- Preserve what works; fix what does not
- Output only the revised newsletter markdown (no preamble, no code fences)

## Orchestrator (editorial-draft.js)

### CLI interface

```
bun scripts/editorial-draft.js                    # Generate draft for current week
bun scripts/editorial-draft.js --week N           # Generate for specific week
bun scripts/editorial-draft.js --session N        # Use specific ANALYSE session number for output naming
bun scripts/editorial-draft.js --dry-run          # Show context stats, no LLM calls
bun scripts/editorial-draft.js --skip-critique    # Generate only, skip critique/revise
bun scripts/editorial-draft.js --force            # Overwrite existing draft
```

### Week and session resolution

The orchestrator determines the week number and session:
- `--week N`: use directly
- No `--week`: derive from current date using ISO 8601 week number
- `--session N`: use directly for output file naming (`draft-session-{N}`)
- No `--session`: use `state.counters.nextSession - 1` (most recent ANALYSE session)
- DRAFT does NOT call `beginSession()` — it reuses the ANALYSE session number. Sessions are incremented only by ANALYSE.

### Path resolution

- **Previous newsletter:** scan `data/editorial/drafts/` for `draft-session-*-final.md`, pick the most recent
- **Sector articles directory:** `data/verified/` (passed to `buildDraftContext`)
- **Draft context assembly:** `buildDraftContext(week, { sectorArticlesDir, previousNewsletterPath })`

### Podcast data in draft context

Podcast-sourced entries exist in `state.analysisIndex` with `source` matching podcast names from `editorial-sources.yaml`. The draft prompt template (editorial-draft.v1.txt) instructs Opus to identify these entries and synthesise them into the podcast-analysis section. No separate podcast context section is needed in `buildDraftContext()` — the analysis index already contains all the analytical summaries.

### Flow

1. Parse CLI args (`--week`, `--session`, `--dry-run`, `--skip-critique`, `--force`)
2. Validate providers (Anthropic required; OpenAI or Gemini required unless --skip-critique)
3. Load state, resolve week number and session number
4. Check if draft already exists for this session (exit unless --force)
5. Acquire lock (`.draft.lock`) — same pattern as DISCOVER
6. Build DRAFT context via `buildDraftContext(week, opts)` from editorial-context.js
7. Load prompt template (`editorial-draft.v1.txt`) and append to user message
8. Call Opus for initial draft (`rawText: true`, ~16k max tokens, temperature 0.5)
9. Extract markdown via `extractDraftMarkdown()` — if empty, abort with error
10. Validate draft structure via `parseDraftSections()` + `validateDraftStructure()`
11. Save v1 draft to `data/editorial/drafts/draft-session-{N}-v1.md`
12. Unless `--skip-critique`:
    a. Load critique template (`editorial-critique.v1.txt`)
    b. Render critique prompt via `renderCritiquePrompt(template, draft, opts)`
    c. Call Gemini + GPT in parallel via `callCritiqueModels(prompt, { system })`
    d. Merge critiques via `mergeCritiques(result)` (pass result object directly)
    e. If `hasCritique`:
       - Load revision template (`editorial-revise.v1.txt`)
       - Render revision prompt via `renderRevisionPrompt(template, draft, merged, opts)`
       - Call Opus for revision (`rawText: true`)
       - Extract and validate revised draft
    f. Save final draft to `data/editorial/drafts/draft-session-{N}-final.md`
13. Calculate metrics for initial and final drafts
14. Save critique artifact to `data/editorial/drafts/critique-session-{N}.json`
15. Save metrics to `data/editorial/drafts/metrics-session-{N}.json`
16. Release lock
17. Log costs to `data/editorial/cost-log.json` (under `draft` breakdown key)
18. Log activity

### Error handling

- Empty Opus response: abort, log error, release lock
- Empty extracted markdown: abort, log error, release lock
- Both critique models fail: skip revision, save v1 as final draft, log warning
- Revision Opus call fails: save v1 as final draft, log warning
- Any I/O error during save: log error but continue to save remaining artifacts

### Lock file

Same pattern as DISCOVER (not ANALYSE, which has no lock):
- `.draft.lock` with `{ pid, timestamp, session, stage }`
- 30-minute stale detection
- Web API reads lock for status display via existing `getEditorialStatus()`

### Cost logging

Appends to `data/editorial/cost-log.json` under the `draft` breakdown key, same pattern as ANALYSE.

### Token budget reconciliation

- `BUDGETS.draft.total` in `editorial-context.js` = 60k tokens for the initial draft context
- Initial Opus call: ~60k context input + ~8k output = ~$1.50
- Critique calls: ~10k input each (draft only, no full context) = ~$0.10 each
- Revision Opus call: ~60k original context + ~2k draft + ~2k critique + ~8k output = ~$1.60
- **Total: ~$3.30 per draft**

The revision call reuses the original system prompt (from `buildSystemPrompt('draft')`) and appends the revision prompt with draft + critique, staying within Opus's 200k window.

## Web API additions

### Route: GET /api/editorial/draft

```javascript
export async function getEditorialDraft({ session } = {}) {
  // Find latest draft session by scanning data/editorial/drafts/ for draft-session-*-final.md
  // Uses numeric sort (same pattern as getDiscoverProgress)
  // Returns { session, draft: string|null, critique: object|null, metrics: object|null }
}
```

Added to `web/api/server.js` route table and `web/api/routes/editorial.js`.

## Dependencies

All existing, no new packages:
- `editorial-context.js` -> `buildDraftContext()`, `buildSystemPrompt('draft')`
- `editorial-multi-model.js` -> `callOpus()`, `callCritiqueModels()`, `getSessionCosts()`, `resetSessionCosts()`, `validateProviders()`
- `editorial-state.js` -> `loadState()`, `logActivity()`, `addNotification()`
- `prompt-loader.js` -> `loadAndRenderPrompt()` (used by orchestrator only, not lib)

## Known pre-existing issues

- `editorial-context.js` line 288: dead expression `userMessage + '...'` whose result is not assigned. Line 293 performs the correct concatenation. Not caused by this spec; avoid propagating.

## Testing strategy

### editorial-draft-lib.test.js

Pure function tests (no mocks, no I/O):
- `extractDraftMarkdown`: clean markdown, code-fenced, with preamble, empty, already clean
- `parseDraftSections`: all sections present, missing sections, extra/unrecognised sections, empty, alternative headings
- `validateDraftStructure`: valid, missing sections, short sections, over-long draft
- `calculateDraftMetrics`: normal draft, empty, single section, no sections
- `mergeCritiques`: both available, one fails, both fail, empty responses
- `renderCritiquePrompt`: includes draft text, replaces all placeholders, handles missing opts
- `renderRevisionPrompt`: includes draft + critique, replaces placeholders, handles missing critique
- `buildDraftArtifact`: complete data, minimal data, output schema validation
