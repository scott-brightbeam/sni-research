import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  extractHeadlinesFromHtml,
  extractKeywords,
  shouldSkipSource,
  recordSuccess,
  recordFailure,
  loadSourceHealth,
  saveSourceHealth,
} from '../lib/headlines.js';

// ─── extractHeadlinesFromHtml ────────────────────────────────────────────────

describe('extractHeadlinesFromHtml', () => {
  test('extracts headlines with configured selector', () => {
    const html = `
      <html><body>
        <div class="articles">
          <h2 class="post-title"><a href="/1">Artificial Intelligence Transforms Drug Discovery Processes in Biopharma</a></h2>
          <h2 class="post-title"><a href="/2">New Machine Learning Models Improve Manufacturing Quality Control Systems</a></h2>
        </div>
      </body></html>
    `;
    const result = extractHeadlinesFromHtml(html, 'h2.post-title a');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Artificial Intelligence Transforms Drug Discovery Processes in Biopharma');
    expect(result[1]).toBe('New Machine Learning Models Improve Manufacturing Quality Control Systems');
  });

  test('falls back to default selectors when configured selector matches nothing', () => {
    const html = `
      <html><body>
        <article>
          <h2>Global AI Investment Reaches Record Highs in Latest Quarter Report</h2>
          <h2>Insurance Companies Deploy Machine Learning for Claims Processing Automation</h2>
        </article>
      </body></html>
    `;
    // Use a selector that won't match anything
    const result = extractHeadlinesFromHtml(html, 'div.nonexistent-class');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Global AI Investment Reaches Record Highs in Latest Quarter Report');
  });

  test('filters headlines shorter than 30 chars', () => {
    const html = `
      <html><body>
        <article>
          <h2>Short headline here</h2>
          <h2>This Is a Sufficiently Long Headline That Should Pass the Length Filter</h2>
        </article>
      </body></html>
    `;
    const result = extractHeadlinesFromHtml(html, 'article h2');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('This Is a Sufficiently Long Headline That Should Pass the Length Filter');
  });

  test('filters headlines longer than 200 chars', () => {
    const longTitle = 'A'.repeat(201);
    const html = `
      <html><body>
        <article>
          <h2>${longTitle}</h2>
          <h2>This Is a Normal Headline That Fits Within the Maximum Length Requirement</h2>
        </article>
      </body></html>
    `;
    const result = extractHeadlinesFromHtml(html, 'article h2');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('This Is a Normal Headline That Fits Within the Maximum Length Requirement');
  });

  test('deduplicates headlines case-insensitively', () => {
    const html = `
      <html><body>
        <article>
          <h2>Artificial Intelligence Transforms Drug Discovery Processes in Biopharma</h2>
          <h2>artificial intelligence transforms drug discovery processes in biopharma</h2>
          <h2>  Artificial Intelligence Transforms Drug Discovery Processes in Biopharma  </h2>
        </article>
      </body></html>
    `;
    const result = extractHeadlinesFromHtml(html, 'article h2');
    expect(result).toHaveLength(1);
  });

  test('deduplicates headlines that differ only in whitespace', () => {
    const html = `
      <html><body>
        <article>
          <h2>Artificial  Intelligence  Transforms  Drug  Discovery  Biopharma  Industry</h2>
          <h2>Artificial Intelligence Transforms Drug Discovery Biopharma Industry</h2>
        </article>
      </body></html>
    `;
    const result = extractHeadlinesFromHtml(html, 'article h2');
    expect(result).toHaveLength(1);
  });

  test('returns empty array when no headlines found', () => {
    const html = '<html><body><p>No articles here.</p></body></html>';
    const result = extractHeadlinesFromHtml(html, 'h2.post-title');
    expect(result).toEqual([]);
  });
});

// ─── extractKeywords ─────────────────────────────────────────────────────────

describe('extractKeywords', () => {
  test('removes stop words from headline', () => {
    const result = extractKeywords('The Impact of AI on the Future of Healthcare');
    // "the", "of", "on", "the", "of" are stop words
    // remaining: "impact", "ai", "future", "healthcare"
    expect(result).toBe('impact ai future healthcare');
  });

  test('returns at most 7 words', () => {
    const result = extractKeywords(
      'Advanced Robotics Systems Transform Global Manufacturing Supply Chain Operations Significantly',
    );
    const words = result.split(' ');
    expect(words.length).toBeLessThanOrEqual(7);
  });

  test('strips non-alpha characters', () => {
    const result = extractKeywords('AI-Powered Drug Discovery: 2024 Breakthroughs');
    // "aipowered", "drug", "discovery", "breakthroughs" remain (2024 becomes empty after removing non-alpha)
    expect(result).not.toContain('2024');
    expect(result).toContain('drug');
    expect(result).toContain('discovery');
  });

  test('returns empty string for all-stop-words headline', () => {
    const result = extractKeywords('the and or but in on at');
    expect(result).toBe('');
  });
});

