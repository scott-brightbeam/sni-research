import { getStatus } from './routes/status.js'
import { getArticles, getArticle, getFlaggedArticles, patchArticle, deleteArticle, ingestArticle } from './routes/articles.js'
import { getDraft, saveDraft, getDraftHistory } from './routes/draft.js'
import { handleChat, listThreads, createThread, renameThread, getHistory, createPin, listPins, deletePin, getUsage } from './routes/chat.js'

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
