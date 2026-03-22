# Podcast Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate podcast transcripts into the SNI pipeline — automated import, co-pilot awareness, and cross-edition overlap detection.

**Architecture:** A new standalone import script (`scripts/podcast-import.js`) runs daily via launchd, parsing transcripts from `~/Desktop/Podcast Transcripts/`, generating LLM digests, extracting stories from trust sources, and gap-filling missing articles. A shared dedup module (`scripts/lib/dedup.js`) provides two-tier matching used by both the import script and a new overlap checker in the web UI. The co-pilot context assembly is extended to include podcast digests and full transcripts on demand.

**Tech Stack:** Bun, ES modules, Anthropic SDK (`claude-sonnet-4-20250514`), cheerio, js-yaml, date-fns. All packages already installed.

**PRD:** `docs/plans/2026-03-20-podcast-integration-prd.md` — the authoritative reference for all design decisions. When in doubt, defer to the PRD.

---

## Phase 0: Foundation

### Task 1: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Edit the architecture constraints section**

In `CLAUDE.md`, find the line:
```
- All new code goes in `web/`. Pipeline scripts are **never** modified.
```

Replace with:
```
- All new web UI code goes in `web/`. New pipeline scripts may be added to `scripts/`. New config files may be added to `config/`. Existing files in `scripts/` and `config/` are **never** modified.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md: allow new scripts/ and config/ files for podcast integration"
```

---

### Task 2: Create directory structure and config files

**Files:**
- Create: `data/podcasts/.gitkeep`
- Create: `data/podcast-articles/.gitkeep`
- Create: `data/test/.gitkeep`
- Create: `output/overlap-cache/.gitkeep`
- Create: `config/prompts/.gitkeep`
- Create: `config/podcast-trust-sources.yaml`

**Step 1: Create directories**

```bash
mkdir -p data/podcasts data/podcast-articles data/test output/overlap-cache config/prompts
touch data/podcasts/.gitkeep data/podcast-articles/.gitkeep data/test/.gitkeep output/overlap-cache/.gitkeep config/prompts/.gitkeep
```

**Step 2: Write config/podcast-trust-sources.yaml**

```yaml
model: claude-sonnet-4-20250514
transcript_source: ~/Desktop/Podcast Transcripts
overlap_lookback_weeks: 8
trust_sources:
  - name: AI Daily Brief
    slug: ai-daily-brief
    extract_stories: true
  - name: Moonshots
    slug: moonshots
    extract_stories: true
```

**Step 3: Commit**

```bash
git add data/podcasts/.gitkeep data/podcast-articles/.gitkeep data/test/.gitkeep output/overlap-cache/.gitkeep config/prompts/.gitkeep config/podcast-trust-sources.yaml
git commit -m "Add directory structure and trust source config for podcast integration"
```

---

### Task 3: Write prompt template files

**Files:**
- Create: `config/prompts/story-extract.v1.txt`
- Create: `config/prompts/content-match.v1.txt`
- Create: `config/prompts/transcript-digest.v1.txt`

**Step 1: Write story-extract.v1.txt**

Copy the exact prompt text from PRD §6.1. The file starts with `You are a news analyst extracting structured story references...` and ends with `{transcript}`. Use `{transcript}` as the single placeholder.

**Step 2: Write content-match.v1.txt**

Copy from PRD §6.2. Placeholders: `{story_a}`, `{story_b}`.

**Step 3: Write transcript-digest.v1.txt**

Copy from PRD §6.3. Placeholders: `{title}`, `{source}`, `{date}`, `{duration}`, `{transcript}`.

**Step 4: Commit**

```bash
git add config/prompts/
git commit -m "Add v1 prompt templates for story extraction, content matching, and transcript digest"
```

---

## Phase 1: Prompt Development & Calibration

> **This phase MUST complete before any integration code is written.** Prompts are empirically validated and thresholds calibrated against labelled test data.

### Task 4: Assemble labelled test data

**Files:**
- Create: `data/test/story-extract-labels.json`
- Create: `data/test/content-match-labels.json`
- Create: `data/test/digest-labels.json`

**Step 1: Build story-extract labels**

Select 4–6 real AI Daily Brief and Moonshots transcripts from `~/Desktop/Podcast Transcripts/`. Read each transcript manually. For each, create a ground-truth entry:

```json
[
  {
    "filename": "2026-03-18-ai-daily-brief-how-to-use-agent-skills.md",
    "source_path": "~/Desktop/Podcast Transcripts/2026-03-18-ai-daily-brief-how-to-use-agent-skills.md",
    "ground_truth_stories": [
      {
        "headline": "Anthropic maps 28,000+ agent skills into nine categories",
        "entities": ["Anthropic", "Claude"],
        "sector": "general",
        "url": null,
        "confidence": "high"
      }
    ]
  }
]
```

Target: ≥4 transcripts, ≥20 total ground-truth stories. Include one transcript with >8 stories and one with <4.

**Step 2: Build content-match labels**

Extract real story sections from `output/draft-week-*.md` files (weeks 8–11) and real articles from `data/verified/`. Create ~50 manually labelled pairs:

```json
[
  {
    "id": "pair-001",
    "story_a": { "text": "Full section text from draft...", "source": "draft-week-9", "heading": "OpenAI pivots to enterprise" },
    "story_b": { "text": "Full article text...", "source": "verified/week-10/general/openai-enterprise-pivot.json", "heading": "OpenAI's strategic pivot" },
    "label": "same_story",
    "notes": "Same announcement, different framing"
  }
]
```

Categories: ~15 same_story, ~15 related_but_different, ~20 unrelated. Include cross-format pairs (podcast extract vs full article).

**Step 3: Build digest labels**

Select 4–6 transcripts from different podcasts (AI Daily Brief, Moonshots, a16z, Cognitive Revolution). For each, manually identify key stories, best quotes, and themes. Include at least one non-AI-focused episode.

```json
[
  {
    "filename": "2026-03-18-ai-daily-brief-how-to-use-agent-skills.md",
    "source_path": "~/Desktop/Podcast Transcripts/2026-03-18-ai-daily-brief-how-to-use-agent-skills.md",
    "expected_stories": ["Anthropic skill taxonomy", "NVIDIA NemoCloud", "..."],
    "expected_sectors": ["general", "manufacturing"],
    "min_quotes": 2,
    "notes": "Dense episode with many stories"
  }
]
```

**Step 4: Commit**

```bash
git add data/test/
git commit -m "Add labelled test datasets for prompt evaluation"
```

---

### Task 5: Build prompt evaluation harness

**Files:**
- Create: `scripts/tests/prompt-eval.js`

**Step 1: Write the evaluation script**

The script accepts CLI arguments and runs prompts against labelled data:

```javascript
#!/usr/bin/env bun

import { readFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'

const ROOT = join(import.meta.dir, '..', '..')

// Parse CLI args
const args = process.argv.slice(2)
const promptArg = args.find(a => a.startsWith('--prompt='))?.split('=')[1]
const datasetArg = args.find(a => a.startsWith('--dataset='))?.split('=')[1]
const sweepMode = args.includes('--threshold-sweep')

// Load env key (Bun .env bug workaround)
function loadEnvKey(key) {
  if (process.env[key]) return process.env[key]
  try {
    const envFile = readFileSync(join(ROOT, '.env'), 'utf8')
    const match = envFile.match(new RegExp(`^${key}=(.+)$`, 'm'))
    if (match) return match[1].trim()
  } catch {}
  throw new Error(`Missing env key: ${key}`)
}

const client = new Anthropic({ apiKey: loadEnvKey('ANTHROPIC_API_KEY') })
const MODEL = 'claude-sonnet-4-20250514'

function loadAndRenderPrompt(name, vars) {
  let prompt = readFileSync(join(ROOT, 'config', 'prompts', `${name}.txt`), 'utf8')
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{${key}}`, value)
  }
  return prompt
}

async function callLLM(prompt) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  })
  const text = response.content[0].text
  try {
    return JSON.parse(text)
  } catch {
    // Retry once
    const retry = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: text },
        { role: 'user', content: 'Your response was not valid JSON. Please return ONLY a JSON object/array with no other text.' }
      ]
    })
    return JSON.parse(retry.content[0].text)
  }
}

