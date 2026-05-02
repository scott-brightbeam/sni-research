import { wrapTool } from './audit.js'
import { SearchArticlesIn } from './schemas.js'
import { getArticles } from '../../routes/articles.js'

/**
 * Map an articles-route row to the MCP-tool output shape. The route
 * returns rich rows with internal fields (keywords_matched, full_text,
 * etc.); the tool surface returns only the analyst-facing columns.
 */
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

export function registerReadTools(server) {
  // outputSchema omitted — shape enforced by shapeArticleRow, not a runtime
  // Zod check. Adding one would be future-proofing for clients that introspect
  // tool metadata; not required by the SDK.
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
}
