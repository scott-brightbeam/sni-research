import { describe, it, expect } from 'bun:test'
import { getOverview, getRunDetail } from './routes/sources.js'

describe('getOverview', () => {
  it('returns runs array and health object', async () => {
    const result = await getOverview()
    expect(result).toHaveProperty('runs')
    expect(result).toHaveProperty('health')
    expect(Array.isArray(result.runs)).toBe(true)
  })

  it('runs are sorted newest first', async () => {
    const { runs } = await getOverview()
    if (runs.length >= 2) {
      expect(runs[0].date >= runs[1].date).toBe(true)
    }
  })

  it('each run has date, saved, fetchErrors, paywalled, elapsed', async () => {
    const { runs } = await getOverview()
    if (runs.length > 0) {
      const run = runs[0]
      expect(run).toHaveProperty('date')
      expect(typeof run.saved).toBe('number')
      expect(typeof run.fetchErrors).toBe('number')
      expect(typeof run.paywalled).toBe('number')
      expect(run).toHaveProperty('elapsed')
    }
  })

  it('new-format run has layerTotals with L1-L4 + headlines + rss', async () => {
    const { runs } = await getOverview()
    const newRun = runs.find(r => r.layerTotals !== null)
    if (newRun) {
      expect(newRun.layerTotals).toHaveProperty('L1')
      expect(newRun.layerTotals).toHaveProperty('L2')
      expect(newRun.layerTotals).toHaveProperty('L3')
      expect(newRun.layerTotals).toHaveProperty('L4')
      expect(newRun.layerTotals).toHaveProperty('headlines')
      expect(newRun.layerTotals).toHaveProperty('rss')
      expect(typeof newRun.layerTotals.L1.queries).toBe('number')
      expect(typeof newRun.layerTotals.L1.saved).toBe('number')
      expect(typeof newRun.layerTotals.L1.errors).toBe('number')
    }
  })

  it('old-format run has layerTotals: null', async () => {
    const { runs } = await getOverview()
    const oldRun = runs.find(r => r.layerTotals === null)
    if (oldRun) {
      expect(oldRun.layerTotals).toBe(null)
      expect(typeof oldRun.saved).toBe('number')
    }
  })

  it('health contains source objects with lastSuccess, consecutiveFailures, lastError', async () => {
    const { health } = await getOverview()
    const keys = Object.keys(health)
    if (keys.length > 0) {
      const source = health[keys[0]]
      expect(source).toHaveProperty('lastSuccess')
      expect(source).toHaveProperty('consecutiveFailures')
      expect(source).toHaveProperty('lastError')
    }
  })
})

describe('getRunDetail', () => {
  it('returns date, saved, queryStats, headlineStats for a valid date', async () => {
    const result = await getRunDetail('2026-03-05')
    if (result) {
      expect(result).toHaveProperty('date')
      expect(result).toHaveProperty('saved')
    }
  })

  it('returns queryStats as object for new-format run', async () => {
    const result = await getRunDetail('2026-03-05')
    if (result && result.queryStats) {
      expect(typeof result.queryStats).toBe('object')
      const firstKey = Object.keys(result.queryStats)[0]
      if (firstKey) {
        const val = result.queryStats[firstKey]
        expect(val).toHaveProperty('results')
        expect(val).toHaveProperty('saved')
      }
    }
  })

  it('returns null queryStats for old-format run', async () => {
    const result = await getRunDetail('2026-03-02')
    if (result) {
      expect(result.queryStats).toBe(null)
      expect(result.headlineStats).toBe(null)
    }
  })

  it('returns null for non-existent date', async () => {
    const result = await getRunDetail('1999-01-01')
    expect(result).toBe(null)
  })
})
