Read SPEC.md in this directory first. It contains the full specification. Do not write any code until you have read the entire spec.

BUILD THE SNI RESEARCH TOOL - a Python news research tool that scrapes AI news across 5 sectors, verifies article publication dates, saves articles as .md files with metadata, and generates a research report.

DIRECTORY STRUCTURE (create exactly this):
- config/sources.yaml (RSS feeds + Brave Search queries)
- config/sectors.yaml (keyword definitions per sector)  
- config/off-limits.yaml (weeks 7+8 from SPEC.md)
- scripts/fetch.py (main fetcher - RSS + Brave Search)
- scripts/verify.py (date verification cascade)
- scripts/categorise.py (sector assignment)
- scripts/report.py (research pack generator)
- data/raw/ data/verified/ data/flagged/ data/weekly/ output/ (empty dirs)
- requirements.txt, .env.example, .gitignore, README.md

CRITICAL IMPLEMENTATION RULES:
1. Date verification mandatory - unverified articles go to data/flagged/, never data/verified/
2. RSS feeds primary source - use feedparser, RSS pubDate is highest confidence date
3. Use requests + BeautifulSoup4 for HTML parsing - NOT regex
4. Rate limit: 1.5 second delay between requests minimum
5. Store raw HTML in data/raw/ 
6. Brave Search for general AI feed ONLY - key in .env as BRAVE_API_KEY
7. No paywalled sources - skip on 403, log URL
8. Off-limits check against ALL previous weeks

VERIFY.PY - implement verify_date(html_content, url, rss_date=None):
Priority cascade returning (date_str, confidence, method):
1. rss_date param if provided (high)
2. schema.org JSON-LD datePublished (high)
3. Open Graph article:published_time (high)
4. meta name=date or pubdate (high)
5. <time datetime=...> (medium-high)
6. URL pattern /2026/02/18/ or /20260218/ (medium)
7. Visible date text near header (medium)
8. HTTP Last-Modified (low)

FETCH.PY flags:
- --test: sets date window to last 7 days from today
- --start-date YYYY-MM-DD --end-date YYYY-MM-DD: explicit window
- --sector: run one sector only
- Verbose progress logging throughout

BRAVE SEARCH API:
- Endpoint: https://api.search.brave.com/res/v1/web/search
- Header: X-Subscription-Token from .env BRAVE_API_KEY
- Use freshness=pw (past week) for test runs
- Always verify dates independently from page content - never trust Brave's date metadata

After building all files, run: python scripts/fetch.py --test
This will attempt to fetch real articles. Show the output so we can see if it works.
Then run: python scripts/report.py --test
Show the generated research pack.
