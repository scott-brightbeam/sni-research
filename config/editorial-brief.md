# SNI editorial brief for Claude Code

This document governs how the automated draft generation layer writes the SNI weekly report. Every editorial decision documented here was made during the production of Weeks 8 and 9 and refined through multiple rounds of human editing. The standards are non-negotiable.

---

## What SNI is

SNI (Sector News Intelligence) is a weekly newsletter covering AI news across five sectors: the broader AI industry, biopharma, medtech, complex manufacturing and insurance. It publishes every Friday. The audience is senior decision-makers in these sectors who need to understand what happened in AI this week and why it matters to their industry. The writing must respect their intelligence and their time.

The editorial standard is the Financial Times, not TechCrunch. Analysis over announcement. Significance over novelty. Precision over excitement.

---

## The cardinal rules

### 1. Every story must be unique

No story may repeat from any previous week. The off-limits list in `config/off-limits.yaml` is cumulative and absolute. Before any story enters the draft, it must be checked against every entry in the off-limits file. A match on company name AND topic (50%+ keyword overlap) means the story is excluded. No exceptions.

After each report publishes, every story covered must be added to the off-limits file for the relevant week. This list only grows.

If an ongoing story has a genuinely new development (new data, new deal, new regulatory action), it may be covered – but only the new development. The draft must not re-explain the background that was covered previously. The reader has already seen it.

### 2. Every URL must be real, verified and correct

Every hyperlink in the report must point to a real, accessible page that contains the content claimed in the text. This is not optional. It is the single most important technical requirement.

Verification means:

- The URL has been fetched and the page content inspected
- The page contains the specific claims, names, numbers and quotes attributed to it in the report
- If the page cannot be fetched (403, paywall, timeout), the URL has been confirmed to exist via web search and at least one corroborating source has been checked
- If a source article discusses a topic in general terms but the report names specific entities, the report must note where those names come from (corroborating sources)

Links are placed inline in the text, never as footnotes or reference lists. The link text is the natural phrase in the sentence – never 'click here', never a bare URL, never a source name in brackets.

Correct inline linking (from Week 9):
- '[DeepSeek withheld its V4 model](https://www.firstpost.com/...) from US chipmakers'
- '[IQVIA signed an agreement](https://www.pharmaceutical-technology.com/...) to acquire drug discovery assets'
- '[three AI chip startups raised a combined $1.1bn](https://www.theregister.com/...)'

Wrong:
- 'DeepSeek withheld its V4 model (source: Firstpost)'
- 'According to [Firstpost](https://...), DeepSeek withheld its V4 model'
- 'DeepSeek withheld its V4 model [1]'

A single story may have multiple inline links when drawing on multiple sources. See the SaaSpocalypse section in Week 9 – it links to MarketMinute, TechCrunch, CNBC and PYMNTS across its paragraphs, each at the point where that source's specific contribution appears.

### 3. No fabrication of any kind

Never invent a URL. Never invent a quote. Never invent a number. Never invent a company name. Never invent a person's name or title. If the information cannot be verified from the source material, it does not appear in the report. An incomplete report is infinitely better than an inaccurate one.

---

## Report structure

The structure is fixed. Do not deviate.

### 1. Welcome line

One sentence. No fluff. Sets the scope.

Example: 'Welcome to all the AI news that matters this week – across biopharma, medtech, manufacturing and insurance.'

### 2. tl;dr section

This section has a specific format established in Week 9:

**Theme title:** 'tl;dr: [Theme name]' – the theme is a unifying idea that connects the week's stories across sectors. It should be specific enough to be interesting and broad enough to span all five sectors. Examples: 'The price of position' (Week 9). The theme should not be a cliché or a buzzword.

**Two intro paragraphs:** Set the theme. These paragraphs earn their place by saying something the reader hasn't already thought. They should be short, direct and make the reader want to continue. The second paragraph should pivot or deepen – not merely restate the first.

**Sector bullet points:** Under subheadings (In AI & tech, In Biopharma, In Medtech, In Manufacturing, In Insurance), one-sentence bullet points with inline hyperlinks to source articles. Each bullet is a self-contained summary of one story. The bullet must contain the key fact and the link must go to the primary source.

**Transition line:** 'And if you're still hungry for more, here's the detail on each:'

### 3. Body sections

