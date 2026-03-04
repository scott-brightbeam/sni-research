import { describe, it, expect, beforeAll } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  listThreads, createThread, renameThread, getHistory,
  createPin, listPins, deletePin, getUsage
} from './routes/chat.js'

const ROOT = resolve(import.meta.dir, '../..')
const TEST_WEEK = 99

// Clean up test data before running
beforeAll(() => {
  const chatDir = join(ROOT, `data/copilot/chats/week-${TEST_WEEK}`)
  const pinDir = join(ROOT, `data/copilot/pins/week-${TEST_WEEK}`)
  if (existsSync(chatDir)) rmSync(chatDir, { recursive: true })
  if (existsSync(pinDir)) rmSync(pinDir, { recursive: true })
})

describe('Thread CRUD', () => {
  let threadId

  it('createThread returns id and auto-generated name', async () => {
    const result = await createThread({ week: TEST_WEEK })
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('name')
    expect(typeof result.id).toBe('string')
    threadId = result.id
  })

  it('createThread with explicit name', async () => {
    const result = await createThread({ week: TEST_WEEK, name: 'Biopharma deep dive' })
    expect(result.name).toBe('Biopharma deep dive')
  })

  it('listThreads returns all threads for a week', async () => {
    const result = await listThreads({ week: TEST_WEEK })
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2)
    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('name')
    expect(result[0]).toHaveProperty('created')
  })

  it('renameThread updates the name', async () => {
    const result = await renameThread({ id: threadId, name: 'Renamed thread' })
    expect(result.name).toBe('Renamed thread')

    const threads = await listThreads({ week: TEST_WEEK })
    const found = threads.find(t => t.id === threadId)
    expect(found.name).toBe('Renamed thread')
  })

  it('getHistory returns empty array for new thread', async () => {
    const result = await getHistory({ week: TEST_WEEK, thread: threadId })
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('listThreads for non-existent week returns empty', async () => {
    const result = await listThreads({ week: 999 })
    expect(result).toEqual([])
  })
})

describe('Pin CRUD', () => {
  let pinId

  it('createPin returns id and preview', async () => {
    const result = await createPin({
      week: TEST_WEEK,
      threadId: 'abc',
      messageId: 'msg_001',
      text: 'Three main themes emerged in biopharma this week: M&A activity, AI drug discovery, and regulatory shifts.',
    })
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('preview')
    pinId = result.id
  })

  it('listPins returns pins for the week', async () => {
    const result = await listPins({ week: TEST_WEEK })
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('threadId')
  })

  it('pin markdown file exists with frontmatter', async () => {
    const pinDir = join(ROOT, `data/copilot/pins/week-${TEST_WEEK}`)
    const pinFile = join(pinDir, `${pinId}.md`)
    expect(existsSync(pinFile)).toBe(true)
  })

  it('deletePin removes the pin', async () => {
    const result = await deletePin({ id: pinId, week: TEST_WEEK })
    expect(result.ok).toBe(true)

    const pins = await listPins({ week: TEST_WEEK })
    expect(pins).toHaveLength(0)
  })
})

describe('Usage', () => {
  it('getUsage returns token counts', async () => {
    const result = await getUsage({ period: 'today' })
    expect(result).toHaveProperty('inputTokens')
    expect(result).toHaveProperty('outputTokens')
    expect(result).toHaveProperty('estimatedCost')
    expect(result).toHaveProperty('ceiling')
    expect(result).toHaveProperty('remaining')
  })
})
