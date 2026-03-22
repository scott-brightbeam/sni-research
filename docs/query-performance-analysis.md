# SNI Pipeline: Brave Search Query Performance Analysis

**Date:** 22 March 2026
**Analysis period:** 7 March -- 22 March 2026 (16 runs with queryStats; 22 total run files)
**Data sources:** `output/runs/pipeline-*.json`, `data/verified/`, `config/search-queries.yaml`, `config/sources.yaml`, `data/source-health.json`, `logs/fetch-error.log`

---

## Executive Summary

The pipeline runs 329 Brave Search queries per day across four tiers (L1, L2, L3, L4) plus RSS feeds and headline scraping. Over the analysis period:

- **Total Brave API calls:** 5,264 (329/run x 16 runs)
- **Total Brave cost:** $15.79 (at $0.003/search)
- **Total articles saved:** 1,461 (across all channels)
- **Overall cost per saved article:** $0.011
- **Brave API availability:** 56% (7 of 16 runs returned zero results due to connectivity failures)
- **70% of all unique queries are dead or zero-result** (961 of 1,364 unique queries never saved a single article)

The single largest cost centre is L4 (daily date-pinned queries), consuming 63% of Brave spend ($9.94) while 71% of its API calls are wasted on dead queries. However, L4 provides 64% unique articles not found by other tiers, making it valuable despite the waste -- the question is which L4 queries to keep.

---

## 1. Query Tier Economics

### Overview Table

| Tier | Unique Queries | Total API Calls | Results | Articles Saved | Cost | Cost/Save | Conversion Rate | Error Rate |
|------|---------------|----------------|---------|---------------|------|-----------|----------------|------------|
| L1 (Sector Sweeps) | 69 | 1,104 | 10,159 | 223 | $3.31 | $0.01 | 2.2% | 107.7%* |
| L2 (Site Targeting) | 24 | 384 | 802 | 23 | $1.15 | $0.05 | 2.9% | 39.1% |
| L3 (Cross-Sector) | 29 | 464 | 4,729 | 109 | $1.39 | $0.01 | 2.3% | 83.2% |
| L4 (Daily Experiment) | 1,242 | 3,312 | 36,064 | 643 | $9.94 | $0.02 | 1.8% | 43.7% |
| **TOTAL** | **1,364** | **5,264** | **51,754** | **998** | **$15.79** | **$0.02** | **1.9%** | -- |

*Error rate >100% means errors exceed calls -- some queries generate multiple fetch errors per result (e.g. 10 results with 12 fetch errors on individual URLs).

### Non-Brave Channels

| Channel | Articles Found | Notes |
|---------|---------------|-------|
| RSS feeds | 404 article-tier mentions | 32 feeds configured; TechCrunch AI (85), GlobeNewswire (59), The Register (49) are top producers |
| Headline scraping (HL) | 106 article-tier mentions | 6 sources; Wired Science (1,180 headlines searched, most found), FT AI (333 found but 403 on article fetch) |

### Key Finding

RSS feeds are free and contribute ~20% of article-tier mentions. Brave Search costs $15.79 for the period but suffered 44% downtime. The pipeline's resilience depends heavily on RSS -- during Brave outages (7 days), RSS/HL still delivered 188 articles.

---

## 2. Individual Query Performance

### Classification Summary

| Category | Count | Percentage | Definition |
|----------|-------|-----------|------------|
| High-performer | 3 | 0.2% | 10+ saves across all runs |
| Moderate | 140 | 10.3% | 3--9 saves |
| Low-performer | 260 | 19.1% | 1--2 saves |
| Dead (has results) | 469 | 34.4% | 0 saves despite returning results |
| Dead (zero results) | 492 | 36.1% | Brave returns nothing at all |

**70.4% of queries (961/1,364) never save a single article.** However, most of these are L4 date-pinned variants (see Section 3).

### Top 20 Queries by Saves

