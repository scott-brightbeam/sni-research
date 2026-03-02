/**
 * prohibited.js — Canonical source for all prohibited language lists.
 *
 * Shared by benchmark.js (measurement), draft.js and revise.js (post-processing).
 *
 * Exports:
 *   BANNED_WORDS           — 35 adjectives / nouns / verbs
 *   BANNED_PHRASES         — 15 multi-word clichés (single-word adverbs moved to INTENSIFIERS)
 *   BANNED_CONSTRUCTIONS   — 22 { pattern, label } regex objects
 *   BANNED_INTENSIFIERS    — 14 standalone adverbs (safe to auto-remove)
 *   compileBannedPatterns()  → Array<{ pattern: RegExp, label: string }>
 *   flagProhibitedLanguage(text) → { cleaned, autoFixed[], flagged[] }
 */

// ─── Word lists ──────────────────────────────────────────────────────────────

export const BANNED_WORDS = [
  'landscape', 'realm', 'spearheading', 'game-changer', 'game-changing',
  'paradigm shift', 'ecosystem', 'synergy', 'leverage', 'utilize', 'utilise',
  'cutting-edge', 'state-of-the-art', 'best-in-class', 'world-class',
  'next-generation', 'revolutionize', 'revolutionise', 'disrupt', 'transform',
  'harness', 'unlock', 'empower', 'enable', 'drive', 'robust', 'seamless',
  'holistic', 'innovative', 'groundbreaking', 'pioneering', 'trailblazing',
  'streamline', 'delve', 'stakeholder',
];

// Multi-word phrases only — 7 single-word adverbs moved to BANNED_INTENSIFIERS
export const BANNED_PHRASES = [
  'double down', 'lean in', 'move the needle', 'boil the ocean', 'deep dive',
  'circle back', 'low-hanging fruit', 'at the end of the day', 'going forward',
  'in terms of', 'it goes without saying', 'needless to say',
  'it remains to be seen', "it's worth noting", "it's important to note",
];

