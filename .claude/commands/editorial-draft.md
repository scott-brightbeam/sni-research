Generate a weekly newsletter draft, run external critique, and revise.

## Instructions

1. Read `data/editorial/state.json` for themes, analysis entries, and post backlog
2. Read articles from `data/verified/` for the current week (scan date directories)
3. Read the previous newsletter from `data/editorial/drafts/` (most recent `draft-session-*-final.md`)
4. Read `config/prompts/draft-system.md` for voice, structure and geographic balance
5. Read `config/prompts/draft-write.md` for story selection and formatting
6. Read `config/prompts/tl-dr-voice.md` for the tl;dr editorial prose standard
7. Read `config/prompts/editorial-context.v1.txt` for the full editorial voice and writing rules

Generate the newsletter with these sections:
- **tl;dr** — narrative editorial prose following `config/prompts/draft-system.md` and `config/prompts/tl-dr-voice.md`
- **AI & Technology** — general AI developments
- **Biopharma** — AI in drug discovery, clinical trials, pharma
- **Medtech** — AI in medical devices, digital health
- **Manufacturing** — AI in factories, supply chain, semiconductors
- **Insurance** — AI in underwriting, claims, regulation
- **Podcast Analysis** — cross-cutting themes from this week's podcasts

Apply ALL writing style rules from the editorial context prompt. UK English, spaced en-dashes, single quotes, active voice, no prohibited language.

6. Write the draft to `data/editorial/drafts/draft-session-{N}-v1.md`
7. Run critique: `bun scripts/editorial-draft.js --critique-only --session {N}`
8. Read `data/editorial/drafts/critique-session-{N}.json`
9. Synthesise the Gemini and GPT critique — identify the strongest points from each
10. Generate a revised draft incorporating the critique
11. Run source-claim verification on the revised draft: for each factual claim, confirm the linked source article actually contains the stated information. Use `config/prompts/draft-source-verify.md`. Flag any UNVERIFIED claims with `[Editorial note: verify]`.
12. Run the self-review checklist (`config/prompts/self-review.md`) on the revised draft. This catches any prohibited language, formatting violations or structural issues introduced during revision. The draft must pass self-review before finalising.
13. Write to `data/editorial/drafts/draft-session-{N}-final.md`
14. Report: sections written, word count, critique highlights, key changes in revision, source verification results (verified/unverified/no-source counts)
