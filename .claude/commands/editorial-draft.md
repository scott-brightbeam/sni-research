Generate a weekly newsletter draft, run external critique, revise, and verify — with hard hallucination gates.

## Format reference

The current newsletter format is the lean layout defined in `config/prompts/draft-system.md`:
- Title line `# SNI: Week N`
- Welcome line (exact phrasing)
- `## tl;dr: [theme]` heading + 5-8 prose paragraphs weaving 5-10 stories
- `Here's everything else worth reading this week:` transition
- Five H3 sector bullet sections: AI & tech, Biopharma, Medtech, Advanced manufacturing, Insurance — 3-5 bullets each, format `- [Headline](url): one sentence`
- Podcast section `## But what set podcast tongues a-wagging?` with 3-4 items
- Closing line

Total target: 1,800-2,800 words. Fail boundary: <1,500 or >3,500.

## Instructions

1. Read `data/editorial/state.json` for themes, analysis entries, and post backlog
2. Read articles from `data/verified/` for the current week (scan date directories)
3. Read the previous newsletter from `data/editorial/drafts/` (most recent `draft-session-*-final.md`)
4. Read `config/prompts/draft-system.md` for voice, structure and format
5. Read `config/prompts/draft-write.md` for story selection and bullet format
6. Read `config/prompts/tl-dr-voice.md` for the tl;dr prose standard
7. Read `config/prompts/podcast-commentary.md` — pay attention to the MANDATORY PRE-FLIGHT section

**PRE-FLIGHT FOR PODCAST SECTION:**
Read `data/podcasts/manifest.json` and filter entries where `week === {current week}`. For each, read the digest at `digestPath`. Build a whitelist of `{source, host, title, url/episodeUrl}` tuples. Every podcast reference in the draft's podcast section MUST come from this list. If you cannot produce a quality podcast section from the available digests, write a shorter section or drop a sub-heading — never invent references.

Generate the newsletter with these sections (see `draft-system.md` for exact structure):
- **Title line** — `# SNI: Week N`
- **Welcome line** — exact phrasing
- **tl;dr** — 5-8 paragraphs of narrative prose weaving the week's dominant stories
- **Transition line** — `Here's everything else worth reading this week:`
- **AI & tech** — `### AI & tech:` with 3-5 bulleted stories, each `- [Headline](url): one sentence`
- **Biopharma** — `### Biopharma:` with 3-5 bullets
- **Medtech** — `### Medtech:` with 3-5 bullets
- **Advanced manufacturing** — `### Advanced manufacturing:` with 3-5 bullets
- **Insurance** — `### Insurance:` with 3-5 bullets
- **Podcast section** — `## But what set podcast tongues a-wagging?` with 3-4 items (1 opener + 2-3 sub-headed items)
- **Closing line**

Apply ALL writing style rules from draft-system.md. UK English, spaced en-dashes, single quotes, active voice, no prohibited language. Do NOT load `editorial-context.v1.txt` — it contains legacy format examples superseded by draft-system.md.

## Workflow

1. **Generate v1**: Write the initial draft to `data/editorial/drafts/draft-session-{N}-v1.md`
2. **Critique**: Run `bun scripts/editorial-draft.js --critique-only --session {N}`
3. **Read critique**: Load `data/editorial/drafts/critique-session-{N}.json`
4. **Synthesise and revise**: Identify the strongest points from Gemini and GPT, rewrite as `data/editorial/drafts/draft-session-{N}-v2.md`
5. **Source-claim verification**: For each factual claim in v2, confirm the linked source article actually contains the stated information. Use `config/prompts/draft-source-verify.md`. Flag any UNVERIFIED claims with `[Editorial note: verify]`.
6. **Self-review**: Run the self-review checklist (`config/prompts/self-review.md`) on v2. The draft must pass self-review before the verification gate.

7. **MANDATORY HALLUCINATION GATE** — the deterministic verifier that produces the final files:

```bash
bun scripts/editorial-verify-draft.js \
  --input data/editorial/drafts/draft-session-{N}-v2.md \
  --output-session data/editorial/drafts/draft-session-{N}-final.md \
  --output-week output/draft-week-{W}.md \
  --week {W} \
  --year {Y}
```

Exit codes:
- **0 (pass)**: the verifier has written `draft-session-{N}-final.md` and `output/draft-week-{W}.md` along with their `.verified` sidecars. Done. The PreToolUse hook enforces that these files cannot be written by any other process.
- **1 (fail)**: verification failed. No output files were written. Read the failure report at `logs/verification/week-{W}-*-FAILED.md`. For each violation:
  - **Podcast reference failure**: rewrite the affected line using only verified whitelist entries from the pre-flight list. Do not paraphrase podcast URLs — copy them exactly from the digest JSON.
  - **Corpus URL failure**: either remove the citation or replace with a URL that exists in `data/verified/`.
  - **Structure failure**: fix the layout to match draft-system.md.
  - **Blocklist hit**: remove the named reference entirely.
  Save the corrected version as a new `-v2.md` (overwrite) and re-run the verifier. Maximum 3 retry rounds. If still failing after 3 rounds, STOP and report to Scott with the failure report path.
- **2 (operational error)**: missing input, bad config. Report and stop — do not retry blindly.

8. **Report results** to Scott: word count, critique highlights, verifier pass/fail summary, any warnings.

## Notes

- Draft generation writes `-v1.md` and `-v2.md` directly; these are working files.
- Only the verifier script can write `-final.md` and `output/draft-week-*.md`. A PreToolUse hook (`.claude/hooks/verify-draft-write.py`) blocks any direct Write to these paths unless a matching `.verified` sidecar exists with a SHA-256 hash matching the content.
- On verification failure, a sentinel flag file `data/editorial/drafts/VERIFICATION-FAILED.flag` is written and a Telegram alert is sent via Zaphod. The web UI reads the flag and displays a warning.
- The known-hallucinated podcast blocklist is at `config/podcast-name-blocklist.yaml`. Add new entries when new hallucinations are discovered.
- The editor override URL file is at `config/editorial-verified-urls.txt`. Use SPARINGLY — each entry should have a one-line comment explaining why.
