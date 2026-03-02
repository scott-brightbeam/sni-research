# SNI Weekly Research: Methodology, Learnings and Tool Specification

## Purpose

This document captures everything learned from producing SNI: Week 8, 2026 - the failures, the fixes and the detailed specification needed to build an automated research tool in Claude Code. The tool should check defined sources daily, save verified articles to a local folder and provide a clean research pack for writing the weekly report.

---

## Part 1: What went wrong and why

### The core problem

Web search tools return results with unreliable date metadata. A search for 'biopharma AI February 2026' returns a mix of results from across weeks or months, and the snippets often don't include publication dates. The LLM then infers dates from contextual clues - URL patterns, surrounding text, conference dates - and gets them wrong.

### Specific failure modes encountered

**1. Search result metadata lies about dates**

Web search returns results ranked by relevance, not recency. A search for 'medtech AI February 2026' returns articles from October 2025, January 2026 and February 2026 mixed together. The search engine's date metadata is unreliable - it often reflects the crawl date or last-modified date rather than the publication date.

Example: GE HealthCare's agentic AI research paper was from October 2025 but appeared in searches for February 2026 content.

**2. Conference dates are not publication dates**

Stories about SEMICON Korea (11-13 February) appeared in searches for the week of 13-20 February. But the articles covering the event were published before or during the conference, not after. The original SEMICON Korea preview article was from December 2025.

**3. Deal announcement dates vs. coverage dates**

Siemens acquired Canopus AI with a deal that closed on 12 January 2026. The press release went out on 4 February. Coverage appeared across January and February. None of this fell within the 13-20 February window, but it appeared in searches for that week because the topic was still being discussed.

**4. URL patterns are unreliable date indicators**

Some URLs contain dates (e.g. /2026/02/18/) but others don't. BusinessWire URLs encode dates in the path (/20260217/) which is reliable. But many sites use slugs without dates. Inferring a date from URL structure works for some publishers and fails for others.

**5. 'This week' and 'recent' are meaningless in search**

Searching for 'AI insurance news this week' returns results the search engine considers relevant and recent - which could be anything from the past month. The phrase 'this week' in a search query does not filter by date.

**6. Paywalled sources can't be verified**

Bloomberg, Financial Times and other paywalled sites appear in search results but the actual article can't be fetched to verify the publication date or content. Using these as sources is risky because the date and content can't be confirmed.

### The verification gap

The fundamental issue: there is a gap between finding a story in search results and confirming it was published within the target date window. Closing that gap requires fetching the actual page and extracting the publication date from the page metadata or visible content. This is slow, sometimes blocked by 403 errors and sometimes unreliable even when it works.

---

## Part 2: What worked

### Reliable date verification methods

**1. Fetching the page and reading schema.org metadata**

Many news sites embed structured data (JSON-LD or microdata) with a `datePublished` field. When WebFetch can access the page, this is the most reliable date source.

Example: Insurance Journal pages include `datePublished: 2026-02-18T09:34:10` in their schema markup. This confirmed the ERGO story date definitively.

Confirmed reliable for: Insurance Journal, BioSpace, MedTech Dive, CNBC, StartupNews.fyi, Taipei Times.

**2. URL date patterns from known publishers**

Some publishers encode publication dates in URLs consistently:

| Publisher | URL pattern | Reliability |
|-----------|------------|-------------|
| BusinessWire | /20260217/ in path | High |
| Insurance Journal | /2026/02/18/ in path | High |
| Healthcare Brew | /stories/2026/02/18/ | High |
| Manila Times | /2026/02/17/ in path | High |
| GlobeNewsWire | /2026/02/18/ in path | High |
| CNBC | /2026/02/18/ in path | High |
| Bloomberg | /2026-02-17/ in path | High (but paywalled) |

**3. Cross-referencing multiple sources**

When the primary source can't be fetched (403 error), checking whether multiple secondary sources report the same story with consistent dates provides reasonable confidence. The Merck/Mayo Clinic story couldn't be verified on mayoclinic.org (403) but healthcare-brew.com, biopharminternational.com and multiple other outlets all dated it to 18 February.

**4. Date-filtered searches**

Adding explicit date references to search queries ('February 18 2026' rather than 'February 2026') narrows results but doesn't guarantee accuracy. More effective: searching for a specific story already identified and checking when it was covered.

### Sources that proved most useful for each sector

