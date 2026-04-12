import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, appendFileSync } from 'fs'
import { join } from 'path'
import { getClient } from '../lib/claude.js'
import { assembleContext, estimateTokens } from '../lib/context.js'
import { estimateCost, formatCost, DEFAULT_MODEL, MODELS } from '../lib/pricing.js'
import { getISOWeek } from '../lib/week.js'
import { listPublished, getPublished } from './published.js'
import config from '../lib/config.js'

const ROOT = config.ROOT
const COPILOT_DIR = join(ROOT, 'data/copilot')
const DAILY_TOKEN_CEILING = config.TOKEN_CEILING

const DAILY_USAGE_PATH = join(COPILOT_DIR, 'daily-usage.json')

// Persist daily usage to disk so it survives server restarts
function loadDailyUsage() {
  if (!existsSync(DAILY_USAGE_PATH)) return { date: '', inputTokens: 0, outputTokens: 0 }
  try {
    return JSON.parse(readFileSync(DAILY_USAGE_PATH, 'utf-8'))
  } catch { return { date: '', inputTokens: 0, outputTokens: 0 } }
}

let _dailyUsage = loadDailyUsage()

function today() { return new Date().toISOString().slice(0, 10) }

function resetDailyIfNeeded() {
  if (_dailyUsage.date !== today()) {
    _dailyUsage = { date: today(), inputTokens: 0, outputTokens: 0 }
  }
}

function persistDailyUsage() {
  try {
    ensureDir(COPILOT_DIR)
    writeFileSync(DAILY_USAGE_PATH, JSON.stringify(_dailyUsage))
  } catch (err) {
    console.error('[chat] Failed to persist daily usage:', err.message)
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// ─── Thread CRUD ────────────────────────────────────────────────────────────

function chatDir(week) { return join(COPILOT_DIR, `chats/week-${week}`) }
function pinDir(week) { return join(COPILOT_DIR, `pins/week-${week}`) }

function readThreadIndex(week) {
  const file = join(chatDir(week), 'threads.json')
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return [] }
}

function writeThreadIndex(week, threads) {
  const dir = chatDir(week)
  ensureDir(dir)
  writeFileSync(join(dir, 'threads.json'), JSON.stringify(threads, null, 2))
}

// Serialise thread index writes to prevent read-modify-write races
let _threadQueue = Promise.resolve()
function withThreadLock(fn) {
  let release
  const acquire = new Promise(resolve => { release = resolve })
  const prev = _threadQueue
  _threadQueue = acquire
  return prev.then(async () => {
    try { return await fn() } finally { release() }
  })
}

export async function listThreads({ week }) {
  if (!week) week = getISOWeek()
  return readThreadIndex(week)
}

export async function createThread({ week, name }) {
  if (!week) week = getISOWeek()
  return withThreadLock(() => {
    const id = generateId()
    const now = new Date().toISOString()
    const thread = {
      id,
      name: name || `New thread`,
      created: now,
      updated: now,
      messageCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCost: 0,
    }

    const threads = readThreadIndex(week)
    threads.push(thread)
    writeThreadIndex(week, threads)

    return { id: thread.id, name: thread.name }
  })
}

export async function renameThread({ id, name, week }) {
  if (!week) {
    // Find which week has this thread
    const copilotChats = join(COPILOT_DIR, 'chats')
    if (existsSync(copilotChats)) {
      for (const dir of readdirSync(copilotChats)) {
        const m = dir.match(/^week-(\d+)$/)
        if (!m) continue
        const threads = readThreadIndex(parseInt(m[1]))
        if (threads.some(t => t.id === id)) { week = parseInt(m[1]); break }
      }
    }
  }
  if (!week) throw Object.assign(new Error('Thread not found'), { status: 404 })

  return withThreadLock(() => {
    const threads = readThreadIndex(week)
    const thread = threads.find(t => t.id === id)
    if (!thread) throw Object.assign(new Error('Thread not found'), { status: 404 })

    thread.name = name
    thread.updated = new Date().toISOString()
    writeThreadIndex(week, threads)

    return { id: thread.id, name: thread.name }
  })
}

export async function getHistory({ week, thread }) {
  if (!week || !thread) throw Object.assign(new Error('week and thread required'), { status: 400 })
  const file = join(chatDir(week), `thread-${thread}.jsonl`)
  if (!existsSync(file)) return []

  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
}

// ─── Pin CRUD ───────────────────────────────────────────────────────────────

function readPinIndex(week) {
  const file = join(pinDir(week), 'pins.json')
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return [] }
}

function writePinIndex(week, pins) {
  const dir = pinDir(week)
  ensureDir(dir)
  writeFileSync(join(dir, 'pins.json'), JSON.stringify(pins, null, 2))
}

