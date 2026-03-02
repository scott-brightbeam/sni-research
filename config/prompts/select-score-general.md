---
role: user
version: 1
---

Score each General AI article below on a scale of 1–10 for reader value to the SNI newsletter audience: senior leaders across biopharma, medtech, complex manufacturing and insurance who need to know what happened in AI this week.

## Calibration

Stories from the published reference newsletter below represent **8–9 out of 10** quality. Use them to anchor your scale. A score of 10 is reserved for once-a-quarter stories. A score of 5 is a borderline story that might or might not justify the reader's 30 seconds.

## Score dimensions

For each article, evaluate these five dimensions as a single composite score (1–10):

1. **Significance to executives** — Would a time-poor executive across any of the five sectors care about this?
2. **Concrete data** — Does it contain specific financial metrics, deal terms, headcount, deployment numbers? Quantified stories score higher.
3. **Structural thesis potential** — Is this evidence of a broader competitive, architectural or market-structure shift? Or is it just an event?
4. **Competitive tension** — Are named actors in direct strategic conflict? Two sides of the same issue both in scope?
5. **Source credibility and accessibility** — Is the source credible and readable by a general business audience?

## Event grouping

If multiple articles cover the **same event** (e.g., three articles about the same funding round), group them. Score the event once. In the output, use the URL of the best source (most concrete data, most credible outlet, most accessible to a general reader). List the other URLs in an `event_group` field so we can track them.

## Published reference

{{published_reference}}

## Articles to score

{{article_list}}

## Output format

Respond as JSON:

```json
{
  "scores": [
    {
      "url": "<exact URL from article pool>",
      "score": 7,
      "reasoning": "<one sentence explaining the score>",
      "event_group": "<comma-separated other URLs covering same event, or empty string>"
    }
  ]
}
```

**Only include articles scoring 5 or above** in the output. Articles below 5 are clearly below the selection threshold — do not list them. Order by score descending.