**Biopharma:**
- BioPharma Dive (biopharmadive.com) - reliable dates, good AI coverage
- Healthcare Brew (healthcare-brew.com) - dates in URLs
- MedCity News (medcitynews.com) - schema.org dates
- BioSpace (biospace.com) - schema.org dates, good AI angle
- PYMNTS (pymnts.com) - cross-sector pharma/AI operations coverage
- BioWorld (bioworld.com) - daily roundups with dates in titles

**MedTech:**
- MedTech Dive (medtechdive.com) - reliable dates, FDA clearance coverage
- Modern Retina (modernretina.com) - ophthalmic device clearances
- Ropes & Gray / Morgan Lewis / Emergo by UL - regulatory analysis with clear dates
- Manila Times / PR Newswire - press release distribution with dates

**Manufacturing:**
- Samsung Global Newsroom (news.samsung.com) - primary source for Samsung
- Storage Newsletter (storagenewsletter.com) - HBM/memory coverage with dates
- CNBC (cnbc.com) - dates in URLs, good for executive commentary
- Automation World (automationworld.com) - manufacturing AI analysis
- GlobeNewsWire - market reports with precise dates
- Robotics and Automation News - dates in URLs

**Insurance:**
- Insurance Journal (insurancejournal.com) - schema.org dates, comprehensive US/international
- The Local (thelocal.de) - European insurance workforce stories
- Commercial Risk Online - European insurance analysis
- Intelligent Insurer - insurtech investment coverage
- Global Reinsurance - reinsurance/insurtech data
- BusinessWire - press releases with dates in URLs
- EU-Startups (eu-startups.com) - European insurtech funding

**Cross-sector:**
- PYMNTS (pymnts.com) - AI operations across sectors
- Automation World - Deloitte/McKinsey analysis republication
- GlobeNewsWire - market sizing reports

### The off-limits list matters

Week 7's stories must not repeat in Week 8. The off-limits list from the method document contains 30+ specific companies, partnerships and topics. Every candidate story must be checked against this list before inclusion. In this session, Takeda/Iambic appeared repeatedly in biopharma searches and would have been included without the check.

---

## Part 3: Specification for automated research tool

### Overview

A Python script (or set of scripts) that runs daily, checks a defined list of news sources for new AI-related stories relevant to the four SNI sectors, verifies publication dates and saves qualified articles as local files. The output is a folder of dated, categorised articles that can be used to write the weekly SNI report.

### Architecture

```
sni-research/
  config/
    sources.yaml          # List of RSS feeds, sitemaps, search queries
    sectors.yaml          # Sector definitions and keywords
    off-limits.yaml       # Stories from previous weeks (updated weekly)
    style-guide.md        # Writing style reference (copy of skill)
  scripts/
    fetch.py              # Daily fetcher - checks sources, saves articles
    verify.py             # Date verification - confirms publication dates
    categorise.py         # Assigns articles to sectors
    report.py             # Generates research summary for writing session
  data/
    raw/                  # Raw fetched articles (HTML/text)
    verified/             # Date-verified articles with metadata
    weekly/               # Curated articles for current week's report
  output/
    week-{N}-research.md  # Research pack for writing session
```

### Source types to check

**1. RSS feeds (most reliable for date verification)**

RSS feeds include publication dates in their XML. These are the most reliable source for confirming when a story was published. Priority feeds:

```yaml
biopharma:
  - url: https://www.biopharmadive.com/feeds/news/
    name: BioPharma Dive
  - url: https://medcitynews.com/feed/
    name: MedCity News
  - url: https://www.biospace.com/rss/
    name: BioSpace
  - url: https://www.fiercebiotech.com/rss/xml
    name: Fierce Biotech

medtech:
  - url: https://www.medtechdive.com/feeds/news/
    name: MedTech Dive
  - url: https://www.massdevice.com/feed/
    name: MassDevice

manufacturing:
  - url: https://www.automationworld.com/rss
    name: Automation World
  - url: https://roboticsandautomationnews.com/feed/
    name: Robotics & Automation News
  - url: https://www.manufacturingdive.com/feeds/news/
    name: Manufacturing Dive

insurance:
  - url: https://www.insurancejournal.com/rss/news/
    name: Insurance Journal
  - url: https://www.intelligentinsurer.com/rss
    name: Intelligent Insurer
  - url: https://insnerds.com/feed/
    name: InsNerds

cross_sector:
  - url: https://www.pymnts.com/feed/
    name: PYMNTS
  - url: https://news.samsung.com/global/feed
    name: Samsung Newsroom
```

**2. Press release wires**