| Saves | Runs | Results | Errors | S/Run | Query |
|-------|------|---------|--------|-------|-------|
| 13 | 16 | 157 | 11 | 0.81 | L1: manufacturing agentic AI autonomous factory operations |
| 12 | 16 | 160 | 21 | 0.75 | L3: edge AI on-device inference mobile deployment |
| 11 | 16 | 136 | 22 | 0.69 | L1: insurance AI liability insurance chatbot errors |
| 9 | 16 | 157 | 28 | 0.56 | L1: biopharma agentic AI pharma deployment |
| 9 | 16 | 139 | 23 | 0.56 | L1: general AI military blacklist defense department |
| 9 | 16 | 179 | 16 | 0.56 | L3: agentic AI autonomous workflow enterprise |
| 8 | 16 | 160 | 27 | 0.50 | L1: manufacturing industrial copilot generative AI PLC engineering |
| 8 | 16 | 140 | 1 | 0.50 | L1: insurance agentic AI submission triage insurance |
| 8 | 16 | 134 | 0 | 0.50 | L1: general prompt injection agent data exfiltration |
| 8 | 16 | 140 | 0 | 0.50 | L2: CNBC -- site:cnbc.com artificial intelligence |
| 7 | 16 | 140 | 13 | 0.44 | L1: manufacturing human centric factory AI upskilling |
| 7 | 16 | 160 | 18 | 0.44 | L3: AI export controls sanctions technology restrictions |
| 7 | 16 | 180 | 13 | 0.44 | L3: AI regulation EU AI Act implementation |
| 7 | 16 | 178 | 27 | 0.44 | L3: AI agent failure hallucination reliability |
| 6 | 16 | 160 | 16 | 0.38 | L1: biopharma OpenFold3 AI structural biology consortium |
| 6 | 16 | 160 | 10 | 0.38 | L1: manufacturing computer vision quality inspection |
| 6 | 16 | 160 | 16 | 0.38 | L1: manufacturing AI manufacturing knowledge transfer retirement |
| 6 | 16 | 140 | 27 | 0.38 | L1: general vibe coding enterprise software |
| 6 | 16 | 154 | 23 | 0.38 | L3: AI data center liquid cooling infrastructure |
| 6 | 16 | 152 | 9 | 0.38 | L3: small language models edge deployment |

### Dead L1 Queries (11 total, 0 saves despite 16 runs each)

All dead L1 queries return results (100--160 per call) but nothing passes sector-keyword scoring:

| Query | Results | Errors | Diagnosis |
|-------|---------|--------|-----------|
| biopharma AI CMC pharmaceutical manufacturing quality control | 160 | 14 | Results are generic manufacturing, not pharma-specific |
| biopharma automated AI partnering system biotech | 155 | 23 | Niche topic -- results about general AI partnerships, not AI-powered partnering platforms |
| medtech predetermined change control plan PCCP AI device | 160 | 24 | Too regulatory-specific; results discuss PCCP generically without AI angle |
| medtech good machine learning practice GMLP medical device | 160 | 8 | Regulatory niche; results are FDA guidance docs, not news |
| medtech FDA wellness guidance wearables AI | 160 | 34 | Mostly consumer wearable news, not AI-medtech intersection |
| medtech ambulatory surgery center AI robotics | 160 | 34 | Results about ASC industry broadly, AI mentions are incidental |
| medtech capability driven procurement medtech | 153 | 15 | Procurement articles without AI substance |
| medtech medtech digital transformation divestiture | 148 | 17 | M&A news without AI focus |
| insurance AI prior authorisation denials health insurance | 140 | 44 | High-error, health insurance topic -- results about prior auth broadly, not AI |
| general HBM memory shortage DRAM pricing AI servers | 140 | 3 | Duplicates L1 manufacturing HBM query; general sector scoring too strict |
| general federal deregulation state AI law conflict | 140 | 9 | Policy articles without clear AI substance in lede |

### Dead L3 Queries (3 total)

| Query | Results | Errors | Diagnosis |
|-------|---------|--------|-----------|
| AI institutional knowledge capture retirement | 137 | 11 | Results about retirement planning, not AI knowledge transfer |
| state vs federal AI regulation conflict | 160 | 6 | Overlaps with L3 "AI regulation EU AI Act" and L1 "federal deregulation"; articles it finds are already captured |
| vibe coding internal software generation | 180 | 15 | "Vibe coding" is too new/niche; overlaps with L1 "vibe coding enterprise software" which does save (6 saves) |

---

## 3. L4 Deep Dive

### What L4 Is

L4 queries are date-pinned variants of L1 queries. Each L1 query like `"biopharma agentic AI pharma deployment March 2026"` spawns daily L4 variants: `"biopharma agentic AI pharma deployment March 7 2026"`, `"...March 8 2026"`, etc. L4 uses `freshness=pw` (past week) vs L1's `freshness=pm` (past month).

### L4 Query Classification

| Category | Count | Percentage |
|----------|-------|-----------|
| Productive (3+ saves) | 84 | 6.8% |
| Low (1--2 saves) | 229 | 18.4% |
| Dead (has results, 0 saves) | 446 | 35.9% |
| Dead (zero results) | 483 | 38.9% |
| **Total** | **1,242** | |

**74.8% of L4 queries are completely dead.** Of those, 483 (52% of dead) return zero results from Brave -- the date-pinned search term simply does not match anything.

