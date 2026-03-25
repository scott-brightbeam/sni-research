Coordinate the Thursday weekly newsletter pipeline.

## Instructions

This skill orchestrates the weekly newsletter production. Some stages run automatically via launchd (fetch, score, report). Claude Code handles the stages that previously required the Anthropic API (draft, review, revision).

### 1. Check pipeline status

Read `output/runs/` for this week's run files. Verify:
- Daily fetch has been running (check last 7 `pipeline-*.json` files)
- Score stage completed (heuristic mode is acceptable)
- Report stage generated `output/*-research.md`

### 2. Verify story references are resolved

Check all `data/editorial/stories-session-*.json` files from this week.
Count entries where `url` is null vs resolved.
If any remain unresolved, use WebSearch to find them inline (same process as /editorial-discover).
The daily editorial-discover task (09:00) should have already resolved most stories — this is the catch-up step.

### 3. Generate newsletter draft

Follow the `/editorial-draft` skill instructions:
- Read state, articles, previous newsletter
- Generate draft with all six sections
- Write to `data/editorial/drafts/draft-session-{N}-v1.md`

### 4. Run external critique

`bun scripts/editorial-draft.js --critique-only --session {N}`
This runs Gemini + GPT critique pair (no Anthropic needed).

### 5. Revise based on critique

Read critique JSON, synthesise feedback, generate revised draft.
Write to `data/editorial/drafts/draft-session-{N}-final.md`

### 6. Run evaluation

`bun scripts/select.js --week {N}` — uses OpenAI + Gemini for dual-model scoring (no Anthropic).

### 7. Present for review

Display the final draft sections, word counts, critique highlights, and evaluation scores.
Ask Scott for approval or revision requests.

### 8. Notify

Send Telegram notification via Zaphod: "Newsletter draft for week {N} ready for review."
