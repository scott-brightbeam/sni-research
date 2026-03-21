# Editorial DRAFT Pipeline Design

## Purpose

The DRAFT pipeline is the third stage of the editorial intelligence system (ANALYSE -> DISCOVER -> DRAFT -> TRACK). It generates the weekly SNI newsletter by synthesising the accumulated editorial state through a generate -> critique -> revise loop using the three-model architecture.

## Architecture

### Three-model flow

1. **Opus 4.6** generates the initial newsletter draft from editorial state
2. **Gemini 3.1 Pro + GPT-5.4** critique the draft in parallel (independent perspectives)
3. **Opus 4.6** revises based on merged critique feedback
4. Artifacts saved: draft versions, critique JSON, metrics

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
  editorial-draft-lib.js        # Pure business logic (testable)
  editorial-draft-lib.test.js   # Tests

scripts/
  editorial-draft.js            # Orchestrator (CLI, I/O, LLM calls)

data/editorial/drafts/          # Output directory
  draft-session-{N}-v1.md       # Initial Opus draft
  draft-session-{N}-final.md    # Post-revision final draft
  critique-session-{N}.json     # Critique responses + merged feedback
  metrics-session-{N}.json      # Draft quality metrics
```

## Pure business logic (editorial-draft-lib.js)

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

### Exported functions

#### `extractDraftMarkdown(rawResponse)`

Extract clean markdown from Opus response text. Opus may wrap the draft in preamble ('Here is the draft...') or code fences. Strips those to get pure markdown.

- Input: `string` (raw Opus response)
- Output: `string` (clean markdown)
- Edge cases: empty response, no markdown found, response is already clean markdown

#### `parseDraftSections(markdown)`

Parse newsletter markdown into labelled sections by splitting on `##` headings and matching to `NEWSLETTER_SECTIONS`.

- Input: `string` (markdown)
- Output: `{ sections: Array<{ name: string, heading: string, content: string, wordCount: number }>, unmatched: string[] }`
- Matching: case-insensitive, flexible (e.g. 'AI & Technology' matches 'general-ai', 'tl;dr' matches 'introduction')

#### `validateDraftStructure(parsedSections)`

Validate that a draft has the required structure.

- Input: parsed sections from `parseDraftSections`
- Output: `{ valid: boolean, missing: string[], warnings: string[] }`
- Warnings for: sections under 50 words, total word count under 800 or over 3000

#### `calculateDraftMetrics(markdown)`

Calculate quality metrics for a draft.

- Input: `string` (markdown)
- Output: `{ wordCount: number, sectionCount: number, readingTimeMinutes: number, sectionWordCounts: Record<string, number>, averageSectionWords: number }`
- Reading time: 250 words/minute

#### `mergeCritiques(critiqueResults)`

Merge critique responses from two models into unified feedback.

- Input: `Array<{ provider: string, raw: string|null, error: string|null }>`
- Output: `{ merged: string, sources: Array<{ provider: string, available: boolean }>, hasCritique: boolean }`
- If one model fails, use the other's critique alone
- If both fail, `hasCritique: false` and the revision step is skipped

#### `buildCritiquePrompt(draft, opts)`

Build the critique prompt by rendering the template with the draft embedded.

- Input: `string` (draft markdown), `{ themes?: string[], week?: number, sectionNames?: string[] }`
- Output: `string` (complete prompt for critique models)
- Loads `config/prompts/editorial-critique.v1.txt` via prompt-loader

#### `buildRevisionPrompt(draft, mergedCritique, opts)`

Build the revision prompt with draft + critique feedback.

- Input: `string` (draft), `string` (merged critique), `{ week?: number }`
- Output: `string` (complete prompt for Opus revision)
- Loads `config/prompts/editorial-revise.v1.txt` via prompt-loader

#### `buildDraftArtifact(data)`

Assemble the complete output artifact JSON.

- Input: `{ initialDraft: string, finalDraft: string, critiques: object, metrics: object, session: number, timestamp: string, costs: object }`
- Output: `object` (JSON-serialisable artifact)

## Prompt templates

### editorial-draft.v1.txt

Instructions for Opus to generate the newsletter. Key elements:
- Newsletter structure (tl;dr -> sectors -> podcast analysis)
- Cross-section synthesis in the introduction
- Analytical perspective (not summarisation)
- Style rules reference (editorial-context.v1.txt covers these via system prompt)
- Explicit instruction to output only the newsletter markdown (no preamble)

