# SNI Weekly Report – Working Memory

## What this project is

SNI (Sector News Intelligence) is a weekly Friday newsletter written by Scott covering AI news across four sectors: biopharma, medtech, manufacturing and insurance, plus a broader AI industry section. Each edition has a unifying theme and runs 3,000–4,000 words.

## Report structure

1. Welcome line (one sentence, no fluff)
2. tl;dr section with theme title, two short intro paragraphs, then bullet points under sector subheadings (In AI & tech, In Biopharma, In Medtech, In Manufacturing, In Insurance) – each bullet has an inline hyperlink to its source
3. Transition line: 'And if you're still hungry for more, here's the detail on each:'
4. Body sections: AI industry, Biopharma, MedTech and digital health, Complex manufacturing, Insurance
5. Each body section opens with a one-paragraph sector intro, followed by story sub-headings (linked to source) and 1–3 paragraphs per story
6. Closing line

## Writing style (critical)

- UK English throughout
- Single quotes, not double
- Spaced en dashes ( – ), not hyphens or unspaced em dashes
- No Oxford commas
- No bold text in body copy
- No emojis
- Sentence case for headings (not Title Case)
- Numbers: spell out one to nine, numerals for 10+; always numerals for money, percentages, data
- Currency: $, £, € symbols before the number; 'bn' and 'm' not 'billion' and 'million' in most contexts

### Prohibited language

Never use these words/phrases in the report:
- 'landscape', 'realm', 'spearheading', 'game-changer', 'game-changing', 'paradigm shift'
- 'ecosystem' (unless literally ecological), 'synergy', 'leverage' (as verb), 'utilize'
- 'cutting-edge', 'state-of-the-art', 'best-in-class', 'world-class', 'next-generation'
- 'revolutionize', 'disrupt' (as marketing speak), 'transform' (when vague)
- 'harness', 'unlock', 'empower', 'enable' (when empty), 'drive' (when vague)
- 'This isn't just an X, it's a Y' (cliché construction)
- 'robust', 'seamless', 'holistic', 'innovative', 'groundbreaking'
- 'double down', 'lean in', 'move the needle', 'boil the ocean'
- 'stakeholder', 'deep dive', 'circle back', 'low-hanging fruit'
- 'at the end of the day', 'going forward', 'in terms of'
- 'It's worth noting', 'It's important to note', 'Interestingly'

## Technical setup for Word document

- Uses npm package `docx` (docx-js) via a local install in the working directory
- Build script: `build-docx.js` in `/sessions/lucid-gifted-davinci/`
- Key patterns:
  - `parseInlineLinks(text, runProps)` converts markdown `[text](url)` to TextRun/ExternalHyperlink elements
  - Helper functions: `bodyPara`, `bulletPara`, `sectionHeading`, `storyHeading`, `tldrSectorHeading`
  - A4 page size (11906 x 16838 DXA), 1-inch margins, Arial font throughout
  - LevelFormat.BULLET for bullet lists (never unicode bullets)
  - Tables need dual widths: columnWidths on table AND width on each cell
  - Page breaks between major sections
  - Footer with page numbers
- Validation: `python3 /sessions/lucid-gifted-davinci/mnt/.skills/skills/docx/scripts/office/validate.py <path>`
- Output: `/sessions/lucid-gifted-davinci/mnt/Friday Updates/SNI-Week{N}-2026.docx`

## Completed reports

### Week 8 (13–20 February 2026)
- Theme: not recorded here – see methodology doc appendix for verified story list
- Off-limits stories from Week 8 must not repeat in Week 9+

### Week 9 (23 February – 1 March 2026)
- Theme: 'The price of position'
- File: `SNI-Week9-2026.md` and `SNI-Week9-2026.docx`
- 13 stories across 5 sections plus a comparison table (Salesforce vs OpenAI stack visions)
- tl;dr uses bullet-point format with sector subheadings and inline hyperlinks (new format from Week 9)

## Week 9 off-limits (do not repeat in Week 10+)

