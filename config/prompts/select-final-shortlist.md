---
role: user
version: 2
---

You are the editor-in-chief making the final story selection for the SNI newsletter. You have a merged pool of ~40–50 stories from two scoring tracks:

- **General AI stories**: Scored by Opus (1–10), with coverage volume data (how many distinct articles covered the same event), then narrowed by a second Opus round
- **Vertical stories**: Scored independently by Opus, GPT and Gemini (1–10), then evaluated by Opus across all three score sets

Your job: select the **28–35 strongest stories** from this pool to form the final newsletter shortlist.

## Sector budget

The newsletter is read by executives across biopharma, medtech, manufacturing and insurance. Sector balance matters — vertical readers have no substitute if their stories are cut.

**Targets (aim for, not rigid caps):**

| Sector | Target |
|---|---|
| General AI | ~12 stories (trim composites to 2 angles max before cutting standalone stories) |
| Each vertical | keep all stories scoring ≥6; minimum 4 per sector if the pool supports it |
| Total | ~33–38 stories |

**Priority when cutting:** Cut the weakest story overall, regardless of sector. But between two stories at the same score, cut the General AI one — vertical readers have no substitute.

**Score protection:** Never cut any story scoring ≥7 (in any sector) unless it is genuinely redundant with another selected story covering the same event and angle. For composites (multiple stories on the same event), keep the 2 strongest angles and cut beyond that.

## Selection criteria

1. **Score strength** — Higher-scoring stories are preferred. For verticals, consider all three model scores (Opus, GPT, Gemini where available).
2. **Coverage volume** (General AI only) — Stories with high media coverage are genuinely important to readers. Use as a supporting signal.
3. **Breadth and narrative completeness** — Include contrarian angles, composite narrative pairs (e.g., a funding round + a regulatory response), and cross-sector bridges.
4. **Reader value** — Would a time-poor executive across biopharma, medtech, manufacturing or insurance care about this story? Concrete data, named actors and structural implications score higher.
5. **Geographic diversity** — The final shortlist must include at least two stories from non-US sources across all sectors combined (EU, UK or Ireland). If this is not achievable on merit, note it in the output.

## What to cut

- Stories that are redundant with a stronger story on the same event or thesis
- Stories that scored low across all models without compensating qualities
- Vague announcements without concrete data or named actors
- Stories that serve the same editorial function as another already selected

**Default posture: keep.** Only cut stories that genuinely fail the above criteria. When in doubt, keep it.

## Published reference

{{published_reference}}

## Story pool

{{story_pool}}

## Output format

Produce the final shortlist in this exact format:

---SHORTLIST---

**URL**: <exact URL from the pool>
**Sector**: <sector name>
**Reasoning**: <one sentence: why this story earns its place>

---END SHORTLIST---

List each selected story as a separate block. Order by sector (General AI first, then verticals alphabetically), then by strength within each sector.
