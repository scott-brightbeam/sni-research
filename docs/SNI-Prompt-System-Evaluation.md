# SNI Prompt System Evaluation

Use this prompt with Claude Opus 4, providing the two reference documents as attachments.

---

<context>
You are evaluating the complete prompt system behind Sector News Intelligence (SNI), a weekly AI newsletter covering five sectors: general AI, biopharma, medtech, manufacturing and insurance. The newsletter serves senior leaders, transformation professionals and AI-curious executives in regulated industries, with particular focus on enterprises in Ireland, the EU and UK.

You have two reference documents:

1. **SNI Prompt Catalogue** (SNI-Prompt-Catalogue.docx) — contains every active prompt in the system with its stated purpose, pipeline position, success criteria and complete text. There are 33 prompts organised by pipeline stage: DISCOVER, ANALYSE, PRODUCE and QUALITY ASSURANCE.

2. **Published Newsletters — Weeks 12 and 13** (weeks-12-13.md) — the definitive quality benchmark. Week 13 is the structural template that every future newsletter must follow exactly. Week 12 has a different structure but is an excellent example of editorial voice, analytical depth and tone. Together they define what the prompt system must produce.

The prompt system runs as an automated daily pipeline with human editorial oversight on Thursdays. The pipeline stages are:

- **DISCOVER** (daily): Article fetching via Brave Search and RSS, podcast transcription, story reference resolution via WebSearch, headline sweeps across US/EU/UK/Irish sources, sector gap-filling
- **ANALYSE** (daily): Podcast transcript processing through the Brightbeam editorial lens — building analysis entries, theme registry, post backlog, cross-connections and story references
- **PRODUCE** (Thursday): Story selection, theme identification, newsletter draft generation (Opus), external critique (Gemini + GPT), revision, evaluation
- **QUALITY ASSURANCE** (Wednesday + Thursday): URL verification, story completeness checks, sector coverage thresholds, draft evaluation, self-review, benchmarking

The system is based in Ireland and serves a global audience. Geographic balance — ensuring Irish, EU and UK stories appear alongside US coverage — is a stated design objective.
</context>

<role>
You are an expert prompt engineer and editorial systems architect conducting a comprehensive audit of this prompt system. You have deep experience with LLM prompt design, editorial workflow automation and newsletter production at scale. Your evaluation must be rigorous, specific and actionable — every finding should cite the exact prompt, the exact text that is problematic, and the exact change you recommend.
</role>

<instructions>
Produce a comprehensive evaluation document covering all ten dimensions below. For each dimension, work through every relevant prompt systematically. Do not summarise or skip prompts — the value of this evaluation is its exhaustiveness.

Throughout, use the Week 12 and Week 13 newsletters as your quality benchmark. When assessing whether a prompt contributes to newsletter quality, ask: would the published Week 13 newsletter have been better or worse if this prompt had been different? When assessing voice, ask: does this prompt's output match the voice in Weeks 12 and 13?

## Dimension 1: Individual Prompt Assessment

For each of the 33 prompts in the catalogue, assess:

- **Purpose accuracy**: Does the prompt's stated purpose match what its text actually instructs? Are there discrepancies between what the catalogue says the prompt does and what the prompt text would actually produce?
- **Success criteria validity**: Are the stated success criteria measurable from the prompt's output? Are there criteria that are impossible to verify, or important criteria that are missing?
- **Effectiveness**: Based on the prompt text alone, would it produce output that contributes to a newsletter of Week 12/13 quality? Identify specific weaknesses.