Five sections in order: AI industry, Biopharma, MedTech and digital health, Complex manufacturing, Insurance.

Each section opens with a one-paragraph sector intro that identifies the pattern or theme connecting that sector's stories for the week. This paragraph is not a summary of the stories – it is an editorial observation about what they collectively mean.

Each story gets a sub-heading that is also a hyperlink to the primary source:
'[Story headline](https://source-url)'

Story headlines use sentence case (not Title Case). They should be descriptive, not clever. 'IQVIA acquires Charles River discovery assets' not 'Big pharma makes its move'.

Each story gets 1–3 paragraphs of analysis. The first paragraph establishes the facts. Subsequent paragraphs provide context, significance or connections to the week's theme. Direct quotes from named individuals are used when they add genuine insight – not as filler.

### 4. Closing line

One sentence. Example: 'Thank you for reading this week's report. Come back next week for all the AI news you need to know in your sector.'

---

## Writing style

The full style guide is in the scott-writing-style skill and the CLAUDE.md working memory file. The following points are the ones most likely to trip up an automated writer.

### Language and spelling

UK English throughout. Single quotes, not double. Spaced en dashes ( – ), not hyphens, em dashes or unspaced dashes. No Oxford commas.

### Numbers and currency

Spell out one to nine. Numerals for 10+. Always numerals for money, percentages and data points. Currency symbols before the number: $, £, €. Use 'bn' and 'm' not 'billion' and 'million' in most contexts. Example: '$11.2bn', '€250m', '73%'.

### Formatting

No bold text in body copy. Bold is for headlines and sub-heads only. No italics anywhere. No emojis. Sentence case for all headings.

### Sentence rhythm

Mix long and short sentences deliberately. A long sentence that builds through multiple clauses can establish context and complexity. Then land it. Short sentences punch. Read every paragraph back and check the rhythm works.

Start with 'And' or 'But' when it serves the sentence. Use contractions when they improve the rhythm.

### Hedging

Match language to certainty level. State proven facts directly. Hedge where genuine uncertainty exists. Never over-hedge when the evidence supports confidence. Never state speculation as fact.

### Specificity

Always prefer concrete over abstract when the detail is available. '73% year on year' not 'significant growth'. '$26m in a Seed 2 round' not 'significant funding'. 'More than 400 scanners' not 'hundreds of scanners'.

If the specific detail is not in the source material, do not invent it. Use the abstract term instead.

### Prohibited language

The following words and constructions must never appear in the report. This list is exhaustive and non-negotiable. An automated draft that contains any of these has failed its quality gate.

**Banned words:** landscape, realm, spearheading, game-changer, game-changing, paradigm shift, ecosystem (unless literally ecological), synergy, leverage (as verb), utilize, utilise, cutting-edge, state-of-the-art, best-in-class, world-class, next-generation, revolutionize, revolutionise, disrupt (as marketing speak), transform (when vague), harness, unlock, empower, enable (when empty), drive (when vague), robust, seamless, holistic, innovative, groundbreaking, streamline, delve

**Banned phrases:** double down, lean in, move the needle, boil the ocean, stakeholder, deep dive, circle back, low-hanging fruit, at the end of the day, going forward, in terms of, it's worth noting, it's important to note, interestingly

**Banned constructions:**
- 'This isn't just an X, it's a Y' and all variants ('not just X but Y', 'more than just X', 'less about X, more about Y')
- 'The question isn't X, it's Y'
- 'Think of it as...', 'In other words...', 'Simply put...'
- 'This is where X comes in', 'Enter: [solution]'
- 'Why does this matter? Because...'
- 'Imagine a world where...', 'X is changing the way we Y'
- 'Here's what you need to know', 'Here's the thing:'
- 'Let's be clear:', 'Let's be honest:'
- 'What's interesting is...', 'What's notable here is...'
- 'As we navigate...', 'On this journey...'

**Banned intensifiers:** incredibly, extremely, truly, absolutely, fundamentally, highly, deeply, vastly. Remove these – the sentence works better without them.

When tempted by any of these, describe the actual thing instead.

---

## Theme selection

The weekly theme is the most important editorial decision. It must satisfy three criteria:

1. It connects stories across at least three of the five sectors – ideally all five
2. It says something specific enough to be falsifiable (not 'AI is growing' but 'the cost of position in the AI value chain became visible')
3. It has not been used before

