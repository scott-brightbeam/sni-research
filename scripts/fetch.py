"""
fetch.py - Main SNI Research Tool fetcher

Checks RSS feeds and Brave Search, verifies article dates, saves qualified articles.

Usage:
  python scripts/fetch.py --test                                    # Last 7 days
  python scripts/fetch.py --start-date 2026-02-13 --end-date 2026-02-20
  python scripts/fetch.py --sector insurance                        # Single sector only
"""

import os
import sys
import io
import json
import time
import hashlib
import argparse
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Fix Windows console encoding for Unicode output
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import requests
import feedparser
import yaml
from bs4 import BeautifulSoup

# Add project root to path for imports
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from scripts.verify import verify_date, is_in_window
from scripts.categorise import assign_sector, check_off_limits

# ── Config ────────────────────────────────────────────────────────────────────

with open(ROOT / 'config' / 'sources.yaml', 'r', encoding='utf-8') as f:
    SOURCES = yaml.safe_load(f)

with open(ROOT / 'config' / 'off-limits.yaml', 'r', encoding='utf-8') as f:
    OFF_LIMITS = yaml.safe_load(f)

BRAVE_API_KEY = os.environ.get('BRAVE_API_KEY', '')
RATE_LIMIT_SEC = 1.5
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
PAYWALL_DOMAINS = set(SOURCES.get('paywall_domains', []))

# ── Logging ───────────────────────────────────────────────────────────────────

def log(msg):    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}', flush=True)
def ok(msg):     print(f'[{datetime.now().strftime("%H:%M:%S")}] ✓  {msg}', flush=True)
def warn(msg):   print(f'[{datetime.now().strftime("%H:%M:%S")}] ⚠  {msg}', flush=True)
def skip(msg):   print(f'[{datetime.now().strftime("%H:%M:%S")}]    {msg}', flush=True)

# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(text):
    text = re.sub(r'[^\w\s-]', '', text.lower())
    text = re.sub(r'[\s_-]+', '-', text)
    return text[:60].strip('-')

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def is_paywalled(url):
    return any(domain in url for domain in PAYWALL_DOMAINS)

def get_date_window(args):
    today = datetime.now().date()
    if args.test:
        start = today - timedelta(days=7)
        return str(start), str(today)
    if args.start_date and args.end_date:
        return args.start_date, args.end_date
    d = str(today)
    return d, d

# ── HTTP Fetching ─────────────────────────────────────────────────────────────

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
})

def fetch_page(url, timeout=15):
    """Fetch a page. Returns (html, response_headers, error)."""
    try:
        resp = SESSION.get(url, timeout=timeout, allow_redirects=True)
        if resp.status_code in (403, 401, 429):
            return None, None, f'HTTP {resp.status_code}'
        if not resp.ok:
            return None, None, f'HTTP {resp.status_code}'
        return resp.text, dict(resp.headers), None
    except requests.exceptions.Timeout:
        # One retry
        try:
            resp = SESSION.get(url, timeout=timeout, allow_redirects=True)
            if resp.ok:
                return resp.text, dict(resp.headers), None
        except Exception:
            pass
        return None, None, 'Timeout'
    except Exception as e:
        return None, None, str(e)

# ── Article Extraction ────────────────────────────────────────────────────────

def extract_article_text(soup):
    """Extract main article text from BeautifulSoup object."""
    selectors = [
        'article .article-body',
        'article .post-content',
        'article .entry-content',
        '[class*=article-content]',
        '[class*=post-content]',
        '[class*=story-body]',
        'article',
        'main',
        '.content',
    ]
    for sel in selectors:
        el = soup.select_one(sel)
        if el:
            text = el.get_text(' ', strip=True)
            if len(text) > 200:
                return text[:10000]
    return soup.get_text(' ', strip=True)[:10000]

# ── File Saving ───────────────────────────────────────────────────────────────