Rate each prompt: STRONG (no changes needed), ADEQUATE (minor improvements), WEAK (significant rework needed), or MISALIGNED (prompt doesn't serve its stated purpose).

## Dimension 2: Contribution to Newsletter Quality

For each prompt, assess its impact on the final published newsletter:

- **Critical path**: Is this prompt on the critical path to newsletter quality? If it failed, would the newsletter noticeably suffer?
- **Value-add**: Does this prompt add editorial value that couldn't be achieved without it?
- **Redundancy risk**: Could this prompt be removed without affecting newsletter quality?

Categorise each: ESSENTIAL, VALUABLE, MARGINAL, or REDUNDANT.

## Dimension 3: Gap Analysis

Identify prompts that are missing from the system. Consider:

- Are there stages in the pipeline where quality could degrade without a prompt to guard it?
- Are there editorial judgements currently made implicitly that should be made explicit in a prompt?
- Looking at Weeks 12 and 13, are there qualities of the published newsletters that no prompt in the system specifically ensures?
- Is there a prompt that ensures the newsletter reads as editorial rather than aggregation? That ensures causal reasoning rather than listing? That ensures the tl;dr develops arguments rather than summarising?

For each gap, specify: what the prompt should do, where in the pipeline it belongs, and what its success criteria should be.

## Dimension 4: Redundancy Analysis

Identify prompts that overlap, duplicate or contradict each other:

- Do any two prompts give conflicting instructions about the same output?
- Are there prompts that could be consolidated without losing functionality?
- Are there prompts that address the same concern at different pipeline stages — is that intentional layering or wasteful duplication?

For each redundancy, recommend: consolidate, keep both (with justification), or remove one (specifying which).

## Dimension 5: Prompt Chain Coherence

Assess the prompts as a system, not individually:

- **Handoff quality**: When one prompt's output feeds into the next prompt's input, is the schema compatible? Are there format mismatches or information losses at handoff points?
- **Contradictions**: Do any prompts contradict each other? For example, does one prompt instruct a conservative approach while another instructs an aggressive one for the same content?
- **Assumption gaps**: Does any prompt assume information that a previous prompt doesn't reliably produce?
- **Chain completeness**: Trace the path from raw podcast transcript to published newsletter. Is every transformation covered by a prompt? Are there steps that happen without prompt guidance?

Map the complete prompt chain from input to output, noting every gap and disconnection.

## Dimension 6: Geographic Balance

Assess whether the prompt system collectively ensures Irish, EU and UK coverage:

- Which prompts explicitly mention non-US sources? Quote the relevant text.
- Which prompts are US-centric by default? Quote the text that creates the bias.
- Is there a mechanism to ensure the final newsletter contains European content, or does geographic balance depend entirely on whether the article corpus happens to contain European stories?
- Looking at Week 13's published content: the tl;dr mentions Ireland's enforcement penalties, the EU AI Act delays, the FCA/Palantir trial and the Roman court ruling. Which prompts in the system would have ensured these stories were found, selected and included? Trace the path.

Recommend specific text changes to prompts that should but don't ensure geographic balance.

## Dimension 7: Voice Consistency

The editorial voice is defined in `editorial-context.v1.txt` and enforced (in theory) across all prompts. Assess:

- **Prohibited language**: Which prompts reference the prohibited language list? Which don't but should?
- **UK English**: Which prompts specify UK English? Which use US English in their own text (and therefore risk producing US English output)?
- **Writing style rules**: Are the style rules (spaced en-dashes, single quotes, active voice, specific over abstract) consistently referenced across all content-generating prompts?
- **Analytical voice**: Do all prompts that produce newsletter content instruct the same analytical approach — or do some produce summaries while others produce analysis?

Quote specific instances where voice enforcement is present, absent or contradictory.

## Dimension 8: Quality Gate Chain

Map every quality gate in the system:

- What checks exist between DISCOVER and ANALYSE? Can a bad article reach the analysis stage?
- What checks exist between ANALYSE and PRODUCE? Can fabricated evidence reach the draft?
- What checks exist between draft generation and publication? How many independent evaluations does a draft receive?
- Is there a single point of failure where one broken prompt would allow errors through to the published newsletter?

For each gate, assess: is it sufficient? What would bypass it? What additional check would strengthen it?

## Dimension 9: Specific Prompt Improvements

For every prompt rated ADEQUATE or below in Dimension 1, provide:

- The exact current text that needs changing (quote it)
- The exact replacement text you recommend
- The reasoning for the change
- The expected impact on newsletter quality

Be precise. "Improve the instructions" is not actionable. "Replace 'Produce a complete newsletter draft' with 'Produce a newsletter draft following the exact structure of the Week 13 template: welcome line, tl;dr (5-6 paragraphs of editorial prose with causal reasoning), sector bullets inline, expanded sector analysis, podcast section with zero URL overlap'" is actionable.

## Dimension 10: System Maturity Rating

Rate the overall system on a 1-10 scale where:

- 1-3: Prompts exist but don't reliably produce newsletter-quality output
- 4-5: System produces drafts that require significant human rewriting
- 6-7: System produces good first drafts with predictable weaknesses
- 8-9: System reliably produces publication-ready content with minor editorial polish
- 10: System matches or exceeds human editorial quality consistently

Justify your rating with specific evidence from the prompt texts and the Week 12/13 benchmark. Identify the three changes that would most improve the rating.
</instructions>

<constraints>
- Cite every finding with the exact prompt name and quoted text. No vague references.
- Use the Week 12 and Week 13 newsletters as the quality benchmark for every assessment. If a prompt's output wouldn't contribute to that level of quality, say so and explain why.
- Be direct. If a prompt is weak, say it's weak and explain exactly what's wrong.
- Recommendations must be specific enough to implement. Include exact replacement text where you recommend changes.
- Do not assess the prompt texts for technical correctness of their domain claims (e.g. don't evaluate whether the AI industry analysis is accurate). Assess only whether the prompts would produce the right kind of output.
- The evaluation should be at least 8,000 words. Thoroughness matters more than brevity.
- Write in UK English throughout.
</constraints>

<output_format>
Structure the evaluation as a professional document with:

1. **Executive Summary** (1 page) — overall assessment, maturity rating, top 5 findings
2. **Dimension 1-10** — one section per dimension, with subsections per prompt where relevant
3. **Prompt-by-Prompt Scorecard** — a summary table rating every prompt across all applicable dimensions
4. **Priority Action List** — the 10 highest-impact changes, ordered by expected improvement to newsletter quality
5. **Appendix: Complete Prompt Chain Map** — visual representation of how prompts connect from input to output

Use tables for comparative assessments. Use quoted text for specific findings. Use bold for ratings and recommendations.
</output_format>
