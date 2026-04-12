Process ALL unprocessed podcast transcripts through the Brightbeam editorial intelligence lens, oldest first.

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
3. Scan `~/Desktop/Podcast Transcripts/*.md` for files NOT already in `state.analysisIndex` (match on `filename` field, case-insensitive)
4. If no unprocessed transcripts, report "No new transcripts to process" and stop

**For EACH unprocessed file (oldest first, loop until all done or context exhausted):**

5. Read the full transcript
6. Extract the `**URL:**` field from the frontmatter. If present, this is the episode URL. If missing, search `~/Projects/Claude/HomeBrew/podcasts/episodes-log.json` for a matching episode (by title or date+feedId) to find the `episodeUrl`.
7. Increment `counters.nextSession` (this is your session number)
8. Analyse through the Brightbeam editorial lens — read `config/prompts/editorial-context.v1.txt` for the full analytical framework
9. **Actively discover new themes.** Do not just map content to existing T01-T26. Look for patterns, tensions, or phenomena that existing themes don't capture. A new theme is warranted when the content surfaces a recurring pattern, a genuine tension, or a distinct phenomenon. Create T27+ as needed.
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
{ "title" (argumentative, not descriptive), "status": "suggested", "dateAdded": "YYYY-MM-DD",
  "session", "coreArgument", "format" (one of six LinkedIn formats), "sourceDocuments": [],
  "freshness", "priority", "notes" }
```
Increment `counters.nextPost` after. Include MEDIUM-HIGH, HIGH and IMMEDIATE priority ideas.

**Story references** — save to `data/editorial/stories-session-N.json`:
```json
[{ "headline", "detail", "url" (if mentioned), "type", "sector", "sourceFile": "filename.md" }]
```

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

13. Report what was processed and what was found
