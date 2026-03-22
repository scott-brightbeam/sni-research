/**
 * queries.js — Load and resolve search queries from YAML config
 *
 * Loads search queries organised by layer, resolves template variables
 * ({month}, {year}, {date}) against a date window, and returns labelled
 * query objects ready for the fetch pipeline.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Parse a 'YYYY-MM-DD' string into a Date (local time, noon to avoid DST).
 * @param {string} dateStr
 * @returns {Date}
 */
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Format a Date as "Month D YYYY" (e.g. "March 5 2026").
 * @param {Date} d
 * @returns {string}
 */
function formatHumanDate(d) {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

/**
 * Resolve template variables in a query string.
 *
 * Templates:
 *   {month} — month name from window.end (e.g. "March")
 *   {year}  — year from window.end (e.g. "2026")
 *   {date}  — human-readable date (e.g. "March 5 2026"), used for Layer 4
 *
 * @param {string} queryStr — query string with optional {month}/{year}/{date} templates
 * @param {object} window — { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 * @param {object} [overrides] — optional overrides for template values
 * @param {string} [overrides.month] — override month name
 * @param {string} [overrides.date] — override date string
 * @returns {string}
 */
export function resolveTemplates(queryStr, window, overrides = {}) {
  const endDate = parseDate(window.end);

  const month = overrides.month || MONTH_NAMES[endDate.getMonth()];
  const year = String(endDate.getFullYear());
  const date = overrides.date || formatHumanDate(endDate);

  return queryStr
    .replace(/\{month\}/g, month)
    .replace(/\{year\}/g, year)
    .replace(/\{date\}/g, date);
}

/**
 * Truncate a string to maxLen characters.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen = 50) {
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

/**
 * Check whether the window spans two different months.
 * @param {object} window — { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 * @returns {boolean}
 */
function spansTwoMonths(window) {
  const startDate = parseDate(window.start);
  const endDate = parseDate(window.end);
  return startDate.getMonth() !== endDate.getMonth()
    || startDate.getFullYear() !== endDate.getFullYear();
}

/**
 * Get start and end month names when window crosses a month boundary.
 * @param {object} window
 * @returns {string[]} — [startMonth, endMonth]
 */
function getBoundaryMonths(window) {
  const startDate = parseDate(window.start);
  const endDate = parseDate(window.end);
  return [MONTH_NAMES[startDate.getMonth()], MONTH_NAMES[endDate.getMonth()]];
}

/**
 * Resolve a single query template, duplicating for month boundaries if needed.
 * Returns an array of resolved strings (1 normally, 2 at month boundaries).
 * @param {string} template
 * @param {object} window
 * @param {object} [overrides]
 * @returns {string[]}
 */
function resolveWithBoundary(template, window, overrides = {}) {
  if (spansTwoMonths(window) && template.includes('{month}')) {
    const [startMonth, endMonth] = getBoundaryMonths(window);
    return [
      resolveTemplates(template, window, { ...overrides, month: startMonth }),
      resolveTemplates(template, window, { ...overrides, month: endMonth }),
    ];
  }
  return [resolveTemplates(template, window, overrides)];
}

/**
 * Build Layer 1 queries from sector-keyed config.
 * @param {object} sectorQueries — { sectorName: [queryTemplate, ...], ... }
 * @param {object} window
 * @param {string} freshness
 * @param {string} [sectorFilter] — if set, only include this sector
 * @returns {object[]}
 */
function buildLayer1(sectorQueries, window, freshness, sectorFilter) {
  if (!sectorQueries || typeof sectorQueries !== 'object') return [];

  const results = [];
  for (const [sector, queries] of Object.entries(sectorQueries)) {
    if (sectorFilter && sector !== sectorFilter) continue;
    if (!Array.isArray(queries)) continue;

    for (const template of queries) {
      const resolved = resolveWithBoundary(template, window);
      for (const query of resolved) {
        results.push({
          query,
          label: `L1: ${sector} ${truncate(query)}`,
          sector,
          freshness,
        });
      }
    }
  }
  return results;
}

/**
 * Build Layer 2 queries from source list.
 * @param {object[]} sources — [{ query, name }, ...]
 * @param {object} window
 * @param {string} freshness
 * @returns {object[]}
 */
function buildLayer2(sources, window, freshness) {
  if (!Array.isArray(sources)) return [];

  return sources.map(({ query: template, name }) => {
    const resolved = resolveTemplates(template, window);
    // Extract a short topic from the query (first 50 chars)
    const topic = truncate(resolved);
    return {
      query: resolved,
      label: `L2: ${name} \u2014 ${topic}`,
      freshness,
    };
  });
}

/**
 * Build Layer 3 queries from theme list.
 * @param {string[]} themes — array of query templates
 * @param {object} window
 * @param {string} freshness
 * @returns {object[]}
 */
function buildLayer3(themes, window, freshness) {
  if (!Array.isArray(themes)) return [];

  const results = [];
  for (const template of themes) {
    const resolved = resolveWithBoundary(template, window);
    for (const query of resolved) {
      results.push({
        query,
        label: `L3: ${truncate(query)}`,
        freshness,
      });
    }
  }
  return results;
}

/**
 * Build Layer 4 queries: date-specific variants of Layer 1 queries.
 * Generates queries for the last 3 days (window.end, end-1, end-2).
 * @param {object} sectorQueries — same as Layer 1 input
 * @param {object} window
 * @param {string} freshness
 * @param {string} [sectorFilter]
 * @returns {object[]}
 */
function buildLayer4(sectorQueries, window, freshness, sectorFilter) {
  if (!sectorQueries || typeof sectorQueries !== 'object') return [];

  const endDate = parseDate(window.end);

  // Generate last 3 days: end, end-1, end-2
  const dates = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    dates.push(formatHumanDate(d));
  }

  const results = [];
  for (const [sector, queries] of Object.entries(sectorQueries)) {
    if (sectorFilter && sector !== sectorFilter) continue;
    if (!Array.isArray(queries)) continue;

    for (const template of queries) {
      // For L4, replace {month} {year} pattern with {date}
      const dateTemplate = template
        .replace(/\{month\}\s*\{year\}/g, '{date}')
        .replace(/\{month\}/g, '{date}')
        .replace(/\{year\}/g, '');

      for (const dateStr of dates) {
        const query = resolveTemplates(dateTemplate, window, { date: dateStr });
        results.push({
          query,
          label: `L4: ${sector} ${truncate(query)} ${dateStr}`,
          sector,
          freshness,
        });
      }
    }
  }
  return results;
}

/**
 * Load and resolve all search queries from a parsed YAML config.
 *
 * @param {object} config — parsed YAML config object with keys:
 *   - layer1_sector: { sectorName: [queryTemplate, ...], ... }
 *   - layer2_sources: [{ query, name }, ...]
 *   - layer3_themes: [queryTemplate, ...]
 *   - layer4_enabled: boolean
 *   - freshness: { layer1, layer2, layer3, layer4 }
 * @param {object} window — { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', sector?: string }
 * @returns {{ layer1: object[], layer2: object[], layer3: object[], layer4: object[] }}
 */
export function loadQueries(config, window) {
  const freshness = config.freshness || {};
  const sectorFilter = window.sector || null;

  const layer1 = buildLayer1(
    config.layer1_sector,
    window,
    freshness.layer1,
    sectorFilter,
  );

  const layer2 = buildLayer2(
    config.layer2_sources,
    window,
    freshness.layer2,
  );

  const layer3 = buildLayer3(
    config.layer3_themes,
    window,
    freshness.layer3,
  );

  const layer4 = config.layer4_enabled
    ? buildLayer4(config.layer1_sector, window, freshness.layer4, sectorFilter)
    : [];

  return { layer1, layer2, layer3, layer4 };
}
