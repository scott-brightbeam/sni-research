---
description: Daily broad AI news sweep — find the week's biggest stories across US, EU, UK and Irish sources. Fills the gap between RSS/Brave (volume) and DISCOVER (podcast references).
---

# Editorial Headlines — Daily News Sweep

You are the front-page news check for the SNI newsletter. Every day, search for the biggest AI stories and check whether they're in the article corpus. Add anything significant that's missing.

**The goal: by Wednesday evening, every major AI story from the week should be in `data/verified/`.** The newsletter should never be missing a story that a reader would expect to see.

## Step 1: Determine the newsletter date window

```bash
python3 -c "
from datetime import date, timedelta
today = date.today()
# Newsletter window: Friday to Thursday
days_since_friday = (today.weekday() - 4) % 7
window_start = today - timedelta(days=days_since_friday)
print(f'Window: {window_start} to {today}')
"
```

## Step 2: Search for major stories

Run WebSearch for each of these queries. For each result, check if the URL is already in the corpus before proceeding.

### Global AI headlines
- "artificial intelligence news this week"
- "OpenAI" + current week
- "Anthropic Claude" + current week
- "Google AI" OR "Google Gemini" + current week
- "Meta AI" + current week
- "AI regulation" + current week

### Irish AI
- "Ireland AI"
- "IDA Ireland artificial intelligence"
- "CBI artificial intelligence" OR "Central Bank Ireland AI"
- "Irish data centre"

### EU AI
- "EU AI Act" implementation OR delay OR compliance
- "EIOPA AI" OR "European insurance AI"
- "EMA artificial intelligence" OR "European Medicines Agency AI"
- "European Commission AI"

### UK AI
- "FCA AI" OR "Financial Conduct Authority artificial intelligence"
- "NHS AI"
- "MHRA AI" OR "UK medical device AI"
- "Lloyd's AI" OR "London market AI"
- "UK AI regulation" OR "UK AI Safety Institute"

## Step 3: Check corpus for each story

For each significant result:
```bash
grep -rl "ARTICLE_URL" data/verified/ 2>/dev/null
```

If found → skip (already in corpus).
If not found → proceed to Step 4.

## Step 4: Verify and save

For each new story:
1. Confirm publication date is within the newsletter window
2. Confirm it's genuine reporting (not aggregator, not social media, not paywalled)
3. WebFetch the article content
4. Save to `data/verified/{date}/{sector}/{slug}.json` with standard schema
5. Dispatch a verification sub-agent to confirm the article is what it claims to be

Skip paywalled: bloomberg.com, ft.com, wsj.com, thetimes.co.uk, economist.com, hbr.org

## Step 5: Report

```
Headlines checked: N queries
New stories found: N
Already in corpus: N
Saved: N
  By region: US X, EU X, UK X, Ireland X
  By sector: general X, insurance X, biopharma X, medtech X, manufacturing X
Outside date window (rejected): N
```

## Rules

1. Date verification is mandatory — reject anything outside the newsletter window
2. European stories are first-class, not secondary — equal search effort as US
3. Every saved article must have a verified, working URL
4. Dedup before saving — never create duplicates
5. Irish stories matter — we're based in Ireland
