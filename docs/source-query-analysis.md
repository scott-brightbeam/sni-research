# Source Query Performance Analysis

**Generated:** 2026-03-22
**Data range:** 2026-02-24 to 2026-03-21 (26 daily run files)
**Working period analysed:** 2026-03-05 to 2026-03-14 (10 days with Brave Search active)
**Broken period analysed:** 2026-03-15 to 2026-03-21 (7 days, Brave Search returning 0 results)

---

## 1. Critical Finding: Brave Search Outage (Mar 15 Onwards)

From 2026-03-15, all 329 Brave Search queries return 0 results. This is a complete outage, not a gradual degradation. The pipeline is still saving articles (RSS feeds continue to work), but volume has collapsed:

| Period | Avg articles/day | Brave Search producing |
|--------|-----------------|----------------------|
| Working (Mar 5–14) | ~101/day | Yes |
| Broken (Mar 15–21) | ~23/day | No |

The drop is uniform across all query tiers (L1 through L4). The headlineStats `found` count (secondary Brave Search calls per RSS headline) also dropped to zero on Mar 15, confirming the outage is at the Brave Search API level, not in the query configuration.

**Sector-level impact:**

| Sector | Working period (avg/day) | Broken period (avg/day) | Drop |
|--------|--------------------------|------------------------|------|
| general | 51.9 | 14.1 | 73% |
| manufacturing | 25.3 | 4.3 | 83% |
| biopharma | 8.1 | 1.7 | 79% |
| medtech | 8.1 | 2.6 | 68% |
| insurance | 7.4 | 0.6 | 92% |

Insurance is worst affected — it has only one working RSS feed (Insurance Thought Leadership), so Brave Search was doing nearly all the heavy lifting.

---

## 2. RSS Feed Health

### Headline search feeds (used for secondary Brave Search lookups)

These six sources feed into the `headlineStats` pathway, where headlines are searched against Brave to find related articles. From 2026-03-15, `found=0` for all of them (Brave outage).

| Source | Avg headlines/run | Zero-found runs | Last issue |
|--------|-------------------|-----------------|------------|
| Wired Science | 55 | 7/16 | Post-Mar-15 outage |
| Harvard Business Review AI | 37 | 7/16 | Post-Mar-15 outage |
| Endpoints News | 43 | 8/16 | Post-Mar-15 outage |
| STAT News Health Tech | 29 | 7/16 | Post-Mar-15 outage |
| Financial Times AI | 14 | 6/12 | 3 consecutive failures (HTTP 403) |
| **Insurance Journal AI** | **0** | **16/16** | **Dead — always zero headlines** |

**Insurance Journal AI is dead.** It has zero headlines in every single run across the entire 16-day period. `source-health.json` shows no failures (the RSS fetch succeeds with an empty feed), which means the feed returns no items that pass the keyword filter — or the feed URL is serving empty content. `consecutiveFailures=0` is misleading here because "success" is measured by HTTP response, not article yield.

### Direct RSS article feeds (active during broken period)

These feeds save directly to `data/verified/` without needing Brave Search:

| Source | Articles saved (Mar 15–21) | Sectors covered |
|--------|-----------------------------|-----------------|
| TechCrunch AI | 36 | general (80%), manufacturing, medtech |
| The Register | 24 | general, medtech |
| GlobeNewswire AI | 22 | general, biopharma, manufacturing, medtech |
| PYMNTS | 15 | general, manufacturing |
| The Verge AI | 14 | general, medtech |
| Semiconductor Engineering | 12 | manufacturing, medtech, general |
| MobiHealthNews | 12 | medtech, biopharma, general |
| NVIDIA Blog | 5 | manufacturing, biopharma, general |
| Insurance Thought Leadership | 4 | **insurance only** |
| The Neuron | 4 | general, medtech, manufacturing |
| Google Research Blog | 3 | general, medtech |
| Nature Biotechnology | 2 | biopharma |
| Manufacturing Dive | 2 | manufacturing |
| Hugging Face Blog | 2 | manufacturing |

**Notable RSS gaps:**
- Insurance: only 4 articles in 7 days, all from one source (Insurance Thought Leadership). The sector is effectively dark without Brave Search.
- Biopharma: thin coverage (12 articles, 7 days). BioPharma Dive, Clinical Trials Arena, Pharmaceutical Technology are low-volume; STAT News and Endpoints News are paywalled for most content.
- No AI lab blogs (OpenAI, Anthropic, DeepMind, Microsoft Research) produced articles via RSS in Mar 15–21, likely because no qualifying articles were published in that window.

### Financial Times AI: Consecutive Failures

`source-health.json` records 3 consecutive HTTP 403 failures, last success 2026-03-16. FT has strengthened bot blocking. During the working period it contributed via the `HL:` pathway (headline search), generating meaningful finds: 22 `HL: Financial Times AI` article attributions in working-period verified files. This is now a blocked source.

