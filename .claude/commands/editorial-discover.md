---
description: Find and fetch original articles for story references extracted from podcast transcripts. Three-tier search with mandatory verification. Uses WebSearch + WebFetch natively.
---

# Editorial Discover — Story Reference Resolution

You are resolving story references from the editorial analysis pipeline. Each podcast transcript analysis produces a `stories-session-N.json` file containing news stories mentioned in the episode. Your job is to find the original articles, verify they match, fetch their content, and save them to the article corpus.

**Most stories from our key podcasts have wide coverage — exhaust all three search tiers before accepting failure. Some stories are podcast-specific anecdotes with no published source; mark those honestly.**

## Step 1: Find the latest story references

```bash
ls -t data/editorial/stories-session-*.json | head -5
```

Read the most recent file(s) that have unresolved stories. **A story is "unresolved" if any of these apply:**

- `url` is `null`, missing, or an empty string
- `url` equals the podcast's own episodeUrl (contamination — the podcast is not the story's source)
- `url` is on a podcast-platform host — these are ALWAYS unresolved, never article URLs:
  - Platforms: `podcasters.spotify.com`, `open.spotify.com`, `*.simplecast.com`, `*.blubrry.net`, `*.libsyn.com`, `*.buzzsprout.com`, `*.podbean.com`, `*.acast.com`, `art19.com`, `*.transistor.fm`, `anchor.fm`, `megaphone.fm`, `omnystudio.com`, `podcasts.apple.com`, `overcast.fm`, `pocketcasts.com`
  - Show sites: `lexfridman.com`, `jimruttshow.com`, `jimruttshow.blubrry.net`, `dwarkesh.com`, `intelligencesquared.com`, `cognitiverevolution.ai`, `complexsystemspodcast.com`
- `url` is a YouTube search URL (`youtube.com/@*/search?query=...` or `youtube.com/search?...`)

