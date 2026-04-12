---
description: Geographic gap-fill — find Ireland, EU and UK AI stories missing from the corpus. Ensures geographic balance before the weekly newsletter draft.
---

# Editorial Geographic Sweep — Ireland, EU & UK Gap-Fill

You are filling the geographic gap in the SNI corpus. The automated RSS and Brave feeds are US-heavy. This skill finds editorially relevant AI stories from Ireland, the EU and the UK that the automated pipeline missed.

**The goal: ensure the corpus contains at least 3 Ireland/EU/UK stories per vertical sector and at least 5 across the general AI category by Wednesday evening.** The newsletter serves a global audience with particular concentration in Ireland, the EU and the UK. European stories are first-class editorial items, not footnotes.

## Step 1: Determine the newsletter date window

```bash
python3 -c "
from datetime import date, timedelta
today = date.today()
days_since_friday = (today.weekday() - 4) % 7
window_start = today - timedelta(days=days_since_friday)
print(f'Window: {window_start} to {today}')
"
```

## Step 2: Count existing Ireland/EU/UK stories

Scan articles in `data/verified/` within the date window. For each JSON file, check whether the article is from an Irish, EU or UK source — by checking the `source` field and `url` domain against the known geographic source lists below, and by scanning the `title` and first 300 chars of `full_text` or `snippet` for geographic markers (Ireland, Irish, Dublin, EU, European Commission, Brussels, UK, London, NHS, FCA, MHRA, etc.).

```bash
# Count articles with geographic markers in title or snippet
for region in ireland eu uk; do
  echo "=== $region ==="
  case $region in
    ireland) pattern="Ireland|Irish|Dublin|IDA |Enterprise Ireland|HSE |Central Bank of Ireland|SFI " ;;
    eu) pattern="European|EU |Brussels|EIOPA|EMA |ESMA|ECB |Horizon Europe|CE mark|MDR |IVDR" ;;
    uk) pattern="UK |United Kingdom|London|NHS |FCA |MHRA|Lloyd|Bank of England|PRA " ;;
  esac
  grep -rl "$pattern" data/verified/2026-*/{general,insurance,biopharma,medtech,manufacturing}/*.json 2>/dev/null | wc -l
done
```

Report the count by sector × region.

## Step 3: Fill gaps via WebSearch

Run targeted searches for each region × sector combination. Apply the same editorial quality gate as all other corpus-building skills: **would an FT editor include this story in a weekly intelligence briefing for senior leaders in regulated industries?**

### Ireland — all sectors

Search queries (run each, adapt date terms to current week):
- `"Ireland" "artificial intelligence" site:siliconrepublic.com` + current week
- `"Ireland AI" site:rte.ie` + current week
- `"Ireland AI" site:techcentral.ie` + current week
- `"IDA Ireland" AI` + current month
- `"Enterprise Ireland" AI` + current month
- `"Ireland" "AI" insurance OR insurtech` + current month
- `"Ireland" "AI" pharma OR biopharma OR clinical trial` + current month
- `"Ireland" "AI" medtech OR medical device OR digital health` + current month
- `"Ireland" "AI" manufacturing OR semiconductor OR data centre` + current month
- `"Central Bank of Ireland" "artificial intelligence"` + current month
- `"HSE" "artificial intelligence" OR "AI"` + current month
- `"Science Foundation Ireland" AI` + current month

### EU — all sectors

- `"EU AI Act" implementation OR compliance OR enforcement` + current week
- `"European Commission" "artificial intelligence"` + current week
- `"EIOPA" AI OR "artificial intelligence"` + current month
- `"EMA" "artificial intelligence" OR "AI" drug` + current month
- `"CE marking" AI OR "artificial intelligence" medical` + current month
- `"EU MDR" AI OR "artificial intelligence"` + current month
- `"European" insurtech AI` + current month
- `"Horizon Europe" AI OR "artificial intelligence"` + current month
- `"ECB" OR "ESMA" "artificial intelligence"` + current month
- `"France" OR "Germany" OR "Netherlands" "artificial intelligence"` + current week
- `site:euractiv.com artificial intelligence` + current week
- `site:sciencebusiness.net artificial intelligence` + current week

### UK — all sectors

- `"NHS" AI OR "artificial intelligence"` + current week
- `"FCA" "artificial intelligence" OR "AI"` + current month
- `"MHRA" AI OR "artificial intelligence" medical device` + current month
- `"Lloyd's" AI OR "artificial intelligence" insurance` + current month
- `"UK AI Safety Institute" OR "AISI"` + current month
- `"Bank of England" OR "PRA" "artificial intelligence"` + current month
- `"UK" AI pharma OR drug discovery` + current week
- `"UK" AI manufacturing OR semiconductor` + current week
- `site:digitalhealth.net artificial intelligence` + current week
- `site:computerweekly.com artificial intelligence` + current week
- `site:theregister.com artificial intelligence` + current week
- `site:insurancetimes.co.uk artificial intelligence` + current month

