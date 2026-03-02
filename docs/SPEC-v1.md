# SNI Research Tool: Full Specification

## Purpose
A Python tool that runs daily, checks defined news sources for AI-related stories across five sectors, verifies publication dates and saves qualified articles as local files. Output is a folder of dated, categorised articles for writing the weekly SNI newsletter.

---

## Architecture

```
sni-research/
  config/
    sources.yaml       # RSS feeds, press wires, search queries
    sectors.yaml       # Sector definitions and keywords
    off-limits.yaml    # Stories from previous weeks (updated weekly)
  scripts/
    fetch.py           # Daily fetcher - checks sources, saves articles
    verify.py          # Date verification - confirms publication dates
    categorise.py      # Assigns articles to sectors
    report.py          # Generates research summary
  data/
    raw/               # Raw fetched articles (HTML + text)
    verified/          # Date-verified articles with metadata JSON
    weekly/            # Curated articles for current week
  output/
    week-{N}-research.md  # Research pack for writing session
```

---

## Five Sectors

1. **general** - Frontier AI providers, hyperscalers, emerging themes (Brave Search primary)
2. **pharma-biopharma** - AI drug discovery, clinical trials, FDA/EMA, biotech
3. **medtech** - AI diagnostics, FDA clearances, medical devices, digital health
4. **manufacturing** - Industrial AI, semiconductors, robotics, factory automation
5. **insurance** - Insurtech, AI underwriting, claims automation, reinsurance

---

## Source Types

### 1. RSS Feeds (PRIMARY - dates embedded in XML, highest reliability)

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

### 2. General AI Feed (Brave Search - no single RSS home)

Search queries covering:
- OpenAI, Anthropic, Google DeepMind, Meta AI, Mistral, xAI, Cohere - new releases
- AWS Bedrock, Azure AI, Google Cloud AI - new services and enterprise moves
- SaaSpocalypse, AI agents replacing SaaS, agentic AI
- Open source AI models, AI regulation, AI funding rounds, AI safety
- Foundation model pricing, benchmark releases

### 3. Press Wire Sources

BusinessWire and GlobeNewsWire for funding rounds, partnerships, product launches.
URL date patterns are reliable for both (e.g. /20260217/ for BusinessWire).

Search terms:
- 'AI insurance', 'AI pharma', 'AI medical device', 'AI manufacturing', 'AI semiconductor'
- 'artificial intelligence healthcare', 'AI semiconductor', 'insurtech AI'

### 4. Regulatory Sources (MedTech)

- FDA AI-enabled devices list: https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-enabled-medical-devices
- FDA 510(k) database: https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm

---

## Date Verification: The Critical Component

**Date verification is non-negotiable.** Every article must have its publication date confirmed before entering the verified folder. Articles with unconfirmed dates go to flagged/, not verified/.

### Priority cascade (implement in this order):

1. **RSS pubDate/dc:date** (for RSS-sourced articles) - HIGHEST CONFIDENCE
2. **schema.org JSON-LD** - `datePublished` in `<script type="application/ld+json">` - HIGH
3. **Open Graph meta tags** - `<meta property="article:published_time">` - HIGH
4. **Meta name tags** - `<meta name="date">` or `<meta name="pubdate">` - HIGH
5. **`<time datetime="...">` elements** - MEDIUM-HIGH
6. **URL date pattern extraction** - patterns like `/2026/02/18/` or `/20260218/` - MEDIUM
7. **Visible date text near article header** - 'February 18, 2026' or '18 Feb 2026' - MEDIUM
8. **HTTP Last-Modified header** - LOW (often reflects cache, not publication)

### Known reliable URL patterns:

| Publisher | URL pattern | Reliability |
|-----------|------------|-------------|
| BusinessWire | /20260217/ in path | High |
| Insurance Journal | /2026/02/18/ in path | High |
| Healthcare Brew | /stories/2026/02/18/ | High |
| Manila Times | /2026/02/17/ in path | High |
| GlobeNewsWire | /2026/02/18/ in path | High |
| CNBC | /2026/02/18/ in path | High |

