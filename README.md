# SNI Research Tool

Automated AI news research for the SNI newsletter. Scrapes sector-specific RSS feeds and Brave Search, verifies publication dates, saves articles as dated .md files.

## Setup

```bash
cd sni-research
bun install
cp .env.example .env
# Edit .env and add your BRAVE_API_KEY
```

## Usage

```bash
# Test run: last 7 days (validate against known Week 8 stories)
bun scripts/fetch.js --test
bun scripts/report.js --test

# Specific date range
bun scripts/fetch.js --start-date 2026-02-20 --end-date 2026-02-27
bun scripts/report.js --start-date 2026-02-20 --end-date 2026-02-27

# Single sector
bun scripts/fetch.js --test --sector insurance
```

## Output Structure

```
data/
  verified/
    YYYY-MM-DD/
      sector-name/
        article-slug.json    # Metadata + full text
        article-slug.md      # Readable markdown
  raw/
    YYYY-MM-DD/sector-name/  # Raw HTML for re-verification
  flagged/                   # Articles with unverified dates
output/
  YYYY-MM-DD-week-N-research.md  # Research pack for writing session
```

## Date Verification

Every article is verified through a 7-method priority cascade:
1. RSS pubDate (highest confidence)
2. schema.org JSON-LD datePublished
3. Open Graph article:published_time
4. meta name=date / pubdate
5. `<time datetime>` elements
6. URL date pattern (/2026/02/18/)
7. Visible date text near header

Unverified articles go to `data/flagged/` — never to `data/verified/`.

## Configuration

- `config/sources.yaml` — RSS feeds + Brave Search queries + paywall blocklist
- `config/sectors.yaml` — Keyword filters per sector
- `config/off-limits.yaml` — Previously covered stories (update weekly)