BusinessWire, PR Newswire and GlobeNewsWire carry company announcements with reliable dates. These are primary sources for funding rounds, partnerships and product launches.

```yaml
press_wires:
  - url: https://www.businesswire.com/portal/site/home/
    search_terms: ['AI insurance', 'AI pharma', 'AI medical device', 'AI manufacturing', 'AI semiconductor']
  - url: https://www.globenewswire.com/
    search_terms: ['artificial intelligence healthcare', 'AI semiconductor', 'insurtech AI']
```

**3. Regulatory sources**

FDA clearances and EMA decisions have definitive dates.

```yaml
regulatory:
  - url: https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-enabled-medical-devices
    name: FDA AI Device List
    check_frequency: weekly
  - url: https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm
    name: FDA 510(k) Database
    check_frequency: daily
```

### Fetching logic

For each source, the daily fetch script should:

1. Check the RSS feed or page for new items since the last check
2. Filter by keyword relevance (AI, artificial intelligence, machine learning, plus sector-specific terms)
3. For each candidate article:
   a. Fetch the full page
   b. Extract the publication date from schema.org metadata, Open Graph tags, or visible date elements
   c. If date is within the current reporting window (Monday to Friday of current week), save it
   d. If date cannot be determined, flag it for manual review
4. Save qualified articles with metadata:
   ```json
   {
     "title": "Article title",
     "url": "https://...",
     "source": "Insurance Journal",
     "date_published": "2026-02-18",
     "date_verified_method": "schema.org datePublished",
     "sector": "insurance",
     "keywords": ["ERGO", "job cuts", "AI", "claims"],
     "snippet": "First 200 words...",
     "full_text": "..."
   }
   ```

### Date verification logic

This is the critical component. The script must verify dates through multiple methods, in priority order:

```python
def verify_date(html_content, url):
    '''
    Returns (date, confidence, method) tuple.
    Confidence: high, medium, low
    '''

    # Method 1: schema.org JSON-LD (highest confidence)
    # Look for datePublished in <script type="application/ld+json">
    # Confidence: high

    # Method 2: Open Graph meta tags
    # Look for <meta property="article:published_time">
    # Confidence: high

    # Method 3: <meta name="date"> or <meta name="pubdate">
    # Confidence: high

    # Method 4: <time datetime="..."> elements
    # Confidence: medium-high

    # Method 5: URL date pattern extraction
    # Match patterns like /2026/02/18/ or /20260218/
    # Confidence: medium (some sites use different date semantics)

    # Method 6: Visible date text near article header
    # Parse text like 'February 18, 2026' or '18 Feb 2026'
    # Confidence: medium (could be update date, not publish date)

    # Method 7: HTTP Last-Modified header
    # Confidence: low (often reflects server cache, not publication)

    # If no method succeeds: flag for manual review
```

### Keyword filtering

Each sector needs specific keywords to catch relevant stories without drowning in noise.

```yaml
biopharma:
  required_any: ['AI', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'generative AI', 'foundation model']
  required_any: ['pharma', 'biopharma', 'drug discovery', 'clinical trial', 'FDA', 'EMA', 'therapeutic', 'biotech']
  boost: ['Ireland', 'Irish', 'Merck', 'Lilly', 'Pfizer', 'Roche', 'AstraZeneca', 'Novartis', 'BMS', 'Takeda', 'Sanofi']

medtech:
  required_any: ['AI', 'artificial intelligence', 'machine learning']
  required_any: ['medical device', 'medtech', 'FDA clearance', '510(k)', 'digital health', 'diagnostic', 'surgical robot', 'imaging']
  boost: ['Medtronic', 'GE HealthCare', 'Siemens Healthineers', 'Philips', 'Abbott', 'Boston Scientific', 'Stryker']

manufacturing:
  required_any: ['AI', 'artificial intelligence', 'machine learning', 'digital twin', 'physical AI']
  required_any: ['manufacturing', 'semiconductor', 'fab', 'factory', 'production', 'chip', 'HBM', 'wafer', 'robotics']
  boost: ['Samsung', 'TSMC', 'Intel', 'NVIDIA', 'SK hynix', 'ASML', 'Siemens', 'Foxconn']

insurance:
  required_any: ['AI', 'artificial intelligence', 'machine learning', 'generative AI']
  required_any: ['insurance', 'insurtech', 'underwriting', 'claims', 'actuarial', 'reinsurance', 'broker']
  boost: ['Munich Re', 'Swiss Re', 'AIG', 'Allianz', 'Zurich', 'Lloyd', 'Aviva', 'mea', 'Gallagher']
```

