import { getStatus } from './routes/status.js'
import { getArticles, getArticle, getFlaggedArticles, patchArticle, deleteArticle, ingestArticle, getLastUpdated } from './routes/articles.js'
import { getDraft, saveDraft, getDraftHistory, handleCheckOverlap } from './routes/draft.js'
import { handleChat, listThreads, createThread, renameThread, getHistory, createPin, listPins, deletePin, getUsage } from './routes/chat.js'
import { getUsage as getUsageByPeriod } from './routes/usage.js'
import { getConfig, putConfig } from './routes/config.js'
import { getOverview, getRunDetail } from './routes/sources.js'
import { listPublished, getPublished, savePublished, extractExclusions } from './routes/published.js'
import { handleGetPodcasts, handleGetTranscript } from './routes/podcasts.js'

const PORT = 3900

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
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

      if (path === '/api/articles/last-updated' && req.method === 'GET') {
        return json(await getLastUpdated())
      }

      // Single article: /api/articles/:date/:sector/:slug
      const articleMatch = path.match(/^\/api\/articles\/(\d{4}-\d{2}-\d{2})\/([\w-]+)\/([\w-]+)$/)
      if (articleMatch && req.method === 'GET') {
        const [, date, sector, slug] = articleMatch
        const article = await getArticle(date, sector, slug)
        if (!article) return json({ error: 'Not found' }, 404)
        return json(article)
      }

      if (articleMatch && req.method === 'PATCH') {
        const [, date, sector, slug] = articleMatch
        const body = await req.json()
        return json(await patchArticle(date, sector, slug, body))
      }

      if (articleMatch && req.method === 'DELETE') {
        const [, date, sector, slug] = articleMatch
        return json(await deleteArticle(date, sector, slug))
      }

      if (path === '/api/articles/ingest' && req.method === 'POST') {
        const body = await req.json()
        return json(await ingestArticle(body))
      }

      // --- Draft ---
      if (path === '/api/draft' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getDraft(query))
      }

      if (path === '/api/draft' && req.method === 'PUT') {
        const query = parseQuery(req.url)
        const body = await req.json()
        return json(await saveDraft(query, body))
      }

      if (path === '/api/draft/history' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getDraftHistory(query))
      }

      if (path === '/api/draft/check-overlap' && req.method === 'POST') {
        const query = parseQuery(req.url)
        return json(await handleCheckOverlap(query))
      }

      // --- Chat ---
      if (path === '/api/chat' && req.method === 'POST') {
        return handleChat(req)
      }

      if (path === '/api/chat/threads' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await listThreads(query))
      }

      if (path === '/api/chat/threads' && req.method === 'POST') {
        const body = await req.json()
        return json(await createThread(body))
      }

      if (path === '/api/chat/threads' && req.method === 'PUT') {
        const query = parseQuery(req.url)
        const body = await req.json()
        return json(await renameThread({ ...query, ...body }))
      }

      if (path === '/api/chat/history' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getHistory(query))
      }

      if (path === '/api/chat/pin' && req.method === 'POST') {
        const body = await req.json()
        return json(await createPin(body))
      }

      if (path === '/api/chat/pins' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await listPins(query))
      }

      if (path === '/api/chat/pin' && req.method === 'DELETE') {
        const query = parseQuery(req.url)
        return json(await deletePin(query))
      }

      if (path === '/api/chat/usage' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getUsage(query))
      }

      // --- Usage (aggregated by period) ---
      if (path === '/api/usage' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getUsageByPeriod(query))
      }

      // --- Config ---
      const configMatch = path.match(/^\/api\/config\/([\w-]+)$/)
      if (configMatch && req.method === 'GET') {
        return json(await getConfig(configMatch[1]))
      }

      if (configMatch && req.method === 'PUT') {
        const body = await req.json()
        return json(await putConfig(configMatch[1], body))
      }

      // --- Sources ---
      if (path === '/api/sources/overview' && req.method === 'GET') {
        return json(await getOverview())
      }

      const sourceRunMatch = path.match(/^\/api\/sources\/runs\/(\d{4}-\d{2}-\d{2})$/)
      if (sourceRunMatch && req.method === 'GET') {
        const detail = await getRunDetail(sourceRunMatch[1])
        if (!detail) return json({ error: 'Run not found' }, 404)
        return json(detail)
      }

      // --- Published ---
      if (path === '/api/published' && req.method === 'GET') {
        return json(listPublished())
      }

      const pubMatch = path.match(/^\/api\/published\/(week-\d+)$/)
      if (pubMatch) {
        const week = pubMatch[1]
        if (req.method === 'GET') {
          const result = getPublished(week)
          if (!result) return json({ error: 'Not found' }, 404)
          return json(result)
        }
        if (req.method === 'PUT') {
          const body = await req.json()
          const meta = savePublished(week, body.content, body.meta || {})
          return json({ ok: true, meta })
        }
      }

      // --- Published: extract exclusions ---
      const exclMatch = path.match(/^\/api\/published\/(week-\d+)\/exclusions$/)
      if (exclMatch && req.method === 'POST') {
        const result = await extractExclusions({ week: exclMatch[1] })
        return json(result)
      }

      // --- Podcasts ---
      if (path === '/api/podcasts' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await handleGetPodcasts(query))
      }
      if (path === '/api/podcasts/transcript' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await handleGetTranscript(query))
      }

      // --- Health ---
      if (path === '/api/health') {
        return json({ status: 'ok', port: PORT })
      }

      // --- 404 ---
      return json({ error: 'Not found' }, 404)

    } catch (err) {
      console.error('API error:', err)
      return json({ error: err.message }, err.status || 500)
    }
  }
})

console.log(`SNI API server listening on http://localhost:${PORT}`)
