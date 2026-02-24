"""
report.py - Research pack generator for SNI Research Tool

Reads verified articles, groups by sector, checks off-limits,
and generates a markdown research pack.

Usage:
  python scripts/report.py --test
  python scripts/report.py --start-date 2026-02-13 --end-date 2026-02-20
"""

import os
import sys
import io
import json
import argparse
from datetime import datetime, timedelta
from pathlib import Path

# Fix Windows console encoding for Unicode output
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import yaml

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

with open(ROOT / 'config' / 'sectors.yaml', 'r', encoding='utf-8') as f:
    SECTORS_CONFIG = yaml.safe_load(f)['sectors']

with open(ROOT / 'config' / 'off-limits.yaml', 'r', encoding='utf-8') as f:
    OFF_LIMITS = yaml.safe_load(f)

SECTOR_ORDER = ['general', 'biopharma', 'medtech', 'manufacturing', 'insurance']
SECTOR_DISPLAY = {
    'general': 'General AI',
    'biopharma': 'Pharma & Biopharma',
    'medtech': 'MedTech',
    'manufacturing': 'Complex & Advanced Manufacturing',
    'insurance': 'Insurance',
}


def get_date_window(args):
    today = datetime.now().date()
    if args.test:
        start = today - timedelta(days=7)
        return str(start), str(today)
    if args.start_date and args.end_date:
        return args.start_date, args.end_date
    d = str(today)
    return d, d


