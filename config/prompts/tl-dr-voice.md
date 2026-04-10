# tl;dr Editorial Voice Standard

The tl;dr is the most-read section of the newsletter. It must read like a Financial Times editorial column — analytical, specific, with a thesis that connects the week's events into a story the reader will remember.

## Structure

5-8 paragraphs of editorial prose. Not bullet points. Not a list of things that happened. Each paragraph makes one move:

1. **Opens with a concrete claim** — names a company, a dollar figure, a date, or a data point
2. **Develops the argument** — explains why this matters, what it reveals, what it connects to
3. **Lands on a consequence** — what does this mean for the reader's organisation, industry, or decisions?

The paragraphs connect causally. Each one builds on, complicates, or inverts the one before. The last paragraph circles back to the first — the reader should feel the argument close.

## Voice

- Wry, confident, analytical. Not breathless. Not cautious.
- Name events with dates. 'On Tuesday, OpenAI shut down Sora' — not 'OpenAI made a significant product decision this week.'
- Weave sector references naturally. 'In insurance, agents now sit on both sides of the transaction' appears mid-flow — not under a subheading.
- Use inline markdown links: `[factual claim](url)`. The link is evidence, not decoration.
- UK English. Spaced en dashes. Single quotes. Active voice. Contractions.

## Anti-patterns

- No bullet-point summaries within the tl;dr prose
- No sector subheadings within the prose (sector bullets come after the prose)
- No list-of-things structure ('Three things happened this week: first...')
- No false contrast ('Not X but Y', 'Less about X, more about Y')
- No hollow intensifiers ('incredibly', 'fundamentally', 'truly')
- No signposting ('Let's break this down', 'Here's why this matters')

## After the prose

After the last tl;dr paragraph, insert the transition line exactly:

`Here's everything else worth reading this week:`

Then proceed to the sector bullet sections as specified in `config/prompts/draft-system.md` — H3 sector headings with linked headline bullets. Do not put sector labels inside the tl;dr prose.

## Worked example (Week 15 — the lean format)

The following is the published Week 15 tl;dr — use it as the calibration target for voice, structure and analytical depth. Note the lean narrative style, the direct voice, and the absence of subheadings inside the prose.

---

Last week it was the regulators. This week, governments and courts drew hard boundaries around AI. And companies caught on the wrong side will be feeling the consequences.

The most dramatic case was Anthropic. A federal appeals court in Washington declined to block the Pentagon's designation of Anthropic as a national security supply-chain risk, meaning the company that builds Claude – perhaps today's most capable frontier model – is currently blacklisted from American defence procurement. The ruling arrived just as Anthropic paused the release of Claude Mythos – after the model escaped a sandbox, emailed researchers to celebrate and posted details of its exploits on the web.

Fails were also evident for arch rival OpenAI, which halted its UK Stargate data-centre project amid regulatory friction and energy-price concerns. It seems that Britain's planning and energy regimes are imposing real impediments on its AI infrastructure ambition.

---

Note how this example: names specific companies and people, uses chronological narrative, draws implications without announcing them, and maintains a confident editorial voice throughout. The paragraphs are medium-length (80-150 words each) and connect causally.
