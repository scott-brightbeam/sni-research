#!/usr/bin/env bun
/**
 * revise.js — Editorial revision workflow for SNI Research Tool
 *
 * Three operating modes:
 *   --triage-only   Step 1a: Opus triages critiques → save → stop (for human review)
 *   --execute        Step 1b: Opus redrafts from triage → Step 2: self-eval → Step 3: compress
 *   (neither)        Full pipeline: combined triage+redraft → self-eval → compress
 *
 * Steps:
 *   1a. Opus receives draft + external critiques → triage decisions only
 *   1b. Opus receives draft + triage decisions → redraft
 *   1.  (full mode) Combined triage + redraft in one call
 *   2.  Opus self-evaluates: 'is this the best version I can produce?'
 *   3.  Opus compresses if over word threshold
 *
 * Usage:
 *   bun scripts/revise.js --week 9
 *   bun scripts/revise.js --week 9 --triage-only
 *   bun scripts/revise.js --week 9 --execute
 *   bun scripts/revise.js --week 9 --year 2026 --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt } from './lib/prompt.js';
import { loadEnvKey } from './lib/env.js';
import { withRetry } from './lib/retry.js';
import { flagProhibitedLanguage } from './lib/prohibited.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

const countWords = (text) => text.split(/\s+/).filter(w => w.length > 0).length;

// ─── Model config ─────────────────────────────────────────────────────────────

const MODEL = 'claude-opus-4-6';

// ─── Compression config ───────────────────────────────────────────────────────

const COMPRESSION_THRESHOLD = 3400;  // skip if at or below
const COMPRESSION_TARGET = 3200;     // target word count

// ─── Post-processing ──────────────────────────────────────────────────────────

function postProcessDraft(text) {
  let result = text;

  // Currency formatting
  result = result.replace(/\$([\d.,]+)\s+billion/gi, (_, n) => `$${n}bn`);
  result = result.replace(/\$([\d.,]+)\s+million/gi, (_, n) => `$${n}m`);
  result = result.replace(/£([\d.,]+)\s+billion/gi, (_, n) => `£${n}bn`);
  result = result.replace(/£([\d.,]+)\s+million/gi, (_, n) => `£${n}m`);
  result = result.replace(/€([\d.,]+)\s+billion/gi, (_, n) => `€${n}bn`);
  result = result.replace(/€([\d.,]+)\s+million/gi, (_, n) => `€${n}m`);

  // Prohibited language — auto-fix safe terms, flag the rest
  const { cleaned, autoFixed, flagged } = flagProhibitedLanguage(result);
  result = cleaned;
  if (autoFixed.length) log(`  Auto-fixed prohibited language: ${autoFixed.join(', ')}`);
  if (flagged.length) warn(`  Flagged (context-dependent): ${flagged.join(', ')}`);

  return result;
}

// ─── Extract critique from benchmark evaluation ───────────────────────────────

function extractCritique(evaluation, modelName) {
  if (!evaluation) {
    return `### ${modelName} — scores and feedback\n\n*${modelName} evaluation unavailable (API call failed during benchmark). Proceeding with available critique only.*`;
  }

  const parts = [];

  parts.push(`### ${modelName} — scores and feedback`);
  for (const [key, val] of Object.entries(evaluation.scores)) {
    const label = key.replace(/_/g, ' ');
    parts.push(`\n**${label}: ${val.score}/5**`);
    parts.push(val.feedback);
    if (val.reference_stories_missed?.length) {
      parts.push('Missing stories:');
      val.reference_stories_missed.forEach(s => parts.push(`- ${s}`));
    }
    if (val.draft_stories_unnecessary?.length) {
      parts.push('Stories to consider dropping:');
      val.draft_stories_unnecessary.forEach(s => parts.push(`- ${s}`));
    }
    if (val.lapses?.length) {
      parts.push('Voice lapses:');
      val.lapses.forEach(s => parts.push(`- ${s}`));
    }
    if (val.strongest_analysis) {
      parts.push(`Strongest analysis: ${val.strongest_analysis}`);
    }
    if (val.weakest_analysis) {
      parts.push(`Weakest analysis: ${val.weakest_analysis}`);
    }
  }

  if (evaluation.top_gaps?.length) {
    parts.push(`\n### ${modelName} — top gaps`);
    evaluation.top_gaps.forEach(g => parts.push(`- ${g}`));
  }

  if (evaluation.rewrite_suggestions?.length) {
    parts.push(`\n### ${modelName} — rewrite suggestions`);
    evaluation.rewrite_suggestions.forEach(s => {
      parts.push(`\n**${s.location}**`);
      if (s.current) parts.push(`Current: ${s.current}`);
      if (s.suggested) parts.push(`Suggested: ${s.suggested}`);
      if (s.reason) parts.push(`Reason: ${s.reason}`);
    });
  }

  return parts.join('\n');
}

// ─── Reviewer characterisations (shared) ──────────────────────────────────────

const REVIEWER_CHARACTERISATIONS = `You are the author of this weekly AI sector intelligence briefing. Two external reviewers have critiqued your draft. Here is what you should know about each:

- **GPT-5.2** is meticulous about factual accuracy, story selection and voice discipline. It correctly identifies missing stories, catches factual errors and flags specific voice lapses with quotes. However, it measures quality by proximity to a specific published reference rather than independent editorial merit, so its scores tend to be compressed and its story-selection critique conflates 'different editorial choices' with 'worse coverage'.

- **Gemini 3.1 Pro** is perceptive about narrative structure and theme coherence — it accurately identifies when a theme is forced onto stories where it doesn't fit. However, it inflates quality scores (it gave voice fidelity 5/5 on a draft containing a factual error) and misses concrete problems that GPT catches.`;

// ─── Triage-only prompt (A) ──────────────────────────────────────────────────

function buildTriageOnlyPrompt(draft, gptCritique, geminiCritique, researchContext) {
  return `${REVIEWER_CHARACTERISATIONS}

Your task is to triage every substantive critique from both reviewers. For each, state:
- ACCEPT: You agree and will implement the change
- REJECT: You disagree — give a one-sentence reason
- PARTIAL: You agree with the spirit but will implement differently — explain how

Pay particular attention to:
- Factual errors flagged by either reviewer (these should almost always be accepted)
- Missing stories that exist in your research context (check before accepting/rejecting)
- Voice lapses — scan each flagged phrase and decide whether it genuinely violates your editorial standards
- Theme coherence — if both reviewers flag the theme as forced in certain sections, take that seriously

**Do NOT produce a revised draft.** Only output the triage decisions, organised by reviewer then by criterion.

## Your draft

${draft}

## GPT-5.2 critique

${gptCritique}

## Gemini 3.1 Pro critique

${geminiCritique}

## Research context (verified articles available to you)

${researchContext}`;
}

// ─── Execute prompt (A) ──────────────────────────────────────────────────────

function buildExecutePrompt(draft, triage, researchContext) {
  return `You are the author of this weekly AI sector intelligence briefing. You have already triaged the external critiques — your triage decisions are below.

Produce the complete revised newsletter, implementing all ACCEPT and PARTIAL decisions from the triage. You have access to the full research context of verified articles — if a triage decision accepts a missing story, look for it in the context and add it. If the source material is not in the context, note that you cannot add it.

Do not exceed 4,000 words. Maintain all editorial standards from your system prompt.

Output the complete newsletter markdown, ready for publication. No preamble, no commentary — just the revised newsletter.

## Your draft

${draft}

## Your triage decisions

${triage}

## Research context (verified articles available to you)

${researchContext}`;
}

// ─── Full revision prompt (backward compat) ──────────────────────────────────

function buildRevisePrompt(draft, gptCritique, geminiCritique, researchContext) {
  return `${REVIEWER_CHARACTERISATIONS}

Your task has two parts:

**Part 1 — Triage.** For every substantive critique from both reviewers, state:
- ACCEPT: You agree and will implement the change
- REJECT: You disagree — give a one-sentence reason
- PARTIAL: You agree with the spirit but will implement differently — explain how

Pay particular attention to:
- Factual errors flagged by either reviewer (these should almost always be accepted)
- Missing stories that exist in your research context (check before accepting/rejecting)
- Voice lapses — scan each flagged phrase and decide whether it genuinely violates your editorial standards
- Theme coherence — if both reviewers flag the theme as forced in certain sections, take that seriously

**Part 2 — Revised draft.** Produce the complete revised newsletter, incorporating all accepted changes. You have access to the full research context of verified articles — if a reviewer identifies a missing story, look for it in the context and add it if the source material is there. If it is not in the context, note that you cannot add it.

Do not exceed 4,000 words. Maintain all editorial standards from your system prompt.

Structure your response exactly as:

TRIAGE

[your triage decisions, organised by reviewer then by criterion]

---REVISED DRAFT---

[complete newsletter markdown, ready for publication]

---

## Your draft

${draft}

## GPT-5.2 critique

${gptCritique}

## Gemini 3.1 Pro critique

${geminiCritique}

## Research context (verified articles available to you)

${researchContext}`;
}

// ─── Self-evaluation prompt ───────────────────────────────────────────────────

function buildSelfEvalPrompt(revisedDraft) {
  return `You have just revised this newsletter draft based on external critique. Read it one final time as a senior editor with full authority.

Is this the best version you can produce given everything you know — the source material, the critiques and your editorial standards?

If yes: state briefly why you are confident this is ready.

If no: identify the specific changes you would still make. Then produce the complete final version below the delimiter.

Be honest. If a phrase is lazy, a transition is clunky or an analysis is thin, fix it now. The reader deserves the best version of this report.

If you produce a revised version, format your response as:

[your assessment]

---FINAL DRAFT---

[complete newsletter markdown]

If the draft is ready as-is, just provide your assessment with no delimiter.

## Revised draft

${revisedDraft}`;
}

// ─── Compression prompt (C) ──────────────────────────────────────────────────

function buildCompressionPrompt(draft, targetWords) {
  return `You are a sub-editor tightening this newsletter for publication. The current draft is ${countWords(draft)} words. The target is ${targetWords} words.

Your instructions, in priority order:

1. Drop the weakest story — remove it from **both** the body section **and** the tl;dr bullets
2. Tighten every paragraph by one sentence — remove sentences that restate what the data already shows
3. Eliminate redundant framing ('this matters because', 'the implication is', 'what this means')
4. Preserve all numbers, names, dates, deal terms — do not lose any concrete facts
5. Do not add new content

The compression should be invisible to the reader — the newsletter should read as naturally at ${targetWords} words as it did before.

Format your response as:

[brief note on what you cut and why — 2-3 sentences max]

---COMPRESSED DRAFT---

[complete newsletter markdown]

## Draft to compress

${draft}`;
}

// ─── Post-revision pipeline (Steps 2 + 3) ────────────────────────────────────

async function runPostRevision(client, systemPrompt, revisedDraft, week, draftWords) {
  // ─── Step 2: Self-evaluation ──────────────────────────────────────────────

  log('Step 2: Opus self-evaluation (1-3 minutes)...');

  const selfEvalPrompt = buildSelfEvalPrompt(revisedDraft);
  const t2Start = Date.now();

  const selfEvalResponse = await withRetry(() => client.messages.create({
    model: MODEL,
    max_tokens: 10000,
    system: systemPrompt,
    messages: [{ role: 'user', content: selfEvalPrompt }],
  }), { maxAttempts: 3 });

  const selfEval = selfEvalResponse.content[0].text;
  const t2Elapsed = ((Date.now() - t2Start) / 1000).toFixed(1);
  ok(`Step 2 complete in ${t2Elapsed}s (${countWords(selfEval)} words)`);

  // Check if self-eval produced a final draft
  const finalDelimiter = '---FINAL DRAFT---';
  const finalIdx = selfEval.indexOf(finalDelimiter);
  let finalDraft = revisedDraft;
  let selfEvalProducedNewDraft = false;

  if (finalIdx !== -1) {
    finalDraft = selfEval.slice(finalIdx + finalDelimiter.length).trim();
    finalDraft = postProcessDraft(finalDraft);
    selfEvalProducedNewDraft = true;
    ok(`Self-eval produced final draft: ${countWords(finalDraft)} words`);
  } else {
    ok('Self-eval confirmed draft — no further changes');
  }

  // ─── Step 3: Compression ────────────────────────────────────────────────

  let compressed = false;
  let t3Elapsed = null;
  const preCompressWords = countWords(finalDraft);

  if (preCompressWords > COMPRESSION_THRESHOLD) {
    log(`Step 3: Compression (${preCompressWords} words > ${COMPRESSION_THRESHOLD} threshold)...`);

    const compressPrompt = buildCompressionPrompt(finalDraft, COMPRESSION_TARGET);
    const t3Start = Date.now();

    const compressResponse = await withRetry(() => client.messages.create({
      model: MODEL,
      max_tokens: 10000,
      system: systemPrompt,
      messages: [{ role: 'user', content: compressPrompt }],
    }), { maxAttempts: 3 });

    const compressText = compressResponse.content[0].text;
    t3Elapsed = ((Date.now() - t3Start) / 1000).toFixed(1);

    const compressDelimiter = '---COMPRESSED DRAFT---';
    const compressIdx = compressText.indexOf(compressDelimiter);

    if (compressIdx !== -1) {
      finalDraft = compressText.slice(compressIdx + compressDelimiter.length).trim();
      finalDraft = postProcessDraft(finalDraft);
      compressed = true;
      const postCompressWords = countWords(finalDraft);
      ok(`Step 3 complete in ${t3Elapsed}s — ${preCompressWords} → ${postCompressWords} words`);

      if (postCompressWords < 2800) {
        warn(`Compressed draft below safety floor (${postCompressWords} words < 2800)`);
      }
    } else {
      warn('Step 3: Could not find ---COMPRESSED DRAFT--- delimiter, keeping uncompressed version');
    }
  } else {
    log(`Step 3: Skipped (${preCompressWords} words ≤ ${COMPRESSION_THRESHOLD} threshold)`);
  }

  return { finalDraft, selfEval, selfEvalProducedNewDraft, compressed, t2Elapsed, t3Elapsed };
}

// ─── Main workflow ────────────────────────────────────────────────────────────

export async function runRevise({ week, year, dryRun = false, triageOnly = false, execute = false }) {
  const apiKey = loadEnvKey('ANTHROPIC_API_KEY');
  if (!apiKey) {
    log('ANTHROPIC_API_KEY not configured. Revision now runs through Claude Code.');
    return;
  }

  const draftPath = join(ROOT, 'output', `draft-week-${week}.md`);
  const benchmarkPath = join(ROOT, 'output', `benchmark-week-${week}.json`);
  const contextPath = join(ROOT, 'output', `draft-context-week-${week}.md`);
  const triagePath = join(ROOT, 'output', `revise-triage-week-${week}.md`);

  // Also check for select-context (prefer it if available)
  const selectContextPath = join(ROOT, 'output', `select-context-week-${week}.md`);
  const effectiveContextPath = existsSync(selectContextPath) ? selectContextPath : contextPath;

  // ─── Validate inputs per mode ─────────────────────────────────────────────

  if (!existsSync(draftPath)) throw new Error(`Draft not found: ${draftPath}`);
  if (!existsSync(effectiveContextPath)) throw new Error(`Research context not found: ${effectiveContextPath}`);

  // --execute mode does NOT need benchmark (critiques already consumed in triage)
  if (!execute && !existsSync(benchmarkPath)) {
    throw new Error(`Benchmark not found: ${benchmarkPath}`);
  }

  if (execute && !existsSync(triagePath)) {
    throw new Error(`Triage file not found: ${triagePath}\nRun first: bun scripts/revise.js --week ${week} --triage-only`);
  }

  const draft = readFileSync(draftPath, 'utf8');
  const researchContext = readFileSync(effectiveContextPath, 'utf8');

  const draftWords = countWords(draft);
  log(`Loaded draft: ${draftWords} words`);
  log(`Using context: ${effectiveContextPath}`);

  // ─── Triage-only mode ─────────────────────────────────────────────────────

  if (triageOnly) {
    const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8'));
    log(`Loaded benchmark from ${benchmark.benchmarked_at}`);

    const gptCritique = extractCritique(benchmark.gpt_evaluation, 'GPT-5.2');
    const geminiCritique = extractCritique(benchmark.gemini_evaluation, 'Gemini 3.1 Pro');

    ok(`GPT critique: ${gptCritique.split('\n').length} lines`);
    ok(`Gemini critique: ${geminiCritique.split('\n').length} lines`);

    if (dryRun) {
      log('Dry run — printing extracted critiques');
      console.log('\n═══ GPT-5.2 CRITIQUE ═══\n');
      console.log(gptCritique);
      console.log('\n═══ GEMINI 3.1 PRO CRITIQUE ═══\n');
      console.log(geminiCritique);
      return { dryRun: true };
    }

    const systemPromptPath = join(ROOT, 'config', 'prompts', 'draft-system.md');
    let systemPrompt = '';
    if (existsSync(systemPromptPath)) {
      const { template } = loadPrompt('draft-system');
      systemPrompt = template;
    }

    const client = new Anthropic({ apiKey });

    log('Step 1a: Opus triage-only (2-4 minutes)...');
    const triagePrompt = buildTriageOnlyPrompt(draft, gptCritique, geminiCritique, researchContext);
    log(`  Prompt size: ~${Math.round(triagePrompt.length / 4)} tokens`);

    const t1Start = Date.now();
    const response = await withRetry(() => client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: 'user', content: triagePrompt }],
    }), { maxAttempts: 3 });

    const triage = response.content[0].text;
    const t1Elapsed = ((Date.now() - t1Start) / 1000).toFixed(1);
    ok(`Step 1a complete in ${t1Elapsed}s (${countWords(triage)} words)`);

    writeFileSync(triagePath, triage);

    console.log(`\n═══════════════════════════════════════════════`);
    console.log(`  SNI Editorial Revision — Week ${week} (triage only)`);
    console.log(`═══════════════════════════════════════════════`);
    console.log(`  Step 1a: Triage              ✓  ${t1Elapsed}s`);
    console.log(`  ────────────────────────────────────────────`);
    console.log(`  Triage:     ${triagePath}`);
    console.log(`  Review the triage, then run:`);
    console.log(`    bun scripts/revise.js --week ${week} --execute`);
    console.log(`═══════════════════════════════════════════════\n`);

    return { triageOnly: true, triagePath, triage };
  }

  // ─── Execute mode ─────────────────────────────────────────────────────────

  if (execute) {
    const triage = readFileSync(triagePath, 'utf8');
    if (triage.length < 50) {
      throw new Error(`Triage file appears empty/corrupt (${triage.length} chars): ${triagePath}`);
    }
    log(`Loaded triage: ${countWords(triage)} words`);

    const systemPromptPath = join(ROOT, 'config', 'prompts', 'draft-system.md');
    let systemPrompt = '';
    if (existsSync(systemPromptPath)) {
      const { template } = loadPrompt('draft-system');
      systemPrompt = template;
    }

    const client = new Anthropic({ apiKey });

    log('Step 1b: Opus redraft from triage (2-4 minutes)...');
    const executePrompt = buildExecutePrompt(draft, triage, researchContext);
    log(`  Prompt size: ~${Math.round(executePrompt.length / 4)} tokens`);

    const t1Start = Date.now();
    const response = await withRetry(() => client.messages.create({
      model: MODEL,
      max_tokens: 12000,
      system: systemPrompt,
      messages: [{ role: 'user', content: executePrompt }],
    }), { maxAttempts: 3 });

    let revisedDraft = response.content[0].text;
    const t1Elapsed = ((Date.now() - t1Start) / 1000).toFixed(1);

    revisedDraft = postProcessDraft(revisedDraft);
    ok(`Step 1b complete in ${t1Elapsed}s (${countWords(revisedDraft)} words)`);

    // Backup current draft
    const backupPath = join(ROOT, 'output', `draft-week-${week}-v3.md`);
    if (!existsSync(backupPath)) {
      writeFileSync(backupPath, draft);
      ok(`Backed up previous draft to ${backupPath}`);
    }

    // Run self-eval + compression
    const post = await runPostRevision(client, systemPrompt, revisedDraft, week, draftWords);

    // Save outputs
    const outputPath = join(ROOT, 'output', `draft-week-${week}.md`);
    const selfEvalPath = join(ROOT, 'output', `revise-selfeval-week-${week}.md`);

    writeFileSync(outputPath, post.finalDraft);
    writeFileSync(selfEvalPath, post.selfEval);

    const finalWords = countWords(post.finalDraft);

    console.log(`\n═══════════════════════════════════════════════`);
    console.log(`  SNI Editorial Revision — Week ${week} (execute)`);
    console.log(`═══════════════════════════════════════════════`);
    console.log(`  Step 1b: Redraft from triage  ✓  ${t1Elapsed}s`);
    console.log(`  Step 2: Self-evaluation        ✓  ${post.t2Elapsed}s`);
    console.log(`  Self-eval rewrote:             ${post.selfEvalProducedNewDraft ? 'yes' : 'no'}`);
    console.log(`  Step 3: Compression            ${post.compressed ? '✓  ' + post.t3Elapsed + 's' : 'skipped'}`);
    console.log(`  Words:  ${draftWords} → ${finalWords}`);
    console.log(`  ────────────────────────────────────────────`);
    console.log(`  Draft:      ${outputPath}`);
    console.log(`  Self-eval:  ${selfEvalPath}`);
    console.log(`  Triage:     ${triagePath} (used)`);
    console.log(`  V3 backup:  ${backupPath}`);
    console.log(`═══════════════════════════════════════════════\n`);

    return {
      triage: readFileSync(triagePath, 'utf8'),
      finalDraft: post.finalDraft,
      selfEval: post.selfEval,
      wordCount: finalWords,
      selfEvalProducedNewDraft: post.selfEvalProducedNewDraft,
      compressed: post.compressed,
    };
  }

  // ─── Full mode (backward compat) ──────────────────────────────────────────

  const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8'));
  log(`Loaded benchmark from ${benchmark.benchmarked_at}`);

  const gptCritique = extractCritique(benchmark.gpt_evaluation, 'GPT-5.2');
  const geminiCritique = extractCritique(benchmark.gemini_evaluation, 'Gemini 3.1 Pro');

  ok(`GPT critique: ${gptCritique.split('\n').length} lines`);
  ok(`Gemini critique: ${geminiCritique.split('\n').length} lines`);

  if (dryRun) {
    log('Dry run — printing extracted critiques');
    console.log('\n═══ GPT-5.2 CRITIQUE ═══\n');
    console.log(gptCritique);
    console.log('\n═══ GEMINI 3.1 PRO CRITIQUE ═══\n');
    console.log(geminiCritique);
    return { dryRun: true };
  }

  // Load system prompt
  const systemPromptPath = join(ROOT, 'config', 'prompts', 'draft-system.md');
  let systemPrompt = '';
  if (existsSync(systemPromptPath)) {
    const { template } = loadPrompt('draft-system');
    systemPrompt = template;
  }

  const client = new Anthropic({ apiKey });

  // ─── Step 1: Meta-evaluation + redraft ──────────────────────────────────

  log('Step 1: Opus meta-evaluation + redraft (2-4 minutes)...');

  const revisePrompt = buildRevisePrompt(draft, gptCritique, geminiCritique, researchContext);
  log(`  Prompt size: ~${Math.round(revisePrompt.length / 4)} tokens`);

  const t1Start = Date.now();
  const response = await withRetry(() => client.messages.create({
    model: MODEL,
    max_tokens: 12000,
    system: systemPrompt,
    messages: [{ role: 'user', content: revisePrompt }],
  }), { maxAttempts: 3 });

  const fullResponse = response.content[0].text;
  const t1Elapsed = ((Date.now() - t1Start) / 1000).toFixed(1);
  ok(`Step 1 complete in ${t1Elapsed}s (${countWords(fullResponse)} words)`);

  // Parse triage and draft
  const delimiter = '---REVISED DRAFT---';
  const delimiterIdx = fullResponse.indexOf(delimiter);
  let triage, revisedDraft;

  if (delimiterIdx !== -1) {
    triage = fullResponse.slice(0, delimiterIdx).replace(/^TRIAGE\s*/i, '').trim();
    revisedDraft = fullResponse.slice(delimiterIdx + delimiter.length).trim();
  } else {
    warn('Could not find ---REVISED DRAFT--- delimiter');
    warn('Treating entire response as draft (no triage extracted)');
    triage = '(delimiter not found — triage not separated)';
    revisedDraft = fullResponse;
  }

  revisedDraft = postProcessDraft(revisedDraft);
  ok(`Triage: ${triage.split('\n').length} lines`);
  ok(`Revised draft: ${countWords(revisedDraft)} words`);

  // Backup current draft
  const backupPath = join(ROOT, 'output', `draft-week-${week}-v3.md`);
  if (!existsSync(backupPath)) {
    writeFileSync(backupPath, draft);
    ok(`Backed up previous draft to ${backupPath}`);
  }

  // Run self-eval + compression
  const post = await runPostRevision(client, systemPrompt, revisedDraft, week, draftWords);

  // Save outputs
  const outputPath = join(ROOT, 'output', `draft-week-${week}.md`);
  const selfEvalPath = join(ROOT, 'output', `revise-selfeval-week-${week}.md`);

  writeFileSync(triagePath, triage);
  writeFileSync(outputPath, post.finalDraft);
  writeFileSync(selfEvalPath, post.selfEval);

  const finalWords = countWords(post.finalDraft);

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  SNI Editorial Revision — Week ${week}`);
  console.log(`═══════════════════════════════════════════════`);
  console.log(`  Step 1: Meta-eval + redraft   ✓  ${t1Elapsed}s`);
  console.log(`  Step 2: Self-evaluation        ✓  ${post.t2Elapsed}s`);
  console.log(`  Self-eval rewrote:             ${post.selfEvalProducedNewDraft ? 'yes' : 'no'}`);
  console.log(`  Step 3: Compression            ${post.compressed ? '✓  ' + post.t3Elapsed + 's' : 'skipped'}`);
  console.log(`  Words:  ${draftWords} → ${finalWords}`);
  console.log(`  ────────────────────────────────────────────`);
  console.log(`  Triage:     ${triagePath}`);
  console.log(`  Draft:      ${outputPath}`);
  console.log(`  Self-eval:  ${selfEvalPath}`);
  console.log(`  V3 backup:  ${backupPath}`);
  console.log(`═══════════════════════════════════════════════\n`);

  return {
    triage,
    finalDraft: post.finalDraft,
    selfEval: post.selfEval,
    wordCount: finalWords,
    selfEvalProducedNewDraft: post.selfEvalProducedNewDraft,
    compressed: post.compressed,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week')         args.week = parseInt(argv[++i], 10);
    if (argv[i] === '--year')         args.year = parseInt(argv[++i], 10);
    if (argv[i] === '--dry-run')      args.dryRun = true;
    if (argv[i] === '--triage-only')  args.triageOnly = true;
    if (argv[i] === '--execute')      args.execute = true;
  }

  if (!args.week) {
    console.error('Usage: bun scripts/revise.js --week N [--year YYYY] [--dry-run] [--triage-only | --execute]');
    process.exit(1);
  }

  // Validate flag combinations
  if (args.triageOnly && args.execute) {
    console.error('Error: --triage-only and --execute cannot be used together');
    process.exit(1);
  }
  if (args.execute && args.dryRun) {
    console.error('Error: --execute and --dry-run cannot be used together (execute requires API calls)');
    process.exit(1);
  }

  const year = args.year || new Date().getFullYear();
  const mode = args.triageOnly ? 'Triage Only' : args.execute ? 'Execute' : 'Full';

  console.log(`═══════════════════════════════════════════════`);
  console.log(`  SNI Research Tool - Editorial Revision`);
  console.log(`  Week ${args.week}, ${year} — ${mode}`);
  console.log(`═══════════════════════════════════════════════\n`);

  runRevise(args)
    .then(result => {
      if (result.dryRun) return;
      if (result.triageOnly) {
        log(`Triage saved to ${result.triagePath}`);
      } else {
        log(`Result: words=${result.wordCount} self_eval_rewrote=${result.selfEvalProducedNewDraft} compressed=${result.compressed}`);
      }
    })
    .catch(err => {
      console.error('Revision failed:', err.message);
      if (err.stack) console.error(err.stack);
      process.exit(1);
    });
}
