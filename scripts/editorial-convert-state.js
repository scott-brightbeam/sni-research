#!/usr/bin/env bun
/**
 * editorial-convert-state.js
 *
 * One-time conversion script: transforms the four markdown state documents
 * exported from the Claude.ai Project into data/editorial/state.json.
 *
 * Usage:
 *   bun scripts/editorial-convert-state.js \
 *     --analysis ~/Downloads/ANALYSIS-INDEX-SESSION15-FINAL.md \
 *     --themes ~/Downloads/THEME-REGISTRY-SESSION15-FINAL.md \
 *     --backlog ~/Downloads/POST-BACKLOG-SESSION15-FINAL.md \
 *     --decisions ~/Downloads/DECISION-LOG-SESSION15-FINAL.md \
 *     [--dry-run]
 *
 * Writes to: data/editorial/state.json
 * Backs up any existing state.json before overwriting.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import { join, resolve } from 'path'
import { parseArgs } from 'util'

const ROOT = resolve(import.meta.dir, '..')

// ── Argument parsing ─────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    analysis: { type: 'string' },
    themes: { type: 'string' },
    backlog: { type: 'string' },
    decisions: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: false,
})

if (!args.analysis || !args.themes || !args.backlog || !args.decisions) {
  console.error('Usage: bun scripts/editorial-convert-state.js --analysis <file> --themes <file> --backlog <file> --decisions <file> [--dry-run]')
  process.exit(1)
}

// ── Read source files ────────────────────────────────────

const analysisMd = readFileSync(args.analysis, 'utf-8')
const themesMd = readFileSync(args.themes, 'utf-8')
const backlogMd = readFileSync(args.backlog, 'utf-8')
const decisionsMd = readFileSync(args.decisions, 'utf-8')

// ── Parse Analysis Index ─────────────────────────────────

function parseAnalysisIndex(md) {
  const entries = {}

  // Split on ### headings that look like document entries (filenames or titles)
  const blocks = md.split(/\n### /).slice(1) // skip header content before first ###

  // Track document numbering for entries without explicit numbers
  let autoDocNum = 1
  // Map from session info to help assign numbers
  const sessionRanges = {
    // Sessions 1-5: ~29 docs, numbered 1-29
    // Session 6: #30-35
    // Session 9: #36-41
    // Session 10: #42-71
    // Session 11: #72-99
    // Session 12: #100-108
    // Session 14: #109-119
    // Session 15: #120-125
  }

  for (const block of blocks) {
    // Skip session headers and non-document blocks
    if (block.startsWith('Sessions 1-5:') || block.startsWith('Session ') ||
        block.startsWith('Corpus Statistics') || block.startsWith('Rotation Candidates')) continue

    const lines = block.split('\n')
    const titleLine = lines[0].trim()

    // Skip if it's just a session header
    if (/^Session \d/.test(titleLine) && !titleLine.includes('.md')) continue

    // Extract fields from bullet points
    const fieldMap = {}
    const isReconstructed = titleLine.includes('[RECONSTRUCTED]')

    for (const line of lines) {
      const match = line.match(/^- (\w[\w\s/]*?):\s*(.+)/)
      if (match) {
        const key = match[1].trim().toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_')
        fieldMap[key] = match[2].trim()
      }
    }

    // Determine title
    let title = titleLine.replace(/\s*\[RECONSTRUCTED\]\s*/, '').replace(/\.md$/, '')
    // Strip the filename prefix (date-source-) if present
    const fileMatch = title.match(/^\d{4}-\d{2}-\d{2}-[\w-]+-(.+)$/)
    if (fileMatch) {
      title = fileMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }
    // If title still has the full filename format, try to use Source + a cleaner title
    if (title.match(/^\d{4}-\d{2}-\d{2}/)) {
      // Use the key_themes or just clean up
      title = title.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
    }

    // Determine document number — check if mentioned in text
    let docNum = autoDocNum++

    // Map source
    const source = fieldMap.source || 'Unknown'
    const host = fieldMap.author_host || fieldMap.host || null
    const participants = fieldMap.key_participants || null

    // Map date
    const dateContent = fieldMap.date_of_content || null
    const dateProcessed = fieldMap.date_processed || null

    // Map status
    let status = 'active'
    const rawStatus = (fieldMap.status || '').toLowerCase()
    if (rawStatus.includes('retired') || rawStatus.includes('retire')) status = 'retired'
    else if (rawStatus.includes('stub')) status = 'stub'

    // Map tier
    let tier = 1
    if (rawStatus.includes('tier 2') || (fieldMap.key_themes || '').toLowerCase().includes('geopolitical')) tier = 2
    if (status === 'stub') tier = 0

    // Extract themes — look for T-codes in key themes or summary
    const themeText = (fieldMap.key_themes || '') + ' ' + (fieldMap.summary || '')
    const themeCodes = [...new Set((themeText.match(/T\d{2}/g) || []))]

    // Map post potential
    const rawPP = (fieldMap.post_potential || '').toLowerCase()
    let postPotential = 'none'
    if (rawPP.includes('very high') || rawPP.includes('very-high')) postPotential = 'very-high'
    else if (rawPP.includes('high')) postPotential = 'high'
    else if (rawPP.includes('medium-high') || rawPP.includes('medium high')) postPotential = 'medium-high'
    else if (rawPP.includes('medium')) postPotential = 'medium'
    else if (rawPP.includes('low-medium') || rawPP.includes('low medium')) postPotential = 'low'
    else if (rawPP.includes('low') || rawPP.includes('very low')) postPotential = 'low'

    // Determine session number
    let session = 0
    const dpStr = (dateProcessed || '').toLowerCase()
    if (dpStr.includes('pre-session 6') || dpStr.includes('pre session 6')) session = 1 // Sessions 1-5
    else if (fieldMap.date_processed) {
      // Try to match date to session
      const dp = fieldMap.date_processed
      if (dp.includes('21 February 2026') || dp.includes('2026-02-21')) session = 6
      else if (dp.includes('24 February 2026') || dp.includes('2026-02-24')) session = 9
      else if (dp.includes('5 March 2026') || dp.includes('2026-03-05') || dp.includes('5 Mar')) session = 10
      else if (dp.includes('11 March 2026') || dp.includes('2026-03-11') || dp.includes('11 Mar')) session = 11
      else if (dp.includes('15 March 2026') || dp.includes('2026-03-15') || dp.includes('15 Mar')) session = 12
      else if (dp.includes('19 March 2026') || dp.includes('2026-03-19') || dp.includes('19 Mar')) session = 14
      else if (dp.includes('20 March 2026') || dp.includes('2026-03-20') || dp.includes('20 Mar')) session = 15
    }

    const summary = fieldMap.summary || ''

    entries[String(docNum)] = {
      title: title.length > 200 ? title.slice(0, 200) : title,
      source,
      host,
      ...(participants ? { participants } : {}),
      date: dateContent,
      dateProcessed: dateProcessed,
      session,
      tier,
      status,
      themes: themeCodes,
      summary,
      keyThemes: fieldMap.key_themes || '',
      postPotential,
      postPotentialReasoning: '',
      _reconstructed: isReconstructed,
    }
  }

  return entries
}