### L4 Economics

| Metric | Value |
|--------|-------|
| Total L4 API calls | 3,312 |
| Total L4 cost | $9.94 |
| Total L4 saves | 643 |
| Dead L4 calls (wasted) | 2,359 |
| Wasted cost | $7.08 |
| Waste percentage | 71.2% |

### L4 Incrementality -- The Critical Question

Of 961 articles that L4 found:

| Overlap | Articles | Percentage |
|---------|----------|-----------|
| **L4-only** (not found by any other tier) | **619** | **64.4%** |
| L4 + L1 overlap | 292 | 30.4% |
| L4 + other tiers (L3, RSS, etc.) | 50 | 5.2% |

**L4 is genuinely incremental.** 619 articles (64.4%) would be lost without L4. The overlap with L1 is 30.4%, meaning date-pinning does surface different results from Brave than the month-level query.

### Productive vs Dead L4 Base Queries

L4's 1,242 unique queries map to 378 base queries (stripping the date suffix). Of those:

- 148 base queries (39%) are productive (at least one date-pinned variant saves)
- 230 base queries (61%) are completely dead across all date variants

### Top L4 Base Queries by Saves

| Base Query | L4 Saves | L4 Runs | L1 Saves | L1 Runs |
|-----------|----------|---------|----------|---------|
| biopharma synthetic control arm trial emulation real world data | 32 | 48 | 3 | 16 |
| insurance NAIC AI systems evaluation tool | 27 | 48 | 5 | 16 |
| biopharma agentic AI pharma deployment | 17 | 48 | 9 | 16 |
| manufacturing industrial copilot generative AI PLC engineering | 17 | 48 | 8 | 16 |
| insurance EIOPA generative AI survey insurance governance | 16 | 48 | 4 | 16 |
| biopharma small language models biotech | 15 | 48 | 2 | 16 |
| manufacturing high bandwidth memory HBM shortage | 15 | 48 | 5 | 16 |
| insurance AI liability insurance chatbot errors | 15 | 48 | 11 | 16 |
| biopharma artificial intelligence data governance FDA | 14 | 48 | 5 | 16 |
| biopharma FDA AI model credibility regulatory submissions | 13 | 48 | 1 | 16 |
| general sovereign AI national infrastructure | 13 | 48 | 5 | 16 |
| medtech autonomous AI radiology CE class IIB | 12 | 48 | 2 | 16 |
| manufacturing humanoid robots factory pilot | 12 | 48 | 4 | 16 |
| manufacturing human centric factory AI upskilling | 12 | 48 | 7 | 16 |
| manufacturing AI integration ERP MES WMS | 12 | 48 | 4 | 16 |

**Key pattern:** The top L4 base queries consistently outperform their L1 counterparts in absolute saves (e.g. "synthetic control arm" L4=32 vs L1=3). Date-pinning forces Brave to surface recently published pages that the monthly query buries.

### Characteristics of Productive vs Dead L4 Queries

**Productive L4 queries** tend to:
- Target specific technical topics with regular news flow (regulatory decisions, product launches)
- Use distinctive multi-word phrases that Brave can match precisely
- Cover topics where timing matters (e.g. "NAIC evaluation tool" gets new mentions each week)

**Dead L4 queries** tend to:
- Use generic phrases Brave cannot date-pin effectively
- Cover topics with sparse or sporadic coverage
- Target niches where the L1 monthly query already captures everything available

---

## 4. L2 Site-Specific Analysis

### L2 Performance Table