### Sites confirmed to use schema.org datePublished:
Insurance Journal, BioSpace, MedTech Dive, CNBC, StartupNews.fyi, Taipei Times

### Return format from verify_date():
```python
{
    "date": "2026-02-18",
    "confidence": "high|medium|low",
    "method": "schema.org|opengraph|rss|url-pattern|visible-text|last-modified",
    "verified": True|False
}
```

---

## Keyword Filtering

Cast wide net - better 30 verified articles than 12 tight ones.

```yaml
biopharma:
  required_any_group_1: ['AI', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'generative AI', 'foundation model']
  required_any_group_2: ['pharma', 'biopharma', 'drug discovery', 'clinical trial', 'FDA', 'EMA', 'therapeutic', 'biotech']
  boost: ['Ireland', 'Irish', 'Merck', 'Lilly', 'Pfizer', 'Roche', 'AstraZeneca', 'Novartis', 'BMS', 'Takeda', 'Sanofi']

medtech:
  required_any_group_1: ['AI', 'artificial intelligence', 'machine learning']
  required_any_group_2: ['medical device', 'medtech', 'FDA clearance', '510(k)', 'digital health', 'diagnostic', 'surgical robot', 'imaging']
  boost: ['Medtronic', 'GE HealthCare', 'Siemens Healthineers', 'Philips', 'Abbott', 'Boston Scientific', 'Stryker']

manufacturing:
  required_any_group_1: ['AI', 'artificial intelligence', 'machine learning', 'digital twin', 'physical AI']
  required_any_group_2: ['manufacturing', 'semiconductor', 'fab', 'factory', 'production', 'chip', 'HBM', 'wafer', 'robotics']
  boost: ['Samsung', 'TSMC', 'Intel', 'NVIDIA', 'SK hynix', 'ASML', 'Siemens', 'Foxconn']

insurance:
  required_any_group_1: ['AI', 'artificial intelligence', 'machine learning', 'generative AI']
  required_any_group_2: ['insurance', 'insurtech', 'underwriting', 'claims', 'actuarial', 'reinsurance', 'broker']
  boost: ['Munich Re', 'Swiss Re', 'AIG', 'Allianz', 'Zurich', 'Lloyd', 'Aviva', 'Gallagher']

general:
  required_any_group_1: ['AI', 'artificial intelligence', 'machine learning', 'LLM', 'large language model', 'foundation model', 'generative AI']
  boost: ['OpenAI', 'Anthropic', 'Google DeepMind', 'Meta AI', 'Mistral', 'xAI', 'Cohere', 'AWS Bedrock', 'Azure AI', 'SaaS', 'agentic']
```

---

## Per-Article Output Format

Each verified article saved as both JSON (metadata) and MD (content).

**JSON metadata file** (`data/verified/YYYY-MM-DD-{slug}.json`):
```json
{
  "title": "Article title",
  "url": "https://...",
  "source": "Insurance Journal",
  "date_published": "2026-02-18",
  "date_verified_method": "schema.org datePublished",
  "date_confidence": "high",
  "sector": "insurance",
  "keywords_matched": ["ERGO", "job cuts", "AI", "claims"],
  "snippet": "First 200 words...",
  "scraped_at": "2026-02-22T01:14:00Z"
}
```

**MD content file** (`data/verified/YYYY-MM-DD-{slug}.md`):
```markdown
---
title: Article Title Here
url: https://source.com/article
source: Insurance Journal
date_published: 2026-02-18
date_verified_method: schema.org datePublished
date_confidence: high
sector: insurance
scraped_at: 2026-02-22T01:14:00Z
---

[Full article text]
```

**Raw HTML** also saved to `data/raw/` for re-verification if needed.

---

## Off-Limits Management

`config/off-limits.yaml` - cumulative, never reset. Every candidate checked against all previous weeks.

