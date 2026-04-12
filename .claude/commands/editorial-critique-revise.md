Run external critique and revision on an existing newsletter draft.

Use this skill when the draft (v1) has already been generated but critique and revision did not run — typically because the pipeline exhausted its context window during draft generation.

## Instructions

1. Scan `data/editorial/drafts/` for files matching `draft-session-*-v1.md`. For each, check whether a matching `draft-session-*-final.md` exists. Select the highest-numbered session that has a v1 draft but NO final draft. If no unfinished draft exists, report 'No unfinished drafts found' and stop.
2. Extract the session number N from the filename
3. Check if `data/editorial/drafts/critique-session-{N}.json` already exists and contains valid data (non-empty `gemini` or `openai` fields with `raw` content)
   - If NO or empty/corrupt: run critique: `/Users/scott/.bun/bin/bun scripts/editorial-draft.js --critique-only --session {N}`
   - If YES: skip to step 4
4. Read `data/editorial/drafts/critique-session-{N}.json`
5. Read `data/editorial/drafts/draft-session-{N}-v1.md`
6. Read `config/prompts/draft-system.md` for voice, structure and formatting rules
7. Read `config/prompts/draft-write.md` for story selection and quality rules
8. Read `config/prompts/tl-dr-voice.md` for the tl;dr editorial prose standard
9. Read `config/prompts/podcast-commentary.md` for podcast section format

## Critique synthesis

Synthesise the Gemini and GPT critiques. Categorise issues by severity:
- **High**: banned words/constructions, URL overlap in podcast section, US spellings, factual accuracy concerns
- **Medium**: analytical depth, cross-sector connections, enterprise implications
- **Low**: minor style, duplication between bullets and body

## Revision

Generate a revised draft addressing all high-severity issues and as many medium-severity issues as possible. Specifically:

1. Remove all banned words and constructions (see `config/prompts/draft-system.md` prohibited language list)
2. Fix all 'not X but Y' constructions — use comparative phrasing instead
3. Ensure zero URL overlap between podcast section and tl;dr/body sections
4. Rewrite podcast section as cross-episode analytical synthesis with argumentative headings
5. Fix all US spellings to UK English
6. Ensure currency format uses abbreviated units ($Xbn, $Xm — never 'billion' or 'million')
7. Verify single quotes, spaced en dashes, no Oxford commas throughout
8. Strengthen enterprise implications where flagged
9. Add cross-sector connections where natural (audit trail/traceability pattern across insurance, medtech, biopharma)
10. Hedge any claims flagged as weakly sourced

## Source verification

After generating the revised draft, run source-claim verification:
1. For each factual claim with a markdown link, find the matching article in `data/verified/`
2. Compare the claim against the article content
3. Classify each as VERIFIED, PARAPHRASED, UNVERIFIED or NO SOURCE
4. Flag any UNVERIFIED claims with `[Editorial note: verify]` in the draft text

## Self-review

Read `config/prompts/self-review.md` (if it exists) and run its checklist. Then run these automated checks:

1. Run banned word check: search the draft for every word in the prohibited language list
2. Run URL overlap check: confirm zero URL overlap between podcast section and all other sections
3. Run currency format check: search for 'billion' and 'million' in body text (URLs are exempt)
4. Run construction check: search for 'not X but Y', rhetorical questions, double quotes
5. Run UK English check: search for common US spellings (capitalize, center, personalize, organize, analyze, optimize, utilize)

If any issues are found, fix them before writing the final draft.

## Output

1. Write the revised draft to `data/editorial/drafts/draft-session-{N}-final.md`
2. Report:
   - **Session:** N
   - **v1 word count** vs **final word count**
   - **Critique highlights:** top 3-5 points addressed
   - **Key changes:** what was revised and why
   - **Source verification:** verified/paraphrased/unverified/no-source counts
   - **Self-review:** pass/fail, any remaining warnings