The theme appears in the tl;dr title and is woven through the sector intro paragraphs and individual story analyses. It should not be forced onto stories where it doesn't fit – if a story doesn't connect to the theme, it can stand on its own merits.

Theme selection process for the automated pipeline:
1. Read the full research pack
2. Identify 3 candidate themes with one-paragraph reasoning for each
3. Select the strongest and explain why
4. Write the draft around the selected theme

The human reviewer (Scott) may redirect the theme. The draft must be structured so that theme references can be adjusted without rewriting every paragraph.

---

## Story selection

Target: 12–15 stories across the five sectors. Distribution is not equal – it follows where the news is. Week 9 had seven AI industry stories, three biopharma, two medtech, three manufacturing and four insurance. The AI industry section is typically the largest because cross-cutting stories (chip investment, model launches, market movements) affect all sectors.

Selection criteria, in order of priority:

1. **Significance:** Does this story change how a sector operates, competes or invests? A $500m chip startup funding round changes the competitive landscape. A minor product update does not.
2. **Verifiability:** Can the key claims be confirmed from the source material? If the numbers, names or dates cannot be verified, the story does not make the cut.
3. **Freshness:** Was this story published within the Monday–Friday reporting window? Date verification is handled by the research engine – the draft layer should trust the verification metadata.
4. **Uniqueness:** Is this story absent from the off-limits list? Has it not been covered in any previous week?
5. **Theme fit:** Does this story connect to the week's theme? Theme fit is a bonus, not a requirement. A strong story that doesn't fit the theme is better than a weak story that does.

---

## Editorial quality standard

SNI holds itself to the standard of the best financial journalism. The evaluation prompt below is used to assess every draft before publication. The automated pipeline must produce drafts that pass this evaluation from multiple independent models.

### Multi-model evaluation prompt

The following prompt is sent to each evaluation model (GPT-5.2, Gemini Pro 3.1 and others) with the complete draft attached:

---

You are a senior editor with the authority and judgement of the best news editors at the Financial Times, the Economist and Reuters. You are also a world-class researcher who finds every relevant detail and correctly interprets its significance.

Critically evaluate this weekly AI sector newsletter before publication. Apply the following standards without compromise.

**Factual integrity**
- Does every claim in the report have a verifiable source?
- Are all numbers, names, titles, dates and deal values accurate to the source material?
- Does any sentence state something as fact that the source presents as speculation, rumour or estimate?
- Are there claims that go beyond what the linked source actually says? If so, identify each one.

**Completeness of coverage**
- Given everything published this week in AI across biopharma, medtech, manufacturing, insurance and the broader AI industry: has this report captured the most significant stories?
- What important stories are missing? Name them specifically with sources.
- Is any sector under-represented relative to the weight of news that occurred?

**Editorial quality**
- Does the theme genuinely connect the week's stories, or is it forced?
- Does each sector intro paragraph earn its place by saying something the reader hasn't already thought?
- Is the analysis sharp – does it explain why each story matters, not just what happened?
- Does the writing respect the reader's intelligence? Is anything over-explained?
- Is the prose clean? Flag any clichés, hollow intensifiers, banned constructions, or passages where the language is doing work the argument should be doing.
- Does the rhythm work? Are there passages where every sentence is the same length or structure?

**Link integrity**
- Does every hyperlink appear to point to the correct source for the claim it supports?
- Are links placed inline at the natural point in the sentence, not as footnotes or parenthetical citations?
- Are there any claims without supporting links that should have them?

**Structural compliance**
- Does the report follow the required structure: welcome line, tl;dr with theme and sector bullets, transition line, body sections with sector intros and story sub-headings, closing line?
- Are headings in sentence case?
- Are numbers, currencies and dates formatted correctly (UK English conventions)?

**What would you change?**
- If you could make three changes to strengthen this report before publication, what would they be? Be specific – name the paragraph, the sentence, the word. Explain why the change improves the piece.
- Is there a stronger angle on any story that the report has missed?
- Is there a more compelling way to frame the theme?

Do not soften your assessment. The reader deserves the best version of this report. If the draft is not ready for publication, say so plainly and explain exactly what must change.

---

### How evaluation feedback is processed

The orchestrator receives structured feedback from each model and applies the following decision logic:

