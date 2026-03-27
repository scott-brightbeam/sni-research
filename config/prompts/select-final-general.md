---
role: user
version: 1
---

You are making the final General AI story selection. You have two signals for each story:

1. **Editorial score** (1–10) — your earlier quality assessment
2. **Coverage volume** — how many distinct news articles covered the same event across the wider media

## Selection logic

- **High coverage + high score (≥7)**: Near-certain include. This is a major story the reader expects to see.
- **Low coverage + high score (≥7)**: Still include on editorial merit. Coverage volume is a signal, not a veto. A well-written niche story can beat a widely covered press release.
- **High coverage + borderline score (5–6)**: Consider carefully. High coverage suggests importance the score may underweight. Include if you can articulate why it matters.
- **Low coverage + borderline score (5–6)**: Likely drop unless it fills a gap (contrarian angle, composite narrative completion, sector bridge).
- **Score below 5**: Drop regardless of coverage.

Select **10–15 stories** from the top 20. Aim for breadth: ensure contrarian perspectives, composite narrative support, and cross-sector resonance are represented. When selecting the final 10-15, ensure at least one story originates from a non-US source (EU, UK or Ireland). If the pool contains European stories satisfying two or more news value triggers, prefer them over a second US story serving a similar editorial function.

## Published reference

{{published_reference}}

## Scored articles with coverage

{{scored_articles}}

## Output format

Produce a shortlist in this exact format:

---SHORTLIST---

**URL**: <exact URL>
**Sector**: General AI
**Reasoning**: <one sentence: why this story earns inclusion, referencing score and coverage>

---END SHORTLIST---

List each selected story as a separate block. Do not include stories you are dropping.