---

## 3. Query Performance — Working Period (Mar 5–14)

### By query tier

| Tier | Queries | Total results | Total saved | Avg save rate | Always-zero queries |
|------|---------|--------------|-------------|---------------|---------------------|
| L1 (sector-specific, monthly) | 131 | 10,632 | 267 | 2.5% | 0 |
| L2 (site-specific) | 24 | 805 | 29 | 3.6% | **8** |
| L3 (cross-sector themes) | 56 | 4,536 | 87 | 1.9% | 0 |
| L4 (per-day rolling window) | 759 | 27,949 | 399 | 1.4% | 0 |

L4 queries dominate results volume (they run the same L1 topics across multiple date offsets). L1 and L2 are more focused. L3 cross-sector queries have above-average paywall rates.

### L1 sector breakdown

| Sector | Queries | Results | Saved | Save rate |
|--------|---------|---------|-------|-----------|
| manufacturing | 27 | 2,156 | 85 | 3.9% |
| general | 28 | 2,159 | 76 | 3.5% |
| insurance | 25 | 2,044 | 42 | 2.1% |
| biopharma | 25 | 2,162 | 42 | 1.9% |
| medtech | 26 | 2,111 | 22 | 1.0% |

Manufacturing and general are strongest. Medtech has notably low save rate — content is either paywalled or not matching keyword criteria.

### Top L1 queries (by save rate, min 50 results)

| Query (truncated) | Save rate | Saved |
|-------------------|-----------|-------|
| L1: general AI military blacklist defense | 10.1% | 14 |
| L1: general prompt injection agent exfiltration | 5.9% | 8 |
| L1: manufacturing agentic AI autonomous factory | 5.8% | 8 |
| L1: biopharma agentic AI pharma deployment | 5.0% | 7 |
| L1: manufacturing humanoid robots factory pilot | 5.0% | 7 |
| L1: insurance AI liability insurance chatbot errors | 4.4% | 6 |
| L1: medtech medtech AI acquisition premium | 4.3% | 5 |
| L1: manufacturing human centric factory upskilling | 4.3% | 6 |

### Dead L2 (site-specific) queries — always zero results

These eight L2 queries produced zero results in every working-period run. They are candidates for removal:

| Query | Results | Assessment |
|-------|---------|------------|
| L2: BioWorld — site:bioworld.com | 0 | Brave Search doesn't index it |
| L2: Pharmaphorum — site:pharmaphorum.com | 0 | Brave Search doesn't index it |
| L2: IndustryWeek — site:industryweek.com | 0 | Brave Search doesn't index it |
| L2: Automation World — site:automationworld.com | 0 | Brave Search doesn't index it |
| L2: InsuranceERM — site:insuranceerm.com | 0 | Brave Search doesn't index it |
| L2: Instech — site:instech.london | 0 | Brave Search doesn't index it |
| L2: FinTech Global — site:fintechglobal.com | 0 | Brave Search doesn't index it |
| L2: FDA Law Blog — site:fdalawblog.net | 0 | Brave Search doesn't index it |

### L2 queries with zero saves (non-zero results)

| Query | Results | Saves | Notes |
|-------|---------|-------|-------|
| L2: Reuters — site:reuters.com | 140 | 0 | 121 errors — likely 403 |
| L2: Yahoo Finance | 140 | 0 | No relevant AI articles passing filter |
| L2: Wired — site:wired.com | 19 | 0 | 26% paywalled, remainder not matching |
| L2: Manufacturing Dive (site search) | 14 | 0 | Content likely duplicated from RSS feed |
| L2: NIST — site:nist.gov | 15 | 0 | Too technical / doesn't match relevance scoring |
| L2: Industry Today | 7 | 0 | Low-quality source |
| L2: Carrier Management | 3 | 0 | Paywalled |

Reuters site-search is generating 121 fetch errors across 7 runs (17+ errors/run) — it is spending rate-limit on failing requests.

### High-performing L2 queries (to keep)

| Query | Save rate | Saved |
|-------|-----------|-------|
| L2: CNBC | 9.3% | 13 |
| L2: arXiv | 4.3% | 6 |
| L2: BioSpace | 4.2% | 5 |
| L2: Reinsurance News | 16.7% | 3 |
| L2: GEN (genengnews.com) | 10.0% | 1 |

---

## 4. Source Coverage Gaps

### Insurance — critically under-served

Insurance relies almost entirely on Brave Search queries. Its only active RSS feed (Insurance Thought Leadership) yields ~0.6 articles/day. No other insurance-specific RSS feeds are working:
- insurancejournal.com: removed (paywalled)
- insurtech-specific feeds: all dead or 404
- PYMNTS cross-sector feed captures some insurtech content