| Site | Saves | Runs | Results | Errors | Indexed? | Diagnosis |
|------|-------|------|---------|--------|----------|-----------|
| cnbc.com | 8 | 16 | 140 | 0 | Yes | **Best L2 performer.** Broad AI coverage, high-domain articles pass scoring. |
| biospace.com | 4 | 16 | 113 | 0 | Yes | Productive. Biopharma focus, reasonable conversion. |
| reinsurancene.ws | 4 | 16 | 19 | 0 | Yes | Productive despite few results. High-relevance niche site. |
| genengnews.com | 3 | 16 | 12 | 0 | Yes | Sparse but productive. GEN articles are sector-focused. |
| arxiv.org | 3 | 16 | 139 | 0 | Yes | Low conversion. Research papers rarely pass news-oriented scoring. |
| nist.gov | 1 | 16 | 15 | 0 | Yes | Low but unique. Regulatory primary source. |
| reuters.com | 0 | 16 | 140 | 124 | Yes | **Results but 89% error rate.** Reuters blocks article fetch (403). |
| finance.yahoo.com | 0 | 16 | 140 | 0 | Yes | Results but 0 saves. Yahoo Finance AI articles are aggregated/generic. |
| wired.com | 0 | 16 | 16 | 0 | Yes | Few results, 0 saves. Wired covered better by RSS (The Verge AI) and HL scraping. |
| labiotech.eu | 0 | 16 | 14 | 0 | Yes | Indexed but articles do not pass scoring. |
| manufacturingdive.com | 0 | 16 | 15 | 0 | Yes | **Already has RSS feed.** Redundant L2 query. |
| massdevice.com | 0 | 16 | 5 | 5 | Barely | Errors on all results. Site may block bots. |
| radiologybusiness.com | 0 | 16 | 23 | 21 | Yes | High error rate (91%). Site blocks article fetch. |
| industrytoday.com | 0 | 16 | 7 | 0 | Barely | Almost no results. Sparse indexing. |
| carriermanagement.com | 0 | 16 | 4 | 0 | Barely | Minimal results, no saves. |
| bioworld.com | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave at all. |
| pharmaphorum.com | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave. |
| industryweek.com | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave. |
| themanufacturer.com | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave. |
| automationworld.com | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave. |
| insuranceerm.com | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave. |
| instech.london | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave. |
| fintechglobal.com | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave. |
| fdalawblog.net | 0 | 16 | 0 | 0 | **No** | Not indexed by Brave. |

### L2/RSS Overlap

Only one L2 site has a corresponding RSS feed: **Manufacturing Dive** (`manufacturingdive.com`). The L2 query for this site returned 15 results and 0 saves across 16 runs, while the RSS feed delivered 6 articles. The L2 query is pure waste.

### L2 Summary

- **6 productive** (cnbc.com, biospace.com, reinsurancene.ws, genengnews.com, arxiv.org, nist.gov): $0.29/period, 23 saves
- **9 not indexed** by Brave (0 results): $0.43/period wasted
- **9 indexed but dead** (results but 0 saves): $0.43/period wasted
- **Total L2 waste:** $0.86 of $1.15 (75%)

---

## 5. Duplicate Coverage Analysis

### Multi-Channel Articles

Of 2,097 total verified articles, **351 (16.7%)** were found by two or more tiers.

### Tier Overlap Pairs

| Tier Pair | Overlapping Articles | Notes |
|-----------|---------------------|-------|
| L1 + L4 | 292 | Largest overlap. Expected since L4 is date-pinned L1. |
| L3 + L4 | 76 | Thematic queries finding same articles as sector-specific. |
| L1 + L3 | 49 | Sector sweeps and theme queries surface same stories. |
| HL + L4 | 12 | Headline scraping catching same as Brave. |
| L4 + RSS | 12 | RSS and date-pinned searches finding same articles. |
| L2 + L4 | 8 | Minimal site-query overlap with date-pinned. |
| L1 + RSS | 4 | L1 and RSS operate independently with little overlap. |
| L1 + L2 | 4 | Minimal overlap between sector sweeps and site queries. |
| HL + L1 | 3 | Very little headline/L1 overlap. |
| HL + RSS | 3 | Headline scraping and RSS are complementary. |

### Would We Lose Coverage by Dropping Dead Queries?

No. Dead queries by definition save zero articles. Dropping all 961 dead queries removes zero unique coverage while saving $5.47/period (calculated from dead L1 + dead L2 + dead L3 + dead L4 API calls).

---

## 6. Sector-Level ROI

### Sector Performance (Brave Queries Only)

Sector attribution uses the query label prefix (L1/L4 queries carry sector names; L2/L3 are cross-sector).

| Sector | Brave Calls | Results | Saved | Cost | Cost/Save | L1 Queries | Dead L1 |
|--------|------------|---------|-------|------|-----------|-----------|---------|
| Manufacturing | 267 | 9,566 | 231 | $0.80 | $0.003 | 14 | 0 |
| General AI | 266 | 9,204 | 184 | $0.80 | $0.004 | 14 | 2 |
| Insurance | 247 | 8,662 | 187 | $0.74 | $0.004 | 13 | 1 |
| Biopharma | 266 | 9,452 | 176 | $0.80 | $0.005 | 14 | 2 |
| MedTech | 266 | 9,354 | 88 | $0.80 | $0.009 | 14 | 6 |

### Sector Workhorses (Top L1 Queries per Sector)

**Manufacturing** (0 dead L1 queries -- best sector):
1. `agentic AI autonomous factory operations` -- 13 saves (0.81/run)
2. `industrial copilot generative AI PLC engineering` -- 8 saves
3. `human centric factory AI upskilling` -- 7 saves

