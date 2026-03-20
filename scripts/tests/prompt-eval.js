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
  let totalRecall = 0, totalPrecision = 0

  for (const entry of labels) {
    const transcript = readFileSync(entry.source_path.replace('~', process.env.HOME), 'utf8')
    const prompt = loadAndRenderPrompt('story-extract.v1', { transcript })
    const extracted = await callLLM(prompt)

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
    const titleMatch = transcript.match(/^# (.+)$/m)
    const sourceMatch = transcript.match(/\*\*Source:\*\*\s*(.+)$/m)
    const dateMatch = transcript.match(/\*\*Date:\*\*\s*(.+)$/m)
    const durationMatch = transcript.match(/\*\*Duration:\*\*\s*(.+)$/m)

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
