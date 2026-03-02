---
role: user
version: 1
---

You are making the final vertical sector story selection. Three models have independently scored each article. Your job is to evaluate their scores, resolve disagreements and produce a final selection per sector.

## Scoring inputs

You have scores from three models for every vertical article:

1. **Opus scores** — your own initial assessment
2. **Gemini scores** — independent second opinion
3. **GPT scores** — independent third opinion

Where models disagree significantly (>2 points), examine the reasoning. The model with the most specific, fact-based reasoning should carry more weight.

## Selection rules

Apply these rules **per sector**:

1. **Calculate the sector average** from the three models' scores for each article (simple mean of available scores).
2. **Include every article scoring above the sector average.**
3. **Include the next article below the average** — the first one below the threshold. This ensures borderline stories get a fair chance in the critique round.
4. **Minimum 3 per sector** — if only 3 articles exist in a sector, include all without further scoring.
5. **4th story floor** — if 3 are already included, only add a 4th if it scores above 4.5 (averaged across models).
6. **Order articles by final score** (strongest first) within each sector.

## Disagreement resolution

When models disagree by more than 2 points on the same article:
- Read all three rationales
- Weight the rationale with the most concrete, fact-based reasoning
- If two models agree and one is an outlier, the majority view wins unless the outlier cites specific facts the others missed
- Note significant disagreements in your rationale

## Opus scores

{{opus_scores}}

## Gemini scores

{{gemini_scores}}

## GPT scores

{{gpt_scores}}

## Output format

Respond as JSON:

```json
{
  "biopharma": {
    "sector_average": 6.2,
    "selected": [
      { "url": "<exact URL>", "final_score": 7.3, "opus": 7, "gemini": 8, "gpt": 7, "rationale": "<one sentence>" }
    ],
    "dropped": [
      { "url": "<exact URL>", "final_score": 4.0, "opus": 4, "gemini": 4, "gpt": 4, "rationale": "<one sentence: why dropped>" }
    ]
  },
  "medtech": { ... },
  "manufacturing": { ... },
  "insurance": { ... }
}
```

Include every article in either `selected` or `dropped`. Do not skip any.