**Insurance** (1 dead L1 query):
1. `AI liability insurance chatbot errors` -- 11 saves (0.69/run)
2. `agentic AI submission triage insurance` -- 8 saves
3. `AI model risk management insurance underwriting` -- 5 saves

**General AI** (2 dead L1 queries):
1. `AI military blacklist defense department` -- 9 saves
2. `prompt injection agent data exfiltration` -- 8 saves
3. `vibe coding enterprise software` -- 6 saves

**Biopharma** (2 dead L1 queries):
1. `agentic AI pharma deployment` -- 9 saves
2. `OpenFold3 AI structural biology consortium` -- 6 saves
3. `AI qualified tool drug development biomarker` -- 5 saves

**MedTech** (6 dead L1 queries -- worst sector):
1. `AI ambient scribe clinical documentation` -- 5 saves
2. `MDR IVDR AI Act medical device` -- 3 saves
3. `medtech AI acquisition premium` -- 3 saves

### MedTech Underperformance

MedTech has the worst cost/save ($0.009) and 6 of 14 L1 queries are dead. The dead queries target overly specific regulatory niches (PCCP, GMLP, wellness guidance) where Brave surfaces regulatory documents rather than news. MedTech needs query reformulation (see Recommendations).

### RSS Dependency by Sector

| Sector | Article Count | Primary Channels |
|--------|--------------|-----------------|
| General AI | 1,190 | TechCrunch AI (85), The Register (49), The Verge AI (33), Brave L1/L3/L4 |
| Manufacturing | 456 | Semiconductor Engineering (30), Manufacturing Dive (6), Brave L1/L4 |
| Biopharma | 160 | GlobeNewswire (59), Endpoints News RSS, Brave L1/L4 |
| Insurance | 146 | Insurance Thought Leadership (14), PYMNTS (43 cross-sector), Brave L1/L4 |
| MedTech | 145 | MobiHealthNews (26), Brave L1/L4 |

Insurance is the most Brave-dependent sector with only 1 working RSS feed. Biopharma improved in March with Nature Biotechnology and Endpoints News additions.

---

## 7. RSS Feed Analysis

### RSS Feed Productivity (by article-tier mentions in verified articles)

| Rank | Feed | Articles | Category | Notes |
|------|------|----------|----------|-------|
| 1 | TechCrunch AI | 85 | tech_press | Top producer. Broad AI coverage. |
| 2 | GlobeNewswire AI | 59 | wire_services | Press releases. High volume, variable quality. |
| 3 | The Register | 49 | tech_press | General tech with strong AI coverage. |
| 4 | PYMNTS | 43 | cross_sector | Payments/fintech, some insurance overlap. |
| 5 | The Verge AI | 33 | tech_press | Consumer AI news focus. |
| 6 | Semiconductor Engineering | 30 | manufacturing | Excellent for chip/manufacturing sector. |
| 7 | MobiHealthNews | 26 | medtech | Only productive medtech RSS. |
| 8 | The Neuron | 20 | newsletters | AI digest newsletter. |
| 9 | Insurance Thought Leadership | 14 | insurance | Only working insurance RSS feed. |
| 10 | Google Research Blog | 7 | ai_labs | Low volume but high-signal. |
| 11 | NVIDIA Blog | 7 | ai_labs | Product announcements. |
| 12 | Manufacturing Dive | 6 | manufacturing | Low but sector-specific. |
| 13 | Samsung Newsroom | 5 | cross_sector | Occasional AI chip news. |
| 14 | Hugging Face Blog | 5 | newsletters | Open-source AI model releases. |
| 15 | Amazon Science | 3 | ai_labs | Frequent timeouts (6 in error log). |

### Dead/Silent RSS Feeds

The following configured RSS feeds produced 0 verified articles in the analysis period:

- **BioPharma Dive** -- feed works but articles 403 on fetch (32 errors logged for biopharmadive.com)
- **Clinical Trials Arena** -- timeout errors logged
- **Pharmaceutical Technology** -- timeout errors logged
- **Nature Biotechnology** -- recently added, may need time
- **Rock Health** -- no articles matched scoring criteria
- **FDA Press Releases** -- regulatory notices, not AI-focused news
- **The Robot Report** -- feed works but articles 403 on fetch (71 errors logged)
- **OpenAI News** -- all article URLs return 403 (45 errors logged)
- **Google DeepMind Blog** -- timeout errors
- **Microsoft Research** -- no articles matched
- **VentureBeat AI** -- no articles matched (possibly paywalled)
- **Ars Technica** -- no articles matched criteria
- **Import AI** -- newsletter format may not parse well
- **Last Week in AI** -- newsletter format may not parse well