// --- Story Extract Evaluator ---
async function evalStoryExtract(dataset) {
  const labels = JSON.parse(readFileSync(join(ROOT, dataset), 'utf8'))
  let totalRecall = 0, totalPrecision = 0, totalFP = 0

  for (const entry of labels) {
    const transcript = readFileSync(entry.source_path.replace('~', process.env.HOME), 'utf8')
    const prompt = loadAndRenderPrompt('story-extract.v1', { transcript })
    const extracted = await callLLM(prompt)

    const gtHeadlines = new Set(entry.ground_truth_stories.map(s => s.headline.toLowerCase()))
    let matched = 0
    for (const story of extracted) {
      const matchesAny = entry.ground_truth_stories.some(gt =>
        story.headline.toLowerCase().includes(gt.headline.toLowerCase().split(' ').slice(0, 3).join(' '))
      )
      if (matchesAny) matched++
    }

    const recall = matched / entry.ground_truth_stories.length
    const precision = extracted.length > 0 ? matched / extracted.length : 0
    totalRecall += recall
    totalPrecision += precision

    console.log(`\n--- ${entry.filename} ---`)
    console.log(`  Ground truth: ${entry.ground_truth_stories.length} stories`)
    console.log(`  Extracted: ${extracted.length} stories`)
    console.log(`  Matched: ${matched}`)
    console.log(`  Recall: ${(recall * 100).toFixed(1)}%`)
    console.log(`  Precision: ${(precision * 100).toFixed(1)}%`)
  }

  const avgRecall = totalRecall / labels.length
  const avgPrecision = totalPrecision / labels.length
  console.log(`\n=== SUMMARY ===`)
  console.log(`  Avg Recall: ${(avgRecall * 100).toFixed(1)}% (target: >90%)`)
  console.log(`  Avg Precision: ${(avgPrecision * 100).toFixed(1)}% (target: >80%)`)
  console.log(`  ${avgRecall >= 0.9 && avgPrecision >= 0.8 ? '✓ PASS' : '✗ FAIL'}`)
}

// --- Content Match Evaluator ---
async function evalContentMatch(dataset) {
  const labels = JSON.parse(readFileSync(join(ROOT, dataset), 'utf8'))
  let tp = 0, fp = 0, fn = 0, tn = 0

  for (const pair of labels) {
    const prompt = loadAndRenderPrompt('content-match.v1', {
      story_a: pair.story_a.text,
      story_b: pair.story_b.text
    })
    const result = await callLLM(prompt)

    const predicted = result.sameStory
    const actual = pair.label === 'same_story'

    if (predicted && actual) tp++
    else if (predicted && !actual) { fp++; console.log(`  FP: ${pair.id} — ${result.explanation}`) }
    else if (!predicted && actual) { fn++; console.log(`  FN: ${pair.id} — ${result.explanation}`) }
    else tn++
  }

  const fpr = fp / (fp + tn) || 0
  const fnr = fn / (fn + tp) || 0
  console.log(`\n=== SUMMARY ===`)
  console.log(`  TP: ${tp}, FP: ${fp}, FN: ${fn}, TN: ${tn}`)
  console.log(`  False Positive Rate: ${(fpr * 100).toFixed(1)}% (target: <10%)`)
  console.log(`  False Negative Rate: ${(fnr * 100).toFixed(1)}% (target: <5%)`)
  console.log(`  ${fpr < 0.1 && fnr < 0.05 ? '✓ PASS' : '✗ FAIL'}`)
}

// --- Threshold Sweep ---
async function thresholdSweep(dataset) {
  const labels = JSON.parse(readFileSync(join(ROOT, dataset), 'utf8'))

  // Compute pairwise token overlap for all pairs
  function tokenise(text) {
    const stops = new Set(['the','a','an','is','are','was','were','in','on','at','to','for','of','and','or','but','with','by','from','as','it','its','this','that','has','have','had','be','been','will','would','could','should','not','no','do','does','did'])
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length > 1 && !stops.has(t))
  }

  function jaccard(textA, textB) {
    const a = new Set(tokenise(textA))
    const b = new Set(tokenise(textB))
    const intersection = new Set([...a].filter(x => b.has(x)))
    const union = new Set([...a, ...b])
    return union.size === 0 ? 0 : intersection.size / union.size
  }

  // Compute similarity for each pair
  const pairs = labels.map(pair => ({
    id: pair.id,
    similarity: jaccard(pair.story_a.text, pair.story_b.text),
    isSameStory: pair.label === 'same_story'
  }))

  console.log('Threshold | Recall | Tier2 Load | Notes')
  console.log('----------|--------|------------|------')

  for (let threshold = 2; threshold <= 30; threshold++) {
    const t = threshold / 100
    const sent = pairs.filter(p => p.similarity >= t)
    const sameStory = pairs.filter(p => p.isSameStory)
    const caught = sameStory.filter(p => p.similarity >= t)
    const recall = sameStory.length > 0 ? caught.length / sameStory.length : 1
    const flag = recall === 1.0 ? '✓ 100% recall' : ''
    console.log(`  ${threshold.toString().padStart(3)}%     | ${(recall * 100).toFixed(0).padStart(4)}%  |  ${sent.length.toString().padStart(3)}/${pairs.length}    | ${flag}`)
  }
}