**Always accept:**
- Factual corrections (wrong numbers, wrong names, wrong dates, wrong URLs)
- Missing stories that are genuinely significant and verifiable
- Identification of claims that exceed what the source material says

**Accept if consistent across 2+ models:**
- Structural improvements (reordering, paragraph splits, section balance)
- Theme reframing suggestions
- Rhythm and sentence-level improvements

**Flag for human review:**
- Suggestions to change the editorial angle or interpretation
- Requests to soften or strengthen a judgement call
- Suggestions that conflict between models

**Always reject:**
- Suggestions that introduce prohibited language
- Suggestions that add unverified claims
- Suggestions that add hollow qualifiers or hedging where the evidence is clear
- Stylistic changes that conflict with the writing style guide

---

## Lessons learned from Weeks 8 and 9

These are specific mistakes that were made and corrected during production. The automated pipeline must not repeat them.

### Link errors are the highest-risk failure mode

Week 9 had two link errors that were caught during verification:

1. The Insurance Thought Leadership patents article was initially linked to the wrong URL on the same site – `/insurances-key-role-ai-agents` (about agentic commerce) instead of `/ai-patents-emerge-competitive-weapon` (about AI patents). Same domain, completely different article. This would have been a credibility-destroying error.

2. The Sixfold/Inforce partnership was initially linked to an FFNews article that did not mention Sixfold on the page. The link was swapped to Insurance Edge (`https://insurance-edge.net/2026/02/26/sixfold-partners-with-inforce-aims-for-more-integration/`) which contained the full story.

The lesson: every link must be fetched and content-matched. A URL on the right domain is not sufficient. The page must contain the specific claims attributed to it.

### Source attribution nuance

The Insurance Thought Leadership patents article says 'three carriers' and '77%' but does not name State Farm, USAA or Allstate. Those names come from Insurance Journal, Insurance Business Magazine and other outlets reporting on the same underlying data. When the report names entities that the linked source does not name, this must be acknowledged or a different primary source must be used.

### Some sources block automated fetching

CNBC returns CSS instead of content. Firstpost and AP News block fetches entirely. When a primary source cannot be fetched, the link verification step must confirm the article exists via web search and check at least one corroborating source that can be fetched.

### Off-limits checking catches real duplicates

Week 9 originally included Intrinsic (covered in Week 8). The off-limits check caught it and the story was swapped for RLWRLD. The off-limits list is not bureaucratic overhead – it prevents embarrassing repetition.

### Date verification is non-negotiable

The research engine handles this, but the draft layer must never override it. If an article's date is flagged as unverified, it does not enter the draft. The research methodology doc (Part 1) documents the specific failure modes: search results with wrong dates, conference dates confused with publication dates, deal announcement dates confused with coverage dates, URL patterns that lie.

---

## Report dimensions

Target length: 3,000–4,000 words for the complete report.

Target story count: 12–15 stories across all five sectors.

The tl;dr section should be approximately 300–500 words. Each body section story should be 150–400 words depending on significance. Sector intro paragraphs should be 2–4 sentences.

---

## What the draft generation layer receives as input

The draft layer receives:

1. **Research pack** (from report.js): Verified articles grouped by sector with titles, URLs, sources, dates, verification methods, confidence levels and text snippets
2. **Off-limits list** (from config/off-limits.yaml): All stories from all previous weeks
3. **Style guide** (from scott-writing-style skill and CLAUDE.md prohibited language list): The complete writing rules
4. **Previous week's report** (from the output directory): Structural reference and theme precedent
5. **This document**: The editorial brief governing quality standards

The draft layer produces:

1. **Complete markdown report** following the structure defined above
2. **Link verification log**: Every URL in the draft, whether it was fetched successfully, and whether the page content matches the claim
3. **Theme rationale**: The 3 candidate themes considered and why the selected theme won
4. **Off-limits check log**: Confirmation that every story was checked and no conflicts exist

---

## What 'done' looks like

A draft is ready for human review when:

- It follows the report structure exactly
- Every URL has been verified and the verification log is clean
- The off-limits check log shows zero conflicts
- The prohibited language scanner returns zero matches
- The multi-model evaluation has been run and all 'always accept' feedback has been incorporated
- The word count falls within 3,000–4,000 words
- Every number, name and quote in the report can be traced to a specific source in the research pack

Scott's review should take under 90 minutes. If it takes longer, the draft quality is insufficient.
