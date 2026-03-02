---
role: user
version: 1
---

Score each vertical sector article below on a scale of 1–10 for reader value to the SNI newsletter audience: senior leaders in that specific sector who need to know what happened in AI this week.

## Calibration

Stories from the published reference newsletter below represent **8–9 out of 10** quality. Use them to anchor your scale. A score of 10 is reserved for once-a-quarter stories. A score of 5 is a borderline story that might or might not justify the reader's 30 seconds.

**Important:** Vertical sectors have smaller article pools than General AI. Calibrate your threshold relative to the available pool — a story that satisfies two news value triggers in a 12-article sector is the editorial equivalent of a three-trigger story in a 200-article pool.

## Score dimensions

For each article, evaluate these three dimensions as a single composite score (1–10):

1. **Reader interest and relevance** — How interesting and relevant is this to a senior leader in this specific sector? Would they share it with a colleague?
2. **Impact level** — Does this represent a meaningful development? Funding rounds with named investors and competitive context, regulatory clearances with deployment implications, product launches with customer traction all score higher than vague announcements.
3. **Source credibility and accessibility** — Is the source credible, specific and readable by a business audience? Stories with concrete data (dollar figures, metrics, named customers) score higher.

## Event grouping

If multiple articles cover the **same event** within a sector, group them. Score the event once. Use the URL of the best source. List other URLs in `event_group`.

## Published reference

{{published_reference}}

## Vertical articles by sector

{{vertical_articles}}

## Output format

Respond as JSON, grouped by sector:

```json
{
  "biopharma": [
    { "url": "<exact URL>", "score": 7, "reasoning": "<one sentence>", "event_group": "" }
  ],
  "medtech": [...],
  "manufacturing": [...],
  "insurance": [...]
}
```

Score every article in every sector. Do not skip any. Order by score descending within each sector.
