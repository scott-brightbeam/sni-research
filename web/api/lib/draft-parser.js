const CONTAINER_PATTERNS = [
  /^## In (Biopharma|Medtech|Manufacturing|Insurance)$/,
  /^## AI$/,
  /^Biopharma$/,
  /^Medtech$/,
  /^Manufacturing$/,
  /^Insurance$/,
  /^## But what set podcast tongues/,
]

const BARE_LINK_RE = /^\[(.+)\]\((https?:\/\/.+)\)$/
const H3_RE = /^### (.+)$/

/**
 * Parse a newsletter draft into story sections.
 * @param {string} markdown — full draft markdown
 * @returns {Array<{heading: string, body: string, urls: string[], container: string}>}
 */
export function parseDraftSections(markdown) {
  if (!markdown.trim()) return []

  const lines = markdown.split('\n')
  const sections = []
  let currentContainer = ''
  let currentSection = null

  function flushSection() {
    if (currentSection) {
      currentSection.body = currentSection.body.trim()
      sections.push(currentSection)
      currentSection = null
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Check for container headers
    const isContainer = CONTAINER_PATTERNS.some(p => p.test(trimmed))
    if (isContainer) {
      flushSection()
      if (/podcast tongues/.test(trimmed)) {
        currentContainer = 'podcast'
      } else {
        currentContainer = trimmed.replace(/^## ?(In )?/, '')
      }
      continue
    }

    // Check for bare markdown link story entry
    const linkMatch = trimmed.match(BARE_LINK_RE)
    if (linkMatch) {
      flushSection()
      currentSection = {
        heading: linkMatch[1],
        body: '',
        urls: [linkMatch[2]],
        container: currentContainer
      }
      continue
    }

    // Check for H3 story entry
    const h3Match = trimmed.match(H3_RE)
    if (h3Match) {
      flushSection()
      currentSection = {
        heading: h3Match[1],
        body: '',
        urls: [],
        container: currentContainer
      }
      continue
    }

    // Body text — append to current section
    if (currentSection && trimmed) {
      currentSection.body += (currentSection.body ? '\n' : '') + trimmed
      // Extract any inline URLs
      const inlineUrls = [...trimmed.matchAll(/\(https?:\/\/[^)]+\)/g)]
      for (const match of inlineUrls) {
        const url = match[0].slice(1, -1)
        if (!currentSection.urls.includes(url)) {
          currentSection.urls.push(url)
        }
      }
    }
  }

  flushSection()
  return sections
}