**Newsletter URLs are NOT unresolved** — these are valid story URLs:
- `exponentialview.co` (Azeem Azhar's Exponential View newsletter)
- `bigtechnology.com` (Alex Kantrowitz's newsletter)

**Action:** For every story flagged as unresolved above, **null-out the existing `url` first** (so retry-sequences work cleanly), then process it through the three-tier search below. If all files are empty or every story already has a valid non-podcast URL, report 'No stories to discover' and stop.

## Step 2: Three-tier search for each unresolved story

For each story where `url` is null, execute all three tiers before accepting failure.

### Tier 1 — Primary search
- WebSearch for `headline + detail + date`
- If results found, evaluate and proceed to Step 3 (Verification)
- If no relevant results, proceed to Tier 2

### Tier 2 — Alternative search
Try the following sequentially — stop after the first match:
- **Rephrase:** Search for key entities + event type (e.g. 'OpenAI Sora shutdown' instead of the full headline)
- **Publication name:** If the transcript mentions the source ('The Guardian reported...', 'according to CNBC...'), search `"publication name" + key terms`
- **Data point:** If the story contains a specific number ('$1 billion Disney partnership', '60% of hiring managers'), search for that exact figure
- **Named participants:** If specific people are named, search `"person name" + topic`

### Tier 3 — Direct publication search
For stories that mention or are likely covered by known outlets:
- `site:theguardian.com [key terms]`
- `site:cnbc.com [key terms]`
- `site:theverge.com [key terms]`
- `site:techcrunch.com [key terms]`
- `site:reuters.com [key terms]`
- `site:bbc.co.uk [key terms]`
- `site:irishtimes.com [key terms]`

Also try for named authors: `"author name" [topic]`

**Only mark as `not-found` after ALL THREE TIERS fail.** If any tier produces a plausible result, proceed to verification.

## Step 3: Verification — mandatory for every resolved story

After finding an article for a story reference, **perform the following verification before saving**:

1. Read the found article content (at least the title and first 500 chars)
2. Compare it against the story reference's headline and detail
3. Confirm the article actually covers the referenced story (not a tangentially related piece)
4. Confirm the publication date is within ±7 days of the transcript date. If dates are unavailable on either side, skip the date check.
5. Rate the match:
   - **MATCH**: article covers the referenced story — save it
   - **PARTIAL**: article covers the topic but not the specific claim — save but note in the story ref
   - **MISMATCH**: wrong article — re-search with corrected terms (max 2 re-search attempts per story)

If a story fails verification twice, mark it as `url: "not-found"` with a note explaining what was tried.

## Step 4: Save verified articles

For each verified article:
1. **Dedup** before saving: `grep -rl "ARTICLE_URL" data/verified/ 2>/dev/null`. If found, set the story URL but don't save a duplicate.
2. **Save** to `data/verified/{date}/{sector}/{slug}.json`:

```json
{
  "title": "Article title",
  "url": "https://...",
  "source": "Publication name",
  "source_type": "editorial-discover",
  "date_published": "YYYY-MM-DD",
  "date_verified_method": "web-search",
  "date_confidence": "high",
  "sector": "general|biopharma|medtech|manufacturing|insurance",
  "snippet": "First 300 characters of full_text",
  "full_text": "Full article text (no HTML)",
  "found_by": ["WebSearch: story reference from transcript"],
  "score_reason": "Transcript story reference — editorial priority"
}
```

3. **Update** the story reference: set `url` to the found URL.
4. Create directories as needed: `mkdir -p data/verified/{date}/{sector}`
5. Generate slug: lowercase title, replace non-alphanumeric with hyphens, truncate at 80 chars.

Skip paywalled sites: bloomberg.com, ft.com, wsj.com, thetimes.co.uk, economist.com, hbr.org, nytimes.com, telegraph.co.uk, theatlantic.com

**Sector mapping:** Story references may use `"general-ai"` but the corpus directory is `"general"`. Map accordingly: `general-ai` → `general`, all others match directly.

**Edge cases:**
- Malformed JSON in stories file → log error, skip file
- Empty `url` string → treat as unresolved (same as null)
- No publication date available → skip date check, note in verification
- `site:` operator may not work in WebSearch → use `"publication name" + key terms` as fallback

## Step 5: Mark genuinely unfindable stories

Only after all three tiers fail AND no verification-corrected re-search produces a result:
- If the story is too vague ('some company did something with AI') → `url: "too-vague"`
- If the story is a podcast anecdote with no published source → `url: "anecdote"`
- If all searches returned nothing → `url: "not-found"` with a note explaining what was tried

## Step 6: EV Newsletter special handling

If any story references come from Exponential View Newsletter transcripts, also fetch the original Substack HTML page to recover hyperlinks stripped from the transcript text. Extract and fetch any external article URLs not already in the corpus.

## Step 7: Write updated story reference file

Save the updated `stories-session-N.json` back to disk with all URLs filled in.

## Step 8: Report

```
Stories processed: N
  Tier 1 resolved: N
  Tier 2 resolved: N
  Tier 3 resolved: N
  Verification passed: N
  Verification failed (re-searched): N
  Already had URL: N
  Not found (all tiers exhausted): N
  Too vague / anecdote: N
  Duplicates skipped: N
  New articles saved: N
```

## Priority sources

These podcasts reference the most newsletter-relevant stories:
- **AI Daily Brief** (Nathaniel Whittemore) — 5-8 news stories per episode
- **Exponential View** (Azeem Azhar) — newsletter + podcast, high-quality references
- **Moonshots** (Peter Diamandis) — GTC, startup, frontier tech
- **Big Technology** (Alex Kantrowitz) — deals, policy, industry

## Rules

1. Every saved article MUST have a valid, verified URL
2. Never fabricate article content — only save what WebFetch returns
3. Sector: use the story reference's `sector` field, or infer from content
4. Three tiers before accepting failure — no exceptions
5. Verification agent must confirm every match before saving
