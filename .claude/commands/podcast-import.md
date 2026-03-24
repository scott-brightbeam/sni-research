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
   - `summary`: 3-5 sentence analytical summary through the Brightbeam lens
   - `key_stories`: array of `{ headline, detail, url?, sector }` — concrete news stories referenced
   - `tier`: from config (1 = primary AI content, 2 = contextual)

6. Write digest to `data/podcasts/{date}/{source-slug}/{episode-slug}.digest.json`
7. Add entry to manifest: `{ "filename.md": { "date", "source", "title", "week", "year", "digestPath" } }`

8. Save updated manifest.json (write-validate-swap)
9. Report: N transcripts imported, sources covered, stories extracted