### Off-limits management

After each week's report is published, the script should update the off-limits list:

```yaml
# off-limits.yaml
# Stories covered in previous weeks - must not repeat
week_7:
  - company: Takeda
    topic: Iambic AI drug discovery partnership
  - company: Isomorphic Labs
    topic: IsoDDE protein design
  - company: Generate Biomedicines
    topic: IPO filing
  # ... (full list from method doc)

week_8:
  - company: Merck
    topic: Mayo Clinic AI drug discovery partnership
  - company: Medtronic
    topic: Stealth AXiS FDA clearance
  # ... (populated after Week 8 publishes)
```

### Output format

At the end of each week (or on demand), the report script generates a research pack:

```markdown
# SNI Research Pack: Week 9, 2026
# Date range: 20-27 February 2026
# Generated: 27 February 2026

## Biopharma (4 stories, all dates verified)

### Story 1: [Title]
- Source: [Publisher name]
- URL: [link]
- Published: 24 February 2026 (verified: schema.org datePublished)
- Summary: [200-word summary]
- Key data points: [specific numbers, names, deal values]
- Relevance: [why this matters for SNI audience]

### Story 2: ...

## MedTech (3 stories, all dates verified)
...

## Manufacturing (5 stories, all dates verified)
...

## Insurance (4 stories, all dates verified)
...

## Flagged for manual review (2 stories, dates unverified)
...

## Off-limits check
- Checked against weeks 7 and 8 off-limits lists
- Zero conflicts found
```

### Running schedule

```
Monday-Friday 08:00: Run fetch.py (check all sources for new articles)
Friday 12:00: Run report.py (generate research pack for writing session)
Friday 14:00: Writing session begins with verified research pack
```

### Error handling

- 403/paywall errors: log the URL, flag for manual check, do not include in verified output
- Timeout errors: retry once, then flag
- Date parsing failures: save article but mark confidence as 'unverified'
- Duplicate detection: hash article URLs and titles to avoid double-counting

---

## Part 4: Tips for the Claude Code implementation

### What to tell Claude Code

When briefing Claude Code to build this tool, include these specific instructions:

1. **Date verification is non-negotiable.** Every article must have its publication date confirmed from page metadata before it enters the verified folder. No exceptions. If the date can't be confirmed, the article goes to the 'flagged' pile, not the 'verified' pile.

2. **RSS feeds are the primary source.** Start with RSS because the publication date is embedded in the XML. Only fall back to web scraping when RSS isn't available.

3. **Use requests + BeautifulSoup for fetching.** The script needs to parse HTML for schema.org JSON-LD, Open Graph tags and visible date elements. Use a proper HTML parser, not regex.

4. **Respect rate limits and robots.txt.** Add delays between requests (1-2 seconds minimum). Check robots.txt before scraping. Use a reasonable User-Agent string.

5. **Store raw HTML alongside extracted data.** If a date verification is later questioned, the raw HTML allows re-checking without re-fetching.

6. **The off-limits list is cumulative.** Each week adds to it. The tool should check every candidate story against all previous weeks, not just the most recent.

7. **Don't over-filter.** Cast a wide net on keywords, then let the human (or the writing session LLM) decide what's significant. Better to have 30 verified, dated articles and pick 12 than to have exactly 12 articles and discover three are irrelevant.

8. **Test with a known week first.** Before deploying for real, run the tool against the Week 8 date range (13-20 February 2026) and compare its output against the manually verified story list from this session. The tool should find at least these confirmed stories:
   - Merck/Mayo Clinic (Feb 18)
   - Medtronic Stealth AXiS (Feb 18)
   - Samsung HBM4 (Feb 13)
   - ERGO job cuts (Feb 18)
   - AIG AI results (Feb 13)
   - mea Platform $50m (Feb 17)
   - Gallagher Re insurtech report (Feb 18)
   - Intrinsic/Alphabet CEO (Feb 18)
   - Copan PhenoMATRIX (Feb 17)
   - Deloitte manufacturing AI (Feb 18)
   - Michigan State diamonds (Feb 20)

### What NOT to do

- Do not rely on web search date filters. They are unreliable.
- Do not infer dates from conference schedules, fiscal quarter references or phrases like 'this week'.
- Do not include Bloomberg, FT or other hard-paywalled sources as primary references. They can't be verified or accessed by readers.
- Do not assume a story is from this week because it appeared in a search for this week's news.
- Do not use cached or archived versions of pages as date evidence.

