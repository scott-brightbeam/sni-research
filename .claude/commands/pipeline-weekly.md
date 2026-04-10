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

The draft must follow the lean format defined in `config/prompts/draft-system.md`: title line → welcome line → tl;dr prose → transition line → five H3 sector bullet sections → podcast section → closing line. The authoritative prompt pairing is `draft-system.md` (system) + `draft-write.md` (user). Do NOT load `editorial-context.v1.txt` — it contains legacy format examples superseded by draft-system.md.

Follow the `/editorial-draft` skill instructions:
- Read state, articles, previous newsletter
- Pre-flight: list this week's podcast digests from `data/podcasts/manifest.json` — every podcast reference in the draft must come from this list
- Generate draft → `data/editorial/drafts/draft-session-{N}-v1.md`

### 4. Pre-critique structural verification

Before spending API tokens on critique, verify the draft meets minimum structural requirements. Read `data/editorial/drafts/draft-session-{N}-v1.md` and check:

1. **Title line** — `# SNI: Week N` on line 1
2. **Welcome line** — exact phrasing starting with "Welcome to all the AI news that matters this week"
3. **tl;dr is prose, not bullets** — the section after `## tl;dr:` must be paragraphs. If it's bullets, stop and regenerate.
4. **Transition line** — `Here's everything else worth reading this week:`
5. **Five H3 sector headings in order** — `### AI & tech:`, `### Biopharma:`, `### Medtech:`, `### Advanced manufacturing:`, `### Insurance:`. All five must appear — never skipped.
6. **Each sector has 3-5 bullet stories** — each bullet format `- [Headline](url): one sentence`. Flag any sector under 3.
7. **Podcast section exists** — `## But what set podcast tongues a-wagging?` with 3-4 items
8. **Geographic balance** — at least 2 stories from non-US sources across all sections. Flag if missing.
9. **Word count** — total 1,800-2,800 words target. Fail boundary: <1,500 or >3,500.

If checks 1-7 fail, regenerate the draft before proceeding. If checks 8-9 fail, note the issues but proceed — the critique can address them.

### 5. Run external critique

`bun scripts/editorial-draft.js --critique-only --session {N}`
This runs Gemini + GPT critique pair (no Anthropic needed).

### 6. Revise based on critique

Read critique JSON, synthesise feedback, generate revised draft.
Write to `data/editorial/drafts/draft-session-{N}-v2.md`

### 7. Mandatory hallucination gate

Run the deterministic verifier. This is the ONLY way `draft-session-{N}-final.md` and `output/draft-week-{W}.md` can be created — a PreToolUse hook blocks any other writer.

```bash
bun scripts/editorial-verify-draft.js \
  --input data/editorial/drafts/draft-session-{N}-v2.md \
  --output-session data/editorial/drafts/draft-session-{N}-final.md \
  --output-week output/draft-week-{W}.md \
  --week {W} \
  --year {Y}
```

On pass (exit 0): verifier has written the final files and `.verified` sidecars. Proceed.
On fail (exit 1): read `logs/verification/week-{W}-*-FAILED.md`, fix the affected sections (usually the podcast section — check references against `data/podcasts/` digests), save as new `-v2.md`, re-run. Max 3 retries. After 3 failures, STOP and alert Scott with the failure report path.
On error (exit 2): operational issue. Report and stop.

### 6. Run evaluation

`bun scripts/select.js --week {N}` — uses OpenAI + Gemini for dual-model scoring (no Anthropic).

### 7. Present for review

Display the final draft sections, word counts, critique highlights, and evaluation scores.
Ask Scott for approval or revision requests.

### 8. Notify

Send Telegram notification via Zaphod: "Newsletter draft for week {N} ready for review."