export const BANNED_CONSTRUCTIONS = [
  { pattern: /this isn't just an?\s+\w+,\s+it's/i, label: "This isn't just X, it's Y" },
  { pattern: /not just \w+[\w\s]* but/i, label: 'not just X but Y' },
  { pattern: /more than just/i, label: 'more than just' },
  { pattern: /less about \w+[\w\s,]* more about/i, label: 'less about X, more about Y' },
  { pattern: /the question isn't/i, label: "The question isn't X, it's Y" },
  { pattern: /the question is no longer whether/i, label: 'the question is no longer whether' },
  { pattern: /think of it as/i, label: 'Think of it as...' },
  { pattern: /in other words/i, label: 'In other words...' },
  { pattern: /simply put/i, label: 'Simply put...' },
  { pattern: /this is where \w+ comes in/i, label: 'This is where X comes in' },
  { pattern: /^enter:/im, label: 'Enter: [solution]' },
  { pattern: /why does this matter\? because/i, label: 'Why does this matter? Because...' },
  { pattern: /imagine a world where/i, label: 'Imagine a world where...' },
  { pattern: /is changing the way we/i, label: 'X is changing the way we Y' },
  { pattern: /here's what you need to know/i, label: "Here's what you need to know" },
  { pattern: /here's the thing/i, label: "Here's the thing:" },
  { pattern: /let's be clear/i, label: "Let's be clear:" },
  { pattern: /let's be honest/i, label: "Let's be honest:" },
  { pattern: /what's interesting is/i, label: "What's interesting is..." },
  { pattern: /what's notable here is/i, label: "What's notable here is..." },
  { pattern: /as we navigate/i, label: 'As we navigate...' },
  { pattern: /on this journey/i, label: 'On this journey...' },
];

// Includes 7 former BANNED_PHRASES entries that are really standalone adverbs
export const BANNED_INTENSIFIERS = [
  'incredibly', 'extremely', 'truly', 'absolutely', 'fundamentally',
  'highly', 'deeply', 'vastly',
  'interestingly', 'notably', 'significantly', 'crucially', 'essentially',
  'ultimately',
];

// ─── Auto-fix classification ─────────────────────────────────────────────────

// Adjectives safe to delete entirely (no replacement needed)
const AUTO_REMOVE_WORDS = [
  'cutting-edge', 'state-of-the-art', 'next-generation', 'groundbreaking',
  'pioneering', 'trailblazing', 'game-changing', 'robust', 'seamless',
  'holistic', 'innovative', 'world-class', 'best-in-class',
];

// Words with specific replacements
const AUTO_REPLACE = [
  { from: 'utilize',       to: 'use' },
  { from: 'utilise',       to: 'use' },
  { from: 'spearheading',  to: 'leading' },
  { from: 'paradigm shift', to: 'shift' },
];

// Words to delete with no replacement
const AUTO_DELETE = [
  'game-changer', 'revolutionize', 'revolutionise',
];

// ─── Compile patterns ────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile all banned items into a flat Array<{ pattern: RegExp, label: string }>.
 * Same shape benchmark.js uses for its COMPILED_BANNED.
 */
export function compileBannedPatterns() {
  const compiled = [];

  for (const word of BANNED_WORDS) {
    compiled.push({ pattern: new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi'), label: word });
  }
  for (const phrase of BANNED_PHRASES) {
    compiled.push({ pattern: new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi'), label: phrase });
  }
  for (const c of BANNED_CONSTRUCTIONS) {
    compiled.push(c);
  }
  for (const word of BANNED_INTENSIFIERS) {
    compiled.push({ pattern: new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi'), label: word });
  }

  return compiled;
}

// ─── Auto-fix + flag ─────────────────────────────────────────────────────────

/**
 * Scan text for prohibited language. Auto-fix what's safe, flag the rest.
 *
 * @param {string} text
 * @returns {{ cleaned: string, autoFixed: string[], flagged: string[] }}
 */
export function flagProhibitedLanguage(text) {
  let cleaned = text;
  const autoFixed = [];
  const flagged = [];

  // 1. Auto-remove intensifiers (all 14 — standalone adverbs)
  for (const word of BANNED_INTENSIFIERS) {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b\\s?`, 'gi');
    if (re.test(cleaned)) {
      autoFixed.push(word);
      cleaned = cleaned.replace(re, '');
    }
  }

  // 2. Auto-remove adjectives
  for (const word of AUTO_REMOVE_WORDS) {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b\\s?`, 'gi');
    if (re.test(cleaned)) {
      autoFixed.push(word);
      cleaned = cleaned.replace(re, '');
    }
  }

  // 3. Auto-delete words (game-changer, revolutionize, revolutionise)
  for (const word of AUTO_DELETE) {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b\\s?`, 'gi');
    if (re.test(cleaned)) {
      autoFixed.push(`${word} → (removed)`);
      cleaned = cleaned.replace(re, '');
    }
  }

  // 4. Auto-replace words
  for (const { from, to } of AUTO_REPLACE) {
    const re = new RegExp(`\\b${escapeRegex(from)}\\b`, 'gi');
    if (re.test(cleaned)) {
      autoFixed.push(`${from} → ${to}`);
      cleaned = cleaned.replace(re, to);
    }
  }

  // 5. Flag context-dependent verbs and nouns (not safe to auto-remove)
  const FLAG_ONLY_WORDS = [
    'drive', 'enable', 'transform', 'disrupt', 'leverage', 'empower',
    'unlock', 'harness', 'streamline', 'delve',
    'ecosystem', 'landscape', 'realm', 'synergy', 'stakeholder',
  ];
  for (const word of FLAG_ONLY_WORDS) {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    if (re.test(cleaned)) {
      flagged.push(word);
    }
  }

  // 6. Flag multi-word phrases
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi');
    if (re.test(cleaned)) {
      flagged.push(phrase);
    }
  }

  // 7. Flag constructions
  for (const { pattern, label } of BANNED_CONSTRUCTIONS) {
    if (pattern.test(cleaned)) {
      flagged.push(label);
    }
  }

  // Cleanup: collapse double spaces, trim lines
  cleaned = cleaned.replace(/  +/g, ' ');
  cleaned = cleaned.replace(/ +$/gm, '');

  return { cleaned, autoFixed, flagged };
}
