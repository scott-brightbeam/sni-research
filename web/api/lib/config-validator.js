const VALID_SECTORS = ['general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

const VALID_FEED_CATEGORIES = [
  'biopharma', 'medtech', 'manufacturing', 'insurance',
  'cross_sector', 'ai_labs', 'tech_press', 'newsletters', 'wire_services'
]

export function validateOffLimits(data) {
  if (!data || typeof data !== 'object') {
    throw validationError('Off-limits config must be an object')
  }
  for (const [key, value] of Object.entries(data)) {
    if (!/^week_\d+$/.test(key)) {
      throw validationError(`Invalid key "${key}" — must match week_N`)
    }
    if (!Array.isArray(value)) {
      throw validationError(`"${key}" must be an array`)
    }
    for (const entry of value) {
      if (!entry.company || typeof entry.company !== 'string') {
        throw validationError(`Each entry in "${key}" must have a "company" string`)
      }
      if (!entry.topic || typeof entry.topic !== 'string') {
        throw validationError(`Each entry in "${key}" must have a "topic" string`)
      }
    }
  }
}

export function validateSources(data) {
  if (!data || typeof data !== 'object') {
    throw validationError('Sources config must be an object')
  }
  if (!data.rss_feeds || typeof data.rss_feeds !== 'object') {
    throw validationError('Sources must have "rss_feeds" object')
  }
  for (const [cat, feeds] of Object.entries(data.rss_feeds)) {
    if (!VALID_FEED_CATEGORIES.includes(cat)) {
      throw validationError(`Unknown feed category "${cat}"`)
    }
    if (!Array.isArray(feeds)) {
      throw validationError(`"${cat}" feeds must be an array`)
    }
    for (const feed of feeds) {
      if (!feed.url || typeof feed.url !== 'string') {
        throw validationError(`Each feed in "${cat}" must have a "url" string`)
      }
      if (!feed.name || typeof feed.name !== 'string') {
        throw validationError(`Each feed in "${cat}" must have a "name" string`)
      }
    }
  }
  if (data.general_search_queries) {
    if (!Array.isArray(data.general_search_queries)) {
      throw validationError('"general_search_queries" must be an array')
    }
    for (const q of data.general_search_queries) {
      if (typeof q !== 'string' || q.trim().length === 0) {
        throw validationError('Each search query must be a non-empty string')
      }
    }
  }
}

export function validateSectors(data) {
  if (!data || typeof data !== 'object') {
    throw validationError('Sectors config must be an object')
  }
  if (!data.sectors || typeof data.sectors !== 'object') {
    throw validationError('Must have "sectors" key')
  }
  for (const [key, sector] of Object.entries(data.sectors)) {
    if (!VALID_SECTORS.includes(key)) {
      throw validationError(`Unknown sector "${key}"`)
    }
    if (!sector.display_name || typeof sector.display_name !== 'string') {
      throw validationError(`Sector "${key}" must have a "display_name" string`)
    }
    if (!Array.isArray(sector.required_any_group_1) || sector.required_any_group_1.length === 0) {
      throw validationError(`Sector "${key}" must have a non-empty "required_any_group_1" array`)
    }
    if (!Array.isArray(sector.required_any_group_2) || sector.required_any_group_2.length === 0) {
      throw validationError(`Sector "${key}" must have a non-empty "required_any_group_2" array`)
    }
    if (!Array.isArray(sector.boost)) {
      throw validationError(`Sector "${key}" must have a "boost" array`)
    }
  }
}

function validationError(message) {
  const err = new Error(`Config validation failed: ${message}`)
  err.status = 422
  return err
}
