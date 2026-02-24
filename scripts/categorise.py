"""
categorise.py - Sector assignment for SNI Research Tool

Assigns a primary sector to an article based on keyword matching.
Primary sector only - no cross-posting.
Cast wide net: over-inclusion is better than missing relevant stories.
"""

import os
import yaml

_sectors_config = None
_config_path = os.path.join(os.path.dirname(__file__), '..', 'config', 'sectors.yaml')


def _load_sectors():
    global _sectors_config
    if _sectors_config is None:
        with open(_config_path, 'r', encoding='utf-8') as f:
            _sectors_config = yaml.safe_load(f)
    return _sectors_config['sectors']


def _contains_any(text, terms):
    """Case-insensitive check if text contains any of the terms."""
    lower = text.lower()
    return any(term.lower() in lower for term in terms)


def _count_boosts(text, terms):
    """Count how many boost terms appear in text."""
    lower = text.lower()
    return sum(1 for term in terms if term.lower() in lower)


def _score_sector(text, sector_def):
    """
    Score text against a sector definition.
    Returns (matches: bool, boost_score: int)
    """
    g1 = sector_def.get('required_any_group_1', [])
    g2 = sector_def.get('required_any_group_2', [])

    if g1 and not _contains_any(text, g1):
        return False, 0
    if g2 and not _contains_any(text, g2):
        return False, 0

    boost_score = _count_boosts(text, sector_def.get('boost', []))
    return True, boost_score


def assign_sector(title, text, source_sector=None):
    """
    Assign primary sector to an article.

    Priority: specific sectors (biopharma, medtech, manufacturing, insurance)
    checked in order with boost scores as tiebreakers. General is fallback.

    IMPORTANT: Matching uses title + first 800 chars of text only.
    This prevents general AI articles that mention sector terms in passing
    from being miscategorised. Sector-relevant articles will have the
    relevant terms in the title and opening paragraphs.

    Args:
        title: Article title
        text: Article full text or snippet
        source_sector: Hint from the RSS feed source sector

    Returns:
        Sector name string, or None if no match
    """
    sectors = _load_sectors()
    # Use title + first 800 chars only - prevents false positives from
    # general AI articles that mention sector terms in passing
    search_text = f'{title} {text}'[:800]

    sector_order = ['biopharma', 'medtech', 'manufacturing', 'insurance']

    # If source sector hint provided and article matches it, prefer that sector
    if source_sector and source_sector not in ('general', 'cross_sector', None):
        sector_def = sectors.get(source_sector)
        if sector_def:
            matches, _ = _score_sector(search_text, sector_def)
            if matches:
                return source_sector

    # Score all specific sectors
    best_sector = None
    best_boost = -1

    for sector_name in sector_order:
        sector_def = sectors.get(sector_name)
        if not sector_def:
            continue
        matches, boost_score = _score_sector(search_text, sector_def)
        if matches and boost_score > best_boost:
            best_sector = sector_name
            best_boost = boost_score

    if best_sector:
        return best_sector

    # Fallback: check general AI keywords
    general_def = sectors.get('general')
    if general_def:
        matches, _ = _score_sector(search_text, general_def)
        if matches:
            return 'general'

    return None  # No match - article should be skipped


def check_off_limits(title, text, off_limits_config):
    """
    Check article against cumulative off-limits list.

    Args:
        title: Article title
        text: Article text or snippet
        off_limits_config: Dict from off-limits.yaml { week_N: [{company, topic}] }

    Returns:
        (blocked: bool, reason: str or None)
    """
    search_text = f'{title} {text}'.lower()[:3000]

    for week, entries in off_limits_config.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            company = (entry.get('company') or '').lower().strip()
            topic = (entry.get('topic') or '').lower().strip()

            if not company:
                continue

            if company not in search_text:
                continue

            # Check topic keywords - at least half of meaningful words must match
            if topic:
                topic_words = [w for w in topic.split() if len(w) > 3]
                if topic_words:
                    matches = sum(1 for w in topic_words if w in search_text)
                    threshold = max(1, len(topic_words) // 2)
                    if matches >= threshold:
                        return True, f'{week}: {entry.get("company")} - {entry.get("topic")}'

    return False, None
