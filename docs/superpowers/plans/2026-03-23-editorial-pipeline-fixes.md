# Editorial Pipeline Fixes — Plan

## Diagnosis

### Root causes found

1. **Duplicate analysis entries** — `isAlreadyProcessed()` matches on Claude-generated `title` + `source`, but Claude produces slightly different titles each run (e.g. "Frostlines: Arctic Geopolitics..." vs "Frostlines: Arctic Ecology..."). Sessions 17–19 each re-processed the same 3 transcripts. **Fix: match on original filename, not generated title.**

2. **Pipeline not producing themes/posts for new content** — The pipeline IS producing them (S17 added 5 theme evidence + 1 post), but sessions 18–20 re-analysed already-processed files due to the dedup bug, and Claude stopped generating new evidence for content it had already covered. The 25 genuinely new transcripts (Mar 14–23) were never processed because the background run timed out after 4 files.

3. **No archive for podcasts in Editorial tabs** — Archive exists for articles/podcasts in Database, and for analysis/themes/backlog in Editorial, but the user's request is about the Podcast tab specifically — it has no archive UI.

### Gap analysis vs Project prompt

| Feature | Status | Action |
|---------|--------|--------|
| MODE 1: INGEST (process new docs) | **Works** — editorial-analyse.js is the implementation | Fix dedup bug, run backfill |
| MODE 2: ANALYSE (cross-corpus) | **Works** — via Co-pilot chat `editorial` tab | No change |
| MODE 3: IDEATE (generate post ideas) | **Partial** — post candidates come from INGEST | Wire up as explicit Co-pilot action |
| MODE 4: DRAFT (write posts) | **Partial** — newsletter draft works; LinkedIn post draft is Co-pilot only | Wire up as explicit backlog → draft flow |
| META: RESEARCH | **Works** — editorial-discover.js | No change |
| Theme creation from new content | **Works** — applyAnalysisResponse calls addNewTheme | No change |
| Theme evidence accumulation | **Works** — addThemeEvidence called for each update | No change |
| Cross-connections | **Works** — addCrossConnection in place | No change |
| Post idea generation | **Works** — postCandidates processed and added to backlog | No change |
| 6 LinkedIn formats | **Stored** but not enforced in draft | Add format templates to draft prompts |
| In-the-end-at-the-end | **Documented** in context prompt but not enforced | Add to draft prompt |
| Content rotation | **Missing** | Add rotation recommendations |
| Dedup/archive for analysis | **Buggy** — title-based matching fails | Fix to filename-based |
| Archive for all Editorial items | **Exists** — all 4 sections have archive | Verify UI toggle works |
| Decision log | **Exists** — manual entries via API | Broader: rename to "Notes & Decisions" |
| Newest-first sorting | **Fixed** this session | Done |
| Writing style enforcement | **In prompt** | No automated validation needed — Claude follows the prompt |
| Prohibited language | **In prompt** | Same — prompt-driven |

## Plan — 5 tasks

### Task 1: Fix dedup bug in editorial-analyse

**File:** `scripts/lib/editorial-analyse-lib.js`

Change `isAlreadyProcessed()` to match on the **original filename** instead of the generated title. The `state.analysisIndex` entries need to store the original filename. Also store it in `addAnalysisEntry()`.

**Changes:**
- `addAnalysisEntry()` — add `filename` field to the stored entry
- `isAlreadyProcessed()` — match on `entry.filename === meta.filename` (falling back to title match for legacy entries without filename)
- `extractSourceMeta()` — ensure `meta.filename` is always populated

**Test:** Process the same transcript twice — second run should skip it.

### Task 2: Clean up duplicate analysis entries

**File:** `data/editorial/state.json` (data fix, not code)

Remove duplicate entries from sessions 17–19 that re-processed the same transcripts. Keep the earliest entry for each unique filename.

Then re-run `editorial-analyse.js` on the full transcript backlog (25 pending files) to properly ingest Mar 14–23 content.

### Task 3: Add archive to Podcast tab in Database

**File:** `web/app/src/pages/Database.jsx`, `web/api/routes/podcasts.js`

The podcast archive toggle already exists for individual episodes (Task 8 from the previous session). Verify it works end-to-end: archive button on podcast cards, PATCH route, showArchived toggle, visual indicator.

### Task 4: Wire IDEATE mode into Co-pilot

**File:** `web/app/src/components/EditorialChat.jsx`, `web/api/lib/editorial-chat.js`

Add an `ideate` tab/suggestion to the Editorial Chat that:
- Reads current theme registry and post backlog
- Asks Claude to generate 5–10 post ideas per the Project prompt's MODE 3 spec
- Presents ideas with format, freshness, priority
- "Add to backlog" action writes to state

### Task 5: Wire DRAFT mode from backlog

**File:** `web/app/src/pages/Editorial.jsx`, `web/app/src/components/EditorialChat.jsx`

Add a "Draft this" button on backlog items that:
- Switches to Co-pilot with the selected idea pre-loaded
- Builds context from the idea's source documents
- Asks Claude to generate 3 drafts in different LinkedIn formats
- Each draft includes the in-the-end-at-the-end closing
- Selected draft can be saved and status updated to published

### Execution order

Task 1 → Task 2 → Task 3 → Task 4 → Task 5

Tasks 1–2 are critical (pipeline is broken without dedup fix).
Tasks 3–5 are UI enhancements.
