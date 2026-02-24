"""
verify.py - Date verification for SNI Research Tool

7-method priority cascade to confirm article publication dates.
Date verification is non-negotiable: unverified articles never enter verified/.

Usage: from scripts.verify import verify_date, is_in_window
Returns: dict with keys: date, confidence, method, verified
"""

import re
import json
from datetime import datetime
from bs4 import BeautifulSoup
from dateutil import parser as dateutil_parser

# URL date patterns for known publishers
# BusinessWire: /20260217/  Standard: /2026/02/17/  Dashed: /2026-02-17
URL_DATE_REGEXES = [
    re.compile(r'/(\d{4})(\d{2})(\d{2})/'),          # compact: /20260217/
    re.compile(r'/(\d{4})/(\d{2})/(\d{2})/?'),        # slashes: /2026/02/17/
    re.compile(r'/stories/(\d{4})/(\d{2})/(\d{2})/?'), # /stories/2026/02/17/
    re.compile(r'/(\d{4})-(\d{2})-(\d{2})'),          # dashes: /2026-02-17
]

# Visible date text patterns
VISIBLE_DATE_REGEXES = [
    # February 18, 2026
    re.compile(r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b', re.IGNORECASE),
    # 18 Feb 2026
    re.compile(r'\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{4})\b', re.IGNORECASE),
    # Feb 18, 2026
    re.compile(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2}),?\s+(\d{4})\b', re.IGNORECASE),
    # ISO: 2026-02-18
    re.compile(r'\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b'),
]

MONTH_NAMES = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'jun': '06', 'jul': '07', 'aug': '08', 'sep': '09',
    'oct': '10', 'nov': '11', 'dec': '12',
}


def normalise_date(raw_date):
    """Parse any date string into YYYY-MM-DD. Returns None if unparseable or out of range."""
    if not raw_date:
        return None
    try:
        if isinstance(raw_date, datetime):
            d = raw_date
        else:
            raw_date = str(raw_date).strip()
            d = dateutil_parser.parse(raw_date)
        if 2020 <= d.year <= 2030:
            return d.strftime('%Y-%m-%d')
    except Exception:
        pass
    return None


def parse_url_date(url):
    """Extract date from URL path patterns."""
    for pattern in URL_DATE_REGEXES:
        m = pattern.search(url)
        if not m:
            continue
        try:
            year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2020 <= year <= 2030 and 1 <= month <= 12 and 1 <= day <= 31:
                return f'{year:04d}-{month:02d}-{day:02d}'
        except (ValueError, IndexError):
            continue
    return None


def parse_visible_date(text):
    """Find a date in visible text near article headers."""
    for pattern in VISIBLE_DATE_REGEXES:
        m = pattern.search(text)
        if not m:
            continue
        try:
            groups = m.groups()
            # ISO: YYYY-MM-DD
            if re.match(r'^20\d{2}$', groups[0]):
                year, month, day = groups[0], groups[1], groups[2]
                return f'{year}-{month.zfill(2)}-{day.zfill(2)}'
            # Month name first (February 18, 2026 or Feb 18, 2026)
            month_str = groups[0].lower()[:3]
            if month_str in MONTH_NAMES:
                month = MONTH_NAMES[month_str]
                day = groups[1].zfill(2)
                year = groups[2]
                if 2020 <= int(year) <= 2030:
                    return f'{year}-{month}-{day}'
            # Day first (18 Feb 2026)
            if groups[0].isdigit() and len(groups[0]) <= 2:
                day = groups[0].zfill(2)
                month_str = groups[1].lower()[:3]
                year = groups[2]
                month = MONTH_NAMES.get(month_str)
                if month and 2020 <= int(year) <= 2030:
                    return f'{year}-{month}-{day}'
        except (ValueError, IndexError, KeyError):
            continue
    return None


def extract_jsonld_date(soup):
    """Extract datePublished from schema.org JSON-LD blocks."""
    for script in soup.find_all('script', type='application/ld+json'):
        try:
            raw = script.string or script.get_text()
            if not raw or 'datePublished' not in raw:
                continue
            data = json.loads(raw)
            items = data if isinstance(data, list) else [data]
            for item in items:
                # Handle @graph
                if isinstance(item, dict) and '@graph' in item:
                    items.extend(item['@graph'])
                if isinstance(item, dict):
                    date = item.get('datePublished') or item.get('dateCreated')
                    if date:
                        return str(date)
        except Exception:
            continue
    return None


