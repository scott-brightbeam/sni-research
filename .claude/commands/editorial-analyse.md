Process the OLDEST unprocessed podcast transcript through the Brightbeam editorial intelligence lens.

## Instructions

1. Read `data/editorial/state.json` — note the counters (nextSession, nextDocument, nextPost) and existing themes
2. Read `config/editorial-sources.yaml` for source metadata (name, host, tier)
3. Scan `~/Desktop/Podcast Transcripts/*.md` for files NOT already in `state.analysisIndex` (match on `filename` field, case-insensitive)
4. If no unprocessed transcripts, report "No new transcripts to process" and stop

For the OLDEST unprocessed file:

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
12. Report what was processed and what was found
