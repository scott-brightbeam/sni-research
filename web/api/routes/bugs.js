/**
 * bugs.js — Route handlers for the bug_reports API.
 *
 * Handlers receive Hono context `c`.
 */

import { getDb } from '../lib/db.js'
import { listBugs, getBug, createBug, updateBug, VALID_COMPONENTS, VALID_SEVERITIES } from '../lib/bug-queries.js'
import { audit } from '../lib/audit.js'

// ---------------------------------------------------------------------------
// Rate limiter — in-memory, max 10 bugs per user per hour
// ---------------------------------------------------------------------------

const rateLimitMap = new Map()
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

function checkRateLimit(email) {
  const now = Date.now()
  const entry = rateLimitMap.get(email)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(email, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) return false

  entry.count++
  return true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '')
}

// ---------------------------------------------------------------------------
// listBugsHandler
// ---------------------------------------------------------------------------

export async function listBugsHandler(c) {
  const db = getDb()
  const status = c.req.query('status') || undefined
  const limit = parseInt(c.req.query('limit') || '50', 10)
  const offset = parseInt(c.req.query('offset') || '0', 10)

  const result = await listBugs(db, { status, limit, offset })
  return c.json(result)
}

// ---------------------------------------------------------------------------
// getBugHandler
// ---------------------------------------------------------------------------

export async function getBugHandler(c) {
  const db = getDb()
  const id = c.req.param('id')

  const bug = await getBug(db, id)
  if (!bug) return c.json({ error: 'Not found' }, 404)
  return c.json(bug)
}

// ---------------------------------------------------------------------------
// createBugHandler
// ---------------------------------------------------------------------------

export async function createBugHandler(c) {
  const db = getDb()
  const body = await c.req.json()

  // --- User identity ---
  const user = c.get('user')
  const reportedBy = user?.sub || user?.email || 'unknown'
  const reportedByName = user?.name || reportedBy

  // --- Rate limiting ---
  if (!checkRateLimit(reportedBy)) {
    return c.json({ error: 'Rate limit exceeded. Maximum 10 bug reports per hour.' }, 429)
  }

  // --- Input validation ---
  if (!body.title || typeof body.title !== 'string') {
    return c.json({ error: 'title is required and must be a string' }, 400)
  }
  if (!body.description || typeof body.description !== 'string') {
    return c.json({ error: 'description is required and must be a string' }, 400)
  }

  const title = stripHtml(body.title).slice(0, 200)
  const description = stripHtml(body.description).slice(0, 5000)

  if (title.trim().length === 0) {
    return c.json({ error: 'title must not be empty after sanitisation' }, 400)
  }
  if (description.trim().length === 0) {
    return c.json({ error: 'description must not be empty after sanitisation' }, 400)
  }

  const component = body.component || null
  if (component && !VALID_COMPONENTS.has(component)) {
    return c.json({ error: `component must be one of: ${[...VALID_COMPONENTS].join(', ')}` }, 400)
  }

  const severity = body.severity || 'medium'
  if (!VALID_SEVERITIES.has(severity)) {
    return c.json({ error: `severity must be one of: ${[...VALID_SEVERITIES].join(', ')}` }, 400)
  }

  const result = await createBug(db, {
    title,
    description,
    component,
    severity,
    reportedBy,
    reportedByName,
  })

  audit(user, 'bug.create', result.id, { title })

  return c.json(result, 201)
}

// ---------------------------------------------------------------------------
// updateBugHandler
// ---------------------------------------------------------------------------

export async function updateBugHandler(c) {
  const db = getDb()
  const id = c.req.param('id')
  const body = await c.req.json()

  // Check bug exists
  const existing = await getBug(db, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Validate status if provided
  if (body.status) {
    const { VALID_STATUSES } = await import('../lib/bug-queries.js')
    if (!VALID_STATUSES.has(body.status)) {
      return c.json({ error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }, 400)
    }
  }

  // Validate severity if provided
  if (body.severity && !VALID_SEVERITIES.has(body.severity)) {
    return c.json({ error: `severity must be one of: ${[...VALID_SEVERITIES].join(', ')}` }, 400)
  }

  const result = await updateBug(db, id, body)

  const user = c.get('user')
  audit(user, 'bug.update', id, { status: body.status })

  return c.json(result)
}