```yaml
week_7:
  - company: Takeda
    topic: Iambic AI drug discovery partnership
  - company: Isomorphic Labs
    topic: IsoDDE protein design
  - company: Generate Biomedicines
    topic: IPO filing

week_8:
  - company: Merck
    topic: Mayo Clinic AI drug discovery partnership
  - company: Medtronic
    topic: Stealth AXiS FDA clearance
  - company: Samsung
    topic: HBM4 memory
  - company: ERGO
    topic: 1000 job cuts AI
  - company: AIG
    topic: AI beyond expectations results
  - company: mea Platform
    topic: 50m funding round
  - company: Gallagher Re
    topic: insurtech report
  - company: Intrinsic
    topic: Alphabet CEO
  - company: Copan
    topic: PhenoMATRIX
  - company: Deloitte
    topic: manufacturing AI analysis
  - company: Michigan State
    topic: AI diamonds research
```

---

## Research Pack Report Format

Generated by `report.py`:

```markdown
# SNI Research Pack: Week {N}, 2026
Generated: {date}
Date range: {start} to {end}
Total verified articles: {N}

## General AI Feed ({N} articles)
### [Title]
- Source: Publisher
- URL: https://...
- Published: DD Month YYYY (verified: method)
- Summary: [200-word summary]

## Biopharma ({N} articles)
[same format]

## MedTech ({N} articles)
[same format]

## Manufacturing ({N} articles)
[same format]

## Insurance ({N} articles)
[same format]

## Flagged for manual review ({N} articles)
[articles where date could not be confirmed]

## Off-limits check
- Checked against: weeks 7, 8
- Conflicts found: 0
```

---

## Error Handling

- **403/paywall errors**: log URL, skip entirely, do not include in any output
- **Timeout**: retry once with 5s wait, then skip
- **Date unverifiable**: save to `data/flagged/` with reason, never to `data/verified/`
- **Duplicate detection**: hash URLs to avoid double-counting across sources
- **Rate limiting**: 1-2 second delay between requests minimum, respect robots.txt
- **User-Agent**: use a reasonable browser-like string

---

## Technical Requirements

- Python 3.x
- Libraries: requests, beautifulsoup4, feedparser, pyyaml, python-dateutil
- requirements.txt included
- .env file for API keys (BRAVE_API_KEY, not hardcoded)
- .gitignore for .env, data/, output/ (content not in git)
- All scripts runnable standalone: `python scripts/fetch.py`
- Verbose logging to console showing progress

---

## Brave Search Integration (General Feed)

API endpoint: `https://api.search.brave.com/res/v1/web/search`
Header: `X-Subscription-Token: {BRAVE_API_KEY}`
Parameter: `freshness=pw` (past week) for the test run
Parameter: `count=20` per query

Do NOT rely on Brave Search dates - fetch each URL and verify date independently.

---

## Test Validation

The first run uses `--test` flag targeting the last 7 days (approximately 15-22 Feb 2026).

The tool MUST find these confirmed Week 8 stories (from manual research):
- Merck/Mayo Clinic partnership (Feb 18) - Healthcare Brew
- Medtronic Stealth AXiS (Feb 18) - MedTech Dive
- Samsung HBM4 (Feb 13) - Samsung Newsroom
- ERGO 1,000 job cuts (Feb 18) - Insurance Journal
- AIG AI results (Feb 13) - Insurance Journal
- mea Platform $50m (Feb 17) - BusinessWire
- Gallagher Re insurtech report (Feb 18) - Insurance Journal
- Intrinsic/Alphabet CEO (Feb 18-19) - CNBC / StartupNews
- Copan PhenoMATRIX (Feb 17) - Manila Times/PR Newswire
- Deloitte manufacturing AI (Feb 18) - Automation World
- Michigan State AI diamonds (Feb 20) - Robotics & Automation News

Target: find 7+ of these 11. (Samsung HBM4 Feb 13 and AIG Feb 13 may fall outside 7-day window from Feb 22.)

---

## What NOT To Do

- Do NOT rely on web search date filters - they are unreliable
- Do NOT infer dates from conference schedules or fiscal quarters
- Do NOT include Bloomberg, FT or hard-paywalled sources
- Do NOT assume a story is from this week because it appeared in a search
- Do NOT use cached/archived versions as date evidence
- Do NOT skip raw HTML storage
