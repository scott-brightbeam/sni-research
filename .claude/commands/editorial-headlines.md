---
description: Daily broad AI news sweep — find the week's biggest stories across US, EU, UK and Irish sources. Fills the gap between RSS/Brave (volume) and DISCOVER (podcast references).
---

# Editorial Headlines — Daily News Sweep

You are the front-page news check for the SNI newsletter. Every day, search for the biggest AI stories and check whether they're in the article corpus. Add anything significant that's missing.

**The goal: by Wednesday evening, every major AI story from the week should be in `data/verified/`.** The newsletter should never be missing a story that a reader would expect to see.

**Quality bar: apply an FT editor's judgement.** For each story, ask: would this make it into the final published newsletter, given our audience of senior leaders in regulated industries? If yes — fetch it. If it's background noise, aggregator churn, or a story that adds volume without editorial value — skip it. There is no numerical cap. The constraint is relevance, not quantity.

## Step 1: Determine the newsletter date window

```bash
python3 -c "
from datetime import date, timedelta
today = date.today()
days_since_friday = (today.weekday() - 4) % 7
window_start = today - timedelta(days=days_since_friday)
print(f'Window: {window_start} to {today}')
"
```

## Step 2: Search for major stories

Run WebSearch for each category below. For each result, check if the URL is already in the corpus: `grep -rl "ARTICLE_URL" data/verified/ 2>/dev/null`

Also check for title-based duplicates — if an article with a substantially similar title from a different publication already exists, skip it.

### Global AI — major companies
- "OpenAI" + current week
- "Anthropic Claude" + current week
- "Google AI" OR "Google Gemini" + current week
- "Microsoft AI" OR "Microsoft Copilot" + current week
- "Meta AI" + current week
- "Apple AI" OR "Apple Intelligence" + current week
- "Amazon AI" OR "AWS AI" + current week
- "xAI" OR "Grok" + current week
- "NVIDIA AI" + current week (beyond GTC — earnings, partnerships, chip launches)

### Global AI — themes
- "artificial intelligence news this week"
- "AI regulation" + current week
- "AI safety" OR "AI alignment" + current week
- "AI funding round" OR "AI acquisition" + current week
- "AI layoffs" OR "AI workforce" + current week
- "AI defence" OR "AI military" + current week

### Irish AI
- "Ireland artificial intelligence" (not just "Ireland AI" — too broad)
- "IDA Ireland AI" OR "Enterprise Ireland AI"
- "Central Bank Ireland artificial intelligence"
- "Irish data centre AI" (AI qualifier added)
- "Science Foundation Ireland AI"

### EU AI
- "EU AI Act" implementation OR delay OR compliance
- "EIOPA AI" OR "European insurance AI"
- "EMA artificial intelligence" OR "European Medicines Agency AI"
- "European Commission AI"
- "ECB artificial intelligence" OR "ESMA AI"

### UK AI
- "FCA AI" OR "Financial Conduct Authority artificial intelligence"
- "NHS AI"
- "MHRA AI" OR "UK medical device AI"
- "Lloyd's AI" OR "London market AI"
- "UK AI regulation" OR "UK AI Safety Institute"
- "Bank of England AI" OR "PRA artificial intelligence"

### Asian AI (weekly check, not daily)
- "China AI" OR "DeepSeek" OR "Baidu AI" + current week
- "Japan AI" OR "SoftBank AI" + current week

## Step 3: Check corpus for each story

For each significant result:
```bash
grep -rl "ARTICLE_URL" data/verified/ 2>/dev/null
```

If found → skip.
If not found → also check for title similarity: `grep -rl "KEY_PHRASE_FROM_TITLE" data/verified/ 2>/dev/null`. If a substantially similar story exists from a different publication, skip.

## Step 4: Verify and save

For each editorially relevant story:
1. Confirm publication date is within the newsletter window — WebFetch the article and check the date in the page content
2. Confirm it's genuine reporting (not aggregator, not social media, not paywalled)
3. WebFetch the article content
4. Save to `data/verified/{date}/{sector}/{slug}.json`:

```json
{
  "title": "Article title",
  "url": "https://...",
  "source": "Publication name",
  "source_type": "editorial-headlines",
  "date_published": "YYYY-MM-DD",
  "date_verified_method": "web-search",
  "date_confidence": "high",
  "sector": "general|biopharma|medtech|manufacturing|insurance",
  "snippet": "First 300 characters of full_text",
  "full_text": "Full article text (no HTML)",
  "found_by": ["WebSearch: editorial-headlines daily sweep"],
  "score_reason": "Major story — editorial headlines sweep"
}
```

5. Create directories: `mkdir -p data/verified/{date}/{sector}`
6. Slug: lowercase title, non-alphanumeric to hyphens, truncate at 80 chars

Skip paywalled: bloomberg.com, ft.com, wsj.com, thetimes.co.uk, economist.com, hbr.org, nytimes.com, telegraph.co.uk, theatlantic.com

## Step 5: Report

```
Headlines checked: N queries
New stories found: N
Already in corpus (URL match): N
Already in corpus (title match): N
Saved: N (of max 10)
  By region: US X, EU X, UK X, Ireland X, Asia X
  By sector: general X, insurance X, biopharma X, medtech X, manufacturing X
Outside date window (rejected): N
```

## Rules

1. **Editorial relevance is the gate, not a number.** Ask: would an FT editor include this in a newsletter for senior leaders in regulated industries? If yes, fetch it. If not, skip it.
2. Date verification is mandatory — reject anything outside the newsletter window
3. European stories are first-class — equal search effort as US
4. Irish stories matter — we're based in Ireland
5. Title-based dedup alongside URL dedup — don't save the same story from two publications
6. Every saved article must have a verified, working URL
7. `source_type` must be `"editorial-headlines"` to distinguish from discover and sector-search origins