- DeepSeek: V4 model withheld from US chipmakers, Huawei early access
- SaaSpocalypse: B2B software sell-off, seat-based licensing obsolescence fears
- Salesforce: Q4 record $11.2bn revenue, 'agentic work units' metric, stack war with OpenAI
- HSBC: buy ratings on software stocks at 'historical lows'
- Nvidia: Q4 $68.1bn revenue, Jensen Huang 'got it wrong' on SaaSpocalypse
- Anthropic: enterprise agents for HR, finance, investment banking
- AI chip startups: MatX $500m, Axelera $250m, SambaNova $350m in one week
- Meta/AMD: MI450 deal potentially worth $100bn+, 6GW deployment, equity warrant
- Amazon/OpenAI: potential $50bn investment conditional on AGI or IPO
- Citrini Research: fictional '2028 Global Intelligence Crisis' memo, ~$300bn sell-off
- IQVIA: acquiring Charles River drug discovery assets including AI platform
- Bruker/Noetik: spatial biology foundation models, scaling toward 1bn cells
- BreezeBio (formerly GenEdit): $60m Series B, NanoGalaxy nanoparticle delivery, BRZ-101 for Type 1 diabetes
- DeepHealth: CE mark for TechLive remote imaging, 400+ scanners connected
- Oura: proprietary women's health LLM built on biometric ring data
- RLWRLD: $26m Seed 2 for industrial robotics foundation models trained in live operations
- Axelera AI: $250m+ for Metis edge AI chip, digital in-memory computing
- Apple: Mac mini production to Houston, $600bn domestic manufacturing commitment
- Insurance AI patents: State Farm, USAA, Allstate filed 77% of all AI patents
- Broker stocks: worst single-day decline since 2008, Clear Group CEO Mike Edgeley response
- Concirrus: Inspire AI-native underwriting platform for specialty insurance
- Sixfold/Inforce: strategic partnership for AI underwriting transformation
- General Magic: $7.2m seed for SMS-based insurance AI, time-to-quote under 3 minutes

## Lessons learned in Week 9

### Link verification is essential
- Always verify every hyperlink before finalising – fetch the URL and confirm the content matches the claim
- The Insurance Thought Leadership patents article URL was initially wrong (pointed to a different article on the same site: `/insurances-key-role-ai-agents` instead of `/ai-patents-emerge-competitive-weapon`)
- Some sources (CNBC, firstpost.com, apnews.com) block direct fetching – use WebSearch to confirm the article exists and covers the expected content
- When a source article doesn't name specific entities but the report does (e.g. the patents article says 'three carriers' but doesn't name them), note that the names come from corroborating sources
- The Sixfold/Inforce tl;dr bullet originally linked to an FFNews article that did not mention Sixfold – swapped to Insurance Edge (`https://insurance-edge.net/2026/02/26/sixfold-partners-with-inforce-aims-for-more-integration/`)

### tl;dr format change
- From Week 9 onwards, the tl;dr uses bullet points with inline hyperlinks under sector subheadings, not prose paragraphs
- Each bullet should be one sentence linking to its source article
- Two short intro paragraphs set the theme before the bullets

### Word document rebuild
- After any edit to the markdown, the Word document must be regenerated by updating `build-docx.js` and re-running it
- The build script contains hardcoded content – URL changes must be made in both the markdown AND the build script

### Cross-checking previous weeks
- Always check the off-limits list before including any story
- Week 9 originally included Intrinsic (covered in Week 8) – swapped for RLWRLD

## Key reference files

- Report markdown: `/sessions/lucid-gifted-davinci/mnt/Friday Updates/SNI-Week9-2026.md`
- Report Word doc: `/sessions/lucid-gifted-davinci/mnt/Friday Updates/SNI-Week9-2026.docx`
- Build script: `/sessions/lucid-gifted-davinci/build-docx.js`
- Research methodology: `/sessions/lucid-gifted-davinci/mnt/Friday Updates/SNI-Research-Methodology.md`
- Source articles: `/sessions/lucid-gifted-davinci/mnt/Friday Updates/2026-02-27/` (organised by date/sector)
- DOCX skill: `/sessions/lucid-gifted-davinci/mnt/.skills/skills/docx/SKILL.md`
- Scott's writing style skill: `/sessions/lucid-gifted-davinci/mnt/.skills/skills/scott-writing-style/`