// --- Digest Evaluator ---
async function evalDigest(dataset) {
  const labels = JSON.parse(readFileSync(join(ROOT, dataset), 'utf8'))

  for (const entry of labels) {
    const transcript = readFileSync(entry.source_path.replace('~', process.env.HOME), 'utf8')
    // Parse metadata from frontmatter
    const titleMatch = transcript.match(/^# (.+)$/m)
    const sourceMatch = transcript.match(/\*\*Source:\*\* (.+)$/m)
    const dateMatch = transcript.match(/\*\*Date:\*\* (.+)$/m)
    const durationMatch = transcript.match(/\*\*Duration:\*\* (.+)$/m)

    const prompt = loadAndRenderPrompt('transcript-digest.v1', {
      title: titleMatch?.[1] || 'Unknown',
      source: sourceMatch?.[1] || 'Unknown',
      date: dateMatch?.[1] || 'Unknown',
      duration: durationMatch?.[1] || 'Unknown',
      transcript
    })

    const digest = await callLLM(prompt)

    console.log(`\n--- ${entry.filename} ---`)
    console.log(`  Key stories found: ${digest.key_stories?.length || 0} (expected: ${entry.expected_stories.length})`)
    console.log(`  Sector tags: ${JSON.stringify(digest.sector_tags)} (expected: ${JSON.stringify(entry.expected_sectors)})`)
    console.log(`  Quotes: ${digest.notable_quotes?.length || 0} (min: ${entry.min_quotes})`)
    console.log(`  Summary length: ${digest.summary?.length || 0} chars`)
    console.log(`  --- Manual review required for quality score ---`)
  }
}

// --- Main ---
if (sweepMode) {
  await thresholdSweep(datasetArg)
} else if (promptArg === 'story-extract') {
  await evalStoryExtract(datasetArg)
} else if (promptArg === 'content-match') {
  await evalContentMatch(datasetArg)
} else if (promptArg === 'transcript-digest') {
  await evalDigest(datasetArg)
} else {
  console.log('Usage:')
  console.log('  bun scripts/tests/prompt-eval.js --prompt=story-extract --dataset=data/test/story-extract-labels.json')
  console.log('  bun scripts/tests/prompt-eval.js --prompt=content-match --dataset=data/test/content-match-labels.json')
  console.log('  bun scripts/tests/prompt-eval.js --prompt=transcript-digest --dataset=data/test/digest-labels.json')
  console.log('  bun scripts/tests/prompt-eval.js --threshold-sweep --dataset=data/test/content-match-labels.json')
}
```

**Step 2: Verify it runs (help output)**

```bash
bun scripts/tests/prompt-eval.js
```

Expected: Usage text printed.

**Step 3: Commit**

```bash
git add scripts/tests/prompt-eval.js
git commit -m "Add prompt evaluation harness for story extraction, content matching, and digest quality"
```

---

### Task 6: Run prompt evaluation and iterate

**Files:**
- Modify: `config/prompts/story-extract.v1.txt` (potentially → v2, v3)
- Modify: `config/prompts/content-match.v1.txt` (potentially → v2, v3)
- Modify: `config/prompts/transcript-digest.v1.txt` (potentially → v2, v3)
- Create: `config/prompts/thresholds.yaml`
- Create: `config/prompts/story-extract.results.json`
- Create: `config/prompts/content-match.results.json`
- Create: `config/prompts/transcript-digest.results.json`

**Step 1: Run story-extract evaluation**

```bash
bun scripts/tests/prompt-eval.js --prompt=story-extract --dataset=data/test/story-extract-labels.json
```

Targets: Recall >90%, Precision >80%. If FAIL, revise prompt → bump to v2 → re-run. Minimum 3 iterations.

**Step 2: Run content-match evaluation**

```bash
bun scripts/tests/prompt-eval.js --prompt=content-match --dataset=data/test/content-match-labels.json
```

Targets: FNR <5%, FPR <10%. If FAIL, revise prompt → bump to v2 → re-run.

**Step 3: Run threshold sweep**

```bash
bun scripts/tests/prompt-eval.js --threshold-sweep --dataset=data/test/content-match-labels.json
```

Find the threshold achieving 100% recall with minimum Tier 2 load.

**Step 4: Run transcript-digest evaluation**

```bash
bun scripts/tests/prompt-eval.js --prompt=transcript-digest --dataset=data/test/digest-labels.json
```

Manually score each digest 1–5. Target: average ≥4/5.

**Step 5: Write thresholds.yaml with calibrated values**

```yaml
tier1_similarity: 0.12  # determined by threshold sweep
tier2_confidence: 0.65   # determined by content-match eval
calibrated_at: 2026-03-22
dataset_version: "v1"
test_results:
  tier1:
    recall: 1.0
    tier2_load: 23
  tier2:
    false_positive_rate: 0.04
    false_negative_rate: 0.00
```

**Step 6: Save results files**

For each prompt, save final metrics to `config/prompts/<name>.results.json`.

**Step 7: Commit**

```bash
git add config/prompts/
git commit -m "Calibrate prompts and thresholds: story-extract vN, content-match vN, digest vN"
```

---

## Phase 2: Core Libraries

### Task 7: Prompt loader utility — `loadAndRenderPrompt()`

**Files:**
- Create: `scripts/lib/prompt-loader.js`
- Create: `scripts/lib/prompt-loader.test.js`

**Step 1: Write the failing test**

```javascript
// scripts/lib/prompt-loader.test.js
import { describe, it, expect } from 'bun:test'
import { loadAndRenderPrompt } from './prompt-loader.js'

describe('loadAndRenderPrompt', () => {
  it('loads a prompt and replaces placeholders', () => {
    // story-extract.v1.txt has {transcript} placeholder
    const result = loadAndRenderPrompt('story-extract.v1', { transcript: 'TEST_TRANSCRIPT' })
    expect(result).toContain('TEST_TRANSCRIPT')
    expect(result).not.toContain('{transcript}')
    expect(result).toContain('You are a news analyst')
  })

  it('replaces multiple placeholders', () => {
    // content-match.v1.txt has {story_a} and {story_b}
    const result = loadAndRenderPrompt('content-match.v1', {
      story_a: 'STORY_A_TEXT',
      story_b: 'STORY_B_TEXT'
    })
    expect(result).toContain('STORY_A_TEXT')
    expect(result).toContain('STORY_B_TEXT')
    expect(result).not.toContain('{story_a}')
    expect(result).not.toContain('{story_b}')
  })

  it('throws on missing prompt file', () => {
    expect(() => loadAndRenderPrompt('nonexistent', {})).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd scripts/lib && bun test prompt-loader.test.js
```

Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```javascript
// scripts/lib/prompt-loader.js
import { readFileSync } from 'fs'
import { join } from 'path'

const PROMPTS_DIR = join(import.meta.dir, '..', '..', 'config', 'prompts')

/**
 * Load and render a prompt template from config/prompts/.
 * Reads config/prompts/<name>.txt, performs {key} → value replacement.
 * @param {string} name — prompt filename without extension (e.g. 'content-match.v1')
 * @param {object} vars — key-value pairs for replacement
 * @returns {string} Rendered prompt text
 */
export function loadAndRenderPrompt(name, vars) {
  let prompt = readFileSync(join(PROMPTS_DIR, `${name}.txt`), 'utf8')
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{${key}}`, value)
  }
  return prompt
}
```

**Step 4: Run test to verify it passes**

```bash
cd scripts/lib && bun test prompt-loader.test.js
```

Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add scripts/lib/prompt-loader.js scripts/lib/prompt-loader.test.js
git commit -m "feat: add prompt template loader with placeholder replacement"
```

---

### Task 8: Dedup module — `textSimilarity()` and `loadThresholds()`

**Files:**
- Create: `scripts/lib/dedup.js`
- Create: `scripts/lib/dedup.test.js`

**Step 1: Write the failing tests**

```javascript
// scripts/lib/dedup.test.js
import { describe, it, expect } from 'bun:test'
import { textSimilarity, loadThresholds } from './dedup.js'

describe('textSimilarity', () => {
  it('returns 1.0 for identical texts', () => {
    expect(textSimilarity('hello world', 'hello world')).toBe(1.0)
  })

  it('returns 0.0 for completely different texts', () => {
    expect(textSimilarity('apple banana cherry', 'xylophone zebra quilt')).toBe(0.0)
  })

  it('returns value between 0 and 1 for partial overlap', () => {
    const score = textSimilarity(
      'OpenAI launched GPT-5 for enterprise customers',
      'OpenAI released GPT-5 targeting enterprise market'
    )
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('ignores stop words', () => {
    const withStops = textSimilarity('the OpenAI is in the market', 'OpenAI market')
    const withoutStops = textSimilarity('OpenAI market', 'OpenAI market')
    // After stop word removal, both should be similar
    expect(withStops).toBeGreaterThan(0.5)
  })

  it('handles empty strings', () => {
    expect(textSimilarity('', '')).toBe(0)
    expect(textSimilarity('hello', '')).toBe(0)
    expect(textSimilarity('', 'hello')).toBe(0)
  })

  it('is case insensitive', () => {
    expect(textSimilarity('OpenAI GPT', 'openai gpt')).toBe(1.0)
  })
})

describe('loadThresholds', () => {
  it('returns tier1 and tier2 numeric values', () => {
    const t = loadThresholds()
    expect(typeof t.tier1).toBe('number')
    expect(typeof t.tier2).toBe('number')
    expect(t.tier1).toBeGreaterThan(0)
    expect(t.tier1).toBeLessThan(1)
    expect(t.tier2).toBeGreaterThan(0)
    expect(t.tier2).toBeLessThan(1)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd scripts/lib && bun test dedup.test.js
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

```javascript
// scripts/lib/dedup.js
import { readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { loadAndRenderPrompt } from './prompt-loader.js'

const ROOT = join(import.meta.dir, '..', '..')
const THRESHOLDS_PATH = join(ROOT, 'config', 'prompts', 'thresholds.yaml')

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','in','on','at','to','for','of',
  'and','or','but','with','by','from','as','it','its','this','that',
  'has','have','had','be','been','will','would','could','should',
  'not','no','do','does','did','can','may','might','shall'
])

/**
 * Tokenise text: lowercase, strip non-alphanumeric, remove stop words.
 */
function tokenise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

/**
 * Tier 1: normalised token overlap between two texts (Jaccard similarity).
 * @param {string} textA
 * @param {string} textB
 * @returns {number} Similarity score 0.0–1.0
 */
export function textSimilarity(textA, textB) {
  const a = new Set(tokenise(textA))
  const b = new Set(tokenise(textB))
  if (a.size === 0 && b.size === 0) return 0
  const intersection = new Set([...a].filter(x => b.has(x)))
  const union = new Set([...a, ...b])
  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * Load thresholds from config/prompts/thresholds.yaml.
 * @returns {{ tier1: number, tier2: number }}
 */
export function loadThresholds() {
  const raw = readFileSync(THRESHOLDS_PATH, 'utf8')
  const config = yaml.load(raw)
  return {
    tier1: config.tier1_similarity,
    tier2: config.tier2_confidence
  }
}

/**
 * Tier 2: LLM-based content matching.
 * @param {string} contentA
 * @param {string} contentB
 * @param {object} options — { client, model }
 * @returns {Promise<{sameStory: boolean, confidence: number, explanation: string}>}
 */
export async function contentMatch(contentA, contentB, options) {
  const { client, model } = options
  const prompt = loadAndRenderPrompt('content-match.v1', {
    story_a: contentA,
    story_b: contentB
  })

  const response = await client.messages.create({
    model,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].text
  try {
    return JSON.parse(text)
  } catch {
    // Single retry with corrective prompt
    const retry = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: text },
        { role: 'user', content: 'Your response was not valid JSON. Please return ONLY a JSON object with no other text.' }
      ]
    })
    return JSON.parse(retry.content[0].text)
  }
}

/**
 * Full two-tier dedup check against a corpus.
 * @param {object} candidate — { headline, content }
 * @param {Array<object>} corpus — [{ headline, content, metadata }]
 * @param {object} [options] — { client, model, thresholds }
 * @returns {Promise<{matched: boolean, matchedItem: object|null, tier: 1|2, confidence: number, explanation: string}>}
 */
export async function checkDuplicate(candidate, corpus, options = {}) {
  const thresholds = options.thresholds || loadThresholds()
  const candidateText = `${candidate.headline}\n${candidate.content}`

  // Tier 1: find candidates above threshold
  const tier1Candidates = []
  for (const item of corpus) {
    const itemText = `${item.headline}\n${item.content}`
    const similarity = textSimilarity(candidateText, itemText)
    if (similarity >= thresholds.tier1) {
      tier1Candidates.push({ item, similarity })
    }
  }

  if (tier1Candidates.length === 0) {
    return { matched: false, matchedItem: null, tier: 1, confidence: 0, explanation: 'No Tier 1 candidates above threshold' }
  }

  // Sort by similarity descending, check top candidates via Tier 2
  tier1Candidates.sort((a, b) => b.similarity - a.similarity)

  for (const { item, similarity } of tier1Candidates) {
    if (!options.client) {
      // No LLM client — return Tier 1 match only
      return { matched: true, matchedItem: item, tier: 1, confidence: similarity, explanation: 'Tier 1 match (no LLM client for Tier 2)' }
    }

    const result = await contentMatch(candidateText, `${item.headline}\n${item.content}`, {
      client: options.client,
      model: options.model || 'claude-sonnet-4-20250514'
    })

    if (result.sameStory && result.confidence >= thresholds.tier2) {
      return { matched: true, matchedItem: item, tier: 2, confidence: result.confidence, explanation: result.explanation }
    }
  }

  return { matched: false, matchedItem: null, tier: 2, confidence: 0, explanation: 'No Tier 2 matches confirmed' }
}
```

**Step 4: Run test to verify it passes**

```bash
cd scripts/lib && bun test dedup.test.js
```

Expected: All tests PASS. (Note: `loadThresholds` test requires `thresholds.yaml` to exist from Task 6.)

**Step 5: Commit**

```bash
git add scripts/lib/dedup.js scripts/lib/dedup.test.js
git commit -m "feat: add two-tier dedup module with Jaccard similarity and LLM content matching"
```

---

### Task 9: Frontmatter parser

**Files:**
- Create: `scripts/lib/transcript-parser.js`
- Create: `scripts/lib/transcript-parser.test.js`

**Step 1: Write the failing tests**

```javascript
// scripts/lib/transcript-parser.test.js
import { describe, it, expect } from 'bun:test'
import { parseTranscriptFrontmatter } from './transcript-parser.js'

const FULL_FRONTMATTER = `# How to Use Agent Skills

**Date:** 2026-03-18
**Source:** AI Daily Brief
**URL:** https://www.youtube.com/watch?v=abc123
**Duration:** 27 min
**Transcript source:** whisper-api (gpt-4o-mini-transcribe)

---

This is the transcript body...`

const NO_URL = `# Episode Title

**Date:** 2026-03-19
**Source:** Moonshots
**Duration:** 45 min
**Transcript source:** whisper-api

---

Body text here.`

const NEWSLETTER = `# EV Newsletter Issue 42

**Date:** 2026-03-18
**Source:** EV Newsletter
**Duration:** 10 min
**Transcript source:** newsletter

---

Newsletter content...`

const ON_DEMAND = `# Re-transcribed Episode

**Date:** 2026-03-18
**Source:** On-demand request
**Duration:** 30 min
**Transcript source:** whisper-api

---

Body...`

describe('parseTranscriptFrontmatter', () => {
  it('extracts all fields from complete frontmatter', () => {
    const result = parseTranscriptFrontmatter(FULL_FRONTMATTER)
    expect(result.title).toBe('How to Use Agent Skills')
    expect(result.date).toBe('2026-03-18')
    expect(result.source).toBe('AI Daily Brief')
    expect(result.url).toBe('https://www.youtube.com/watch?v=abc123')
    expect(result.duration).toBe('27 min')
    expect(result.transcriptSource).toBe('whisper-api (gpt-4o-mini-transcribe)')
  })

  it('handles missing URL gracefully', () => {
    const result = parseTranscriptFrontmatter(NO_URL)
    expect(result.title).toBe('Episode Title')
    expect(result.url).toBeNull()
  })

  it('detects newsletter type', () => {
    const result = parseTranscriptFrontmatter(NEWSLETTER)
    expect(result.type).toBe('newsletter')
  })

  it('detects on-demand source', () => {
    const result = parseTranscriptFrontmatter(ON_DEMAND)
    expect(result.isOnDemand).toBe(true)
  })

  it('extracts body text after separator', () => {
    const result = parseTranscriptFrontmatter(FULL_FRONTMATTER)
    expect(result.body).toContain('This is the transcript body')
  })

  it('returns null for missing Date field', () => {
    const noDate = `# Title\n**Source:** Something\n---\nBody`
    const result = parseTranscriptFrontmatter(noDate)
    expect(result).toBeNull()
  })

  it('validates date is ISO format', () => {
    const badDate = `# Title\n**Date:** March 18\n**Source:** Something\n---\nBody`
    const result = parseTranscriptFrontmatter(badDate)
    expect(result).toBeNull()
  })

  it('warns on suspiciously short transcript', () => {
    const short = `# Long Episode\n**Date:** 2026-03-18\n**Source:** Test\n**Duration:** 47 min\n---\nShort.`
    const result = parseTranscriptFrontmatter(short)
    expect(result.warnings).toContain(expect.stringContaining('Suspiciously short'))
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd scripts/lib && bun test transcript-parser.test.js
```

**Step 3: Write implementation**

```javascript
// scripts/lib/transcript-parser.js

/**
 * Parse podcast transcript frontmatter from markdown.
 * @param {string} content — full markdown file content
 * @returns {object|null} Parsed fields, or null if missing required fields
 */
export function parseTranscriptFrontmatter(content) {
  const warnings = []

  // Title from H1
  const titleMatch = content.match(/^# (.+)$/m)
  const title = titleMatch?.[1]?.trim() || null

  // Key-value pairs
  const dateMatch = content.match(/\*\*Date:\*\*\s*(.+)$/m)
  const sourceMatch = content.match(/\*\*Source:\*\*\s*(.+)$/m)
  const urlMatch = content.match(/\*\*URL:\*\*\s*(.+)$/m)
  const durationMatch = content.match(/\*\*Duration:\*\*\s*(.+)$/m)
  const transcriptSourceMatch = content.match(/\*\*Transcript source:\*\*\s*(.+)$/m)

  const date = dateMatch?.[1]?.trim() || null
  const source = sourceMatch?.[1]?.trim() || null
  const url = urlMatch?.[1]?.trim() || null
  const duration = durationMatch?.[1]?.trim() || null
  const transcriptSource = transcriptSourceMatch?.[1]?.trim() || null

  // Validate required fields
  if (!date) return null
  if (!source) return null

  // Validate ISO date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(date + 'T00:00:00Z')
  if (isNaN(parsed.getTime())) return null

  // Type detection
  const type = transcriptSource === 'newsletter' ? 'newsletter' : 'podcast'
  const isOnDemand = source === 'On-demand request'

  // Body: everything after the --- separator
  const separatorIndex = content.indexOf('\n---\n')
  const body = separatorIndex >= 0 ? content.slice(separatorIndex + 5).trim() : ''

  // Quality check: short transcript for long episode
  if (body.length < 1000 && duration) {
    const minMatch = duration.match(/(\d+)\s*min/)
    if (minMatch && parseInt(minMatch[1]) > 10) {
      warnings.push(`Suspiciously short transcript (${body.length} chars for ${duration} episode)`)
    }
  }

  return {
    title,
    date,
    source,
    url,
    duration,
    transcriptSource,
    type,
    isOnDemand,
    body,
    warnings
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd scripts/lib && bun test transcript-parser.test.js
```

**Step 5: Commit**

```bash
git add scripts/lib/transcript-parser.js scripts/lib/transcript-parser.test.js
git commit -m "feat: add podcast transcript frontmatter parser with validation and type detection"
```

---

### Task 10: Manifest management

**Files:**
- Create: `scripts/lib/manifest.js`
- Create: `scripts/lib/manifest.test.js`

**Step 1: Write the failing tests**

```javascript
// scripts/lib/manifest.test.js
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { loadManifest, saveManifest, isComplete, acquireImportLock, releaseImportLock } from './manifest.js'

const TEST_DIR = join(import.meta.dir, '..', '..', 'data', 'podcasts', '_test_manifest')

describe('manifest', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns empty object for missing manifest', () => {
    const m = loadManifest(join(TEST_DIR, 'manifest.json'))
    expect(m).toEqual({})
  })

  it('saves and loads manifest with write-validate-swap', () => {
    const path = join(TEST_DIR, 'manifest.json')
    const data = { 'test-file.md': { importedAt: '2026-03-18T07:00:00Z', week: 12 } }
    saveManifest(path, data)
    const loaded = loadManifest(path)
    expect(loaded).toEqual(data)
    // Verify .bak does not exist on first write
    expect(existsSync(path + '.bak')).toBe(false)
  })

  it('creates .bak on subsequent saves', () => {
    const path = join(TEST_DIR, 'manifest.json')
    saveManifest(path, { first: true })
    saveManifest(path, { second: true })
    expect(existsSync(path + '.bak')).toBe(true)
    const bak = JSON.parse(readFileSync(path + '.bak', 'utf8'))
    expect(bak).toEqual({ first: true })
  })

  it('cleans up .tmp on write failure', () => {
    // This tests the error path — we don't force a failure here,
    // just verify the happy path doesn't leave .tmp files
    const path = join(TEST_DIR, 'manifest.json')
    saveManifest(path, { clean: true })
    expect(existsSync(path + '.tmp')).toBe(false)
  })

  it('isComplete returns true when all stages done (non-trust source)', () => {
    expect(isComplete({ digestGenerated: true, isTrustSource: false })).toBe(true)
  })

  it('isComplete returns false when digest missing', () => {
    expect(isComplete({ digestGenerated: false, isTrustSource: false })).toBe(false)
  })

  it('isComplete requires stories for trust sources', () => {
    expect(isComplete({ digestGenerated: true, isTrustSource: true, storiesExtracted: false })).toBe(false)
    expect(isComplete({ digestGenerated: true, isTrustSource: true, storiesExtracted: true })).toBe(true)
  })
})

describe('import lock', () => {
  const lockPath = join(TEST_DIR, '.import.lock')

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    try { releaseImportLock(lockPath) } catch {}
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('acquires and releases lock', () => {
    expect(acquireImportLock(lockPath)).toBe(true)
    expect(existsSync(lockPath)).toBe(true)
    releaseImportLock(lockPath)
    expect(existsSync(lockPath)).toBe(false)
  })

  it('rejects concurrent lock', () => {
    acquireImportLock(lockPath)
    expect(acquireImportLock(lockPath)).toBe(false)
  })

  it('detects stale lock from dead PID', () => {
    // Write lock with PID 99999999 (almost certainly not running)
    writeFileSync(lockPath, JSON.stringify({ pid: 99999999, timestamp: new Date().toISOString() }))
    expect(acquireImportLock(lockPath)).toBe(true)
  })
})
```

**Step 2: Run test to verify fails**

```bash
cd scripts/lib && bun test manifest.test.js
```

**Step 3: Write implementation**

```javascript
// scripts/lib/manifest.js
import { readFileSync, writeFileSync, copyFileSync, renameSync, rmSync, existsSync } from 'fs'

/**
 * Load manifest from disk. Returns empty object if file doesn't exist.
 */
export function loadManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Save manifest using write-validate-swap pattern.
 * (1) Write .tmp, (2) parse back to verify, (3) backup existing, (4) rename.
 */
export function saveManifest(path, data) {
  const tmp = path + '.tmp'
  const bak = path + '.bak'

  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    // Verify round-trip
    JSON.parse(readFileSync(tmp, 'utf8'))
    // Backup existing
    if (existsSync(path)) {
      copyFileSync(path, bak)
    }
    // Swap
    renameSync(tmp, path)
  } catch (err) {
    try { rmSync(tmp) } catch {}
    throw err
  }
}

/**
 * Check if a manifest entry is fully complete (all stages done).
 */
export function isComplete(entry) {
  if (!entry.digestGenerated) return false
  if (entry.isTrustSource && !entry.storiesExtracted) return false
  return true
}

/**
 * Acquire import lockfile. Returns true on success, false if already locked.
 * Stale locks (from dead PIDs) are automatically cleaned up.
 */
export function acquireImportLock(lockPath) {
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
      // Check if PID is still alive
      try {
        process.kill(lock.pid, 0) // signal 0 = check existence
        return false // Process alive — lock is valid
      } catch {
        // PID not running — stale lock, remove it
        rmSync(lockPath)
      }
    } catch {
      rmSync(lockPath)
    }
  }

  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }))
  return true
}

/**
 * Release import lockfile.
 */
export function releaseImportLock(lockPath) {
  if (existsSync(lockPath)) rmSync(lockPath)
}
```

**Step 4: Run test to verify passes**

```bash
cd scripts/lib && bun test manifest.test.js
```

**Step 5: Commit**

```bash
git add scripts/lib/manifest.js scripts/lib/manifest.test.js
git commit -m "feat: add manifest management with write-validate-swap and PID-based lockfile"
```

---

### Task 11: Draft section parser

**Files:**
- Create: `scripts/lib/draft-parser.js`
- Create: `scripts/lib/draft-parser.test.js`

**Step 1: Write the failing tests**

Test against the real newsletter structure from `output/draft-week-9.md`. The parser must identify container headers, story entries (both bare links and H3 headings), and extract heading + body + URLs for each.

```javascript
// scripts/lib/draft-parser.test.js
import { describe, it, expect } from 'bun:test'
import { parseDraftSections } from './draft-parser.js'

const SAMPLE_DRAFT = `## AI

[OpenAI raised $110bn at a $300bn valuation](https://example.com/openai)

This was the biggest funding round in AI history, dwarfing previous records.

[Google DeepMind's new protein model](https://example.com/deepmind)

Researchers unveiled AlphaFold 3 with significant improvements.

## In Biopharma

### Recursion expands AI drug discovery platform

Recursion announced a major expansion of its AI-driven drug discovery capabilities.

### Insilico Medicine reaches Phase II trials

Insilico's AI-discovered drug candidate entered Phase II clinical trials.

## But what set podcast tongues a-wagging?

### AI agents replacing junior analysts

Several podcast hosts discussed the growing trend of AI agents in financial analysis.
`

describe('parseDraftSections', () => {
  it('extracts story entries from bare markdown links', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    const openai = sections.find(s => s.heading.includes('OpenAI'))
    expect(openai).toBeDefined()
    expect(openai.heading).toBe('OpenAI raised $110bn at a $300bn valuation')
    expect(openai.urls).toContain('https://example.com/openai')
    expect(openai.body).toContain('biggest funding round')
    expect(openai.container).toBe('AI')
  })

  it('extracts story entries from H3 headings', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    const recursion = sections.find(s => s.heading.includes('Recursion'))
    expect(recursion).toBeDefined()
    expect(recursion.container).toBe('In Biopharma')
  })

  it('does not include container headers as story entries', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    const containers = sections.filter(s => s.heading === 'AI' || s.heading === 'In Biopharma')
    expect(containers.length).toBe(0)
  })

  it('assigns podcast container correctly', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    const podcast = sections.find(s => s.heading.includes('AI agents'))
    expect(podcast).toBeDefined()
    expect(podcast.container).toContain('podcast')
  })

  it('returns array of {heading, body, urls, container} objects', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    expect(sections.length).toBeGreaterThan(0)
    for (const s of sections) {
      expect(s).toHaveProperty('heading')
      expect(s).toHaveProperty('body')
      expect(s).toHaveProperty('urls')
      expect(s).toHaveProperty('container')
      expect(Array.isArray(s.urls)).toBe(true)
    }
  })

  it('handles empty draft', () => {
    expect(parseDraftSections('')).toEqual([])
  })
})
```

**Step 2: Run test to verify fails**

```bash
cd scripts/lib && bun test draft-parser.test.js
```

**Step 3: Write implementation**

```javascript
// scripts/lib/draft-parser.js

const CONTAINER_PATTERNS = [
  /^## In (Biopharma|Medtech|Manufacturing|Insurance)$/,
  /^## AI$/,
  /^Biopharma$/,
  /^Medtech$/,
  /^Manufacturing$/,
  /^Insurance$/,
  /^## But what set podcast tongues/,
]

const BARE_LINK_RE = /^\[(.+)\]\((https?:\/\/.+)\)$/
const H3_RE = /^### (.+)$/

/**
 * Parse a newsletter draft into story sections.
 * @param {string} markdown — full draft markdown
 * @returns {Array<{heading: string, body: string, urls: string[], container: string}>}
 */
export function parseDraftSections(markdown) {
  if (!markdown.trim()) return []

  const lines = markdown.split('\n')
  const sections = []
  let currentContainer = ''
  let currentSection = null

  function flushSection() {
    if (currentSection) {
      currentSection.body = currentSection.body.trim()
      sections.push(currentSection)
      currentSection = null
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Check for container headers
    const isContainer = CONTAINER_PATTERNS.some(p => p.test(trimmed))
    if (isContainer) {
      flushSection()
      if (/podcast tongues/.test(trimmed)) {
        currentContainer = 'podcast'
      } else {
        currentContainer = trimmed.replace(/^## ?(In )?/, '')
      }
      continue
    }

    // Check for bare markdown link story entry
    const linkMatch = trimmed.match(BARE_LINK_RE)
    if (linkMatch) {
      flushSection()
      currentSection = {
        heading: linkMatch[1],
        body: '',
        urls: [linkMatch[2]],
        container: currentContainer
      }
      continue
    }

    // Check for H3 story entry
    const h3Match = trimmed.match(H3_RE)
    if (h3Match) {
      flushSection()
      currentSection = {
        heading: h3Match[1],
        body: '',
        urls: [],
        container: currentContainer
      }
      continue
    }

    // Body text — append to current section
    if (currentSection && trimmed) {
      currentSection.body += (currentSection.body ? '\n' : '') + trimmed
      // Extract any inline URLs
      const inlineUrls = [...trimmed.matchAll(/\(https?:\/\/[^)]+\)/g)]
      for (const match of inlineUrls) {
        const url = match[0].slice(1, -1)
        if (!currentSection.urls.includes(url)) {
          currentSection.urls.push(url)
        }
      }
    }
  }

  flushSection()
  return sections
}
```

**Step 4: Run test to verify passes**

```bash
cd scripts/lib && bun test draft-parser.test.js
```

**Step 5: Commit**

```bash
git add scripts/lib/draft-parser.js scripts/lib/draft-parser.test.js
git commit -m "feat: add newsletter draft section parser for overlap checker"
```

---

## Phase 3: Import Script

### Task 12: Podcast import script — core

**Files:**
- Create: `scripts/podcast-import.js`

This is the largest single file. It orchestrates: file scanning, frontmatter parsing, editorial week assignment, transcript copying, digest generation, story extraction, gap-fill, manifest management, run summary, and logging.

**Step 1: Write the integration test**

Create `scripts/tests/podcast-import.test.js` that sets up a temporary source directory with fake transcripts, runs the import, and verifies:
- Transcripts copied to `data/podcasts/<date>/<slug>/`
- Manifest updated with correct entries
- Run summary saved to `output/runs/`
- `_pipeline_report.md` skipped
- Already-imported files skipped on second run

The test should mock LLM calls (digest and story extraction) by intercepting the Anthropic client.

**Step 2: Write the import script**

The script follows this structure (see PRD §5.1 for full details):

```javascript
#!/usr/bin/env bun
// scripts/podcast-import.js

import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import yaml from 'js-yaml'

import { parseTranscriptFrontmatter } from './lib/transcript-parser.js'
import { loadManifest, saveManifest, isComplete, acquireImportLock, releaseImportLock } from './lib/manifest.js'
import { loadAndRenderPrompt } from './lib/prompt-loader.js'
import { textSimilarity, contentMatch } from './lib/dedup.js'
import { slugify } from './lib/extract.js'

const ROOT = import.meta.dir.replace(/\/scripts$/, '')

// ... (full implementation per PRD §5.1, §5.2)
// Key functions:
// - loadConfig() — reads config/podcast-trust-sources.yaml
// - scanSourceDirectory() — lists .md files, filters by pattern
// - isTrustSource(source, config) — matches Source field against config
// - generateDigest(transcript, metadata, client, model) — LLM call
// - extractStories(transcript, client, model) — LLM call (trust sources only)
// - gapFill(stories, week, year, client, model) — fetch missing articles
// - writeRunSummary(stats) — save to output/runs/
// - main() — orchestrate all steps
```

Refer to the PRD §5.1 for all processing steps, error handling, logging format, and run summary schema.

**Step 3: Run the integration test**

```bash
bun scripts/tests/podcast-import.test.js
```

**Step 4: Manual smoke test with real transcripts**

```bash
bun scripts/podcast-import.js
```

Verify: logs show expected output, manifest created, digests generated.

**Step 5: Commit**

```bash
git add scripts/podcast-import.js scripts/tests/podcast-import.test.js
git commit -m "feat: add podcast import script with digest generation, story extraction, and gap-fill"
```

---

### Task 13: Launchd plist

**Files:**
- Create: `com.sni.podcast-import.plist`

**Step 1: Write the plist**

Copy the exact XML from PRD §5.1. Key values:
- Label: `com.sni.podcast-import`
- Program: `/Users/scott/.bun/bin/bun /Users/scott/Projects/sni-research-v2/scripts/podcast-import.js`
- Hour: 7, Minute: 0 (daily at 07:00)
- WorkingDirectory: `/Users/scott/Projects/sni-research-v2`
- Logs: `logs/podcast-import.log` and `logs/podcast-import-error.log`
- Nice: 10

**Step 2: Commit (do NOT load into launchd yet — that happens at deployment)**

```bash
git add com.sni.podcast-import.plist
git commit -m "Add launchd plist for daily podcast import at 07:00"
```

---

## Phase 4: API Layer

### Task 14: Podcast API routes

**Files:**
- Create: `web/api/routes/podcasts.js`
- Create: `web/api/tests/podcasts.test.js`
- Modify: `web/api/server.js` (add route entries)

**Step 1: Write the failing tests**

```javascript
// web/api/tests/podcasts.test.js
import { describe, it, expect } from 'bun:test'
import { handleGetPodcasts, handleGetTranscript } from '../routes/podcasts.js'

describe('GET /api/podcasts', () => {
  it('returns episodes for a given week', async () => {
    // This test requires data/podcasts/manifest.json to exist
    // with test fixtures — set up in beforeEach
  })

  it('returns empty array for week with no episodes', async () => {
    // week 99 should have no data
  })

  it('includes digest data in each episode', async () => {
    // Verify digest field is populated
  })
})

describe('GET /api/podcasts/transcript', () => {
  it('returns full transcript text for valid triple', async () => {
    // ?date=2026-03-18&source=ai-daily-brief&title=how-to-use-agent-skills
  })

  it('returns 404 for missing transcript', async () => {
    // Invalid path
  })

  it('prevents path traversal', async () => {
    // source=../../etc should fail validation
  })
})
```

**Step 2: Implement the route handlers**

```javascript
// web/api/routes/podcasts.js
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { validateParam } from '../lib/walk.js'

const DATA_DIR = join(import.meta.dir, '..', '..', '..', 'data')

export function handleGetPodcasts(req, url) {
  const week = parseInt(url.searchParams.get('week'))
  if (!week) return new Response(JSON.stringify({ error: 'week required' }), { status: 400 })

  const manifestPath = join(DATA_DIR, 'podcasts', 'manifest.json')
  let manifest = {}
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch {}

  const episodes = Object.values(manifest)
    .filter(e => e.week === week)
    .map(e => {
      let digest = null
      try { digest = JSON.parse(readFileSync(join(DATA_DIR, '..', e.digestPath), 'utf8')) } catch {}
      return { ...e, digest }
    })

  // Find latest run summary
  // ... read from output/runs/podcast-import-*.json

  return new Response(JSON.stringify({ week, episodes }), {
    headers: { 'Content-Type': 'application/json' }
  })
}

export function handleGetTranscript(req, url) {
  const date = url.searchParams.get('date')
  const source = url.searchParams.get('source')
  const title = url.searchParams.get('title')

  // Validate all params
  try {
    validateParam(date, /^\d{4}-\d{2}-\d{2}$/)
    validateParam(source)
    validateParam(title)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid parameters' }), { status: 400 })
  }

  const path = join(DATA_DIR, 'podcasts', date, source, `${title}.md`)
  if (!existsSync(path)) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  }

  const transcript = readFileSync(path, 'utf8')
  // Parse metadata from frontmatter
  // ... return { transcript, metadata }

  return new Response(JSON.stringify({ transcript }), {
    headers: { 'Content-Type': 'application/json' }
  })
}
```

**Step 3: Add route entries to server.js**

Add these lines to the routing section of `web/api/server.js`:

```javascript
// Podcast routes
if (path === '/api/podcasts' && method === 'GET') return handleGetPodcasts(req, url)
if (path === '/api/podcasts/transcript' && method === 'GET') return handleGetTranscript(req, url)
```

Import at the top:
```javascript
import { handleGetPodcasts, handleGetTranscript } from './routes/podcasts.js'
```

**Step 4: Run tests**

```bash
cd web/api && bun test podcasts.test.js
```

**Step 5: Commit**

```bash
git add web/api/routes/podcasts.js web/api/tests/podcasts.test.js web/api/server.js
git commit -m "feat: add podcast API routes (GET /api/podcasts, GET /api/podcasts/transcript)"
```

---

### Task 15: Overlap checker API endpoint

**Files:**
- Modify: `web/api/routes/draft.js` (add handleCheckOverlap)
- Modify: `web/api/server.js` (add route entry)
- Modify: `web/api/tests/draft.test.js` (add overlap tests)

**Step 1: Write the failing tests**

Test the overlap checker with mock data: create temporary draft files, run the checker, verify result structure.

**Step 2: Implement handleCheckOverlap**

The handler:
1. Reads the current week's draft
2. Parses it into sections using `parseDraftSections()`
3. Loads archived drafts (lookback N weeks, published preferred over draft)
4. Parses archives into sections, caches in `output/overlap-cache/`
5. Runs Tier 1 scan across all current × archived pairs
6. For Tier 1 candidates (≤20), runs Tier 2 LLM check via `contentMatch()`
7. Returns the overlap report JSON (see PRD §5.5)

Import `parseDraftSections` from `../../scripts/lib/draft-parser.js` and `textSimilarity`/`contentMatch`/`loadThresholds` from `../../scripts/lib/dedup.js`.

**Step 3: Add route entry to server.js**

```javascript
if (path === '/api/draft/check-overlap' && method === 'POST') return handleCheckOverlap(req, url)
```

Import `handleCheckOverlap` from `./routes/draft.js`.

**Step 4: Run tests**

```bash
cd web/api && bun test draft.test.js
```

**Step 5: Commit**

```bash
git add web/api/routes/draft.js web/api/server.js web/api/tests/draft.test.js
git commit -m "feat: add overlap checker API endpoint (POST /api/draft/check-overlap)"
```

---

### Task 16: Co-pilot context integration

**Files:**
- Modify: `web/api/lib/context.js`
- Modify: `web/api/tests/context.test.js`

**Step 1: Write the failing tests**

- `TOKEN_BUDGET` should be `64000` (not `28000` or `30000`)
- `buildPodcastContext(week, year)` should return markdown block of digests
- `loadArticlesForWeek(week, year)` should read from both `data/verified/` and `data/podcast-articles/`
- `assembleContext()` should include podcast digests in output
- Priority-based truncation: thread history truncated first, then podcast digests, then article context

**Step 2: Implement changes**

1. Change `TOKEN_BUDGET` to `64000`
2. Add `buildPodcastContext(week, year)`:
   - Read manifest, filter by week
   - Load each digest JSON
   - Format as compressed markdown (see PRD §5.4 format)
   - Return `{ text, tokenCount }`
3. Update `loadArticlesForWeek(week, year)`:
   - After reading `data/verified/`, also read `data/podcast-articles/`
   - Merge both sets; add `source_type: 'podcast-extract'` for articles with `found_by` containing `'podcast-extract'`
4. Restructure `assembleContext()`:
   - Compute each block with its token count
   - Apply priority-based truncation if total exceeds budget
   - Add podcast digests between article context and injected full text

**Step 3: Add `loadPodcastFullText(date, podcastSlug, titleSlug)`**

Reads full transcript from `data/podcasts/`, capped at 16,000 characters.

**Step 4: Run tests**

```bash
cd web/api && bun test context.test.js
```

Ensure all existing tests still pass:
```bash
cd web/api && bun test
```

**Step 5: Commit**

```bash
git add web/api/lib/context.js web/api/tests/context.test.js
git commit -m "feat: integrate podcast context into co-pilot (64k budget, digests, full transcript on demand)"
```

---

### Task 17: Chat endpoint — podcastRef support

**Files:**
- Modify: `web/api/routes/chat.js`
- Modify: `web/api/tests/chat.test.js`

**Step 1: Write the failing tests**

- Chat with `podcastRef` should inject full transcript into context
- `podcastRef` should be persisted in thread history JSONL
- `podcastRef` format: `{ date, source, title }`
- Sending both `articleRef` and `podcastRef` simultaneously should use `podcastRef` (only one at a time)

**Step 2: Implement changes**

1. In the request body destructuring, add `podcastRef` alongside `articleRef`
2. If `podcastRef` is present, call `loadPodcastFullText(podcastRef.date, podcastRef.source, podcastRef.title)` and inject into context
3. Persist `podcastRef` in thread history JSONL (same pattern as `articleRef` on line 333)
4. Update `COPILOT_SYSTEM` prompt text (see PRD §5.4)

**Step 3: Run tests**

```bash
cd web/api && bun test chat.test.js
```

**Step 4: Run full test suite**

```bash
cd web/api && bun test
```

**Step 5: Commit**

```bash
git add web/api/routes/chat.js web/api/tests/chat.test.js
git commit -m "feat: add podcastRef support to chat endpoint with thread persistence"
```

---

### Task 18: Status endpoint — podcast import field

**Files:**
- Modify: `web/api/routes/status.js`
- Modify: `web/api/tests/status.test.js`

**Step 1: Add podcastImport to status response**

Read from `output/runs/podcast-import-*.json` (latest by date) and `data/podcasts/manifest.json`. Return:

```json
{
  "podcastImport": {
    "lastRun": "2026-03-20T07:02:32.000Z",
    "episodesThisWeek": 14,
    "storiesGapFilled": 5,
    "warnings": ["No URL in frontmatter for ..."]
  }
}
```

**Step 2: Run tests**

```bash
cd web/api && bun test status.test.js
```

**Step 3: Commit**

```bash
git add web/api/routes/status.js web/api/tests/status.test.js
git commit -m "feat: add podcast import status to dashboard API"
```

---

### Task 19: Articles endpoint — podcast-articles merge

**Files:**
- Modify: `web/api/routes/articles.js`
- Modify: `web/api/tests/articles.test.js`

**Step 1: Update articles endpoint to read from both directories**

The `GET /api/articles?week={N}` handler currently reads only `data/verified/`. Update it to also read `data/podcast-articles/` and synthesise `source_type: 'podcast-extract'` from the `found_by` field.

**Step 2: Run tests**

```bash
cd web/api && bun test articles.test.js
```

**Step 3: Commit**

```bash
git add web/api/routes/articles.js web/api/tests/articles.test.js
git commit -m "feat: merge podcast-articles into articles endpoint with source_type field"
```

---

## Phase 5: UI

### Task 20: Dashboard — Podcast Status card

**Files:**
- Modify: `web/app/src/pages/Dashboard.jsx`
- Modify: `web/app/src/pages/Dashboard.module.css` (if needed)

**Step 1: Add podcast status card**

Follow the existing card pattern in Dashboard.jsx. Data comes from `useStatus()` hook which already calls `GET /api/status`.

Display:
- Episodes imported this week (count)
- Last import timestamp
- Stories gap-filled (count)
- Warnings (expandable)

**Step 2: Verify in browser**

```bash
cd web/app && bun run dev
```

Open http://localhost:5173 — verify card appears on dashboard.

**Step 3: Commit**

```bash
git add web/app/src/pages/Dashboard.jsx web/app/src/pages/Dashboard.module.css
git commit -m "feat: add podcast import status card to dashboard"
```

---

### Task 21: Co-pilot — Podcast Picker

**Files:**
- Modify: `web/app/src/pages/Copilot.jsx`
- Modify: `web/app/src/pages/Copilot.module.css`
- Create: `web/app/src/hooks/usePodcasts.js`

**Step 1: Create usePodcasts hook**

```javascript
// web/app/src/hooks/usePodcasts.js
import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api.js'

export function usePodcasts(week) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (!week) { setLoading(false); return }

    const fetchPodcasts = async () => {
      try {
        setLoading(true)
        const response = await apiFetch(`/api/podcasts?week=${week}`)
        if (mountedRef.current) setData(response)
      } catch (err) {
        if (mountedRef.current) setError(err.message)
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    }
    fetchPodcasts()
    return () => { mountedRef.current = false }
  }, [week])

  return { data, loading, error }
}
```

**Step 2: Extend the article picker in Copilot.jsx**

Add a 'Podcasts' divider and subsection within the existing picker dropdown (around lines 159–185). Add `podcastRef` state parallel to `articleRef`. When a podcast is selected, pass `podcastRef` to the chat API call.

**Step 3: Verify in browser**

Open co-pilot page, confirm podcast episodes appear in picker.

**Step 4: Commit**

```bash
git add web/app/src/pages/Copilot.jsx web/app/src/pages/Copilot.module.css web/app/src/hooks/usePodcasts.js
git commit -m "feat: add podcast picker to co-pilot with full transcript injection"
```

---

### Task 22: Draft Editor — Overlap Checker UI

**Files:**
- Modify: `web/app/src/pages/Draft.jsx`
- Modify: `web/app/src/pages/Draft.module.css`
- Create: `web/app/src/hooks/useOverlapCheck.js`

**Step 1: Create useOverlapCheck hook**

```javascript
// web/app/src/hooks/useOverlapCheck.js
import { useState, useRef } from 'react'
import { apiPost } from '../lib/api.js'

