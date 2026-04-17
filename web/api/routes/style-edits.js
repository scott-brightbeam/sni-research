/**
 * style-edits.js — Feature 10: Living style evolution.
 *
 * Captures edits between what the model drafted and what Scott
 * actually published. An LLM extracts rules from the diff that are
 * appended to the vocabulary fingerprint so future drafts learn
 * from real editorial decisions.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getDb } from '../lib/db.js'
import { getClient } from '../lib/claude.js'
import config from '../lib/config.js'

const ROOT = config.ROOT
const FINGERPRINT_PATH = join(ROOT, 'data/editorial/vocabulary-fingerprint.json')

/**
 * POST /api/editorial/style-edit
 * Body: { threadId?, backlogId?, draftText, finalText, extractRules? }
 * Logs the edit. If extractRules=true, runs an LLM pass to extract
 * rules and appends them to the vocabulary fingerprint.
 */
export async function postStyleEdit(body = {}) {
  const { threadId, backlogId, draftText, finalText, extractRules } = body

  if (!draftText || !finalText || typeof draftText !== 'string' || typeof finalText !== 'string') {
    throw Object.assign(new Error('draftText and finalText are required strings'), { status: 400 })
  }
  if (draftText.length < 50 || finalText.length < 50) {
    throw Object.assign(new Error('Draft and final must each be at least 50 chars'), { status: 400 })
  }

  const db = getDb()

  // Insert the edit
  const result = await db.execute({
    sql: `INSERT INTO style_edits (thread_id, backlog_id, draft_text, final_text, processed)
          VALUES (?, ?, ?, ?, 0)`,
    args: [threadId || null, backlogId || null, draftText, finalText],
  })
  const editId = result.lastInsertRowid

  let extracted = null
  if (extractRules !== false) {
    try {
      extracted = await extractRulesFromDiff(draftText, finalText)
      if (extracted?.rules?.length) {
        await db.execute({
          sql: `UPDATE style_edits SET extracted_rules = ?, processed = 1 WHERE id = ?`,
          args: [JSON.stringify(extracted), Number(editId)],
        })
        appendRulesToFingerprint(extracted.rules)
      }
    } catch (err) {
      console.error('[style-edit] Rule extraction failed:', err.message)
    }
  }

  return { id: Number(editId), extracted }
}

/**
 * Use Claude to diff the draft against the final and extract editorial rules.
 */
async function extractRulesFromDiff(draftText, finalText) {
  const client = getClient()
  if (!client) throw new Error('Anthropic client unavailable')

  const systemPrompt = `You are a writing-rule extractor. You will be given two texts: a DRAFT (what Claude wrote) and the FINAL (what Scott published after editing). Your job: identify the PATTERNS in Scott's edits — not individual word swaps, but repeatable rules he would want applied to all future drafts.

Return ONLY a JSON object of this shape:
{
  "rules": [
    { "pattern": "description of the edit pattern", "example": "draft said X, final said Y", "rationale": "why Scott made this change" }
  ],
  "summary": "one-sentence overall takeaway"
}

Rules:
- Only include rules that generalise (not one-off rewrites for a specific topic)
- If Scott removed hedging ('probably', 'somewhat'), that's a rule
- If Scott swapped passive for active, that's a rule
- If Scott changed a sentence opening pattern, that's a rule
- If Scott tightened pacing (split long sentences), that's a rule
- Max 5 rules — only the strongest patterns
- Skip trivial diffs (typos, single-word cleanups without pattern)
- Return empty rules array if no meaningful patterns`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `## DRAFT\n\n${draftText.slice(0, 6000)}\n\n## FINAL\n\n${finalText.slice(0, 6000)}\n\nExtract editorial rules as JSON only.`
    }],
  })

  const text = response.content?.[0]?.text || ''
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    console.error('[style-edit] Could not parse extracted rules:', text.slice(0, 200))
    return { rules: [], summary: 'Extraction failed' }
  }
}

/**
 * Append extracted rules to the vocabulary fingerprint's learned_rules array.
 */
function appendRulesToFingerprint(newRules) {
  let fingerprint = {}
  if (existsSync(FINGERPRINT_PATH)) {
    try { fingerprint = JSON.parse(readFileSync(FINGERPRINT_PATH, 'utf-8')) } catch {}
  }
  if (!Array.isArray(fingerprint.learned_rules)) fingerprint.learned_rules = []
  const timestamp = new Date().toISOString()
  for (const r of newRules) {
    fingerprint.learned_rules.push({ ...r, learned_at: timestamp })
  }
  // Cap at 50 most recent to prevent unbounded growth
  fingerprint.learned_rules = fingerprint.learned_rules.slice(-50)
  writeFileSync(FINGERPRINT_PATH, JSON.stringify(fingerprint, null, 2))
}

/**
 * GET /api/editorial/style-edits?limit=20
 */
export async function getStyleEdits({ limit = 20 } = {}) {
  const db = getDb()
  const result = await db.execute({
    sql: `SELECT id, thread_id, backlog_id,
            SUBSTR(draft_text, 1, 200) AS draft_excerpt,
            SUBSTR(final_text, 1, 200) AS final_excerpt,
            extracted_rules, processed, created_at
          FROM style_edits
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [Number(limit)],
  })
  return result.rows.map(r => ({
    ...r,
    extracted_rules: r.extracted_rules ? JSON.parse(r.extracted_rules) : null,
  }))
}