## Step 4: Dedup, verify and save

For each search result that passes the editorial quality gate:

### 4a. Dedup — URL match
```bash
grep -rl "ARTICLE_URL" data/verified/ 2>/dev/null
```
If found → skip.

### 4b. Dedup — title similarity
```bash
grep -rl "KEY_PHRASE_FROM_TITLE" data/verified/ 2>/dev/null
```
If a substantially similar story from a different publication exists → skip. Same story, different source adds no editorial value.

### 4c. Date verification
WebFetch the article. Confirm the publication date falls within the newsletter window (Friday–Thursday). Reject anything outside the window.

### 4d. Sector classification
Classify each article into one of the five sectors using the keyword rules from `config/sectors.yaml`:
- Match title + first 800 chars against `required_any_group_1` (AI terms) AND `required_any_group_2` (sector terms)
- If both groups match a sector → assign that sector
- If only group 1 matches (AI terms but no sector match) → assign `general`
- If multiple sectors match → assign the sector with the strongest group 2 match (most keywords hit)

### 4e. Save
Save to `data/verified/{date}/{sector}/{slug}.json`:

```json
{
  "title": "Article title",
  "url": "https://...",
  "source": "Publication name",
  "source_type": "editorial-geographic-sweep",
  "date_published": "YYYY-MM-DD",
  "date_verified_method": "web-search",
  "date_confidence": "high",
  "sector": "general|biopharma|medtech|manufacturing|insurance",
  "snippet": "First 300 characters of full_text",
  "full_text": "Full article text (no HTML)",
  "found_by": ["WebSearch: geographic-sweep {region}"],
  "score_reason": "Geographic gap-fill — {region} {sector} coverage",
  "geographic_region": "ireland|eu|uk"
}
```

Create directories: `mkdir -p data/verified/{date}/{sector}`

Slug: lowercase title, non-alphanumeric to hyphens, truncate at 80 chars.

### Paywalled — skip these domains
bloomberg.com, ft.com, wsj.com, thetimes.co.uk, economist.com, hbr.org, nytimes.com, telegraph.co.uk, theatlantic.com, businesspost.ie, irishtimes.com

### Press release fallback
If an editorially significant story is only available behind a paywall (403/paywall), search for:
1. The company's own press release (investor relations, newsroom page)
2. A wire service version (PR Newswire, Business Wire, GlobeNewswire)
3. A trade publication rewrite

Press releases are acceptable source material when the editorial content behind the paywall is inaccessible, provided the press release contains verifiable facts (not just marketing copy).

## Step 5: Report

```
Geographic coverage (before → after):

Ireland:
  general:       N → N
  insurance:     N → N
  biopharma:     N → N
  medtech:       N → N
  manufacturing: N → N

EU:
  general:       N → N
  insurance:     N → N
  biopharma:     N → N
  medtech:       N → N
  manufacturing: N → N

UK:
  general:       N → N
  insurance:     N → N
  biopharma:     N → N
  medtech:       N → N
  manufacturing: N → N

Articles added: N
  Ireland: N
  EU: N
  UK: N
Duplicates skipped (URL): N
Duplicates skipped (title): N
Outside date window: N
Paywalled (skipped): N
```

## Rules

1. **Editorial relevance is the gate.** Apply FT editor judgement: would a senior executive at a $1bn+ regulated-industry company change a decision based on this story? If not, skip it. Do not pad the corpus with weak geographic stories to hit a number.
2. **Same dedup as all other pipeline stages** — URL grep + title similarity. Never save a duplicate.
3. **Same article schema** — identical JSON structure to automated fetch, editorial-headlines, editorial-sector-search and editorial-discover. The `source_type` field (`editorial-geographic-sweep`) and `geographic_region` field distinguish the provenance.
4. **Same sector classification** — use `config/sectors.yaml` keyword rules. The sector assignment determines where the story appears in the newsletter.
5. **Date verification is mandatory** — reject anything outside the Friday–Thursday newsletter window.
6. **Irish stories matter** — we're based in Ireland. Irish regulatory actions, enterprise AI deployments and funding rounds are front-page material for our audience, not local colour.
7. **EU regulatory stories are high-priority** — EU AI Act enforcement, EIOPA guidance, EMA approvals and CE marking decisions affect every reader in regulated industries.
8. **UK stories bridge US and EU** — FCA, NHS and MHRA actions often preview regulatory patterns that reach the EU. Lloyd's and London market insurance stories are directly relevant.
9. **Every saved article must have a verified, working URL.**