def save_article(article, sector, stats):
    """Save article to verified/ as JSON + MD, and raw HTML."""
    date_dir = article['date_published']
    verified_dir = ROOT / 'data' / 'verified' / date_dir / sector
    raw_dir = ROOT / 'data' / 'raw' / date_dir / sector
    ensure_dir(verified_dir)
    ensure_dir(raw_dir)

    slug = slugify(article['title'])
    # Avoid filename collisions
    url_hash = hashlib.md5(article['url'].encode()).hexdigest()[:6]
    filename = f'{slug}-{url_hash}'

    # Save JSON metadata (strip raw HTML before JSON)
    json_article = {k: v for k, v in article.items() if k != '_raw_html'}
    (verified_dir / f'{filename}.json').write_text(
        json.dumps(json_article, indent=2, ensure_ascii=False), encoding='utf-8'
    )

    # Save readable MD
    md_content = f"""---
title: {article['title']}
url: {article['url']}
source: {article['source']}
date_published: {article['date_published']}
date_verified_method: {article['date_verified_method']}
date_confidence: {article['date_confidence']}
sector: {sector}
scraped_at: {article['scraped_at']}
---

{article.get('full_text') or article.get('snippet') or ''}
"""
    (verified_dir / f'{filename}.md').write_text(md_content, encoding='utf-8')

    # Save raw HTML
    if article.get('_raw_html'):
        (raw_dir / f'{filename}.html').write_text(
            article['_raw_html'][:500000], encoding='utf-8', errors='replace'
        )

    stats['saved'] += 1
    ok(f'Saved [{sector}] {article["title"][:70]}')


def save_flagged(title, url, source, reason, stats):
    """Save an unverifiable article to flagged/."""
    flagged_dir = ROOT / 'data' / 'flagged'
    ensure_dir(flagged_dir)
    slug = slugify(title or url)
    url_hash = hashlib.md5(url.encode()).hexdigest()[:6]
    (flagged_dir / f'{datetime.now().strftime("%Y-%m-%d")}-{slug}-{url_hash}.json').write_text(
        json.dumps({'title': title, 'url': url, 'source': source, 'flagged_reason': reason}, indent=2),
        encoding='utf-8'
    )
    stats['flagged'] += 1
    skip(f'Flagged: {(title or url)[:60]} — {reason}')

# ── RSS Processing ────────────────────────────────────────────────────────────

def process_rss_feed(feed_url, feed_name, sector, start_date, end_date, stats, seen):
    """Parse an RSS feed, verify dates, save qualifying articles."""
    log(f'RSS [{sector}] {feed_name}')

    try:
        feed = feedparser.parse(feed_url)
        if feed.bozo and not feed.entries:
            warn(f'Failed to parse RSS {feed_url}: {feed.bozo_exception}')
            stats['feed_errors'] += 1
            return
    except Exception as e:
        warn(f'RSS fetch error {feed_url}: {e}')
        stats['feed_errors'] += 1
        return

    log(f'  {len(feed.entries)} items in feed')
    processed = 0

    for entry in feed.entries:
        url = entry.get('link') or entry.get('id')
        if not url or url in seen:
            continue

        # Quick pre-filter: use RSS date before fetching full page
        rss_date = (entry.get('published') or entry.get('updated') or
                    entry.get('dc_date') or entry.get('pubDate'))
        rough_date = None
        if rss_date:
            try:
                from dateutil import parser as dp
                d = dp.parse(rss_date)
                rough_date = d.strftime('%Y-%m-%d')
            except Exception:
                pass

        if rough_date:
            # Allow 1-day slack around window for timezone differences
            slack_start = str((datetime.strptime(start_date, '%Y-%m-%d') - timedelta(days=1)).date())
            slack_end = str((datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)).date())
            if rough_date < slack_start or rough_date > slack_end:
                continue

        if is_paywalled(url):
            stats['paywalled'] += 1
            continue

        seen.add(url)
        time.sleep(RATE_LIMIT_SEC)

        html, headers, error = fetch_page(url)

        # RSS fallback: if article fetch fails but we have reliable RSS data,
        # use RSS pubDate + description instead of discarding the article.
        # This recovers content from 403-blocking sources with good RSS feeds.
        if (error or not html) and rough_date and entry.get('title'):
            rss_summary = (entry.get('summary') or entry.get('description') or
                           entry.get('content', [{}])[0].get('value', '') if entry.get('content') else '')
            rss_summary = BeautifulSoup(rss_summary, 'lxml').get_text(' ', strip=True) if rss_summary else ''

            if rough_date and is_in_window(rough_date, start_date, end_date) and len(rss_summary) > 50:
                title = entry.get('title', '').strip()
                blocked, reason = check_off_limits(title, rss_summary, OFF_LIMITS)
                if blocked:
                    skip(f'Off-limits [{reason}]: {title[:50]}')
                    stats['off_limits'] += 1
                    seen.add(url)
                    continue

                assigned_sector = assign_sector(title, rss_summary,
                                                source_sector=None if sector == 'cross_sector' else sector)
                if assigned_sector:
                    article = {
                        'title': title,
                        'url': url,
                        'source': feed_name,
                        'date_published': rough_date,
                        'date_verified_method': 'rss-pubdate',
                        'date_confidence': 'high',
                        'sector': assigned_sector,
                        'snippet': rss_summary[:300],
                        'full_text': rss_summary,
                        'scraped_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                        'rss_fallback': True,
                        '_raw_html': '',
                    }
                    save_article(article, assigned_sector, stats)
                    processed += 1
                continue

            warn(f'Fetch error {url}: {error}')
            stats['fetch_errors'] += 1
            continue

        if error or not html:
            warn(f'Fetch error {url}: {error}')
            stats['fetch_errors'] += 1
            continue

        # Verify date with RSS date as strong hint
        date_result = verify_date(html, url, rss_date=rss_date, response_headers=headers)
        if not date_result['verified']:
            save_flagged(entry.get('title', ''), url, feed_name, 'date-unverified', stats)
            continue

        if not is_in_window(date_result['date'], start_date, end_date):
            skip(f'Out of window ({date_result["date"]}): {entry.get("title", "")[:50]}')
            continue

        # Extract text and check filters
        soup = BeautifulSoup(html, 'lxml')
        full_text = extract_article_text(soup)
        title = entry.get('title') or soup.find('title') and soup.find('title').get_text() or ''
        title = title.strip()

        blocked, reason = check_off_limits(title, full_text, OFF_LIMITS)
        if blocked:
            skip(f'Off-limits [{reason}]: {title[:50]}')
            stats['off_limits'] += 1
            continue

        assigned_sector = assign_sector(title, full_text,
                                        source_sector=None if sector == 'cross_sector' else sector)
        if not assigned_sector:
            skip(f'No sector match: {title[:50]}')
            continue

        article = {
            'title': title,
            'url': url,
            'source': feed_name,
            'date_published': date_result['date'],
            'date_verified_method': date_result['method'],
            'date_confidence': date_result['confidence'],
            'sector': assigned_sector,
            'snippet': full_text[:300],
            'full_text': full_text,
            'scraped_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            '_raw_html': html,
        }
        save_article(article, assigned_sector, stats)
        processed += 1

    log(f'  Processed {processed} articles from {feed_name}')

