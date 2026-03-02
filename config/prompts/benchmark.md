---
model: multi
max_tokens: 5000
version: 2
---

You are evaluating two versions of a weekly AI sector intelligence briefing: a published reference (written by a human editor) and a pipeline-generated draft. Your job is to assess the draft's **independent editorial quality** first, then compare it to the reference.

Important: the reference and draft may legitimately select different stories. Different story choices do not automatically mean the draft is worse — the draft may have found strong stories the reference missed. Evaluate editorial judgement, not exact replication.

## Published reference

{{reference}}

## Pipeline draft

{{draft}}

## Evaluation dimensions

Score each dimension 1-5 with specific evidence. A score of 5 means publication-ready quality, not identical to the reference.

### 1. Theme quality
Is the draft's theme specific, non-obvious and tightly argued? Does it connect stories across sectors? Does it satisfy: connects 3+ sectors, specific enough to be falsifiable, not generic ('AI advances', 'big week for AI')? Compare the theme's analytical power to the reference's — is it equally sharp, or weaker?

### 2. Story selection
Evaluate the draft's story choices on their own merits first:
- Does each story justify 30 seconds of reading time for a senior executive?
- Are stories anchored in concrete facts (deal terms, revenue, named entities, timelines)?
- Is the mix weighted toward structurally significant events (M&A, earnings, regulatory clearances, competitive repositioning)?
- Are there filler stories that add nothing?

Then compare to the reference: are there high-significance stories in the reference that the draft missed? Are there strong draft stories the reference missed? Note: some divergence is expected due to different source pools — penalise only when the draft missed genuinely important stories that were available to it.

### 3. Analytical depth
Does the draft explain WHY stories matter (competitive dynamics, strategic implications, structural shifts) or merely report WHAT happened? Does it name winners and losers? Does it identify moats, deal structures and second-order effects? Compare analytical sharpness to the reference's best paragraphs.

### 4. Voice fidelity
Does the draft maintain a senior analyst tone? Any lapses into marketing language, cheerleading, over-hedging, generic tech journalism or rhetorical questions? Check for: prohibited buzzwords, hollow intensifiers, cliché constructions, reader-addressing.

### 5. Narrative coherence
Does the draft read as a unified briefing with a throughline, or as disconnected story summaries? How effectively does the theme weave through sector intros and individual stories?

### 6. Structural balance
Are sectors weighted by news significance? Is the AI & tech section appropriately dominant when warranted? Are vertical sectors represented proportionally to the week's actual news volume?

### 7. Overall quality
Holistic assessment: if you were the editor, how much work would the draft need before publication? 1 = complete rewrite. 3 = significant editing but strong foundation. 5 = publishable with minor tweaks. Judge on absolute quality, not similarity to the reference.

Return JSON only, no surrounding text or markdown fencing:
{"scores": {"theme_quality": {"score": 0, "feedback": "..."}, "story_selection": {"score": 0, "feedback": "...", "reference_stories_missed": ["..."], "draft_stories_unnecessary": ["..."], "draft_stories_strong": ["stories the draft found that reference missed or that are genuinely strong"]}, "analytical_depth": {"score": 0, "feedback": "...", "strongest_analysis": "...", "weakest_analysis": "..."}, "voice_fidelity": {"score": 0, "feedback": "...", "lapses": ["..."]}, "narrative_coherence": {"score": 0, "feedback": "..."}, "structural_balance": {"score": 0, "feedback": "..."}, "overall_closeness": {"score": 0, "feedback": "..."}}, "overall_score": 0, "top_matches": ["what the draft got right — specific examples", "..."], "top_gaps": ["where the draft falls short — specific examples", "..."], "rewrite_suggestions": [{"location": "section or paragraph reference", "current": "brief quote", "suggested": "improvement", "reason": "why this matters"}]}
