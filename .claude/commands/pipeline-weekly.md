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

The draft must follow the Week 13 published structure: welcome line → tl;dr editorial prose → sector bullets inline → expanded sector analysis → podcast commentary with zero URL overlap. The authoritative prompt pairing is draft-system.md (system) + draft-write.md (user). Do not load editorial-draft.v1.txt.

Follow the `/editorial-draft` skill instructions:
- Read state, articles, previous newsletter
- Generate draft with all six sections
- Write to `data/editorial/drafts/draft-session-{N}-v1.md`

### 4. Pre-critique structural verification

Before spending API tokens on critique, verify the draft meets minimum structural requirements. Read `data/editorial/drafts/draft-session-{N}-v1.md` and check:

1. **tl;dr is prose, not bullets** — the section after `## tl;dr:` must be paragraphs, not a bulleted list. If it's bullets, stop and regenerate.
2. **All five sector labels present** — `In AI & tech`, `Biopharma:`, `Medtech:`, `Advanced Manufacturing:`, `Insurance:` (skip any sector with zero stories)
3. **Podcast section exists** — `## But what set podcast tongues a-wagging?` with at least 2 sub-sections
4. **Podcast URLs don't duplicate sector URLs** — extract all markdown links from both sections, check for overlap. If any URL appears in both, flag it.
5. **Geographic balance** — at least 2 stories from non-US sources across all sections. If missing, flag for the editor.
6. **Word count** — tl;dr should be 400-800 words. Total draft 2,500-4,000 words. Flag if outside range.

If checks 1-3 fail, regenerate the draft before proceeding. If checks 4-6 fail, note the issues but proceed — the critique can address them.

### 5. Run external critique

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