# ── Brave Search ──────────────────────────────────────────────────────────────

def search_brave(query):
    """Run a Brave Search query. Returns list of {url, title, snippet}."""
    if not BRAVE_API_KEY:
        return []
    try:
        resp = requests.get(
            'https://api.search.brave.com/res/v1/web/search',
            params={'q': query, 'count': 20, 'freshness': 'pw', 'search_lang': 'en'},
            headers={'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json'},
            timeout=10,
        )
        if not resp.ok:
            warn(f'Brave API {resp.status_code} for: {query}')
            return []
        data = resp.json()
        results = data.get('web', {}).get('results', [])
        return [{'url': r['url'], 'title': r.get('title', ''), 'snippet': r.get('description', '')}
                for r in results]
    except Exception as e:
        warn(f'Brave search error: {e}')
        return []


def process_general_feed(start_date, end_date, stats, seen):
    """Run Brave Search queries for the general AI feed."""
    log('─── General AI Feed (Brave Search) ───')
    if not BRAVE_API_KEY:
        warn('BRAVE_API_KEY not set - general feed skipped')
        return

    queries = SOURCES.get('general_search_queries', [])
    log(f'Running {len(queries)} search queries')

    for query in queries:
        log(f'  Search: {query}')
        time.sleep(RATE_LIMIT_SEC)
        results = search_brave(query)
        log(f'  → {len(results)} results')

        for result in results:
            url = result['url']
            if not url or url in seen:
                continue
            if is_paywalled(url):
                stats['paywalled'] += 1
                continue

            seen.add(url)
            time.sleep(RATE_LIMIT_SEC)

            html, headers, error = fetch_page(url)
            if error or not html:
                stats['fetch_errors'] += 1
                continue

            # NEVER trust Brave's date metadata - always verify from page
            date_result = verify_date(html, url, rss_date=None, response_headers=headers)
            if not date_result['verified']:
                save_flagged(result['title'], url, 'Brave Search', 'date-unverified', stats)
                continue

            if not is_in_window(date_result['date'], start_date, end_date):
                skip(f'Out of window ({date_result["date"]}): {result["title"][:50]}')
                continue

            soup = BeautifulSoup(html, 'lxml')
            full_text = extract_article_text(soup)
            title = (result['title'] or
                     (soup.find('title') and soup.find('title').get_text()) or '').strip()

            blocked, reason = check_off_limits(title, full_text, OFF_LIMITS)
            if blocked:
                skip(f'Off-limits: {title[:50]}')
                stats['off_limits'] += 1
                continue

            assigned_sector = assign_sector(title, full_text, source_sector=None)
            if not assigned_sector:
                continue

            try:
                from urllib.parse import urlparse
                source_domain = urlparse(url).netloc.replace('www.', '')
            except Exception:
                source_domain = url

            article = {
                'title': title,
                'url': url,
                'source': source_domain,
                'date_published': date_result['date'],
                'date_verified_method': date_result['method'],
                'date_confidence': date_result['confidence'],
                'sector': assigned_sector,
                'snippet': full_text[:300],
                'full_text': full_text,
                'scraped_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                '_raw_html': html,
            }
            save_article(article, assigned_sector, stats)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # Load .env manually (no dotenv dependency needed)
    env_path = ROOT / '.env'
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, val = line.partition('=')
                os.environ.setdefault(key.strip(), val.strip())

    global BRAVE_API_KEY
    BRAVE_API_KEY = os.environ.get('BRAVE_API_KEY', '')

    parser = argparse.ArgumentParser(description='SNI Research Fetcher')
    parser.add_argument('--test', action='store_true', help='Test mode: last 7 days')
    parser.add_argument('--start-date', help='Start date YYYY-MM-DD')
    parser.add_argument('--end-date', help='End date YYYY-MM-DD')
    parser.add_argument('--sector', help='Fetch single sector only')
    args = parser.parse_args()

    start_date, end_date = get_date_window(args)

    print()
    print('═' * 49)
    print('  SNI Research Tool - Fetch')
    print(f'  Date window: {start_date} → {end_date}')
    if args.test:
        print('  Mode: TEST (last 7 days)')
    if args.sector:
        print(f'  Sector filter: {args.sector}')
    print('═' * 49)
    print()

    if not BRAVE_API_KEY:
        warn('BRAVE_API_KEY not configured - general feed will be skipped')

    stats = {
        'saved': 0, 'flagged': 0, 'fetch_errors': 0,
        'feed_errors': 0, 'paywalled': 0, 'off_limits': 0,
    }
    seen = set()  # URL deduplication
    start_time = time.time()

    rss_feeds = SOURCES.get('rss_feeds', {})
    sector_order = ['biopharma', 'medtech', 'manufacturing', 'insurance', 'cross_sector']

    # Process RSS feeds
    for sector in sector_order:
        if args.sector and sector not in (args.sector, 'cross_sector'):
            continue
        feeds = rss_feeds.get(sector)
        if not feeds:
            continue
        print()
        log(f'─── Sector: {sector.upper()} ───')
        for feed in feeds:
            process_rss_feed(feed['url'], feed['name'], sector,
                             start_date, end_date, stats, seen)

    # General AI feed via Brave Search
    if not args.sector or args.sector == 'general':
        print()
        process_general_feed(start_date, end_date, stats, seen)

    elapsed = time.time() - start_time
    print()
    print('═' * 49)
    print('  Fetch Complete')
    print(f'  Saved:        {stats["saved"]} articles')
    print(f'  Flagged:      {stats["flagged"]} (date unverified)')
    print(f'  Off-limits:   {stats["off_limits"]}')
    print(f'  Fetch errors: {stats["fetch_errors"]}')
    print(f'  Paywalled:    {stats["paywalled"]}')
    print(f'  Time:         {elapsed:.0f}s')
    print('═' * 49)
    print()

    flag = '--test' if args.test else f'--start-date {start_date} --end-date {end_date}'
    print(f'Run next: python scripts/report.py {flag}')

    # Save run stats
    ensure_dir(ROOT / 'data')
    stats_file = ROOT / 'data' / f'last-run-{end_date}.json'
    stats_file.write_text(json.dumps({
        **stats,
        'window': {'start': start_date, 'end': end_date},
        'elapsed_seconds': round(elapsed, 1),
        'completed_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
    }, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
