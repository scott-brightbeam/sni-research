import { describe, test, expect } from 'bun:test';
import { resolveTemplates, loadQueries } from '../lib/queries.js';

// ---------------------------------------------------------------------------
// Minimal mock config — 2-3 queries per section
// ---------------------------------------------------------------------------
const mockConfig = {
  freshness: {
    layer1: 'pw',
    layer2: 'pm',
    layer3: 'pw',
    layer4: 'pd',
  },
  layer1_sector: {
    'general-ai': [
      'OpenAI new model release {month} {year}',
      'Anthropic Claude announcement {month} {year}',
    ],
    biopharma: [
      'AI drug discovery biopharma {month} {year}',
    ],
  },
  layer2_sources: [
    { query: 'site:techcrunch.com AI {month} {year}', name: 'TechCrunch' },
    { query: 'site:venturebeat.com AI {month} {year}', name: 'VentureBeat' },
  ],
  layer3_themes: [
    'agentic AI enterprise software {month} {year}',
    'AI regulation EU UK {month} {year}',
  ],
  layer4_enabled: true,
};

const window = { start: '2026-03-02', end: '2026-03-05' };

// ---------------------------------------------------------------------------
// resolveTemplates
// ---------------------------------------------------------------------------
describe('resolveTemplates', () => {
  test('resolves {month} and {year} correctly', () => {
    const result = resolveTemplates(
      'OpenAI news {month} {year}',
      { start: '2026-03-02', end: '2026-03-05' },
    );
    expect(result).toBe('OpenAI news March 2026');
  });

  test('resolves {date} to human-readable date', () => {
    const result = resolveTemplates(
      'Breaking AI news {date}',
      { start: '2026-03-02', end: '2026-03-05' },
    );
    expect(result).toBe('Breaking AI news March 5 2026');
  });

  test('returns string unchanged when no templates present', () => {
    const input = 'AI regulation EU UK 2026';
    const result = resolveTemplates(input, window);
    expect(result).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// loadQueries — Layer 1
// ---------------------------------------------------------------------------
describe('loadQueries Layer 1', () => {
  test('returns correct structure with labels and freshness', () => {
    const { layer1 } = loadQueries(mockConfig, window);

    expect(layer1.length).toBe(3); // 2 general-ai + 1 biopharma

    const first = layer1[0];
    expect(first.query).toBe('OpenAI new model release March 2026');
    expect(first.label).toStartWith('L1: general-ai');
    expect(first.sector).toBe('general-ai');
    expect(first.freshness).toBe('pw');
  });
});

// ---------------------------------------------------------------------------
// loadQueries — Layer 2
// ---------------------------------------------------------------------------
describe('loadQueries Layer 2', () => {
  test('returns source-targeted queries with names', () => {
    const { layer2 } = loadQueries(mockConfig, window);

    expect(layer2.length).toBe(2);

    const tc = layer2[0];
    expect(tc.query).toBe('site:techcrunch.com AI March 2026');
    expect(tc.label).toContain('TechCrunch');
    expect(tc.label).toStartWith('L2:');
    expect(tc.freshness).toBe('pm');
    // Layer 2 should not have a sector property
    expect(tc.sector).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadQueries — Layer 3
// ---------------------------------------------------------------------------
describe('loadQueries Layer 3', () => {
  test('returns theme queries', () => {
    const { layer3 } = loadQueries(mockConfig, window);

    expect(layer3.length).toBe(2);

    const first = layer3[0];
    expect(first.query).toBe('agentic AI enterprise software March 2026');
    expect(first.label).toStartWith('L3:');
    expect(first.freshness).toBe('pw');
    expect(first.sector).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadQueries — Layer 4
// ---------------------------------------------------------------------------
describe('loadQueries Layer 4', () => {
  test('generates date-specific queries from L1 when enabled', () => {
    const { layer4 } = loadQueries(mockConfig, window);

    // 3 L1 queries * 3 dates = 9
    expect(layer4.length).toBe(9);

    // Verify date variants exist
    const queries = layer4.map((q) => q.query);
    expect(queries.some((q) => q.includes('March 5 2026'))).toBe(true);
    expect(queries.some((q) => q.includes('March 4 2026'))).toBe(true);
    expect(queries.some((q) => q.includes('March 3 2026'))).toBe(true);

    // Check structure
    const first = layer4[0];
    expect(first.label).toStartWith('L4:');
    expect(first.sector).toBeDefined();
    expect(first.freshness).toBe('pd');
  });

  test('returns empty array when layer4_enabled is false', () => {
    const disabledConfig = { ...mockConfig, layer4_enabled: false };
    const { layer4 } = loadQueries(disabledConfig, window);
    expect(layer4).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadQueries — month boundary
// ---------------------------------------------------------------------------
describe('loadQueries month boundary', () => {
  test('duplicates queries when window spans two months', () => {
    const boundaryWindow = { start: '2026-02-27', end: '2026-03-05' };
    const { layer1 } = loadQueries(mockConfig, boundaryWindow);

    // 3 base queries * 2 (each duplicated for Feb + Mar) = 6
    expect(layer1.length).toBe(6);

    const queries = layer1.map((q) => q.query);
    expect(queries.some((q) => q.includes('February'))).toBe(true);
    expect(queries.some((q) => q.includes('March'))).toBe(true);
  });

  test('duplicates layer3 queries at month boundary', () => {
    const boundaryWindow = { start: '2026-02-27', end: '2026-03-05' };
    const { layer3 } = loadQueries(mockConfig, boundaryWindow);

    // 2 base L3 queries * 2 months = 4
    expect(layer3.length).toBe(4);

    const queries = layer3.map((q) => q.query);
    expect(queries.some((q) => q.includes('February'))).toBe(true);
    expect(queries.some((q) => q.includes('March'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadQueries — empty/missing sections
// ---------------------------------------------------------------------------
describe('loadQueries empty/missing sections', () => {
  test('handles gracefully with empty arrays', () => {
    const emptyConfig = {
      freshness: { layer1: 'pw', layer2: 'pm', layer3: 'pw', layer4: 'pd' },
      layer4_enabled: false,
    };
    const result = loadQueries(emptyConfig, window);

    expect(result.layer1).toEqual([]);
    expect(result.layer2).toEqual([]);
    expect(result.layer3).toEqual([]);
    expect(result.layer4).toEqual([]);
  });

  test('handles missing freshness gracefully', () => {
    const minimalConfig = {
      layer1_sector: { general: ['AI news {month} {year}'] },
      layer4_enabled: false,
    };
    const result = loadQueries(minimalConfig, window);

    expect(result.layer1.length).toBe(1);
    expect(result.layer1[0].freshness).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadQueries — sector filter
// ---------------------------------------------------------------------------
describe('loadQueries sector filter', () => {
  test('L1 only includes filtered sector when window.sector is set', () => {
    const filteredWindow = { ...window, sector: 'biopharma' };
    const { layer1 } = loadQueries(mockConfig, filteredWindow);

    expect(layer1.length).toBe(1);
    expect(layer1[0].sector).toBe('biopharma');
    expect(layer1[0].query).toBe('AI drug discovery biopharma March 2026');
  });

  test('L4 only includes filtered sector when window.sector is set', () => {
    const filteredWindow = { ...window, sector: 'biopharma' };
    const { layer4 } = loadQueries(mockConfig, filteredWindow);

    // 1 biopharma query * 3 dates = 3
    expect(layer4.length).toBe(3);
    expect(layer4.every((q) => q.sector === 'biopharma')).toBe(true);
  });

  test('L2 and L3 are unaffected by sector filter', () => {
    const filteredWindow = { ...window, sector: 'biopharma' };
    const { layer2, layer3 } = loadQueries(mockConfig, filteredWindow);

    expect(layer2.length).toBe(2);
    expect(layer3.length).toBe(2);
  });
});