### editorial-critique.v1.txt

Instructions for critique models. Structured evaluation:
1. **Structure** - Are all sections present? Is the flow logical?
2. **Voice** - Does it match Scott's editorial voice? Any prohibited language?
3. **Analysis quality** - Evidence before labels? Specific not generic?
4. **Synthesis** - Does the intro connect cross-section themes?
5. **Podcast section** - Analytical synthesis, not episode recaps?
6. **Accuracy** - Any unsupported claims or misattributions?
7. **Actionable feedback** - Specific suggestions, not vague praise

Output format: numbered critique points, each with section reference and suggested fix.

### editorial-revise.v1.txt

Instructions for Opus revision pass:
- Apply critique feedback selectively (not all feedback is correct)
- Maintain editorial voice during revision
- Preserve what works; fix what does not
- Output only the revised newsletter markdown

## Orchestrator (editorial-draft.js)

### CLI interface

```
bun scripts/editorial-draft.js                    # Generate draft for latest session
bun scripts/editorial-draft.js --session N        # Generate for specific session
bun scripts/editorial-draft.js --dry-run          # Show context stats, no LLM calls
bun scripts/editorial-draft.js --skip-critique    # Generate only, skip critique/revise
bun scripts/editorial-draft.js --force            # Overwrite existing draft
```

### Flow

1. Parse CLI args
2. Validate providers (Anthropic required; OpenAI or Gemini required unless --skip-critique)
3. Load state, determine session number
4. Check if draft already exists (exit unless --force)
5. Acquire lock (.draft.lock)
6. Build DRAFT context via `buildDraftContext()` from editorial-context.js
7. Call Opus for initial draft (rawText mode, ~16k max tokens, temperature 0.5)
8. Extract and validate draft structure
9. Save v1 draft
10. Unless --skip-critique:
    a. Build critique prompt
    b. Call Gemini + GPT in parallel via `callCritiqueModels()`
    c. Merge critiques
    d. If critique available, build revision prompt
    e. Call Opus for revision (rawText mode)
    f. Save final draft
11. Calculate and save metrics
12. Save critique artifact
13. Release lock
14. Log costs, log activity

### Lock file

Same pattern as ANALYSE and DISCOVER:
- `.draft.lock` with `{ pid, timestamp, session, stage }`
- 30-minute stale detection
- Web API reads lock for status display

### Cost logging

Appends to `data/editorial/cost-log.json` under the `draft` breakdown key, same pattern as ANALYSE.

## Web API additions

### Route: GET /api/editorial/draft

```javascript
export async function getEditorialDraft({ session } = {}) {
  // Find latest draft session if not specified
  // Return { session, draft: string|null, critique: object|null, metrics: object|null }
}
```

Added to `web/api/server.js` route table and `web/api/routes/editorial.js`.

## Dependencies

All existing, no new packages:
- `editorial-context.js` -> `buildDraftContext()`, `buildSystemPrompt('draft')`
- `editorial-multi-model.js` -> `callOpus()`, `callCritiqueModels()`, `getSessionCosts()`, `resetSessionCosts()`, `validateProviders()`
- `editorial-state.js` -> `loadState()`, `logActivity()`, `addNotification()`
- `prompt-loader.js` -> `loadAndRenderPrompt()`

## Testing strategy

### editorial-draft-lib.test.js

Pure function tests (no mocks, no I/O):
- `extractDraftMarkdown`: clean markdown, code-fenced, with preamble, empty
- `parseDraftSections`: all sections, missing sections, extra sections, empty
- `validateDraftStructure`: valid, missing sections, short sections
- `calculateDraftMetrics`: normal draft, empty, single section
- `mergeCritiques`: both available, one fails, both fail, empty responses
- `buildCritiquePrompt`: includes draft text, handles missing opts
- `buildRevisionPrompt`: includes draft + critique, handles edge cases
- `buildDraftArtifact`: complete data, minimal data

### Integration (via orchestrator dry-run)

`bun scripts/editorial-draft.js --dry-run` confirms context assembly without LLM calls.

## Cost estimate

Per draft generation:
- Initial Opus call: ~80k input + ~8k output = ~$1.80
- Two critique calls: ~$0.10 each = ~$0.20
- Revision Opus call: ~90k input + ~8k output = ~$1.95
- **Total: ~$3.95 per draft**

Weekly budget impact: one draft per week = ~$4 out of $50 budget (8%).