// ── Parse Theme Registry ─────────────────────────────────

function parseThemeRegistry(md) {
  const themes = {}

  // Pre-process: expand range headings like "## T12-T13:" into individual entries
  // and remove cross-connection note headings that would overwrite real themes
  let processed = md
    .replace(/\n## T21[–-]T26 Cross-Connection Note.*$/m, '\n## _CROSS_NOTE_T21_T26:')
    .replace(/\n## T(\d{2})[–-]T(\d{2}):?\s*(.*)/g, (match, start, end, rest) => {
      const entries = []
      for (let n = parseInt(start); n <= parseInt(end); n++) {
        const code = String(n).padStart(2, '0')
        entries.push(`\n## T${code}: ${rest.trim() || '[Base Document Content Required]'}`)
      }
      return entries.join('\n')
    })

  // Split on ## T{NN}: headings
  const blocks = processed.split(/\n## (T\d{2}|_CROSS_NOTE_T21_T26):?\s*/)

  for (let i = 1; i < blocks.length; i += 2) {
    const code = blocks[i]
    const content = blocks[i + 1] || ''

    if (!code.match(/^T\d{2}$/)) continue // skip non-theme blocks like _CROSS_NOTE

    // Extract name from first line
    const lines = content.split('\n')
    let name = lines[0].trim()
    // Some theme names have extra formatting
    name = name.replace(/\s*\(.*?\)\s*$/, '').trim() // Remove parenthetical
    if (!name || name === '[Base Document Content Required]') {
      name = `Theme ${code} (base document content required)`
    }

    // Extract strength
    const strengthMatch = content.match(/Strength:\s*(.+?)(?:\n|$)/)
    const strengthStr = strengthMatch ? strengthMatch[1].trim() : ''

    // Count documents from strength line
    const docCountMatch = strengthStr.match(/~?(\d+)\//)
    const documentCount = docCountMatch ? parseInt(docCountMatch[1]) : 0

    // Find last updated session
    const sessionMatches = content.match(/Session (\d+)/g) || []
    const sessionNums = sessionMatches.map(s => parseInt(s.match(/\d+/)[0]))
    const lastUpdated = sessionNums.length > 0 ? `Session ${Math.max(...sessionNums)}` : 'Unknown'
    const created = sessionNums.length > 0 ? `Session ${Math.min(...sessionNums)}` : 'Session 1'

    // Extract evidence blocks
    const evidence = []
    const evidenceRegex = /- (.+?)\((.+?)\):\s*(.+?)(?=\n-|\n\n|\nSession|\nCross-connections|$)/gs
    let evMatch
    // Simpler approach: look for lines starting with "- " in evidence sections
    const evidenceSections = content.split(/(?:Evidence|Session \d+ evidence):/i)
    for (let j = 1; j < evidenceSections.length; j++) {
      const section = evidenceSections[j]
      // Determine session for this section
      let evSession = 1
      const secHeader = content.split(/(?:Evidence|Session \d+ evidence):/i)[j - 1] || ''
      const sesMatch = secHeader.match(/Session (\d+)/)
      if (sesMatch) evSession = parseInt(sesMatch[1])

      const evLines = section.split('\n- ')
      for (const evLine of evLines) {
        if (!evLine.trim()) continue
        const cleaned = evLine.replace(/^\s*\[BASE\]\s*/i, '').trim()
        if (!cleaned || cleaned.startsWith('Sub-themes') || cleaned.startsWith('Cross-connections')) break

        // Try to extract source and content
        const sourceMatch = cleaned.match(/^(.+?)\((.+?)\):\s*(.+)/)
        if (sourceMatch) {
          evidence.push({
            session: evSession,
            source: `${sourceMatch[1].trim()} (${sourceMatch[2].trim()})`,
            content: sourceMatch[3].trim(),
          })
        } else if (cleaned.length > 20) {
          evidence.push({
            session: evSession,
            source: 'Unknown',
            content: cleaned.slice(0, 500),
          })
        }
      }
    }

    // Extract cross-connections
    const crossConnections = []
    const ccSection = content.match(/Cross-connections:\s*(.+?)(?=\n\n---|\n## |$)/s)
    if (ccSection) {
      const ccMatches = ccSection[1].matchAll(/(T\d{2})\s*\(([^)]+)\)/g)
      for (const ccm of ccMatches) {
        crossConnections.push({
          theme: ccm[1],
          reasoning: ccm[2].trim(),
        })
      }
    }

    themes[code] = {
      name,
      created,
      lastUpdated,
      documentCount,
      evidence: evidence.slice(-9), // Keep last 9 evidence entries (3 sessions × ~3)
      crossConnections,
    }
  }

  return themes
}

// ── Parse Post Backlog ───────────────────────────────────

function parsePostBacklog(md) {
  const posts = {}

  // Split on ### #NN: headings
  const blocks = md.split(/\n### #(\d+):?\s*/)

  for (let i = 1; i < blocks.length; i += 2) {
    const id = blocks[i]
    const content = blocks[i + 1] || ''

    if (!id.match(/^\d+$/)) continue

    const lines = content.split('\n')
    let title = lines[0].trim()

    // Check if this is a base-document reference
    if (title.includes('[From base document') || title.includes('see base document')) {
      posts[id] = {
        title: `Post #${id} (from base document — not available)`,
        workingTitle: null,
        status: 'unknown',
        dateAdded: null,
        session: 0,
        coreArgument: 'Entry from base document — not provided in export.',
        format: null,
        sourceDocuments: [],
        freshness: null,
        priority: 'unknown',
        notes: 'Base document entry not reproduced in Session 15 export.',
        _baseDocumentRef: true,
      }
      continue
    }

    // Extract fields
    const fieldMap = {}
    for (const line of lines) {
      const match = line.match(/^- (\w[\w\s/()]*?):\s*(.+)/)
      if (match) {
        const key = match[1].trim().toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '')
        fieldMap[key] = match[2].trim()
      }
    }

    // Map status
    const rawStatus = (fieldMap.status || 'suggested').toLowerCase()
    let status = 'suggested'
    if (rawStatus.includes('published')) status = 'published'
    else if (rawStatus.includes('approved')) status = 'approved'
    else if (rawStatus.includes('in-progress') || rawStatus.includes('in progress')) status = 'in-progress'
    else if (rawStatus.includes('rejected')) status = 'rejected'
    else if (rawStatus.includes('archived')) status = 'archived'

    // Map priority
    const rawPriority = (fieldMap.priority || 'medium').toLowerCase()
    let priority = 'medium'
    if (rawPriority.includes('immediate')) priority = 'immediate'
    else if (rawPriority.includes('highest') || rawPriority.includes('very high')) priority = 'immediate'
    else if (rawPriority.includes('high')) priority = 'high'
    else if (rawPriority.includes('medium-high') || rawPriority.includes('medium high')) priority = 'medium-high'

    // Map format
    const rawFormat = (fieldMap.recommended_format || fieldMap.format_used || fieldMap.format || '').toLowerCase()
    let format = null
    if (rawFormat.includes('quiet') || rawFormat.includes('f5')) format = 'quiet-observation'
    else if (rawFormat.includes('concept') || rawFormat.includes('f1')) format = 'concept-contrast'
    else if (rawFormat.includes('news') || rawFormat.includes('decoder')) format = 'news-decoder'
    else if (rawFormat.includes('honest') || rawFormat.includes('confession')) format = 'honest-confession'
    else if (rawFormat.includes('behavio') || rawFormat.includes('paradox')) format = 'behavioural-paradox'
    else if (rawFormat.includes('practitioner')) format = 'practitioners-take'
    else if (rawFormat.includes('long-form') || rawFormat.includes('blog')) format = 'long-form'

    // Map freshness
    const rawFresh = (fieldMap.freshness || '').toLowerCase()
    let freshness = 'evergreen'
    if (rawFresh.includes('very timely') || rawFresh.includes('very-timely')) freshness = 'very-timely'
    else if (rawFresh.includes('timely')) freshness = 'timely-evergreen'

    // Extract source documents — look for #NN references
    const srcDocs = [...new Set(
      ((fieldMap.source_documents || '') + ' ' + content)
        .match(/#(\d{1,3})(?!\d)/g)?.map(s => parseInt(s.slice(1))) || []
    )].filter(n => n !== parseInt(id)) // Don't self-reference

    // Determine session
    let session = 0
    const dateAdded = fieldMap.date_added || null
    if (dateAdded) {
      if (dateAdded.includes('21 February')) session = 7
      else if (dateAdded.includes('24 February')) session = 9
      else if (dateAdded.includes('5 March')) session = 10
      else if (dateAdded.includes('11 March')) session = 11
      else if (dateAdded.includes('15 March')) session = 12
      else if (dateAdded.includes('19 March')) session = 14
      else if (dateAdded.includes('20 March')) session = 15
    }

    posts[id] = {
      title,
      workingTitle: fieldMap.working_title || null,
      status,
      dateAdded,
      ...(fieldMap.date_published ? { datePublished: fieldMap.date_published } : {}),
      session,
      coreArgument: fieldMap.core_argument || '',
      format,
      sourceDocuments: srcDocs,
      freshness,
      priority,
      notes: fieldMap.notes || fieldMap.publication_notes || '',
    }
  }

  return posts
}

// ── Parse Decision Log ───────────────────────────────────

function parseDecisionLog(md) {
  const decisions = []
  const permanentPreferences = []

  // Extract permanent editorial preferences
  const prefSection = md.match(/## Permanent Editorial Preferences.*?\n---/s)
  if (prefSection) {
    const prefLines = prefSection[0].match(/^\d+\.\s+.+$/gm) || []
    for (const line of prefLines) {
      const match = line.match(/^\d+\.\s+(.+?):\s*(.+)/)
      if (match) {
        permanentPreferences.push({
          title: match[1].trim(),
          content: match[2].trim(),
        })
      }
    }
  }

  // Extract session decisions
  const sessionBlocks = md.split(/\n### Session (\d+):/)
  for (let i = 1; i < sessionBlocks.length; i += 2) {
    const sessionNum = parseInt(sessionBlocks[i])
    const content = sessionBlocks[i + 1] || ''

    // Find Decision X.Y blocks
    const decisionBlocks = content.split(/\n(?:\*\*)?Decision (\d+\.\d+):?\s*/)
    for (let j = 1; j < decisionBlocks.length; j += 2) {
      const decId = decisionBlocks[j]
      const decContent = decisionBlocks[j + 1] || ''

      // Extract title from first line
      const titleLine = decContent.split('\n')[0].replace(/\*\*/g, '').trim()

      // Extract the decision and reasoning
      const decBody = decContent.split('\n').slice(1).join('\n').trim()

      // Try to separate decision from reasoning
      let decision = ''
      let reasoning = ''
      const reasoningMatch = decBody.match(/Reasoning:\s*(.+)/s)
      if (reasoningMatch) {
        reasoning = reasoningMatch[1].trim().split('\n')[0]
        decision = decBody.slice(0, decBody.indexOf('Reasoning:')).trim()
      } else {
        decision = decBody.split('\n').slice(0, 3).join(' ').trim()
      }

      decisions.push({
        id: decId,
        session: sessionNum,
        title: titleLine || `Decision ${decId}`,
        decision: decision.slice(0, 500),
        reasoning: reasoning.slice(0, 500),
      })
    }
  }

  return { decisions, permanentPreferences }
}

// ── Compute corpus stats ─────────────────────────────────

function computeCorpusStats(analysisIndex, themeRegistry, postBacklog) {
  const docs = Object.values(analysisIndex)
  const posts = Object.values(postBacklog)

  return {
    totalDocuments: docs.length,
    activeTier1: docs.filter(d => d.status === 'active' && d.tier === 1).length,
    activeTier2: docs.filter(d => d.status === 'active' && d.tier === 2).length,
    retired: docs.filter(d => d.status === 'retired').length,
    stubs: docs.filter(d => d.status === 'stub' || d.tier === 0).length,
    referenceDocuments: 2, // Insurance themes + Article 49 brief
    activeThemes: Object.keys(themeRegistry).length,
    totalPosts: posts.length,
    postsPublished: posts.filter(p => p.status === 'published').length,
    postsApproved: posts.filter(p => p.status === 'approved').length,
  }
}

// ── Extract rotation candidates ──────────────────────────

function extractRotationCandidates(md) {
  const candidates = []
  const section = md.match(/## Rotation Candidates[\s\S]*?(?=\n---\s*$|\Z)/m)
  if (!section) return candidates

  const lines = section[0].split('\n')
  for (const line of lines) {
    const match = line.match(/^- (.+?)(?:\s*\((.+?)\))?\s*$/)
    if (match) {
      candidates.push({
        filename: match[1].trim(),
        reason: match[2] || '',
        priority: 'low',
      })
    }
    // Also match #NNN format
    const numMatch = line.match(/^- #(\d+):\s*(.+?)(?:\s*\((.+?)\))?\s*$/)
    if (numMatch) {
      candidates.push({
        docId: parseInt(numMatch[1]),
        reason: `${numMatch[2].trim()}${numMatch[3] ? ' — ' + numMatch[3] : ''}`,
        priority: 'low',
      })
    }
  }

  return candidates
}

// ── Main ─────────────────────────────────────────────────

console.log('Parsing Analysis Index...')
const analysisIndex = parseAnalysisIndex(analysisMd)
console.log(`  → ${Object.keys(analysisIndex).length} entries`)

console.log('Parsing Theme Registry...')
const themeRegistry = parseThemeRegistry(themesMd)
console.log(`  → ${Object.keys(themeRegistry).length} themes`)

console.log('Parsing Post Backlog...')
const postBacklog = parsePostBacklog(backlogMd)
console.log(`  → ${Object.keys(postBacklog).length} posts`)

console.log('Parsing Decision Log...')
const { decisions: decisionLog, permanentPreferences } = parseDecisionLog(decisionsMd)
console.log(`  → ${decisionLog.length} decisions, ${permanentPreferences.length} permanent preferences`)

console.log('Computing corpus stats...')
const corpusStats = computeCorpusStats(analysisIndex, themeRegistry, postBacklog)

console.log('Extracting rotation candidates...')
const rotationCandidates = extractRotationCandidates(analysisMd)
console.log(`  → ${rotationCandidates.length} candidates`)

// Build the state document
const state = {
  counters: {
    nextSession: 16,
    nextDocument: Math.max(...Object.keys(analysisIndex).map(Number), 0) + 1,
    nextPost: Math.max(...Object.keys(postBacklog).map(Number), 0) + 1,
  },
  analysisIndex,
  themeRegistry,
  postBacklog,
  decisionLog,
  permanentPreferences,
  corpusStats,
  rotationCandidates,
}

// Summary
console.log('\n── State Document Summary ──')
console.log(`  Documents: ${Object.keys(analysisIndex).length} (next: #${state.counters.nextDocument})`)
console.log(`  Themes: ${Object.keys(themeRegistry).length}`)
console.log(`  Posts: ${Object.keys(postBacklog).length} (next: #${state.counters.nextPost})`)
console.log(`    Published: ${corpusStats.postsPublished}`)
console.log(`    Approved: ${corpusStats.postsApproved}`)
console.log(`  Decisions: ${decisionLog.length}`)
console.log(`  Next session: ${state.counters.nextSession}`)
console.log(`  Corpus: ${corpusStats.activeTier1} Tier 1, ${corpusStats.activeTier2} Tier 2, ${corpusStats.retired} retired, ${corpusStats.stubs} stubs`)

if (args['dry-run']) {
  console.log('\n[DRY RUN] Would write to data/editorial/state.json')
  // Print a sample entry from each section
  const firstDoc = Object.entries(analysisIndex)[0]
  if (firstDoc) console.log('\nSample Analysis Index entry:', JSON.stringify(firstDoc, null, 2))
  const firstTheme = Object.entries(themeRegistry)[0]
  if (firstTheme) console.log('\nSample Theme entry:', JSON.stringify({ [firstTheme[0]]: { ...firstTheme[1], evidence: `[${firstTheme[1].evidence.length} entries]` } }, null, 2))
  const firstPost = Object.entries(postBacklog).find(([, v]) => !v._baseDocumentRef)
  if (firstPost) console.log('\nSample Post entry:', JSON.stringify(firstPost, null, 2))
  if (decisionLog[0]) console.log('\nSample Decision entry:', JSON.stringify(decisionLog[0], null, 2))
  process.exit(0)
}

// Write output
const outDir = join(ROOT, 'data/editorial')
mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, 'backups'), { recursive: true })

const outPath = join(outDir, 'state.json')
if (existsSync(outPath)) {
  const backupPath = join(outDir, 'backups', `state-pre-conversion-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  copyFileSync(outPath, backupPath)
  console.log(`\nBacked up existing state.json to ${backupPath}`)
}

// Write-validate-swap pattern
const tmpPath = outPath + '.tmp'
const json = JSON.stringify(state, null, 2)
writeFileSync(tmpPath, json)

// Validate by parsing back
const parsed = JSON.parse(readFileSync(tmpPath, 'utf-8'))
if (!parsed.counters || !parsed.analysisIndex || !parsed.themeRegistry || !parsed.postBacklog) {
  throw new Error('Validation failed: state.json missing required top-level keys')
}

// Rename
const { renameSync } = await import('fs')
renameSync(tmpPath, outPath)

console.log(`\n✓ Wrote ${(json.length / 1024).toFixed(1)}KB to ${outPath}`)

// Also create empty published.json if it doesn't exist
const pubPath = join(outDir, 'published.json')
if (!existsSync(pubPath)) {
  const published = {
    newsletters: [],
    linkedin: [
      { postId: 43, date: '2026-02-17', title: 'How AI shows us psychological safety isn\'t enough' },
      { postId: 71, date: '2026-03-19', title: 'Post #71 (title from Session 13 draft)' },
    ],
  }
  writeFileSync(pubPath, JSON.stringify(published, null, 2))
  console.log(`✓ Created ${pubPath} with 2 published posts (#43, #71)`)
}

// Create empty notifications.json
const notifPath = join(outDir, 'notifications.json')
if (!existsSync(notifPath)) {
  writeFileSync(notifPath, '[]')
  console.log(`✓ Created ${notifPath}`)
}

// Create empty activity.json
const activityPath = join(outDir, 'activity.json')
if (!existsSync(activityPath)) {
  writeFileSync(activityPath, '[]')
  console.log(`✓ Created ${activityPath}`)
}

console.log('\nDone. Review state.json and adjust any parsing issues manually.')