### RSS Feeds That Overlap With Brave Queries

Only Manufacturing Dive has both an RSS feed and an L2 Brave query. The RSS feed produces 6 articles; the L2 query produces 0. **Drop the L2 query.**

### Potential New RSS Feeds

Based on domains that produce articles via Brave but have no RSS feed configured:

- **CNBC** (8 saves from L2 query) -- has RSS: `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114` (Technology section)
- **Reinsurance News** (4 saves from L2) -- already has feed listed as removed in sources.yaml due to timeouts; worth retrying
- **BioSpace** (4 saves from L2) -- feed listed as removed (404); no current RSS available

---

## 8. Error Classification

### Error Summary (from fetch-error.log, 2,782 lines)

| Error Type | Count | Percentage | Impact |
|------------|-------|-----------|--------|
| Brave API connectivity failures | 233 | 8.4% | Caused 7 complete outage days (March 16--22) |
| Article fetch 403 (blocked by site) | 186 | 6.7% | 5 domains responsible for 96% of 403s |
| RSS feed timeouts | 14 | 0.5% | Amazon Science (6), various others (1 each) |
| Brave API timeout | 1 | <0.1% | Rare |
| Score threshold warnings | 9 | 0.3% | Pipeline flagged >10% of articles for review |
| Other (operation aborted, etc.) | 2,339 | 84.1% | Mostly Brave connectivity retry pairs |

### 403 Errors by Domain

| Domain | 403 Count | Source Type | Impact |
|--------|-----------|-------------|--------|
| www.therobotreport.com | 71 | RSS feed | Bot-blocked. RSS feed works but article pages return 403. |
| openai.com | 45 | RSS feed | Bot-blocked. Feed serves URLs but pages block scraping. |
| www.biopharmadive.com | 32 | RSS feed | Same pattern -- feed works, articles blocked. |
| www.medtechdive.com | 19 | RSS feed | Industry Dive sites all block bots on article pages. |
| www.manufacturingdive.com | 18 | RSS feed | Same Industry Dive blocking pattern. |
| www.mobihealthnews.com | 1 | RSS feed | Occasional block. |

### Brave API Outage Pattern

From March 16--22 (7 consecutive days), Brave Search returned 0 results for all 329 queries. The error log shows repeated "Unable to connect" and "Was there a typo in the url or port?" messages, typically in bursts of 20--40 sequential errors. This suggests a local network issue or Brave API endpoint change rather than rate limiting.

**During outage:** The pipeline still saved 188 articles from RSS feeds and headline scraping alone, demonstrating the value of the multi-channel strategy.

---

## 9. Recommendations

### A. Queries to DROP (Immediate, save $2.38/period)

#### Drop 9 unindexed L2 sites (save $0.43)

These sites are not indexed by Brave Search. Every query is guaranteed to return 0 results:

1. `site:bioworld.com` -- not indexed
2. `site:pharmaphorum.com` -- not indexed
3. `site:industryweek.com` -- not indexed
4. `site:themanufacturer.com` -- not indexed
5. `site:automationworld.com` -- not indexed
6. `site:insuranceerm.com` -- not indexed
7. `site:instech.london` -- not indexed
8. `site:fintechglobal.com` -- not indexed
9. `site:fdalawblog.net` -- not indexed

#### Drop 5 dead L2 sites with results but 0 saves (save $0.24)

1. `site:reuters.com` -- 89% error rate, all fetches blocked (403)
2. `site:finance.yahoo.com` -- aggregated content, never passes scoring
3. `site:wired.com` -- covered by headline scraping and The Verge AI RSS
4. `site:labiotech.eu` -- indexed but articles never match
5. `site:manufacturingdive.com` -- **redundant with RSS feed**

#### Drop 1 additional dead L2 site (save $0.05)

6. `site:radiologybusiness.com` -- 91% error rate on article fetch

**Total L2 cuts: 15 of 24 queries. Saves $0.72/period. Keeps 9 productive L2 queries.**

#### Drop 11 dead L1 queries (save $0.53)

1. `biopharma AI CMC pharmaceutical manufacturing quality control` -- generic manufacturing results
2. `biopharma automated AI partnering system biotech` -- too niche
3. `medtech predetermined change control plan PCCP AI device` -- regulatory niche
4. `medtech good machine learning practice GMLP medical device` -- regulatory niche
5. `medtech FDA wellness guidance wearables AI` -- consumer wearable noise
6. `medtech ambulatory surgery center AI robotics` -- off-target results
7. `medtech capability driven procurement medtech` -- procurement noise
8. `medtech medtech digital transformation divestiture` -- M&A noise
9. `insurance AI prior authorisation denials health insurance` -- US health insurance, high errors
10. `general HBM memory shortage DRAM pricing AI servers` -- duplicates manufacturing HBM query
11. `general federal deregulation state AI law conflict` -- too US policy-specific

