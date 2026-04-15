Import new podcast transcripts — generate digests and update the manifest.

## Instructions

1. Read `config/podcast-trust-sources.yaml` for source trust/tier metadata
2. Read `data/podcasts/manifest.json` (create as `{}` if missing)
3. Scan `~/Desktop/Podcast Transcripts/*.md` for files not yet in the manifest (match on filename)

For each new transcript:

4. Extract metadata from filename pattern: `YYYY-MM-DD-source-slug-episode-title.md`
   - Date: first 10 chars
   - Source: next segment(s) before episode title (match against sources in config)
   - Episode title: remainder, de-slugified

5. Read the transcript and generate a digest:
   - `title`: clean episode title
   - `source`: podcast name from config
   - `date`: from filename
   - `week`: ISO week number
   - `duration`: estimate from word count (~150 words/minute)
   - `summary`: 3-5 sentence analytical summary through the Brightbeam editorial lens: what does this mean for organisations adopting AI in regulated industries? Where is the gap between what the technology community says and what enterprises experience? What human, cultural or behavioural dynamics does this reveal?
   - `key_stories`: array of `{ headline, detail, url, sector }` — concrete news stories referenced
     - `url` rules (NON-NEGOTIABLE):
       - Set `url` ONLY if a specific article/source URL for THIS story is explicitly mentioned in the transcript (e.g. "you can read it on Bloomberg at…", speaker quotes a URL).
       - Otherwise, `url` MUST be `null` — DISCOVER will find the original article.
       - **NEVER use the episode's own URL (episodeUrl) as a story URL.** The podcast discussing a story is not the story's source. If you find yourself about to write `url: "<same as episodeUrl>"`, write `url: null` instead.
       - **NEVER use a podcast-platform URL** (spotify, simplecast, blubrry, libsyn, acast, podcasts.apple.com, overcast, etc.) as a story URL.
       - **NEVER construct a search URL** (e.g. `youtube.com/@author/search?query=...`) as a fallback — write `url: null`.
       - Newsletter sources (exponentialview.co, bigtechnology.com newsletter posts) ARE valid story URLs when the transcript references the newsletter post directly.
   - `tier`: from config (1 = primary AI content, 2 = contextual)

6. Write digest to `data/podcasts/{date}/{source-slug}/{episode-slug}.digest.json`
7. Add entry to manifest: `{ "filename.md": { "date", "source", "title", "week", "year", "digestPath" } }`

8. Save updated manifest.json (write-validate-swap)
9. Report: N transcripts imported, sources covered, stories extracted

## Success criteria

Each digest must contain:
- At least 3 key stories with searchable headlines
- A 200-word analytical summary
- Correct sector tags matching `config/sectors.yaml` sector names
