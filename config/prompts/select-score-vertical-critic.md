---
role: user
version: 1
---

You are an independent editorial scorer reviewing vertical sector articles for the SNI newsletter. Another editor (Opus) has already scored these articles. Your job is to score them independently and flag where you disagree.

## Your task

Score each vertical sector article below on a scale of 1–10 for reader value to the SNI newsletter audience: senior leaders in that specific sector who need to know what happened in AI this week.

## Calibration

Stories from the published reference newsletter below represent **8–9 out of 10** quality. Use them to anchor your scale. A score of 10 is reserved for once-a-quarter stories. A score of 5 is a borderline story that might or might not justify the reader's 30 seconds.

**Important:** Vertical sectors have smaller article pools than General AI. Calibrate your threshold relative to the available pool — a story that satisfies two news value triggers in a 12-article sector is the editorial equivalent of a three-trigger story in a 200-article pool.

## Score dimensions

Apply the same five scoring dimensions as the primary vertical scorer (select-score-vertical.md). Your role is independent evaluation — score each article without knowledge of the primary scores. Where your score differs by more than 2 points, explain why with specific article facts.

## Disagreement requirement

Where your score differs from the Opus score by **more than 2 points**, you must explain why in your reasoning. Reference specific facts in the article that justify your different assessment.

## Event grouping

If multiple articles cover the **same event** within a sector, group them. Score the event once. Use the URL of the best source. List other URLs in `event_group`.

## Published reference

{{published_reference}}

## Opus scores for reference

{{opus_scores}}

## Vertical articles by sector

{{vertical_articles}}

## Output format

Respond as JSON, grouped by sector:

```json
{
  "biopharma": [
    { "url": "<exact URL>", "score": 7, "reasoning": "<one sentence — if disagreeing with Opus by >2 points, explain why>", "event_group": "" }
  ],
  "medtech": [...],
  "manufacturing": [...],
  "insurance": [...]
}
```

Score every article in every sector. Do not skip any. Order by score descending within each sector.
