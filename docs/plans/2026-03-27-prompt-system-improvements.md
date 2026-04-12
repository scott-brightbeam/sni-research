# SNI Prompt System Improvement Plan (v2)

Based on the comprehensive evaluation (13,867 words, 33 prompts, 10 dimensions, maturity 7/10) and three independent feasibility reviews that verified every change against the actual files on disk.

## Current state

- 16 STRONG prompts (no changes)
- 14 ADEQUATE prompts (targeted improvements)
- 3 WEAK prompts (#10 master voice, #30 chat system, #33 editorial-draft.v1 — the third is handled by retirement)
- 1 REDUNDANT prompt (#33 editorial-draft.v1.txt — retire)
- 4 gaps identified (tl;dr voice, podcast commentary, geographic balance at selection, source-claim verification)
- 3 redundancies (1 retire, 2 keep as intentional layering)

## Corrections from feasibility review

The original plan had these issues, now resolved:

1. `draft-write.md` line 41 ("every tl;dr bullet must have a corresponding body story") contradicts the new narrative tl;dr — must be updated alongside 1.1
2. `scripts/editorial-draft.js` line 423 calls `loadAndRenderPrompt('editorial-draft.v1')` — removing the file without updating the script causes a runtime error
3. Items 3.6 and 3.7 were duplicates of 1.4 — consolidated into 1.4
4. Items 2.6 and 2.7 were rated WEAK based on catalogue extraction failure, not actual file problems — downgraded to targeted improvements
5. The revise prompt already has a voice maintenance line (line 18) — 2.3 extends it rather than creating it
6. Gap 4 (source-claim verification) was only partially addressed — now a proper Tier 2 item
7. 3.5 → 3.9 dependency was undocumented — now noted
8. The self-review prompt referenced in 3.10 is `config/prompts/self-review.md` (prompt #28) — now named explicitly
9. Geographic balance additions need an escape valve for weeks where US stories genuinely dominate on merit

## Rollback strategy

All changes are to text files in a git repository. Before starting:
```
git checkout -b prompt-improvements
```
Each tier is committed separately. If any tier degrades output quality, revert that tier:
```
git revert <tier-commit-hash>
```
Individual file changes can be reverted independently since prompts are self-contained.

---

## Tier 1: Highest impact (target: +1.0 maturity points)

### 1.1 Rewrite tl;dr structure + fix bullet alignment rule

**Finding:** The Draft System Prompt instructs "two intro paragraphs + sector subheadings with bullets" but Week 13's published tl;dr is narrative editorial prose. This is the single largest gap.

**Changes (2 files):**

**File 1: `config/prompts/draft-system.md`**
- Replace lines 23-32 (tl;dr section instruction) with Week 13-calibrated narrative prose instructions per evaluation Part 2 Rewrite 5a
- Add the podcast directive preserved from 1.3: "Podcast Analysis section: do NOT recap individual episodes. Instead, identify cross-episode themes, surface tensions between perspectives, extract actionable insights, and name specific data points and quotes."
- Insert geographic balance section between Formatting rules (~line 73) and Theme construction (~line 76) per 2.4

**File 2: `config/prompts/draft-write.md`**
- Replace line 41 ("Every story in the body must have a corresponding tl;dr bullet. Every tl;dr bullet must have a corresponding body story.") with: "The tl;dr section weaves key stories into narrative prose — not every story needs a 1:1 mapping between tl;dr and body. Stories referenced in the tl;dr prose must appear in the body. Stories in the body that are not in the tl;dr must appear in the sector bullet summaries."

**Effort:** Small (two text replacements)
**Dependencies:** None
**Verification:** Diff both files, confirm no unintended changes. The pipeline will test this in the Tier 1 verification run.

### 1.2 Create tl;dr editorial voice prompt (Gap 1)

**Finding:** No prompt instructs the narrative editorial prose style visible in Week 13's tl;dr.

**Change:** Create `config/prompts/tl-dr-voice.md` containing:
- Week 13's full tl;dr section as a worked example
- Structural rules: 4-8 paragraphs of editorial prose, not bullet points. Each paragraph develops one argument with specific evidence. Name events with dates. Weave sector references naturally — no subheadings within the tl;dr. Include inline markdown links to sources.
- Voice calibration: "This should read like a Financial Times editorial column — it tells a story, develops a thesis, and leaves the reader understanding why this week mattered."
- Week 13's specific techniques: chronological narrative unfolding, wry editorial voice ("if you weren't watching it unfold you could be forgiven for thinking it was the plot of a movie"), inline sector references without subheadings, rapid-fire sector bullets after the prose as a transition ("And now stay tuned for the sectors:")
- Anti-patterns: no bullet-point summaries, no "In AI & tech:" subheadings within the prose, no list-of-things structure

**File:** `config/prompts/tl-dr-voice.md` (NEW)
**Effort:** Medium (new prompt with Week 13 example)
**Dependencies:** 1.1 complete (conflicting tl;dr structure removed)
**Verification:** Generate a tl;dr from this prompt using this week's editorial state and compare to Week 13

### 1.3 Retire `config/prompts/editorial-draft.v1.txt`

**Finding:** Three draft prompts with conflicting structural guidance. editorial-draft.v1.txt is the oldest and most divergent.

**Changes (3 files):**

**File 1: `config/prompts/editorial-draft.v1.txt`**
- Move to `config/prompts/_archived/editorial-draft.v1.txt`

**File 2: `scripts/editorial-draft.js`**
- Line 423: `draftPromptAppend = loadAndRenderPrompt('editorial-draft.v1', { week: String(week) })`
- Replace with: `draftPromptAppend = loadAndRenderPrompt('draft-write', { week: String(week) })`
- This loads `config/prompts/draft-write.md` instead — the authoritative user-level draft instruction

**File 3: `.claude/commands/editorial-draft.md`**
- Line 4: Replace `Read config/prompts/editorial-draft.v1.txt for structure requirements` with `Read config/prompts/draft-system.md for voice and structure, and config/prompts/draft-write.md for story selection and formatting.`
- Line 12: Replace `tl;dr — three to five bullet executive summary` with `tl;dr — narrative editorial prose following config/prompts/draft-system.md and config/prompts/tl-dr-voice.md`

**Effort:** Small (archive + two script/skill edits)
**Dependencies:** 1.1 complete
**Verification:** Run `bun scripts/editorial-draft.js --dry-run` — confirm no file-not-found errors

### 1.4 Add geographic balance to story selection (Gap 3)

**Finding:** Geographic balance enforced at DISCOVER but not at PRODUCE.

**Changes (3 files):**

**File 1: `config/prompts/select-system.md`**
- Add after "What to drop" section:
```
## Geographic balance

The newsletter serves a global audience with particular concentration in Ireland, the EU and the UK. The shortlist must include at least two stories from non-US sources. If the article pool contains European stories satisfying two or more news value triggers, include them even if their individual score is lower than the weakest US story. European stories are not filler — they serve a readership that includes enterprise leaders across regulated industries in multiple jurisdictions.

Exception: if a week genuinely has no European stories meeting two news value triggers, do not force inclusion. Note the gap in the selection rationale so the editor can address it manually.
```

**File 2: `config/prompts/select-final-general.md`**
- Add after the selection line: "When selecting the final 10-15, ensure at least one story originates from a non-US source (EU, UK or Ireland). If the pool contains European stories satisfying two or more news value triggers, prefer them over a second US story serving a similar editorial function."

**File 3: `config/prompts/select-final-shortlist.md`**
- Add as a 5th selection criterion: "Geographic diversity: the final shortlist must include at least two stories from non-US sources across all sectors combined. If this is not achievable on merit, note it in the output."

**Effort:** Small (three text additions)
**Dependencies:** None
**Verification:** Grep all three files for "geographic" to confirm additions landed

---

## Tier 2: System-wide coherence (target: +0.5 maturity points)

### 2.1 Complete prohibited language in Editorial Critique

**Finding:** Critique prompt has ~10 of ~75 banned items (13%). External models (Gemini/GPT) can't read local files, so the list must be inlined.

**Change:** In `config/prompts/editorial-critique.v1.txt`, replace the partial list at line 17 with the complete list from `config/prompts/draft-system.md` lines 100-118 — all banned words, phrases, constructions and intensifiers. Inline the entire list because Gemini and GPT receive this prompt standalone.

**File:** `config/prompts/editorial-critique.v1.txt`
**Effort:** Small (copy-paste from draft-system.md)
**Dependencies:** None

### 2.2 Extend voice maintenance in Editorial Revise

**Finding:** The revise prompt already has "Maintain the editorial voice throughout. Do not introduce prohibited language during revision." on line 18. This extends it with precedence rules.

**Change:** Insert after line 20 of `config/prompts/editorial-revise.v1.txt` (before the OUTPUT FORMAT section): "The style rules in draft-system.md take precedence over critique suggestions. If a critique recommends a construction that violates the prohibited language list, ignore it. Do not introduce bullet points, subheadings or summary structures into sections that should be narrative prose."

**File:** `config/prompts/editorial-revise.v1.txt`
**Effort:** Small
**Dependencies:** None

### 2.3 Create podcast commentary prompt (Gap 2)

**Finding:** No prompt instructs the podcast section's distinctive Week 13 format.

**Change:** Create `config/prompts/podcast-commentary.md` containing:
- Section heading: `## But what set podcast tongues a-wagging?`
- Opening paragraph: lead with a specific data point from a named host, inline link to the episode, no sub-heading
- Subsequent items as `### ` sub-sections with argumentative headings (not episode titles)
- Format per sub-section: factual claim + inline attribution link → evidence development → implications for regulated-industry audience
- Cross-sector implications drawn explicitly (as in Week 13's submarine item)
- Mandatory: zero URL overlap with any sector section above — check every URL
- "This is original analysis, not episode recap"
- Week 13's podcast section as the worked example

**File:** `config/prompts/podcast-commentary.md` (NEW)
**Effort:** Medium
**Dependencies:** None
**Verification:** Generate a podcast section and compare format to Week 13

### 2.4 Source-claim verification at draft stage (Gap 4)

**Finding:** The ANALYSE stage has a verification sub-agent but PRODUCE does not. Factual claims in the draft are not verified against source articles before publication.

**Change:** Create `config/prompts/draft-source-verify.md` containing:
- For each factual claim in the draft (numbers, quotes, attributions, dates), identify the linked source article
- Verify the claim actually appears in the source (read the article from data/verified/)
- Flag: VERIFIED (claim matches source), UNVERIFIED (source does not contain this claim), NO SOURCE (claim has no linked article)
- Any UNVERIFIED or NO SOURCE claim must be flagged with `[Editorial note: verify]` or removed

Add to `.claude/commands/editorial-draft.md` as a new step after revision and before the self-review: "Run source-claim verification: for each factual claim in the revised draft, confirm the linked source article actually contains the stated information. Use config/prompts/draft-source-verify.md."

**Files:** `config/prompts/draft-source-verify.md` (NEW), `.claude/commands/editorial-draft.md`
**Effort:** Medium
**Dependencies:** None

### 2.5 Improve Editorial Context master voice (Prompt #10)

**Finding:** The file is NOT truncated (catalogue extraction failed). But the opening does frame it as "Content Analyst and LinkedIn Post Generator" which doesn't match its role as the editorial voice anchor for the entire newsletter pipeline.

**Change:** This is the most complex edit — the file is large and tightly structured. Approach:
- Reframe the opening line from "Content Analyst and LinkedIn Post Generator" to "Editorial Intelligence System — content analyst, newsletter editor and LinkedIn post generator"
- Add a "Newsletter voice anchor" section after the analytical lens section, defining the Week 13 analytical style
- Clarify which sections are system-wide (writing rules, prohibited language, analytical lens) vs LinkedIn-specific (six post formats, in-the-end-at-the-end)
- Do NOT change the four operational modes, the writing style rules, or the prohibited language list — these work correctly

**Risk:** The editorial-analyse skill reads this file. Changing the opening could alter how Opus interprets the analytical task. Test by running editorial-analyse on one transcript before and after the change and diffing the output.

**File:** `config/prompts/editorial-context.v1.txt`
**Effort:** Medium (careful surgical edit)
**Dependencies:** None
**Verification:** Diff output of editorial-analyse on same transcript before/after change

### 2.6 Improve Editorial Chat System Prompt (Prompt #30)

**Finding:** The file is NOT truncated (catalogue extraction failed). The base prompt is functional but generic. 6 of 10 modes have zero instruction text — they just load data.

**Change:** In `web/api/lib/editorial-chat.js`:
- Expand EDITORIAL_SYSTEM_BASE to reference the editorial voice and prohibited language list
- Add mode-specific instruction paragraphs for analysis, themes and backlog tabs (currently empty)
- Add the "FT editor" calibration anchor
- Reference `config/prompts/editorial-context.v1.txt` as the authoritative voice document

**File:** `web/api/lib/editorial-chat.js`
**Effort:** Small (expanding string constants)
**Dependencies:** 2.5 complete (so the referenced voice document is updated)

---

## Tier 3: Incremental quality (target: +0.25 maturity points)

All remaining ADEQUATE prompt fixes. Can be parallelised except 3.7 depends on 3.5.

### 3.1 Podcast Import Skill — define the Brightbeam lens
**File:** `.claude/commands/podcast-import.md`
**Change:** Replace "through the Brightbeam lens" with: "through the Brightbeam editorial lens: what does this mean for organisations adopting AI in regulated industries? Where is the gap between what the technology community says and what enterprises experience? What human, cultural or behavioural dynamics does this reveal?" Add success criteria: "Each digest must contain ≥3 key stories with searchable headlines, a 200-word analytical summary, and correct sector tags."
**Effort:** Small

### 3.2 Editorial Sector Search — fix source_type
**File:** `.claude/commands/editorial-sector-search.md`
**Change:** Replace `"source_type": "editorial-discover"` with `"source_type": "editorial-sector-search"`
**Effort:** Trivial

### 3.3 Discovery Gap-Fill — address URL hallucination
**File:** `config/prompts/discover.md`
**Change:** Add after the URL instruction (~line 22): "URLs generated from memory are frequently non-existent. For each URL, note your confidence level. The downstream DISCOVER pipeline will verify all URLs — do not fabricate URLs you are uncertain about. If you cannot recall the exact URL, describe the article with enough detail for a web search to find it."
**Effort:** Small

### 3.4 General AI Scoring — make dropped articles visible
**File:** `config/prompts/select-score-general.md`
**Change:** Replace line 51 ("Only include articles scoring 5 or above") with: "Score every article. Include ALL articles with their scores — do not silently omit low-scoring articles. Mark articles below 5 as 'below threshold' so the downstream selection process can review borderline cases."
**Effort:** Small

### 3.5 Vertical Sector Scoring — align dimensions with General AI
**File:** `config/prompts/select-score-vertical.md`
**Change:** Expand three scoring dimensions to five by adding "Structural thesis potential" and "Competitive tension" from `select-score-general.md` lines 17-18. Adapt wording for sector context.
**Effort:** Small

### 3.6 Pipeline Weekly Skill — specify structural template
**File:** `.claude/commands/pipeline-weekly.md`
**Change:** Add: "The draft must follow the Week 13 published structure: welcome line → tl;dr editorial prose → sector bullets inline → expanded sector analysis → podcast commentary with zero URL overlap. The authoritative prompt pairing is draft-system.md (system) + draft-write.md (user). Do not load editorial-draft.v1.txt."
**Effort:** Small

### 3.7 Vertical Sector Critic — align with updated primary scorer
**File:** `config/prompts/select-score-vertical-critic.md`
**Change:** Replace the duplicated three-dimension scoring text with: "Apply the same five scoring dimensions as the primary vertical scorer (select-score-vertical.md). Your role is independent evaluation — score each article without knowledge of the primary scores. Where your score differs by more than 2 points, explain why with specific article facts."
**Dependencies:** 3.5 must be done first (the primary scorer must have five dimensions before the critic references them)
**Effort:** Small

### 3.8 Vertical Triage — simplify edge cases
**File:** `config/prompts/select-vertical-triage.md`
**Change:** Per evaluation Part 2 Rewrite 15a — simplify the multi-model consensus edge case handling. Reduce the branching logic for when three scores disagree, replacing it with: "Weight the most fact-based rationale when scores disagree. If two of three scorers agree, the majority view wins. If all three disagree, use the score supported by the most specific article evidence."
**Effort:** Small

### 3.9 Post-revision self-review gate
**File:** `.claude/commands/editorial-draft.md`
**Change:** Add as a new step after revision: "Run the self-review checklist (`config/prompts/self-review.md`) on the revised draft. This catches any prohibited language, formatting violations or structural issues introduced during the revision process. The draft must pass self-review before proceeding to evaluation."
**Effort:** Small
**Note:** This step is distinct from 2.4 (source-claim verification). Both run after revision but check different things: self-review checks style/format, source-verify checks factual accuracy.

---

## Summary

| Tier | Unique changes | Files affected | New files | Effort | Impact |
|------|---------------|---------------|-----------|--------|--------|
| 1 | 4 | 8 (6 edited, 1 new, 1 archived) | tl-dr-voice.md | 2 days | +1.0 |
| 2 | 6 | 7 (4 edited, 2 new, 1 JS) | podcast-commentary.md, draft-source-verify.md | 2 days | +0.5 |
| 3 | 9 | 9 edited | — | 1 day | +0.25 |
| **Total** | **19 unique** | **22 files** | **3 new** | **5 days** | **7.0 → 8.75** |

## Execution order

```
BASELINE: Run pipeline once on current corpus, save output as reference

TIER 1 (commit as one):
  1. 1.1  — rewrite tl;dr + bullet alignment + podcast directive + geographic balance in draft-system.md
  2. 1.3  — archive v1.txt, update editorial-draft.js line 423, update editorial-draft.md lines 4+12
  3. 1.2  — create tl-dr-voice.md
  4. 1.4  — geographic balance in select-system.md, select-final-general.md, select-final-shortlist.md
  VERIFY: Run pipeline, compare against baseline. Check tl;dr is prose not bullets. Check geographic stories in shortlist.

TIER 2 (commit as one):
  5. 2.1  — inline complete banned list in editorial-critique.v1.txt
  6. 2.2  — extend voice maintenance in editorial-revise.v1.txt
  7. 2.3  — create podcast-commentary.md
  8. 2.4  — create draft-source-verify.md, add step to editorial-draft.md
  9. 2.5  — reframe editorial-context.v1.txt opening
  10. 2.6 — expand editorial-chat.js system prompt
  VERIFY: Run pipeline. Check critique catches banned words. Check podcast section matches Week 13 format. Check source claims verified.

TIER 3 (commit as one):
  11. 3.1  — podcast import Brightbeam lens
  12. 3.2  — sector search source_type
  13. 3.3  — discover URL hallucination warning
  14. 3.4  — general AI scoring visibility
  15. 3.5  — vertical scoring 5 dimensions (BEFORE 3.7)
  16. 3.6  — pipeline weekly structural template
  17. 3.7  — vertical critic align with 3.5 (AFTER 3.5)
  18. 3.8  — vertical triage simplify
  19. 3.9  — post-revision self-review gate
  VERIFY: Run pipeline. Diff output against Tier 2 output — changes should be incremental, not structural.

POST-IMPLEMENTATION:
  - Update SNI-Prompt-Catalogue.docx with all changes
  - Re-run evaluation prompt with updated catalogue + Week 13 benchmark
  - Target: maturity ≥ 8.5/10, zero WEAK, ≤ 5 ADEQUATE
```

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| tl;dr prose prompt produces unfocused output | Medium | High | Week 13 worked example anchors the style. Test with one generation before committing. |
| `editorial-draft.js` breaks after v1 retirement | High if script not updated | High | Script update is part of 1.3 — change line 423 to load draft-write.md instead |
| Geographic balance overcorrection | Low | Medium | Escape valve: "if no European stories meet two triggers, note the gap rather than forcing inclusion" |
| Master voice reframe breaks LinkedIn pipeline | Low | Medium | Test editorial-analyse on one transcript before/after. Only change the opening framing, not the core content. |
| Multi-file tl;dr changes create contradictions | Medium | Medium | All tl;dr-related changes are in Tier 1 and committed together. Single review before commit. |
| Source-claim verification too slow for pipeline | Low | Low | Runs on the revised draft only (one document), not on every article. |