**Recommended additions to explore:**
- `coverager.com` (currently blocked 403 to bots — may work with subscription/proxy)
- `dig-in.com` (currently returns HTML, not RSS — worth re-checking)
- `instech.london` has an RSS feed that Brave Search doesn't index — try fetching the RSS directly instead of searching it

### Biopharma — improving but thin

Biopharma coverage improved from ~0/day (Feb, no queryStats) to ~8/day (Mar working period). Key contributors during working period:
- L4 Brave Search queries: 227 article attributions across 7 days
- RSS: BioPharma Dive, Clinical Trials Arena, Nature Biotechnology produce sporadically
- STAT News and Endpoints News are partially paywalled but pass some free articles

**Gap:** No Journal of Clinical Oncology, PubMed/NCBI, or Fierce Pharma equivalent that is both non-paywalled and Brave-indexed.

### Medtech — low save rate

Medtech has the lowest L1 save rate (1.0%) despite solid RSS feed coverage. Most medtech-specific search queries are returning results but articles are not passing keyword scoring or are paywalled. The medtech L1 queries that do perform well are those with market/commercial angles rather than purely clinical:
- "medtech AI acquisition premium" saves well (4.3%)
- Regulatory queries (PCCP, GMLP, MDR/IVDR) consistently return 0 results even in working period — these are too niche for Brave Search

---

## 5. Recommended Changes

These are suggestions for Scott to review — none of this document modifies config.

### Remove (dead or counterproductive)

1. **L2: BioWorld, Pharmaphorum, IndustryWeek, Automation World, InsuranceERM, Instech, FinTech Global, FDA Law Blog** — all return 0 results in Brave Search across 7 consecutive working days. Safe to remove; they add query overhead with no yield.

2. **L2: Reuters site:reuters.com** — generates 121 fetch errors in 7 days (17/run). Brave Search returns results but articles 403 on fetch. High overhead, zero saves. Remove.

3. **L2: Yahoo Finance** — 140 results, 0 saves over 7 runs. The content does not match the AI news filter criteria. Remove.

4. **Insurance Journal AI (headline source)** — 0 headlines in all 16 runs. Should be removed from the headline-search pipeline or investigated to confirm the feed URL is correct.

### Keep (currently working, high value)

1. **L2: CNBC** — highest L2 save rate (9.3%), no errors, no paywall issues.
2. **L2: arXiv** — reliable academic pipeline.
3. **L2: BioSpace** — good biopharma specialist coverage.
4. **L2: Reinsurance News** — highest save rate of any L2 (16.7%), good insurance coverage.
5. **All tech_press RSS feeds** — TechCrunch AI, The Register, The Verge AI are the backbone during Brave Search outages.
6. **GlobeNewswire AI (RSS)** — strong cross-sector coverage, particularly general and biopharma press releases.

### Investigate / Add

1. **Brave Search API status** — the complete shutdown since Mar 15 is the most urgent issue. All 329 queries returning 0 suggests an API key expiry, rate-limit ban, or plan change. Check billing/quota status.

2. **Insurance sources** — with only Insurance Thought Leadership active, insurance coverage is at ~0.6 articles/day. Candidates to evaluate:
   - `coverager.com/feed` (currently blocked — worth rechecking)
   - `dig-in.com/feed` (previously returning HTML — may have been fixed)
   - `instech.london` RSS direct fetch (not indexed by Brave but may work as an RSS feed directly)

3. **Medtech regulatory queries** — L1 queries targeting PCCP, GMLP, MDR/IVDR consistently return 0 results. These highly specialised regulatory terms may only appear in grey literature. Consider replacing with broader queries (e.g. "FDA digital health AI clearance 2026") that do produce results.

4. **FT paywall escalation** — FT has moved from occasional 403s to consistent blocking (3 consecutive failures as of Mar 22). The headline pathway that extracted ~22 articles/week from FT is now disabled. No simple workaround without a subscription API.

5. **L3 cross-sector query audit** — L3 queries have above-average paywall rates on some topics. "AI healthcare regulation medical device software" returned 139 results but only 2 saves — poor signal-to-noise for query overhead used.

---

## 6. Summary Statistics

| Metric | Value |
|--------|-------|
| Run files analysed | 26 (Feb 24 – Mar 21) |
| Days with Brave Search active | 10 (Mar 5–14) |
| Days Brave Search fully offline | 7 (Mar 15–21) |
| Total queries per run (current) | 329 |
| L2 queries always returning 0 | 8 (33% of all L2 queries) |
| L2 queries with zero saves | 16 (67% of L2 queries) |
| Insurance Journal AI feed yield | 0 headlines across 16 runs |
| FT headline source status | Blocked (HTTP 403, 3 consecutive failures) |
| Article volume drop (Brave offline) | ~77% average across all sectors |
| Worst-affected sector | Insurance (92% drop) |
| Best-performing L2 source | Reinsurance News (16.7% save rate) |
| Best-performing L1 query class | general/manufacturing (3.5–3.9% save rate) |
