import { describe, it, expect } from 'bun:test'
import { withStateLock } from '../lib/state-lock.js'

describe('state-lock', () => {
  it('serialises concurrent calls', async () => {
    const order = []

    const p1 = withStateLock(async () => {
      order.push('p1-start')
      await new Promise(r => setTimeout(r, 50))
      order.push('p1-end')
      return 'a'
    })

    const p2 = withStateLock(async () => {
      order.push('p2-start')
      await new Promise(r => setTimeout(r, 10))
      order.push('p2-end')
      return 'b'
    })

    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toBe('a')
    expect(r2).toBe('b')
    // p1 must complete before p2 starts
    expect(order).toEqual(['p1-start', 'p1-end', 'p2-start', 'p2-end'])
  })

  it('releases lock on error', async () => {
    const failing = withStateLock(() => { throw new Error('boom') })
    await expect(failing).rejects.toThrow('boom')

    // Lock should be released — next call should work
    const result = await withStateLock(() => 42)
    expect(result).toBe(42)
  })

  it('returns the value from the locked function', async () => {
    const result = await withStateLock(() => ({ ok: true, id: '123' }))
    expect(result).toEqual({ ok: true, id: '123' })
  })
})
