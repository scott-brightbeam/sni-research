/**
 * Parse podcast transcript frontmatter from markdown.
 * @param {string} content — full markdown file content
 * @returns {object|null} Parsed fields, or null if missing required fields
 */
export function parseTranscriptFrontmatter(content) {
  const warnings = []

  // Title from H1
  const titleMatch = content.match(/^# (.+)$/m)
  const title = titleMatch?.[1]?.trim() || null

  // Key-value pairs
  const dateMatch = content.match(/\*\*Date:\*\*\s*(.+)$/m)
  const sourceMatch = content.match(/\*\*Source:\*\*\s*(.+)$/m)
  const urlMatch = content.match(/\*\*URL:\*\*\s*(.+)$/m)
  const durationMatch = content.match(/\*\*Duration:\*\*\s*(.+)$/m)
  const transcriptSourceMatch = content.match(/\*\*Transcript source:\*\*\s*(.+)$/m)

  const date = dateMatch?.[1]?.trim() || null
  const source = sourceMatch?.[1]?.trim() || null
  const url = urlMatch?.[1]?.trim() || null
  const duration = durationMatch?.[1]?.trim() || null
  const transcriptSource = transcriptSourceMatch?.[1]?.trim() || null

  // Validate required fields
  if (!date) return null
  if (!source) return null

  // Validate ISO date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(date + 'T00:00:00Z')
  if (isNaN(parsed.getTime())) return null

  // Type detection
  const type = transcriptSource === 'newsletter' ? 'newsletter' : 'podcast'
  const isOnDemand = source === 'On-demand request'

  // Body: everything after the --- separator
  const separatorIndex = content.indexOf('\n---\n')
  const body = separatorIndex >= 0 ? content.slice(separatorIndex + 5).trim() : ''

  // Quality check: short transcript for long episode
  if (body.length < 1000 && duration) {
    const minMatch = duration.match(/(\d+)\s*min/)
    if (minMatch && parseInt(minMatch[1]) > 10) {
      warnings.push(`Suspiciously short transcript (${body.length} chars for ${duration} episode)`)
    }
  }

  return {
    title,
    date,
    source,
    url,
    duration,
    transcriptSource,
    type,
    isOnDemand,
    body,
    warnings
  }
}
