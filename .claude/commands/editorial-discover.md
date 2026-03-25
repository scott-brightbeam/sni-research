---
description: Find and fetch original articles for story references extracted from podcast transcripts. Replaces editorial-discover.js (Gemini). Uses WebSearch + WebFetch natively.
---

# Editorial Discover — Story Reference Resolution

You are resolving story references from the editorial analysis pipeline. Each podcast transcript analysis produces a `stories-session-N.json` file containing news stories mentioned in the episode. Your job is to find the original articles via web search, fetch their content, and save them to the article corpus.

## Step 1: Find the latest story references

```bash
ls -t data/editorial/stories-session-*.json | head -5
```

Read the most recent file(s) that have unresolved stories (entries where `url` is null). If all files are empty or all stories have URLs, report 'No stories to discover' and stop.

## Step 2: For each story where url is null

1. **WebSearch** for the headline + detail. Include the date if available. Use specific terms — the headline is usually close to the actual article title.
2. **Evaluate results** — pick the original reporting source, not aggregators. Skip paywalled sites: bloomberg.com, ft.com, wsj.com, thetimes.co.uk, economist.com, hbr.org
3. **Dedup** before fetching: `grep -rl "ARTICLE_URL" data/verified/ 2>/dev/null`. If found, skip.
4. **WebFetch** the article content.
5. **Save** to `data/verified/{date}/{sector}/{slug}.json`:

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

6. **Update** the story reference: set `url` to the found URL.
7. Create directories as needed: `mkdir -p data/verified/{date}/{sector}`
8. Generate slug: lowercase title, replace non-alphanumeric with hyphens, truncate at 80 chars.

## Step 3: Mark failed searches

- WebSearch returns nothing relevant → set `url: "not-found"`
- WebFetch returns 403/404 → set `url: "fetch-failed"`
- This prevents re-searching the same story endlessly

## Step 4: EV Newsletter special handling

If any story references come from Exponential View Newsletter transcripts, also fetch the original Substack HTML page to recover hyperlinks stripped from the transcript text. Extract and fetch any external article URLs not already in the corpus.

## Step 5: Write updated story reference file

Save the updated `stories-session-N.json` back to disk with all URLs filled in.

## Step 6: Report

```
Stories searched: N
Found and saved: N
Already had URL: N
Not found: N
Fetch failed: N
Duplicates skipped: N
```

## Priority sources

These podcasts reference the most newsletter-relevant stories:
- **AI Daily Brief** (Nathaniel Whittemore) — 5-8 news stories per episode
- **Exponential View** (Azeem Azhar) — newsletter + podcast, high-quality references
- **Moonshots** (Peter Diamandis) — GTC, startup, frontier tech
- **Big Technology** (Alex Kantrowitz) — deals, policy, industry

## Rules

1. Every saved article MUST have a valid URL — no nulls, no guesses
2. Never fabricate article content — only save what WebFetch returns
3. Sector: use the story reference's `sector` field, or infer from content
4. If a story reference is vague ('some company did something with AI'), skip it — set url to 'too-vague'
