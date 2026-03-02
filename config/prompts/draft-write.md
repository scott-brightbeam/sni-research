---
model: claude-opus-4-6
max_tokens: 12000
version: 3
---

Write the complete SNI weekly briefing. Follow every instruction in the system prompt exactly – structure, formatting, voice, prohibited language. Do not deviate.

## Critical formatting reminders

These are the most commonly violated rules. Check every instance before finalising:

- **Currency**: `$110bn` not '$110 billion'. `$60m` not '$60 million'. `£50m` not '£50 million'. Always abbreviate – never write 'billion' or 'million' in full. This is non-negotiable.
- **Quotes**: Single quotation marks only: 'like this' not "like this"
- **Dashes**: Spaced en dashes: word – word (not em dashes, not hyphens)
- **No rhetorical questions**: Never ask the reader a question. State the answer directly.

## Theme

This week's theme: **{{theme}}**

Use this theme to frame the tl;dr intro, connect stories across sectors in the body section opening paragraphs and give the reader a coherent lens on the week. The theme phrase should appear in the tl;dr title and be echoed naturally in at least two body sections.

## Story selection — hard limits

Select **exactly 12–15 stories** from the research pack. This is a hard ceiling – do not write 16 or more stories under any circumstances, even if the research pack contains 30+ articles. Count your stories before you begin writing. If you have more than 15, cut until you reach 15. Fewer stories with deeper analysis always beats more stories with shallow coverage.

**Sector allocation** (must sum to 12–15 total):
- AI & tech: 4–6 stories
- Each vertical sector: 2–3 stories
- If a vertical has only 1 article, include it. If zero, skip it.

**Word budget check** — verify before writing:
- Total report target: 3,000–4,000 words. Do not exceed 4,000.
- AI & tech body: 800–1,500 words
- Each vertical body: 300–700 words
- tl;dr + transitions: ~400 words
- If your planned story count × 180 words average exceeds 3,500 words of body content, cut the weakest story in the largest section.

**Bullet/detail alignment**: Every story in the body must have a corresponding tl;dr bullet. Every tl;dr bullet must have a corresponding body story. No exceptions – the two sections are a 1:1 map of each other.

**Include** stories that:
- Change competitive dynamics (M&A, major partnerships, market-repricing events)
- Involve concrete capital deployment with disclosed terms ($, deal structure, valuations)
- Reveal structural shifts (new moats, platform consolidation, supply-chain repositioning)
- Are first-mover events (first CE mark, first production deployment, first patent filing)

**Exclude** stories that:
- Are market-size projections from syndicated research firms (e.g. 'market projected to reach $Xbn by 2035')
- Are routine executive appointments with no strategic significance
- Are vendor blog posts or thought-leadership content dressed as news
- Are restatements of existing trends with no new evidence this week
- Add marginal signal when a stronger story in the same sector is available

When in doubt, ask: would a senior executive at a $1bn+ company change a decision based on this story? If not, cut it.

## Analytical framework

For every story in the body, your analysis must answer at least one of these questions:

1. **What changed?** Not what was announced – what shifted in competitive position, market structure or strategic options?
2. **Who benefits and who loses?** Name the winners and losers. If a funding round gives company X a data advantage, name the competitors who now lack that advantage.
3. **What moat is being built?** Data moats, platform lock-in, patent walls, supply-chain control, regulatory certification stacks – identify the specific defensive mechanism.
4. **What does the structure reveal?** Deal terms, pricing models, equity warrants, performance conditions – these reveal power dynamics that press releases obscure.
5. **How does this connect to the theme?** Every story should visibly reinforce the week's thesis. If a story doesn't connect, either find the connection or cut the story.

**Do not** write generic significance statements like 'reflects a broader trend', 'signals commitment to AI', 'positions competitively', 'could accelerate adoption'. These are empty. Replace them with the specific competitive dynamic the story reveals.

## Sector order

Sectors appear in this fixed order in both the tl;dr and body: {{sector_order}}

If a sector has zero articles, include a one-sentence note in the body section acknowledging the quiet week. Skip that sector's subheading in the tl;dr bullets entirely.

## Research pack

The articles below are your sole source material. Every factual claim in the draft must be attributable to one of these articles. Do not invent facts, dates, figures or quotes. If an article's snippet is ambiguous, state what is known rather than inferring what is not.

{{research_pack}}

## Previous report

The previous report represents the target quality standard. Match its analytical depth, competitive analysis specificity, voice and formatting precision. Do not copy its theme, framing or story selection – but match its standard of editorial judgement.

{{previous_report}}

## Output

Write the complete report in markdown. Start with the title line. End with the closing line. Nothing before or after.