export async function createPin({ week, threadId, messageId, text }) {
  if (!week || !text) throw Object.assign(new Error('week and text required'), { status: 400 })

  const id = `pin-${generateId()}`
  const now = new Date().toISOString()
  const preview = text.slice(0, 200)

  // Write markdown file with YAML frontmatter (pipeline-readable)
  const dir = pinDir(week)
  ensureDir(dir)
  const md = `---\nid: ${id}\nthreadId: ${threadId || 'ephemeral'}\nmessageId: ${messageId || 'unknown'}\nweek: ${week}\ncreated: ${now}\n---\n\n${text}\n`
  writeFileSync(join(dir, `${id}.md`), md)

  // Update index
  const pins = readPinIndex(week)
  pins.push({ id, threadId, messageId, week: parseInt(week), preview, created: now })
  writePinIndex(week, pins)

  return { id, preview }
}

export async function listPins({ week }) {
  if (!week) week = getISOWeek()
  return readPinIndex(week)
}

export async function deletePin({ id, week }) {
  if (!id) throw Object.assign(new Error('id required'), { status: 400 })

  if (!week) {
    // Find which week has this pin
    const pinsBase = join(COPILOT_DIR, 'pins')
    if (existsSync(pinsBase)) {
      for (const dir of readdirSync(pinsBase)) {
        const m = dir.match(/^week-(\d+)$/)
        if (!m) continue
        const pins = readPinIndex(parseInt(m[1]))
        if (pins.some(p => p.id === id)) { week = parseInt(m[1]); break }
      }
    }
  }
  if (!week) throw Object.assign(new Error('Pin not found'), { status: 404 })

  // Remove markdown file
  const mdFile = join(pinDir(week), `${id}.md`)
  if (existsSync(mdFile)) rmSync(mdFile)

  // Update index
  const pins = readPinIndex(week).filter(p => p.id !== id)
  writePinIndex(week, pins)

  return { ok: true }
}

// ─── Usage ──────────────────────────────────────────────────────────────────

export async function getUsage({ period }) {
  resetDailyIfNeeded()
  const cost = estimateCost(DEFAULT_MODEL, _dailyUsage.inputTokens, _dailyUsage.outputTokens)
  return {
    inputTokens: _dailyUsage.inputTokens,
    outputTokens: _dailyUsage.outputTokens,
    estimatedCost: cost,
    ceiling: DAILY_TOKEN_CEILING,
    remaining: Math.max(0, DAILY_TOKEN_CEILING - _dailyUsage.inputTokens - _dailyUsage.outputTokens),
  }
}

// ─── Streaming Chat (Task 7) ────────────────────────────────────────────────