def get_week_number(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    return d.isocalendar()[1]


def format_date(date_str):
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d')
        return d.strftime('%-d %B %Y') if os.name != 'nt' else d.strftime('%d %B %Y').lstrip('0')
    except Exception:
        return date_str


def load_verified_articles(start_date, end_date):
    """Load all verified article JSONs within the date window."""
    verified_dir = ROOT / 'data' / 'verified'
    if not verified_dir.exists():
        return []

    articles = []
    for date_dir in verified_dir.iterdir():
        if not date_dir.is_dir():
            continue
        if not (start_date <= date_dir.name <= end_date):
            continue
        for sector_dir in date_dir.iterdir():
            if not sector_dir.is_dir():
                continue
            for json_file in sector_dir.glob('*.json'):
                try:
                    article = json.loads(json_file.read_text(encoding='utf-8'))
                    article.pop('_raw_html', None)
                    articles.append(article)
                except Exception:
                    continue

    # Sort: date descending, then title ascending
    articles.sort(key=lambda a: (a.get('date_published', ''), a.get('title', '')),
                  reverse=False)
    articles.sort(key=lambda a: a.get('date_published', ''), reverse=True)
    return articles


def deduplicate(articles):
    seen = set()
    result = []
    for a in articles:
        url = a.get('url', '')
        if url not in seen:
            seen.add(url)
            result.append(a)
    return result


def group_by_sector(articles):
    groups = {}
    for a in articles:
        sector = a.get('sector', 'general')
        groups.setdefault(sector, []).append(a)
    return groups


def check_off_limits_report(articles):
    """Return list of conflicts for reporting."""
    conflicts = []
    for article in articles:
        search_text = f'{article.get("title", "")} {article.get("snippet", "")}'.lower()
        for week, entries in OFF_LIMITS.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                company = (entry.get('company') or '').lower()
                topic = (entry.get('topic') or '').lower()
                if not company or company not in search_text:
                    continue
                topic_words = [w for w in topic.split() if len(w) > 3]
                if topic_words:
                    matches = sum(1 for w in topic_words if w in search_text)
                    if matches >= max(1, len(topic_words) // 2):
                        conflicts.append({
                            'article': article.get('title', ''),
                            'reason': f'{week}: {entry.get("company")} - {entry.get("topic")}',
                        })
    return conflicts


def format_sector_section(sector_articles, display_name):
    """Format a sector's articles as markdown."""
    if not sector_articles:
        return ''
    lines = [f'## {display_name} ({len(sector_articles)} article{"s" if len(sector_articles) != 1 else ""}, all dates verified)\n']
    for i, a in enumerate(sector_articles, 1):
        title = a.get('title', 'Untitled')
        url = a.get('url', '')
        source = a.get('source', '')
        date = a.get('date_published', '')
        method = a.get('date_verified_method', '')
        confidence = a.get('date_confidence', '')
        snippet = (a.get('snippet') or '').replace('\n', ' ').strip()[:300]

        lines.append(f'### Story {i}: {title}')
        lines.append(f'- Source: {source}')
        lines.append(f'- URL: {url}')
        lines.append(f'- Published: {format_date(date)} (verified: {method}, confidence: {confidence})')
        lines.append(f'- Summary: {snippet}')
        lines.append('')
    return '\n'.join(lines)


def generate_report(articles, start_date, end_date):
    """Generate the full research pack markdown."""
    deduped = deduplicate(articles)
    grouped = group_by_sector(deduped)
    week_num = get_week_number(end_date)
    date_range = f'{format_date(start_date)} - {format_date(end_date)}'
    generated = datetime.now().strftime('%d %B %Y %H:%M')
    weeks_checked = ', '.join(k for k in OFF_LIMITS if isinstance(OFF_LIMITS[k], list))

    off_limit_conflicts = check_off_limits_report(deduped)

    lines = [
        f'# SNI Research Pack: Week {week_num}, 2026',
        f'Generated: {generated}',
        f'Date range: {date_range}',
        f'Total verified articles: {len(deduped)}',
        '',
        '---',
        '',
    ]

    # Headlines overview
    lines.append('## Headlines Overview')
    lines.append('')
    for sector in SECTOR_ORDER:
        sector_articles = grouped.get(sector, [])
        if not sector_articles:
            continue
        display = SECTOR_DISPLAY.get(sector, sector)
        lines.append(f'**{display}** ({len(sector_articles)})')
        for a in sector_articles:
            lines.append(f'• {a.get("title", "")} [{a.get("source", "")}, {a.get("date_published", "")}]')
        lines.append('')

    lines.append('---')
    lines.append('')

    # Detailed sector sections
    for sector in SECTOR_ORDER:
        sector_articles = grouped.get(sector, [])
        display = SECTOR_DISPLAY.get(sector, sector)
        section = format_sector_section(sector_articles, display)
        if section:
            lines.append(section)
            lines.append('---')
            lines.append('')

    # Off-limits check
    lines.append('## Off-Limits Check')
    lines.append(f'- Checked against: {weeks_checked}')
    if not off_limit_conflicts:
        lines.append('- Conflicts found: 0 ✓')
    else:
        lines.append(f'- Conflicts found: {len(off_limit_conflicts)} ⚠')
        for c in off_limit_conflicts:
            lines.append(f'  - "{c["article"]}" → {c["reason"]}')
    lines.append('')

    # Stats
    lines.append('## Collection Statistics')
    for sector in SECTOR_ORDER:
        count = len(grouped.get(sector, []))
        display = SECTOR_DISPLAY.get(sector, sector)
        lines.append(f'- {display}: {count} articles')

    return '\n'.join(lines), {
        'total': len(deduped),
        'by_sector': {s: len(grouped.get(s, [])) for s in SECTOR_ORDER},
    }


def main():
    parser = argparse.ArgumentParser(description='SNI Research Report Generator')
    parser.add_argument('--test', action='store_true')
    parser.add_argument('--start-date')
    parser.add_argument('--end-date')
    args = parser.parse_args()

    start_date, end_date = get_date_window(args)

    print()
    print('═' * 49)
    print('  SNI Research Tool - Report')
    print(f'  Date window: {start_date} → {end_date}')
    print('═' * 49)
    print()

    articles = load_verified_articles(start_date, end_date)
    print(f'Found {len(articles)} verified articles in window')

    if not articles:
        print('No articles found. Run fetch.py first.')
        return

    report_md, stats = generate_report(articles, start_date, end_date)

    # Save report
    output_dir = ROOT / 'output'
    output_dir.mkdir(exist_ok=True)
    week_num = get_week_number(end_date)
    suffix = 'test' if args.test else f'week-{week_num}'
    report_path = output_dir / f'{end_date}-{suffix}-research.md'
    report_path.write_text(report_md, encoding='utf-8')

    print()
    print('═' * 49)
    print(f'  Report saved: {report_path}')
    print()
    print('  Articles by sector:')
    for sector, count in stats['by_sector'].items():
        if count > 0:
            display = SECTOR_DISPLAY.get(sector, sector)
            print(f'    {display:<30} {count}')
    print(f'    {"TOTAL":<30} {stats["total"]}')
    print('═' * 49)
    print()

    # Print headline summary to console
    print('── Headline Summary ' + '─' * 30)
    deduped = deduplicate(articles)
    grouped = group_by_sector(deduped)
    for sector in SECTOR_ORDER:
        sector_articles = grouped.get(sector, [])
        if not sector_articles:
            continue
        display = SECTOR_DISPLAY.get(sector, sector)
        print(f'\n{display} ({len(sector_articles)}):')
        for a in sector_articles:
            print(f'  • {a.get("title", "")[:80]} [{a.get("date_published", "")}]')
    print()


if __name__ == '__main__':
    main()
