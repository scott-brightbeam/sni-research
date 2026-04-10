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

Use this theme to frame the tl;dr opening and connect stories across sectors within the prose. The theme phrase should appear in the tl;dr heading and be echoed naturally at least once more within the prose.

## Story selection — hard limits

Select **18-30 total story references** (across tl;dr prose + sector bullets). Count carefully before writing. The format is lean: a tl;dr prose section that weaves in 5-10 named stories, then five sector sections of 3-5 bullet stories each.

**Sector allocation** (sector bullets only — tl;dr prose is additional):
- AI & tech: 3-5 bullet stories
- Biopharma: 3-5 bullet stories
- Medtech: 3-5 bullet stories
- Advanced manufacturing: 3-5 bullet stories
- Insurance: 3-5 bullet stories

**Minimum 3 per sector.** If a sector has fewer than 3 qualifying stories, include what is available and add one sentence above the bullets noting thin coverage for the week. Never skip a sector heading.

**Maximum 5 per sector.** Rank by editorial strength and cut the weakest if over.

**Total word budget (non-negotiable):** 1,800-2,800 words. Fail boundary: <1,500 or >3,500.

- tl;dr prose: 500-800 words
- Sector bullets: 80-150 words per sector (roughly 25-40 words per bullet — one linked headline + one sentence of context)
- Podcast section: 400-600 words
- Structural lines (welcome, transition, closing): ~80 words

**tl;dr/bullet alignment:** Stories woven into the tl;dr prose should NOT be repeated in the sector bullets. The sector bullets capture stories that did not make it into the prose. Together they cover the week.

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

**For the tl;dr prose**: each paragraph should answer at least one of these questions about the stories it weaves in:

1. **What changed?** Not what was announced – what shifted in competitive position, market structure or strategic options?
2. **Who benefits and who loses?** Name the winners and losers. If a funding round gives company X a data advantage, name the competitors who now lack that advantage.
3. **What moat is being built?** Data moats, platform lock-in, patent walls, supply-chain control, regulatory certification stacks – identify the specific defensive mechanism.
4. **What does the structure reveal?** Deal terms, pricing models, equity warrants, performance conditions – these reveal power dynamics that press releases obscure.
5. **How does this connect to the theme?** Every story should visibly reinforce the week's thesis. If a story doesn't connect, either find the connection or cut the story.

**For the sector bullets**: one sentence of context per story. The context sentence should answer EXACTLY ONE of the questions above — typically "what changed" or "who benefits". Do not cram all analysis into a single bullet. The bullet is a pointer, not a mini-essay.

**Do not** write generic significance statements like 'reflects a broader trend', 'signals commitment to AI', 'positions competitively', 'could accelerate adoption'. These are empty. Replace them with the specific competitive dynamic the story reveals.

## Sector order

Sectors appear in this fixed order:
1. AI & tech
2. Biopharma
3. Medtech
4. Advanced manufacturing
5. Insurance

Always use `### {sector}:` as the H3 heading. If a sector has fewer than 3 qualifying stories, include what is available and add one sentence above the bullets noting thin coverage. Never skip a sector heading entirely.

## Research pack

The articles below are your sole source material. Every factual claim in the draft must be attributable to one of these articles. Do not invent facts, dates, figures or quotes. If an article's snippet is ambiguous, state what is known rather than inferring what is not.

{{research_pack}}

## Previous report

The previous report represents the target quality standard. Match its analytical depth, competitive analysis specificity, voice and formatting precision. Do not copy its theme, framing or story selection – but match its standard of editorial judgement.

{{previous_report}}

## Output

Write the complete report in markdown. Start with the title line. End with the closing line. Nothing before or after.