#### Drop 3 dead L3 queries (save $0.14)

1. `AI institutional knowledge capture retirement` -- off-target results
2. `state vs federal AI regulation conflict` -- overlaps with other regulation queries
3. `vibe coding internal software generation` -- overlaps with productive L1 "vibe coding enterprise software"

#### Disable L4 for dead base queries (save $0.99/period estimated)

Rather than dropping L4 entirely (which would lose 619 unique articles), disable L4 generation for the 230 base queries that have never produced a save. This eliminates ~60% of L4 calls while preserving the 148 productive base queries.

### B. Queries to KEEP

#### All L1 queries not listed above (58 of 69)

Every sector-specific L1 query not flagged as dead should remain. Even low performers (1--2 saves) contribute unique sector coverage.

#### Top L2 sites (9 queries)

- `site:cnbc.com` (8 saves) -- best L2 performer
- `site:biospace.com` (4 saves) -- biopharma niche
- `site:reinsurancene.ws` (4 saves) -- insurance niche, high conversion
- `site:genengnews.com` (3 saves) -- biopharma niche
- `site:arxiv.org` (3 saves) -- research papers
- `site:nist.gov` (1 save) -- regulatory primary source, unique content
- `site:massdevice.com` -- keep for now; low results but medtech-specific. Re-evaluate if error rate persists
- `site:industrytoday.com` -- borderline; keep for manufacturing coverage
- `site:carriermanagement.com` -- borderline; keep for insurance coverage

#### All productive L3 queries (26 of 29)

L3 has the best keep-rate (90%). Cross-sector themes are effective at surfacing articles that sector-specific queries miss.

#### L4 for 148 productive base queries

Date-pinning works. Keep L4 enabled for queries where at least one date variant has ever saved an article.

### C. Queries to MODIFY

#### MedTech query reformulation

MedTech has the worst performance (6 of 14 L1 dead). Replace dead queries with broader alternatives:

| Drop | Replace With |
|------|-------------|
| `predetermined change control plan PCCP AI device` | `AI medical device software update lifecycle` |
| `good machine learning practice GMLP medical device` | `AI validation medical device clinical evidence` |
| `FDA wellness guidance wearables AI` | `AI wearable health monitoring clinical` |
| `ambulatory surgery center AI robotics` | `AI surgical planning robotic-assisted` |
| `capability driven procurement medtech` | `AI value-based care medtech` |
| `medtech digital transformation divestiture` | `medtech AI integration platform` |

#### L3 replacements

| Drop | Replace With |
|------|-------------|
| `AI institutional knowledge capture retirement` | `AI corporate knowledge graph enterprise` |
| `vibe coding internal software generation` | (already covered by L1) |

### D. New RSS Feeds to ADD

| Feed | URL | Sector | Rationale |
|------|-----|--------|-----------|
| CNBC Technology | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114` | cross_sector | 8 saves from L2 query; free RSS avoids Brave cost |
| Labiotech.eu | Check `https://www.labiotech.eu/feed/` | biopharma | Site is indexed by Brave (14 results); RSS may deliver content that L2 misses |
| Radiology Business | Check `https://radiologybusiness.com/feed/` | medtech | Site has results but articles 403; RSS may bypass bot blocking |

### E. Fixes for Brave API Reliability

The 7-day Brave API outage (March 16--22) needs investigation:

1. **Check API key validity** -- may have expired or hit monthly quota
2. **Check endpoint URL** -- Brave may have changed their API endpoint
3. **Add retry with exponential backoff** -- current behaviour appears to fire all 329 queries even when the first fails
4. **Add circuit breaker** -- after 5 consecutive connection failures, skip remaining Brave queries and log a single "Brave API unreachable" error instead of 329 individual failures

### F. Fix Bot-Blocked RSS Sources

The Robot Report, OpenAI, BioPharma Dive, MedTech Dive, and Manufacturing Dive all have working RSS feeds but block article page fetching (403). Options:

1. **Extract content from RSS feed descriptions** instead of fetching full articles -- many RSS feeds include 200--500 char snippets
2. **Add a `User-Agent` header** that mimics a feed reader rather than a scraper
3. **Accept RSS-only metadata** (title, date, URL, snippet) without full text for scoring

---