def verify_date(html, url, rss_date=None, response_headers=None):
    """
    Main date verification function.

    Priority cascade (returns on first successful verification):
    1. RSS pubDate (highest confidence)
    2. schema.org JSON-LD datePublished
    3. Open Graph article:published_time
    4. meta name=date / pubdate
    5. <time datetime="..."> elements
    6. URL date pattern extraction
    7. Visible date text near article header
    8. HTTP Last-Modified header (low confidence)

    Returns dict: {date, confidence, method, verified}
    """
    result_unverified = {'date': None, 'confidence': 'none', 'method': 'unverified', 'verified': False}

    # Method 1: RSS pubDate
    if rss_date:
        d = normalise_date(rss_date)
        if d:
            return {'date': d, 'confidence': 'high', 'method': 'rss-pubdate', 'verified': True}

    if not html:
        return result_unverified

    soup = BeautifulSoup(html, 'lxml')

    # Method 2: schema.org JSON-LD datePublished
    jsonld_date = extract_jsonld_date(soup)
    if jsonld_date:
        d = normalise_date(jsonld_date)
        if d:
            return {'date': d, 'confidence': 'high', 'method': 'schema.org-jsonld', 'verified': True}

    # Method 3: Open Graph article:published_time
    og_date = (
        soup.find('meta', property='article:published_time') or
        soup.find('meta', attrs={'property': 'og:article:published_time'})
    )
    if og_date:
        d = normalise_date(og_date.get('content'))
        if d:
            return {'date': d, 'confidence': 'high', 'method': 'opengraph', 'verified': True}

    # Method 4: meta name tags
    for meta_name in ['date', 'pubdate', 'publish-date', 'publication_date',
                      'article.published', 'published_time']:
        meta = soup.find('meta', attrs={'name': meta_name})
        if meta:
            d = normalise_date(meta.get('content'))
            if d:
                return {'date': d, 'confidence': 'high', 'method': 'meta-name', 'verified': True}

    # Also check itemprop
    for el in soup.find_all(attrs={'itemprop': 'datePublished'}):
        val = el.get('datetime') or el.get('content') or el.get_text()
        if val:
            d = normalise_date(val.strip())
            if d:
                return {'date': d, 'confidence': 'high', 'method': 'itemprop', 'verified': True}

    # Method 5: <time datetime="..."> elements near article content
    time_selectors = [
        ('article', 'time'),
        ('header', 'time'),
    ]
    # Try structured selectors first
    for parent_tag, child_tag in time_selectors:
        for parent in soup.find_all(parent_tag):
            time_el = parent.find(child_tag, datetime=True)
            if time_el:
                d = normalise_date(time_el['datetime'])
                if d:
                    return {'date': d, 'confidence': 'medium-high', 'method': 'time-element', 'verified': True}
    # Fallback: any time element with datetime
    for time_el in soup.find_all('time', datetime=True):
        d = normalise_date(time_el['datetime'])
        if d:
            return {'date': d, 'confidence': 'medium-high', 'method': 'time-element', 'verified': True}

    # Method 6: URL date pattern
    url_date = parse_url_date(url)
    if url_date:
        return {'date': url_date, 'confidence': 'medium', 'method': 'url-pattern', 'verified': True}

    # Method 7: Visible date text near article header
    header_text_parts = []
    for selector in ['article header', 'header', '[class*=article-meta]',
                     '[class*=publish]', '[class*=byline]', '[class*=date]']:
        for el in soup.select(selector)[:2]:
            header_text_parts.append(el.get_text(' ', strip=True))
    # Also first 1000 chars of article
    article = soup.find('article')
    if article:
        header_text_parts.append(article.get_text(' ', strip=True)[:1000])

    header_text = ' '.join(header_text_parts)
    visible_date = parse_visible_date(header_text)
    if visible_date:
        return {'date': visible_date, 'confidence': 'medium', 'method': 'visible-text', 'verified': True}

    # Method 8: HTTP Last-Modified header
    if response_headers:
        last_mod = response_headers.get('Last-Modified') or response_headers.get('last-modified')
        if last_mod:
            d = normalise_date(last_mod)
            if d:
                return {'date': d, 'confidence': 'low', 'method': 'last-modified', 'verified': True}

    return result_unverified


def is_in_window(date_str, start_date, end_date):
    """Check if a YYYY-MM-DD date string falls within the window (inclusive)."""
    if not date_str:
        return False
    return start_date <= date_str <= end_date
