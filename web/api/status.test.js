import { describe, it, expect } from 'bun:test'
import { getStatus } from './routes/status.js'

describe('getStatus', () => {
  it('returns an object with lastRun, articles, and nextPipeline', async () => {
    const result = await getStatus()
    expect(result).toHaveProperty('lastRun')
    expect(result).toHaveProperty('articles')
    expect(result).toHaveProperty('nextPipeline')
  })

  it('lastRun contains mode and stages array', async () => {
    const { lastRun } = await getStatus()
    // lastRun may be null if no runs exist
    if (lastRun) {
      expect(lastRun).toHaveProperty('mode')
      expect(lastRun).toHaveProperty('stages')
      expect(Array.isArray(lastRun.stages)).toBe(true)
    }
  })

  it('articles contains today and byDate counts', async () => {
    const { articles } = await getStatus()
    expect(typeof articles.today).toBe('number')
    expect(typeof articles.total).toBe('number')
    expect(typeof articles.byDate).toBe('object')
  })
})