---

## Part 5: Integration with the writing workflow

### Before writing session

1. Open the research pack (output/week-{N}-research.md)
2. Review verified stories across all four sectors
3. Identify the cross-sector theme
4. Check the off-limits list for conflicts
5. Select 3-4 stories per sector

### During writing session

The writing LLM (Cowork or Claude Code) receives:
- The research pack with pre-verified articles
- The off-limits list
- The writing style skill
- The Week 7 report for structural reference
- The method document

Because the research is already verified, the writing session can focus on analysis and prose rather than searching and date-checking.

### After publishing

1. Update off-limits.yaml with the stories used in this week's report
2. Archive the research pack
3. Reset the weekly folder for next week's collection

---

## Appendix: Verified story list for Week 8 (13-20 February 2026)

| Story | Source | Date | Verification method |
|-------|--------|------|-------------------|
| Merck/Mayo Clinic partnership | Healthcare Brew | 18 Feb | URL path /2026/02/18/ + corroboration |
| PYMNTS pharma AI operations | PYMNTS | 13 Feb | WebFetch metadata |
| Medtronic Stealth AXiS | MedTech Dive | 18 Feb | schema.org datePublished |
| Copan PhenoMATRIX | Manila Times/PR Newswire | 17 Feb | URL path /2026/02/17/ |
| Samsung HBM4 | Samsung Newsroom | 13 Feb | Taipei Times datePublished verified |
| Intrinsic/Alphabet CEO | CNBC / StartupNews | 18-19 Feb | URL path + WebFetch |
| Deloitte manufacturing AI | Automation World | 18 Feb | WebFetch metadata |
| Michigan State AI diamonds | Robotics & Automation News | 20 Feb | WebFetch metadata |
| Semiconductor equipment market | GlobeNewsWire | 18 Feb | URL path |
| ERGO 1,000 job cuts | Insurance Journal | 18 Feb | schema.org datePublished |
| AIG AI 'beyond expectations' | Insurance Journal | 13 Feb | WebFetch metadata |
| mea Platform $50m | BusinessWire | 17 Feb | URL path /20260217/ |
| Gallagher Re insurtech report | Insurance Journal | 18 Feb | schema.org datePublished |

---

## Appendix: Verified story list for Week 9 (23 February – 1 March 2026)

Theme: 'The price of position'

| Story | Source | URL verified | Content match | Notes |
|-------|--------|-------------|---------------|-------|
| DeepSeek V4 withheld from US chipmakers | Firstpost | Could not fetch (blocked) | Confirmed via WebSearch + corroborating sources | Multiple outlets confirmed the story |
| SaaSpocalypse B2B software sell-off | Financial Content / MarketMinute | Yes | Yes | 10%+ sell-off confirmed |
| Salesforce Q4 record $11.2bn revenue | TechCrunch | Yes (metadata) | Yes | Benioff SaaSpocalypse response confirmed |
| HSBC buy ratings on software stocks | CNBC | Could not fetch (CSS returned) | Confirmed via WebSearch | Article exists, HSBC picks confirmed by Benzinga, Yahoo Finance, TipRanks |
| Nvidia Q4 $68.1bn revenue | CNBC | Could not fetch (CSS returned) | Confirmed via WebSearch | Huang 'got it wrong' quote confirmed across multiple outlets |
| Anthropic enterprise agents | PYMNTS | Yes | Yes | HR, finance, investment banking agents confirmed |
| AI chip startups $1.1bn week | The Register | Yes | Yes | MatX, Axelera, SambaNova confirmed |
| Meta/AMD MI450 deal | AP News | Could not fetch (blocked) | Confirmed via WebSearch + AMD press release | $100bn+ deal, equity warrant confirmed |
| Amazon/OpenAI $50bn investment | PYMNTS | Yes | Yes | Conditional on AGI or IPO confirmed |
| Citrini fictional memo | PYMNTS | Yes | Yes | $300bn sell-off, founder quote confirmed |
| IQVIA/Charles River acquisition | Pharmaceutical Technology | Yes (metadata) | Yes (truncated body) | Drug discovery assets confirmed |
| Bruker/Noetik spatial biology | Stock Titan | Yes | Yes | 1bn cells target, 3,500 patient samples confirmed |
| BreezeBio $60m Series B | BioPharma Dive | Yes (metadata) | Body not rendered | Headline confirms $60m, genetic medicines |
| DeepHealth CE mark | GlobeNewsWire | Yes | Yes | TechLive, 400+ scanners, 42% MR closure reduction confirmed |
| Oura women's health LLM | MobiHealthNews | Yes | Yes | Proprietary LLM, biometric ring data, Jayaraman quote confirmed |
| RLWRLD $26m Seed 2 | GlobeNewsWire | Yes | Yes | $41m total, live industrial operations training confirmed |
| Axelera AI $250m+ | SiliconAngle | Yes | Yes | Metis chip, 214 TOPS at 10W, Europa successor confirmed |
| Apple Mac mini to Houston | Manufacturing Dive | Yes (metadata) | Body not rendered | Headline confirms US production, first time |
| Insurance AI patents 77% | Insurance Thought Leadership | Yes | Partially – says 'three carriers' and '77%' but does not name them | Names (State Farm, USAA, Allstate) come from Insurance Journal, Insurance Business Mag and other corroborating sources |
| Broker stocks / Edgeley | Insurance Times | Yes | Yes | Mike Edgeley, Group Chief Executive of Clear Group, AI widens gap argument confirmed |
| Concirrus Inspire platform | FFNews | Yes | Yes | AI-native underwriting, ISO/IEC 42001 + 27001 + SOC 2 confirmed |
| Sixfold/Inforce partnership | FFNews | Yes | Yes | AI underwriting transformation, 1m+ submissions confirmed |
| General Magic $7.2m seed | GlobeNewsWire | Yes | Yes | SMS-based AI, Radical Ventures, time-to-quote under 3 minutes confirmed |

