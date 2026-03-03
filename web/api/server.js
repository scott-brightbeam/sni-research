import { getStatus } from './routes/status.js'
import { getArticles, getArticle, getFlaggedArticles } from './routes/articles.js'

const PORT = 3900

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  })
}

function parseQuery(url) {
  const params = new URL(url).searchParams
  const obj = {}
  for (const [k, v] of params) obj[k] = v
  return obj
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    try {
      // --- Status ---
      if (path === '/api/status' && req.method === 'GET') {
        return json(await getStatus())
      }

      // --- Articles ---
      if (path === '/api/articles' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getArticles(query))
      }

      if (path === '/api/articles/flagged' && req.method === 'GET') {
        return json(await getFlaggedArticles())
      }

      // Single article: /api/articles/:date/:sector/:slug
      const articleMatch = path.match(/^\/api\/articles\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/([^/]+)$/)
      if (articleMatch && req.method === 'GET') {
        const [, date, sector, slug] = articleMatch
        const article = await getArticle(date, sector, slug)
        if (!article) return json({ error: 'Not found' }, 404)
        return json(article)
      }

      // --- Health ---
      if (path === '/api/health') {
        return json({ status: 'ok', port: PORT })
      }

      // --- 404 ---
      return json({ error: 'Not found' }, 404)

    } catch (err) {
      console.error('API error:', err)
      return json({ error: err.message }, 500)
    }
  }
})

console.log(`SNI API server listening on http://localhost:${PORT}`)
