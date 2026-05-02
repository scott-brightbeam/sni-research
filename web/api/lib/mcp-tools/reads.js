import { wrapTool } from './audit.js'
import {
  SearchArticlesIn,
  SearchPodcastsIn,
  GetThemesIn,
  GetThemeDetailIn,
  GetPostBacklogIn,
  GetWritingPreferencesIn,
  GetDraftsIn,
  GetDecisionsIn,
} from './schemas.js'
import { getArticles } from '../../routes/articles.js'
import { handleGetPodcasts } from '../../routes/podcasts.js'
import {
  getThemes,
  getThemeWithEvidence,
  getDecisions,
  getPosts,
} from '../editorial-queries.js'
import { getDb } from '../db.js'
import config from '../config.js'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

function shapeArticleRow(row) {
  return {
    date: row.date_published,
    sector: row.sector,
    slug: row.slug,
    title: row.title,
    url: row.url,
    score: row.score,
    source: row.source,
  }
}

function matchesQuery(item, query) {
  const q = query.toLowerCase()
  return (item.title?.toLowerCase().includes(q) ||
          item.summary?.toLowerCase().includes(q))
}

export function registerReadTools(server) {
  wrapTool(server, 'sni_search_articles', SearchArticlesIn, undefined,
    async (args) => {
      const result = await getArticles({
        search: args.query,
        sector: args.sector,
        from: args.dateFrom,
        to: args.dateTo,
        limit: args.limit,
      })
      return result.articles.map(shapeArticleRow)
    }
  )

  wrapTool(server, 'sni_search_podcasts', SearchPodcastsIn, undefined,
    async (args) => {
      const result = await handleGetPodcasts({
        source: args.source,
        // handleGetPodcasts accepts week but not dateFrom; date-filtering happens below
      })
      return result.episodes
        .filter(ep => {
          if (args.query && !matchesQuery(ep, args.query)) return false
          if (args.dateFrom && ep.date < args.dateFrom) return false
          return true
        })
        .slice(0, args.limit)
        .map(ep => ({
          filename: ep.filename,
          date: ep.date,
          source: ep.source,
          title: ep.title,
          week: ep.week,
          summary: ep.digest?.summary ?? null,
        }))
    }
  )

  wrapTool(server, 'sni_get_themes', GetThemesIn, undefined,
    async (args) => {
      const db = getDb()
      const rows = await getThemes(db, {
        showArchived: args.archived === true,
      })
      return rows
        .slice(0, args.limit)
        .map(row => ({
          code: row.code,
          name: row.name,
          documentCount: Number(row.document_count ?? 0),
          evidenceCount: Number(row.evidence_count ?? 0),
        }))
    }
  )

  wrapTool(server, 'sni_get_theme_detail', GetThemeDetailIn, undefined,
    async (args) => {
      const db = getDb()
      const detail = await getThemeWithEvidence(db, args.code)
      if (!detail) {
        const err = new Error(`Theme not found: ${args.code}`)
        err.status = 404
        throw err
      }
      return detail
    }
  )

  wrapTool(server, 'sni_get_post_backlog', GetPostBacklogIn, undefined,
    async (args) => {
      const db = getDb()
      const rows = await getPosts(db, {
        status: args.status,
        priority: args.priority,
      })
      return rows
        .slice(0, args.limit)
        .map(row => ({
          id: row.id,
          title: row.title,
          status: row.status,
          freshness: row.freshness,
          priority: row.priority,
          dateAdded: row.date_added,
        }))
    }
  )

  wrapTool(server, 'sni_get_writing_preferences', GetWritingPreferencesIn, undefined,
    async () => {
      const root = process.env.SNI_ROOT || config.ROOT
      const prefPath = join(root, 'data/editorial/writing-preferences.md')
      const fpPath = join(root, 'data/editorial/vocabulary-fingerprint.json')
      const statePath = join(root, 'data/editorial/state.json')

      const writingPreferencesMd = existsSync(prefPath)
        ? readFileSync(prefPath, 'utf-8')
        : null

      let vocabularyFingerprint = null
      if (existsSync(fpPath)) {
        try { vocabularyFingerprint = JSON.parse(readFileSync(fpPath, 'utf-8')) } catch { /* skip */ }
      }

      let permanentPreferences = null
      if (existsSync(statePath)) {
        try {
          const state = JSON.parse(readFileSync(statePath, 'utf-8'))
          permanentPreferences = state.permanentPreferences ?? null
        } catch { /* skip */ }
      }

      return { vocabularyFingerprint, writingPreferencesMd, permanentPreferences }
    }
  )

  wrapTool(server, 'sni_get_drafts', GetDraftsIn, undefined,
    async (args) => {
      const root = process.env.SNI_ROOT || config.ROOT
      const outputDir = join(root, 'output')

      if (!existsSync(outputDir)) return []

      // Enumerate draft-week-N.md files in output/
      const allWeeks = readdirSync(outputDir)
        .map(f => { const m = f.match(/^draft-week-(\d+)\.md$/); return m ? parseInt(m[1]) : null })
        .filter(Boolean)
        .sort((a, b) => a - b)

      if (allWeeks.length === 0) return []

      const targetWeeks = args.week != null
        ? (allWeeks.includes(args.week) ? [args.week] : [])
        : allWeeks.slice(-args.limit).reverse()

      return targetWeeks.map(weekNum => {
        const draftPath = join(outputDir, `draft-week-${weekNum}.md`)
        const body = readFileSync(draftPath, 'utf-8')
        const sidecarPath = draftPath + '.verified'
        let verificationStatus = 'unverified'
        let verifiedAt = null
        if (existsSync(sidecarPath)) {
          try {
            const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
            verificationStatus = sidecar.source_draft_sha256 ? 'verified' : 'unverified'
            verifiedAt = sidecar.verifiedAt ?? null
          } catch { verificationStatus = 'invalid-sidecar' }
        }
        return {
          week: weekNum,
          verificationStatus,
          verifiedAt,
          summary: body.slice(0, 200),
        }
      })
    }
  )

  wrapTool(server, 'sni_get_decisions', GetDecisionsIn, undefined,
    async (args) => {
      const db = getDb()
      const rows = await getDecisions(db, { showArchived: args.archived === true })
      return rows
        .slice(0, args.limit)
        .map(row => ({
          id: row.id,
          session: row.session,
          title: row.title,
          decision: row.decision,
          dateAdded: row.created_at ?? null,
        }))
    }
  )
}