export async function handleChat(req) {
  const body = await req.json()
  const { message, model, threadId, ephemeral, draftContext, articleRef, podcastRef } = body

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw Object.assign(new Error('message is required'), { status: 400 })
  }

  const selectedModel = MODELS.includes(model) ? model : DEFAULT_MODEL
  const week = body.week || getISOWeek()

  // Check daily ceiling
  _checkDailyCeiling()

  // If non-ephemeral and threadId provided, load history
  let threadHistory = []
  if (!ephemeral && threadId) {
    threadHistory = await getHistory({ week, thread: threadId })
  }

  // /compare-draft command: load published exemplar
  let publishedExemplar = null
  let userMessage = message
  if (message.startsWith('/compare-draft')) {
    userMessage = message.replace(/^\/compare-draft\s*/, '').trim()
    if (!userMessage) {
      userMessage = 'Compare this draft against the published exemplar. Analyse structure, tone, section balance and coverage gaps.'
    }
    // Load most recent published newsletter
    const published = listPublished()
    if (published.length > 0) {
      const latest = getPublished(published[0].week)
      if (latest?.content) {
        publishedExemplar = latest.content
      }
    }
    if (!publishedExemplar) {
      // No published newsletters — AI will be told there's nothing to compare against
      userMessage = 'The user asked to compare this draft against a published exemplar, but no published newsletters have been saved yet. Let them know they need to save a published newsletter first using the Published panel in the Draft page.'
    }
  }

  // Assemble context
  const { systemPrompt, preamble, trimmedHistory } = await assembleContext({
    week,
    threadHistory,
    articleRef,
    podcastRef,
    ephemeral: !!ephemeral,
    draftContext,
    publishedExemplar,
  })

  // Build SDK messages array
  const sdkMessages = []

  // First message includes the preamble as a user message
  if (preamble && trimmedHistory.length === 0) {
    sdkMessages.push({ role: 'user', content: `${preamble}\n\n---\n\n${userMessage}` })
  } else if (preamble) {
    sdkMessages.push({ role: 'user', content: preamble })
    sdkMessages.push({ role: 'assistant', content: 'I\'ve reviewed the context. What would you like to discuss?' })
    for (const msg of trimmedHistory) {
      sdkMessages.push({ role: msg.role, content: msg.content })
    }
    sdkMessages.push({ role: 'user', content: userMessage })
  } else {
    for (const msg of trimmedHistory) {
      sdkMessages.push({ role: msg.role, content: msg.content })
    }
    sdkMessages.push({ role: 'user', content: userMessage })
  }

  // Create abort controller linked to request signal
  const abort = new AbortController()
  if (req.signal) {
    req.signal.addEventListener('abort', () => abort.abort())
  }

  const client = getClient()
  if (!client) {
    return new Response(JSON.stringify({
      type: 'error', code: 'ANTHROPIC_DISABLED',
      message: 'Editorial chat has moved to Claude Code.'
    }), { status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': config.CORS_ORIGIN } })
  }
  const msgId = `msg_${generateId()}`
  const userMsgId = `msg_${generateId()}`
  const now = new Date().toISOString()

  // Return SSE stream — manual CORS headers required because SSE responses
  // are raw Response objects whose headers cannot be modified by middleware
  const corsHeaders = {
    'Access-Control-Allow-Origin': config.CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch (err) {
          if (err.message?.includes('close') || err.message?.includes('enqueue')) return
          console.error('[chat] SSE send failed:', err.message, data?.type)
        }
      }

      let fullText = ''
      let usage = null

      try {
        const response = await client.messages.create({
          model: selectedModel,
          max_tokens: 4096,
          system: systemPrompt,
          messages: sdkMessages,
          stream: true,
        })

        for await (const event of response) {
          if (abort.signal.aborted) break

          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text
            send({ type: 'delta', text: event.delta.text })
          }

          if (event.type === 'message_delta' && event.usage) {
            usage = {
              input_tokens: (response.usage?.input_tokens || 0) + (event.usage?.input_tokens || 0),
              output_tokens: event.usage?.output_tokens || 0,
            }
          }

          if (event.type === 'message_start' && event.message?.usage) {
            usage = { ...usage, input_tokens: event.message.usage.input_tokens }
          }
        }

        // Finalise usage from response
        if (!usage) usage = { input_tokens: 0, output_tokens: 0 }

        // Persist if not ephemeral
        if (!ephemeral && threadId) {
          const userMsg = { id: userMsgId, role: 'user', content: message, model: selectedModel, timestamp: now, usage: null, articleRef: articleRef || null, podcastRef: podcastRef || null }
          const assistantMsg = { id: msgId, role: 'assistant', content: fullText, model: selectedModel, timestamp: new Date().toISOString(), usage, articleRef: null }

          _appendMessage(week, threadId, userMsg)
          _appendMessage(week, threadId, assistantMsg)
          _updateThreadStats(week, threadId, usage.input_tokens, usage.output_tokens, selectedModel)
          _autoNameThread(week, threadId, message)
        }

        // Record daily usage
        _recordDailyUsage(usage.input_tokens, usage.output_tokens)

        send({ type: 'done', id: msgId, usage })
      } catch (err) {
        if (!abort.signal.aborted) {
          send({ type: 'error', message: err.message || 'Stream error' })
        }
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders,
    },
  })
}

// ─── Internal helpers (exported for Task 7) ─────────────────────────────────

export function _appendMessage(week, threadId, message) {
  const dir = chatDir(week)
  ensureDir(dir)
  const file = join(dir, `thread-${threadId}.jsonl`)
  appendFileSync(file, JSON.stringify(message) + '\n')
}

export function _updateThreadStats(week, threadId, inputTokens, outputTokens, model) {
  return withThreadLock(() => {
    const threads = readThreadIndex(week)
    const thread = threads.find(t => t.id === threadId)
    if (!thread) return
    thread.messageCount += 2 // user + assistant
    thread.totalInputTokens += inputTokens
    thread.totalOutputTokens += outputTokens
    thread.estimatedCost = estimateCost(model, thread.totalInputTokens, thread.totalOutputTokens)
    thread.updated = new Date().toISOString()
    writeThreadIndex(week, threads)
  })
}

export function _recordDailyUsage(inputTokens, outputTokens) {
  resetDailyIfNeeded()
  _dailyUsage.inputTokens += inputTokens
  _dailyUsage.outputTokens += outputTokens
  persistDailyUsage()
}

export function _checkDailyCeiling() {
  resetDailyIfNeeded()
  const total = _dailyUsage.inputTokens + _dailyUsage.outputTokens
  if (total >= DAILY_TOKEN_CEILING) {
    const err = new Error(`Daily token ceiling reached (${total}/${DAILY_TOKEN_CEILING}). Try again tomorrow or restart the server.`)
    err.status = 429
    throw err
  }
  return { total, ceiling: DAILY_TOKEN_CEILING, warningAt80: total >= DAILY_TOKEN_CEILING * 0.8 }
}

export function _autoNameThread(week, threadId, firstMessage) {
  return withThreadLock(() => {
    const threads = readThreadIndex(week)
    const thread = threads.find(t => t.id === threadId)
    if (!thread || thread.name !== 'New thread') return
    thread.name = firstMessage.slice(0, 50).replace(/\n/g, ' ').trim() || 'New thread'
    writeThreadIndex(week, threads)
  })
}