// ─── shouldSkipSource ────────────────────────────────────────────────────────

describe('shouldSkipSource', () => {
  test('returns true when consecutiveFailures >= 3', () => {
    const health = new Map([
      ['TestSource', { lastSuccess: null, consecutiveFailures: 3, lastError: 'timeout' }],
    ]);
    expect(shouldSkipSource(health, 'TestSource')).toBe(true);
  });

  test('returns true when consecutiveFailures > 3', () => {
    const health = new Map([
      ['TestSource', { lastSuccess: null, consecutiveFailures: 5, lastError: 'timeout' }],
    ]);
    expect(shouldSkipSource(health, 'TestSource')).toBe(true);
  });

  test('returns false when consecutiveFailures < 3', () => {
    const health = new Map([
      ['TestSource', { lastSuccess: null, consecutiveFailures: 2, lastError: 'timeout' }],
    ]);
    expect(shouldSkipSource(health, 'TestSource')).toBe(false);
  });

  test('returns false when source is not in health map', () => {
    const health = new Map();
    expect(shouldSkipSource(health, 'UnknownSource')).toBe(false);
  });

  test('returns false when consecutiveFailures is 0', () => {
    const health = new Map([
      ['TestSource', { lastSuccess: '2025-01-01T00:00:00Z', consecutiveFailures: 0, lastError: null }],
    ]);
    expect(shouldSkipSource(health, 'TestSource')).toBe(false);
  });
});

// ─── recordSuccess ───────────────────────────────────────────────────────────

describe('recordSuccess', () => {
  test('resets consecutiveFailures to 0', () => {
    const health = new Map([
      ['TestSource', { lastSuccess: null, consecutiveFailures: 5, lastError: 'HTTP 403' }],
    ]);
    recordSuccess(health, 'TestSource');
    const entry = health.get('TestSource');
    expect(entry.consecutiveFailures).toBe(0);
    expect(entry.lastError).toBeNull();
    expect(entry.lastSuccess).toBeTruthy();
  });

  test('sets lastSuccess to a valid ISO string', () => {
    const health = new Map();
    recordSuccess(health, 'NewSource');
    const entry = health.get('NewSource');
    // Should be a valid ISO date string
    expect(() => new Date(entry.lastSuccess)).not.toThrow();
    expect(new Date(entry.lastSuccess).getTime()).not.toBeNaN();
  });
});

// ─── recordFailure ───────────────────────────────────────────────────────────

describe('recordFailure', () => {
  test('increments consecutiveFailures', () => {
    const health = new Map([
      ['TestSource', { lastSuccess: null, consecutiveFailures: 1, lastError: null }],
    ]);
    recordFailure(health, 'TestSource', 'HTTP 500');
    const entry = health.get('TestSource');
    expect(entry.consecutiveFailures).toBe(2);
    expect(entry.lastError).toBe('HTTP 500');
  });

  test('starts from 0 for new source', () => {
    const health = new Map();
    recordFailure(health, 'NewSource', 'timeout');
    const entry = health.get('NewSource');
    expect(entry.consecutiveFailures).toBe(1);
    expect(entry.lastError).toBe('timeout');
    expect(entry.lastSuccess).toBeNull();
  });

  test('preserves lastSuccess on failure', () => {
    const health = new Map([
      ['TestSource', { lastSuccess: '2025-01-01T00:00:00Z', consecutiveFailures: 0, lastError: null }],
    ]);
    recordFailure(health, 'TestSource', 'HTTP 403');
    const entry = health.get('TestSource');
    expect(entry.lastSuccess).toBe('2025-01-01T00:00:00Z');
    expect(entry.consecutiveFailures).toBe(1);
  });
});

// ─── loadSourceHealth / saveSourceHealth ──────────────────────────────────────

describe('source health persistence', () => {
  test('loadSourceHealth returns empty Map when file does not exist', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'headlines-test-'));
    const result = loadSourceHealth(tmpDir);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    rmSync(tmpDir, { recursive: true });
  });

  test('saveSourceHealth then loadSourceHealth round-trips correctly', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'headlines-test-'));

    const health = new Map([
      ['SourceA', { lastSuccess: '2025-06-01T00:00:00Z', consecutiveFailures: 0, lastError: null }],
      ['SourceB', { lastSuccess: null, consecutiveFailures: 2, lastError: 'HTTP 429' }],
    ]);

    saveSourceHealth(tmpDir, health);

    // Verify file exists and is valid JSON
    const filePath = join(tmpDir, 'source-health.json');
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw.SourceA).toBeDefined();
    expect(raw.SourceB.consecutiveFailures).toBe(2);

    // Round-trip
    const loaded = loadSourceHealth(tmpDir);
    expect(loaded).toBeInstanceOf(Map);
    expect(loaded.get('SourceA').consecutiveFailures).toBe(0);
    expect(loaded.get('SourceB').lastError).toBe('HTTP 429');

    rmSync(tmpDir, { recursive: true });
  });
});
