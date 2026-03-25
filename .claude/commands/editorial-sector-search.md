---
description: Daily sector gap-fill — find articles for underserved sectors using WebSearch. Ensures minimum coverage across all five sectors before the weekly newsletter.
---

# Editorial Sector Search — Daily Gap-Fill

You are filling article gaps across the five SNI sectors. Each sector needs a minimum number of articles per week to support the newsletter. Your job is to identify which sectors are below threshold and find quality articles to fill the gaps.

## Step 1: Count this week's articles by sector

```bash
# Get current ISO week dates (Monday-Sunday)
python3 -c "
from datetime import date, timedelta
today = date.today()
monday = today - timedelta(days=today.weekday())
sunday = monday + timedelta(days=6)
print(f'{monday} to {sunday}')
"
```

For each date directory in that range, count articles per sector:
```bash
for sector in general biopharma medtech manufacturing insurance; do
  count=$(find data/verified/2026-03-{20..26}/$sector -name '*.json' 2>/dev/null | wc -l)
  echo "$sector: $count"
done
```

## Step 2: Identify gaps

Weekly thresholds (articles needed per sector per week):
- **General AI**: 70 (10/day) — usually well-served by RSS + Brave
- **Insurance**: 21 (3/day) — weakest RSS coverage, prioritise first
- **Biopharma**: 21 (3/day)
- **Medtech**: 21 (3/day)
- **Manufacturing**: 21 (3/day)

Warning thresholds (flag but don't panic):
- General: below 50
- Verticals: below 14

If all sectors are above threshold, report 'All sectors adequately covered' and stop.

## Step 3: Fill gaps via WebSearch

For each sector below threshold, run 3-5 targeted searches. Use keywords from `config/sectors.yaml` for sector-specific terms.

**Search strategy by sector:**

**Insurance:**
- "AI insurance underwriting" + current month/year
- "insurtech AI" + current month/year
- "AI claims automation insurance"
- "generative AI insurance" + current month/year

**Biopharma:**
- "AI drug discovery" + current month/year
- "AI clinical trials" + current month/year
- "FDA AI" + current month/year

**Medtech:**
- "AI medical device FDA" + current month/year
- "AI radiology" + current month/year
- "digital health AI" + current month/year

**Manufacturing:**
- "AI factory automation" + current month/year
- "AI semiconductor" + current month/year
- "humanoid robot factory" + current month/year

## Step 4: Fetch and save articles

For each search result that's a genuine article (not social media, not video, not paywalled):

1. **Dedup**: `grep -rl "ARTICLE_URL" data/verified/ 2>/dev/null` — skip if exists
2. **WebFetch** the content
3. **Save** to `data/verified/{date}/{sector}/{slug}.json` with the standard schema:

```json
{
  "title": "...",
  "url": "https://...",
  "source": "Publication name",
  "source_type": "editorial-discover",
  "date_published": "YYYY-MM-DD",
  "date_verified_method": "web-search",
  "date_confidence": "high",
  "sector": "insurance|biopharma|medtech|manufacturing|general",
  "snippet": "First 300 chars of full_text",
  "full_text": "Article text",
  "found_by": ["WebSearch: sector gap-fill"],
  "score_reason": "Sector gap-fill — below weekly threshold"
}
```

Skip paywalled: bloomberg.com, ft.com, wsj.com, thetimes.co.uk, economist.com, hbr.org

## Step 5: Report

```
Sector coverage (before → after):
  general:       N → N (threshold: 70)
  insurance:     N → N (threshold: 21)
  biopharma:     N → N (threshold: 21)
  medtech:       N → N (threshold: 21)
  manufacturing: N → N (threshold: 21)

Articles added: N
Sectors still below threshold: [list]
```

## Rules

1. Quality over quantity — articles must be editorially relevant for enterprise leaders in regulated industries
2. Every article MUST have a valid URL
3. Never fabricate content
4. Prioritise insurance (weakest RSS coverage) when multiple sectors need filling
5. Focus on articles from the current newsletter week, not older content
