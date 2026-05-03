Process ALL unprocessed podcast transcripts through the Brightbeam editorial intelligence lens, oldest first.

**Model requirement:** Use Opus 4.7 with the 1M-context window (`claude-opus-4-7[1m]`). The editorial principles you apply across the transcript, existing theme registry, and backlog require the wide context to hold consistently.

**Runs under your Claude Code subscription.** No metered API calls. The reasoning is done here; `scripts/lib/editorial-state.js` and `scripts/lib/editorial-analyse-lib.js` provide the deterministic state plumbing.

**Batch processing:** Loop through every unprocessed transcript. Each one gets its own session number, analysis entry, theme evidence, and post candidates. Process them sequentially — do NOT skip any. If context runs low, report how many remain and stop cleanly (the next invocation picks up where you left off).

**One session per transcript** — increment nextSession for each. Do not batch multiple transcripts into a single session.

## CRITICAL: Source Fidelity Rule

**Only include what is in the source material.** Never project external knowledge.

Previous audits found fabrication in 69% of entries (11 of 16). The patterns:
- Projected product names and terminology not in the transcript
- Invented statistics (e.g. "40x cost" that doesn't appear anywhere)
- Misattributed frameworks to the wrong speaker
- Added words to real quotes
- Generated entries from filenames without reading the actual content

Every quote must be verifiable against the transcript. Every stat must appear in the source. Every attribution must name the correct speaker. If you know something about a company/person from external knowledge but it's not in THIS transcript, do not include it.

Label editorial inferences explicitly: "Editorial inference: [your analysis]" — never present your interpretation as something the source said.

## Instructions

1. Read `data/editorial/state.json` — note the counters (nextSession, nextDocument, nextPost) and existing themes
2. Read `config/editorial-sources.yaml` for source metadata (name, host, tier)

### Phase 0: Consume `state.pendingContributions[]` (MCP write-tool sidecars)

Before processing transcripts, drain any MCP-contributed material that the
overnight `pullContributions` phase merged into state. Each entry in
`state.pendingContributions[]` is a sidecar (shape per
`scripts/validate-editorial-state.js:validatePendingContributions`):

```json
{ "version": 1, "contributionId": "uuid", "type": "...", "payload": {...},
  "payloadHash": "sha256...", "user": {"email", "name"}, "ts": "ISO",
  "clientRequestId": "string|null" }
```

Process each entry by `type`. **Every downstream record you create or
mutate from a contribution MUST be stamped with `_origin`** — this is what
`scripts/undo-contribution.js` (Task 8e) uses to find and reverse the
mutation. Without it, surgical undo is impossible.

```js
_origin: { contributionId, mergedAt: <ISO ts of THIS run>, mergedBy: 'analyse-daily' }
```

For each entry:

| `type` | Action |
|---|---|
| `post_candidate` | Append to `state.postBacklog[String(nextPost)]` with `status: 'suggested'`, payload fields mapped (`title`, `coreArgument`, `format`, `freshness`, `priority`, `sourceUrls`, `notes`), plus `_origin`, plus `submittedBy: payload.user.email`. Increment `counters.nextPost`. |
| `theme_evidence` | Look up `state.themeRegistry[payload.themeCode]`. If found, append `{session: <this run's session>, source: payload.source ?? 'MCP contribution', url: payload.url ?? null, content: payload.content, _origin}` to its `evidence[]`. Trim to last 12. If themeCode doesn't exist, log + skip (no quarantine — analyse can re-run). |
| `new_theme` | Allocate next T-code (max existing +1). Create `state.themeRegistry[code]` with `{name: payload.name, created: 'Session N', lastUpdated: 'Session N', documentCount: 1, evidence: [<from payload.initialEvidence + _origin>], crossConnections: [], _origin}`. |
| `article` | Write a manual-style article file to `data/verified/{date}/{sector}/{slug}.json` — same shape as fetch.js outputs. Add `submittedBy: payload.user.email` and `_origin`. Pick `slug` from URL or title slugify. |
| `decision` | Append to `state.decisionLog`: `{session, title: payload.title, decision: payload.decision, reasoning: payload.reasoning ?? null, _origin}`. |
| `story_reference` | Append to `data/editorial/stories-session-{nextSession}.json` for the next DISCOVER pass: `{url: payload.url, headline: payload.headline, sector: payload.sector ?? null, context: payload.context ?? null, _origin}`. |
| `draft_suggestion` | Log to `data/editorial/draft-suggestions/week-{payload.week}.json` (create if absent): `{target: payload.target, suggestion: payload.suggestion, rationale: payload.rationale ?? null, submittedBy: payload.user.email, ts: payload.ts, _origin}`. Editorial reviews these in the Friday drafting workflow. |

After consuming each entry, update its lifecycle state in Turso:

```sql
UPDATE mcp_contributions
   SET lifecycle_state = 'consumed', lifecycle_updated_at = datetime('now')
 WHERE contribution_id = ?
```

When all entries are processed, **clear `state.pendingContributions = []`**.
The original sidecars remain durably archived under
`data/editorial/contributions/processed/{date}/` (Task 8c) — they are the
permanent forward-replayable record. The audit row in `mcp_contributions`
(now `lifecycle_state = 'consumed'`) is the per-row index.

If a sidecar's payload fails the type-specific shape check (e.g. a
`theme_evidence` entry whose `themeCode` doesn't match `/^T\d{1,4}$/`),
log + skip; do NOT bury the entry — leave it in `pendingContributions[]`
so an operator can investigate and either fix the data or run
`scripts/undo-contribution.js` to roll it back cleanly.

### Phase 1: Process podcast transcripts

3. Scan `~/Desktop/Podcast Transcripts/*.md` for files NOT already in `state.analysisIndex` (match on `filename` field, case-insensitive)
4. If no unprocessed transcripts (and Phase 0 produced no work), report "No new transcripts to process" and stop

**For EACH unprocessed file (oldest first, loop until all done or context exhausted):**

5. Read the full transcript
6. Extract the `**URL:**` field from the frontmatter. If present, this is the episode URL. If missing, search `~/Projects/Claude/HomeBrew/podcasts/episodes-log.json` for a matching episode (by title or date+feedId) to find the `episodeUrl`.
7. Increment `counters.nextSession` (this is your session number)
8. Analyse through the Brightbeam editorial lens — read `config/prompts/editorial-analyse.v1.txt` for the full analytical framework AND the current editorial principles (evidence calibration, "matters" ban, CEO empathy, prohibited patterns). Apply ALL of them to summaries, theme evidence, and backlog items — not only the JSON schema rules. The same principles run downstream in the drafting audit; upstream shoddiness is what the draft has to fight, so catch it here.
9. **Actively discover new themes.** Do not just map content to existing themes. Look for patterns, tensions, or phenomena that existing themes don't capture. A new theme is warranted when the content surfaces a recurring pattern, a genuine tension, or a distinct phenomenon. Create new themes (T52+) as needed. **Expected rate: approximately 1 new theme per 2-3 sessions.** If you have processed 5+ transcripts without creating any new themes, explicitly reconsider whether existing themes fully capture the content — they probably don't. Theme names should follow the style: descriptive noun phrase — analytical subtitle (see T37-T54 for examples).
10. Produce these outputs:

**Analysis entry** — add to `state.analysisIndex[String(nextDocument)]`:
```json
{ "title", "source", "host", "participants", "filename", "url" (episode or article URL — REQUIRED),
  "date", "dateProcessed": "YYYY-MM-DD", "session", "tier": 1, "status": "active",
  "themes": ["T01", ...], "summary" (analytical, 2-3 sentences), "keyThemes",
  "postPotential", "postPotentialReasoning" }
```
The `url` field is non-negotiable. Every entry must link back to its source.
Increment `counters.nextDocument` after.

**Theme evidence** — for each relevant existing theme, append to `state.themeRegistry[code].evidence`:
```json
{ "session", "source": "Podcast Name - Episode (date)", "url": "episode or article URL",
  "content": "specific evidence — data points, quotes, examples" }
```
Trim evidence array to last 12 entries. Update `lastUpdated` to `"Session N"`. Increment `documentCount`.

**New themes** — actively look for patterns not captured by existing T01-T26. Create `state.themeRegistry[T27+]`:
```json
{ "name", "created": "Session N", "lastUpdated": "Session N", "documentCount": 1,
  "evidence": [{ "session", "source", "content" }], "crossConnections": [] }
```
Theme codes must match `T\d{2}` format.

**Cross-connections** — append to both themes' `crossConnections` arrays (deduplicate by target code):
```json
{ "theme": "T05", "reasoning": "specific analytical connection" }
```

**Post candidates** — add to `state.postBacklog[String(nextPost)]`:
```json
{ "title": "HOOK — 20-80 chars, max 100. Provoke curiosity, never reveal the thesis.",
  "status": "suggested",
  "dateAdded": "YYYY-MM-DD",
  "session": N,
  "coreArgument": "Multi-sentence argumentative thesis (300+ chars). Brightbeam lens: what does this mean for enterprises adopting AI in regulated industries?",
  "format": "One of the 6 LinkedIn formats (see below)",
  "sourceDocuments": ["218"],
  "freshness": "timely | evergreen | timely-evergreen | very-timely",
  "priority": "immediate | high | medium-high | medium | low",
  "notes": "Editor's brief (200+ chars): strongest source quote, which other D-numbers to pair with, why this angle works for Scott's enterprise audience, editorial hook."
}
```

**TITLE RULES — NON-NEGOTIABLE:**
- Target: 20-80 characters. Maximum 100 characters. NEVER longer.
- The title is a HOOK, not a summary. It provokes curiosity without revealing the argument.
- Good examples: "The 4K Ceiling", "AI is Air Cover", "The Kill Switch Problem", "The Benefits Are Real, the Fears Are Imagined", "Google's Problem Isn't Intelligence"
- Techniques: name a phenomenon, invert expectations, state a sharp observation, create tension
- NEVER cram the thesis into the title. That is the coreArgument's job.
- NEVER start with `[EDITORIAL INFERENCE]`

**THE 6 LINKEDIN POST FORMATS — use the canonical names below:**
1. "Format 1: The Concept Contrast" — before/after comparison illuminating a shift. Best for: technology shifts, methodology changes.
2. "Format 2: The News Decoder" — current event → deeper signal. Best for: product launches, market shifts.
3. "Format 3: The Behavioural Paradox" — surprising human contradiction + psychology + framework. Best for: decision-making, adoption challenges.
4. "Format 4: The Honest Confession" — genuine mistake or evolution in thinking. Best for: leadership lessons.
5. "Format 5: The Quiet Observation" — smaller, sharper insight. Fewer words, more precision. Best for: industry patterns, market tells.
6. "Format 6: The Practitioner's Take" — how you actually do something with specificity. Best for: frameworks, processes.

Increment `counters.nextPost` after. Include MEDIUM-HIGH, HIGH and IMMEDIATE priority ideas only.

**Story references** — save to `data/editorial/stories-session-N.json`:
```json
[{ "headline", "detail", "url", "type", "sector", "sourceFile": "filename.md" }]
```

**Story URL rules (NON-NEGOTIABLE):**
- Set `url` ONLY if a specific article/source URL for THIS story is explicitly mentioned in the transcript (a speaker quotes a URL, the transcript includes a citation link).
- Otherwise, `url` MUST be `null` — DISCOVER will find the original article via WebSearch.
- **NEVER use the podcast episode's own URL as a story URL.** The podcast discussing a story is not the story's source. If tempted to fall back to the episode URL, write `null` instead.
- **NEVER use a podcast-platform URL** as a story URL: spotify, simplecast, blubrry, libsyn, buzzsprout, podbean, acast, art19, transistor, anchor, megaphone, omnystudio, podcasts.apple.com, overcast, pocketcasts, lexfridman.com, jimruttshow.*, dwarkesh.com, intelligencesquared.com, cognitiverevolution.ai, complexsystemspodcast.com.
- **NEVER construct a search URL** (e.g. `youtube.com/@author/search?query=...`) as a fallback — write `null`.
- Newsletter URLs (exponentialview.co, bigtechnology.com newsletter posts) ARE valid story URLs when the transcript references the newsletter post directly.

9. Recompute `state.corpusStats` (totalDocuments, activeTier1, activeThemes, totalPosts, etc.)
10. Write state.json using write-validate-swap: write `.tmp`, parse back to validate, backup existing to `backups/`, rename
11. Update `data/editorial/activity.json` (prepend, cap at 100 entries):
```json
{ "type": "analyse", "title": "Session N: processed filename.md", "detail": "X entries, Y evidence, Z posts", "timestamp": "ISO" }
```
12. **MANDATORY VERIFICATION** — After writing state.json, dispatch a sub-agent to audit the entry:

```
Agent prompt: "Audit analysis entry #[ID] in data/editorial/state.json against the
original transcript at ~/Desktop/Podcast Transcripts/[filename].

Check EVERY quoted phrase and data point in the entry summary, theme evidence items
(session [N] in themeRegistry), and post candidates against the actual transcript text.

For each claim report:
- VERIFIED: appears in transcript
- PARAPHRASED: concept present, wording different (acceptable)
- FABRICATED: does NOT appear in the transcript
- PROJECTED: external knowledge imported (product names, terminology, facts not mentioned)
- MISATTRIBUTED: attributed to wrong speaker

Also check: any significant insights MISSED from the transcript?

Be exhaustive. Check every quoted phrase. Previous audits found fabrication in 69% of entries."
```

If the audit finds FABRICATED or PROJECTED items:
- Fix them immediately before processing the next transcript
- Replace fabricated quotes with actual transcript text
- Remove projected external knowledge
- Label editorial inferences as such (prefix with "Editorial inference:")

Do NOT proceed to the next transcript until the current one passes audit.

13. **MANDATORY SCHEMA VALIDATION** — Run: `bun scripts/validate-editorial-state.js`
    If it reports errors, fix them before proceeding to the next transcript.
    If it reports warnings, note them in your session report but continue.
    This catches: overlong titles, wrong format names, missing fields, invalid priorities.

14. Report what was processed and what was found