## 10. Cost Projection

### Current Monthly Spend (extrapolated from 16 days)

| Item | Daily | Monthly (30 days) |
|------|-------|-------------------|
| Brave API (329 queries/day) | $0.99 | $29.61 |
| RSS feeds | $0.00 | $0.00 |
| Headline scraping | $0.00 | $0.00 |
| **Total** | **$0.99** | **$29.61** |

### After Optimisation

| Change | Queries Removed | Daily Saving | Monthly Saving |
|--------|----------------|--------------|----------------|
| Drop 15 dead L2 queries | 15 | $0.045 | $1.35 |
| Drop 11 dead L1 queries | 11 | $0.033 | $0.99 |
| Drop 3 dead L3 queries | 3 | $0.009 | $0.27 |
| Disable L4 for 230 dead bases (~3.3 variants/day avg) | ~50/day est.* | $0.150 | $4.50 |
| **Total** | **~79/day** | **$0.237** | **$7.11** |

*L4 dead-base call reduction varies by day; estimated at ~50 queries/day based on 3,312 total L4 calls over 16 runs with 71.2% dead, adjusted for the fact that dead bases generate fewer variants than productive ones.

### Optimised Query Set

| Tier | Current | After Cuts | Change |
|------|---------|-----------|--------|
| L1 | 69 | 58 | -11 |
| L2 | 24 | 9 | -15 |
| L3 | 29 | 26 | -3 |
| L4 | ~207/day | ~100/day est. | -107 |
| **Total** | **329/day** | **~193/day** | **-136** |

### Projected Optimised Monthly Spend

| Item | Monthly |
|------|---------|
| Brave API (~193 queries/day) | $17.37 |
| RSS feeds | $0.00 |
| Headline scraping | $0.00 |
| **Total** | **$17.37** |

**Saving: $12.24/month (41% reduction) with zero loss of productive coverage.**

### Minimum Viable Query Set

If extreme cost reduction is needed, the absolute minimum would be:

- Keep only L1 queries with 3+ saves (42 queries)
- Keep top 6 L2 queries (6 queries)
- Keep L3 queries with 3+ saves (18 queries)
- Drop L4 entirely (but lose 619 articles/period)

This reduces to ~66 queries/day ($5.94/month) but sacrifices L4's 64% unique article coverage and numerous L1 low-performers that contribute 1--2 unique sector articles per period.

**Recommended approach: the moderate optimisation ($17.37/month) rather than the aggressive cut. The L4 incremental value is too significant to discard entirely.**

---

## Appendix: Headline Scraping Source Performance

| Source | Headlines Scraped | Brave Searches Triggered | Articles Found | Errors | Runs |
|--------|------------------|------------------------|----------------|--------|------|
| Wired Science | 880 | 880 | 1,180* | 0 | 16 |
| Endpoints News | 688 | 688 | 909 | 0 | 16 |
| Harvard Business Review AI | 598 | 598 | 761 | 0 | 16 |
| STAT News Health Tech | 464 | 464 | 589 | 0 | 16 |
| Financial Times AI | 169 | 169 | 333 | 4 | 12 |
| Insurance Journal AI | 0 | 0 | 0 | 0 | 16 |

*"Found" means Brave found matching articles when searching headlines. Found > searched when a single headline matches multiple Brave results.

**Insurance Journal AI returns 0 headlines in every run.** The CSS selector `.article-list h2, .article-list h3` may have broken due to a site redesign. This needs investigation -- insurance is the most RSS-dependent sector and this headline source was intended to compensate.

**Financial Times AI** works but article fetching returns 403 (FT is paywalled). The 333 "found" entries represent headline-to-Brave matches, but the actual articles are blocked. FT should remain as a signal source (knowing what FT covers is valuable for editorial awareness) but should not count toward article savings.

---

## Appendix: Source Health Status

From `data/source-health.json`:

| Source | Last Success | Consecutive Failures | Last Error |
|--------|-------------|---------------------|------------|
| STAT News Health Tech | 22 Mar 04:13 | 0 | -- |
| Insurance Journal AI | 22 Mar 04:15 | 0 | -- |
| Harvard Business Review AI | 22 Mar 04:15 | 0 | -- |
| Wired Science | 22 Mar 04:17 | 0 | -- |
| Endpoints News | 22 Mar 04:20 | 0 | -- |
| Financial Times AI | 16 Mar 07:56 | 3 | HTTP 403 |

FT AI has been failing for 6 days (3 consecutive failures since last success on March 16). This correlates with the Brave API outage period -- the headline scraper likely depends on Brave for the search-after-scrape step, which would fail during the outage.