### Week 9 link issues encountered

1. **Insurance patents link was wrong.** Initially linked to `/ai-machine-learning/insurances-key-role-ai-agents` (a different article about agentic commerce). Corrected to `/ai-machine-learning/ai-patents-emerge-competitive-weapon`.
2. **CNBC articles return CSS instead of content** when fetched via WebFetch. Both CNBC links confirmed to exist and cover the correct stories via WebSearch corroboration.
3. **Firstpost and AP News block WebFetch.** Stories confirmed via WebSearch returning multiple corroborating outlets.
4. **Insurance patents source attribution nuance.** The linked Insurance Thought Leadership article confirms '77%' and 'three carriers' but does not name them. The names State Farm, USAA and Allstate are sourced from Insurance Journal and others reporting on the same underlying data. This is acceptable but worth noting for future reference.

### New sources added for Week 9

| Source | Sector | Reliability | Notes |
|--------|--------|------------|-------|
| FFNews (ffnews.com) | Insurance | High – content renders fully | Good for insurtech launches and partnerships |
| Insurance Thought Leadership | Insurance | High – content renders | Analysis pieces, but may not name all entities |
| Stock Titan (stocktitan.net) | Cross-sector | High – press releases with full text | Good alternative to GlobeNewsWire |
| SiliconAngle | Manufacturing/AI | High – full articles render | Good for chip startup funding coverage |
| Financial Content / MarketMinute | AI industry | Medium – analysis pieces | Useful for market commentary |

---

## Part 6: Week 9 process improvements

### tl;dr format change

From Week 9 onwards, the tl;dr section uses a bullet-point format with sector subheadings and inline hyperlinks, replacing the prose paragraph format used in Weeks 7–8. Structure:

1. Theme heading (e.g. 'tl;dr: The price of position')
2. Two short intro paragraphs setting the theme
3. Sector subheadings (In AI & tech, In Biopharma, In Medtech, In Manufacturing, In Insurance)
4. Under each: one-sentence bullet points with inline hyperlinks to source articles
5. Transition line: 'And if you're still hungry for more, here's the detail on each:'

### Link verification step added to workflow

After writing and before generating the Word document, every hyperlink in the report must be verified:

1. Fetch each URL via WebFetch
2. If blocked, confirm via WebSearch that the article exists and covers the expected content
3. Check that the page content matches the claim in the report
4. Flag any cases where the report's claim goes beyond what the linked source states (e.g. naming entities the source doesn't name)

This step caught the wrong patents URL in Week 9 – a mistake that would have gone live without it.

### Word document rebuild discipline

The Word document is generated from a hardcoded build script (`build-docx.js`), not directly from the markdown. This means:

- Every content edit must be made in BOTH the markdown file AND the build script
- After all edits are complete, re-run `node build-docx.js` and validate with `validate.py`
- Consider moving to a markdown-to-docx pipeline in future to eliminate the dual-edit problem
