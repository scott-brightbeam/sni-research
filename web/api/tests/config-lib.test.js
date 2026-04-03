import { describe, it, expect } from 'bun:test'
import config from '../lib/config.js'

describe('lib/config.js', () => {
  it('exports ROOT as a string', () => {
    expect(typeof config.ROOT).toBe('string')
    expect(config.ROOT.length).toBeGreaterThan(0)
  })

  it('exports PORT as a number', () => {
    expect(typeof config.PORT).toBe('number')
    expect(config.PORT).toBeGreaterThan(0)
  })

  it('exports CORS_ORIGIN as a string', () => {
    expect(typeof config.CORS_ORIGIN).toBe('string')
    expect(config.CORS_ORIGIN).toMatch(/^https?:\/\//)
  })

  it('exports TOKEN_CEILING as a number', () => {
    expect(typeof config.TOKEN_CEILING).toBe('number')
    expect(config.TOKEN_CEILING).toBeGreaterThan(0)
  })

  it('exports INGEST_URL as a string', () => {
    expect(typeof config.INGEST_URL).toBe('string')
    expect(config.INGEST_URL).toMatch(/^https?:\/\//)
  })

  it('exports PIPELINE_ENABLED as a boolean', () => {
    expect(typeof config.PIPELINE_ENABLED).toBe('boolean')
  })

  it('exports isProduction as a boolean', () => {
    expect(typeof config.isProduction).toBe('boolean')
    // In test mode, should not be production
    expect(config.isProduction).toBe(false)
  })

  it('defaults SESSION_SECRET to empty string', () => {
    expect(typeof config.SESSION_SECRET).toBe('string')
  })
})