export function useOverlapCheck(week) {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  const check = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiPost(`/api/draft/check-overlap?week=${week}`)
      if (mountedRef.current) setResults(response)
    } catch (err) {
      if (mountedRef.current) setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  return { check, loading, results, error }
}
```

**Step 2: Add 'Check Overlap' button to Draft toolbar**

Position next to the existing review pill. Shows spinner during check.

**Step 3: Add overlap results slide-out panel**

Follow the `DraftChatPanel` pattern — CSS class toggle with `open` class for animation. Display overlap cards as described in PRD §5.5:
- Current section heading (clickable)
- Matched section heading + week number
- Confidence badge (colour-coded via tokens)
- LLM explanation
- Dismiss button

**Step 4: Verify in browser**

Open draft editor, click 'Check Overlap', verify panel appears with results.

**Step 5: Commit**

```bash
git add web/app/src/pages/Draft.jsx web/app/src/pages/Draft.module.css web/app/src/hooks/useOverlapCheck.js
git commit -m "feat: add overlap checker UI to draft editor with slide-out results panel"
```

---

## Phase 6: Verification & Deployment

### Task 23: Run full test suite

**Files:** None (verification only)

**Step 1: Run API tests**

```bash
cd web/api && bun test
```

Expected: All tests pass (existing 68 + new tests). If any existing tests break due to TOKEN_BUDGET change or loadArticlesForWeek changes, update them.

**Step 2: Run Vite build**

```bash
cd web/app && bun run build
```

Expected: 0 errors.

**Step 3: Manual end-to-end smoke test**

1. Run `bun scripts/podcast-import.js` — verify transcripts imported, digests created, manifest populated
2. Start API server: `bun --watch web/api/server.js`
3. Start Vite: `cd web/app && bun run dev`
4. Visit dashboard — verify podcast status card shows import data
5. Visit co-pilot — verify podcast picker lists episodes, selecting one injects transcript
6. Visit draft editor — click 'Check Overlap', verify results
7. Check `data/podcasts/manifest.json` — verify structure matches PRD §5.1
8. Check `output/runs/podcast-import-*.json` — verify run summary

**Step 4: Commit any fixes**

---

### Task 24: Deploy launchd job

**Step 1: Symlink plist**

```bash
ln -s /Users/scott/Projects/sni-research-v2/com.sni.podcast-import.plist ~/Library/LaunchAgents/
```

**Step 2: Load into launchd**

```bash
launchctl load ~/Library/LaunchAgents/com.sni.podcast-import.plist
```

**Step 3: Verify**

```bash
launchctl list | grep podcast
```

Expected: `com.sni.podcast-import` appears in the list.

---

## Parallel task map

```
Phase 0 (Tasks 1-3)     ─── sequential, 15 min
         │
Phase 1 (Tasks 4-6)     ─── sequential, 2-4 hours (LLM calls + manual labelling)
         │
Phase 2 (Tasks 7-11)    ─── 7→8 sequential; 9, 10, 11 can run in parallel
         │                   after 7 and 8 are done
         │
Phase 3 (Tasks 12-13)   ─── sequential, 12 depends on all of Phase 2
         │
Phase 4 (Tasks 14-19)   ─── 14 independent; 15 needs draft-parser (Task 11);
         │                   16 needs context.js done; 17 needs 16;
         │                   18, 19 independent of each other
         │
Phase 5 (Tasks 20-22)   ─── all independent of each other, all need Phase 4 API
         │
Phase 6 (Tasks 23-24)   ─── sequential, after everything
```

**Parallelisable pairs/groups:**
- Tasks 9, 10, 11 (dedup Tier 2, parser, manifest — no shared dependencies after Task 8)
- Tasks 14, 18, 19 (podcast routes, status endpoint, articles endpoint — independent API changes)
- Tasks 20, 21, 22 (all UI components — independent)
