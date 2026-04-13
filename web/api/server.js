import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import config from './lib/config.js'
import { getDb, migrateSchema } from './lib/db.js'

// --- Route handler imports ---
import { getStatus, getVerificationStatus } from './routes/status.js'
import { getArticles, getArticle, getFlaggedArticles, patchArticle, deleteArticle, ingestArticle, getLastUpdated, getPublications, manualIngest } from './routes/articles.js'
import { getDraft, saveDraft, getDraftHistory, handleCheckOverlap } from './routes/draft.js'
import { handleChat, listThreads, createThread, renameThread, getHistory, createPin, listPins, deletePin, getUsage } from './routes/chat.js'
import { getUsage as getUsageByPeriod } from './routes/usage.js'
import { getConfig, putConfig } from './routes/config.js'
import { getOverview, getRunDetail } from './routes/sources.js'
import { listPublished, getPublished, savePublished, extractExclusions } from './routes/published.js'
import { handleGetPodcasts, handleGetTranscript, handlePatchPodcast } from './routes/podcasts.js'
import { getEditorialState, searchEditorial, getEditorialBacklog, getEditorialThemes, getEditorialNotifications, dismissNotification, getEditorialStatus, getEditorialCost, getEditorialActivity, renderEditorialSection, getDiscoverProgress, getEditorialDraft, postEditorialChat, postTriggerAnalyse, postTriggerDiscover, postTriggerDraft, postTriggerTrack, putBacklogStatus, putAnalysisArchive, putThemeArchive, postDecision, putDecisionArchive } from './routes/editorial.js'
import { getEvRecommendations, updateEvRecommendation } from './routes/ev-recommendations.js'
import { getSubscriptions, saveCredentials as saveSubCredentials, testLogins, triggerFetch } from './routes/subscriptions.js'
import { listBugsHandler, getBugHandler, createBugHandler, updateBugHandler } from './routes/bugs.js'
import { login, callback, me, logout } from './routes/auth.js'
import { authMiddleware } from './middleware/auth.js'
import { audit } from './lib/audit.js'

// --- Production startup guard ---
if (config.isProduction && !config.SESSION_SECRET) {
  console.error('FATAL: SNI_SESSION_SECRET must be set in production')
  process.exit(1)
}

const app = new Hono()

// --- Middleware: request logging (outermost — captures everything including errors) ---
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const log = {
    ts: new Date().toISOString(),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  }
  console.log(JSON.stringify(log))
})

// --- Middleware: security headers ---
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (config.isProduction) {
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    c.res.headers.set('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' https://lh3.googleusercontent.com data:; " +
      "connect-src 'self'"
    )
  }
})

// --- Middleware: no-cache on API responses ---
// Without this, browsers (and any intermediate proxies) fall back to heuristic
// caching, which can keep stale JSON in the tab indefinitely after data changes.
// Scott reported Week 16 data not showing up on Fly even though the live API
// endpoints had already refreshed to include 10 April articles — the only
// remaining failure mode was client-side caching of a prior response.
app.use('/api/*', async (c, next) => {
  await next()
  c.res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  c.res.headers.set('Pragma', 'no-cache')
  c.res.headers.set('Expires', '0')
})

// --- Middleware: CORS ---
// In production with same-origin serving, CORS_ORIGIN is empty — use request origin.
// In dev, CORS_ORIGIN is 'http://localhost:5173' (Vite proxy).
app.use('*', cors({
  origin: config.CORS_ORIGIN || ((origin) => origin),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}))

// --- Middleware: auth ---
app.use('*', authMiddleware)

// --- Error handler ---
app.onError((err, c) => {
  console.error('API error:', err)
  const message = config.isProduction
    ? err.message.replace(/(\/[\w.\/-]+){3,}/g, '[path]')
    : err.message
  return c.json({ error: message }, err.status || 500)
})

// --- Auth ---
app.get('/api/auth/login', login)
app.get('/api/auth/callback', callback)
app.get('/api/auth/me', me)
app.post('/api/auth/logout', logout)

// --- Health ---
app.get('/api/health', (c) => c.json({ status: 'ok', port: config.PORT }))

// --- Status ---
app.get('/api/status', async (c) => c.json(await getStatus()))
app.get('/api/status/verification', async (c) => c.json(getVerificationStatus()))

// --- Articles ---
app.get('/api/articles', async (c) => c.json(await getArticles(c.req.query())))
app.get('/api/articles/flagged', async (c) => c.json(await getFlaggedArticles()))
app.get('/api/articles/last-updated', async (c) => c.json(await getLastUpdated()))
app.get('/api/articles/publications', async (c) => c.json(await getPublications()))
app.post('/api/articles/manual', async (c) => c.json(await manualIngest(await c.req.json())))
app.post('/api/articles/ingest', async (c) => c.json(await ingestArticle(await c.req.json())))

app.get('/api/articles/:date/:sector/:slug', async (c) => {
  const { date, sector, slug } = c.req.param()
  const article = await getArticle(date, sector, slug)
  if (!article) return c.json({ error: 'Not found' }, 404)
  return c.json(article)
})
app.patch('/api/articles/:date/:sector/:slug', async (c) => {
  const { date, sector, slug } = c.req.param()
  return c.json(await patchArticle(date, sector, slug, await c.req.json()))
})
app.delete('/api/articles/:date/:sector/:slug', async (c) => {
  const { date, sector, slug } = c.req.param()
  return c.json(await deleteArticle(date, sector, slug))
})

// --- Draft ---
app.get('/api/draft', async (c) => c.json(await getDraft(c.req.query())))
app.put('/api/draft', async (c) => c.json(await saveDraft(c.req.query(), await c.req.json())))
app.get('/api/draft/history', async (c) => c.json(await getDraftHistory(c.req.query())))
app.post('/api/draft/check-overlap', async (c) => c.json(await handleCheckOverlap(c.req.query())))

// --- Chat (SSE streaming — returns raw Response, CORS handled in handler) ---
app.post('/api/chat', async (c) => handleChat(c.req.raw))

app.get('/api/chat/threads', async (c) => c.json(await listThreads(c.req.query())))
app.post('/api/chat/threads', async (c) => c.json(await createThread(await c.req.json())))
app.put('/api/chat/threads', async (c) => {
  const query = c.req.query()
  const body = await c.req.json()
  return c.json(await renameThread({ ...query, ...body }))
})
app.get('/api/chat/history', async (c) => c.json(await getHistory(c.req.query())))
app.post('/api/chat/pin', async (c) => c.json(await createPin(await c.req.json())))
app.get('/api/chat/pins', async (c) => c.json(await listPins(c.req.query())))
app.delete('/api/chat/pin', async (c) => c.json(await deletePin(c.req.query())))
app.get('/api/chat/usage', async (c) => c.json(await getUsage(c.req.query())))

// --- Usage ---
app.get('/api/usage', async (c) => c.json(await getUsageByPeriod(c.req.query())))

// --- Config ---
app.get('/api/config/:name', async (c) => c.json(await getConfig(c.req.param('name'))))
app.put('/api/config/:name', async (c) => c.json(await putConfig(c.req.param('name'), await c.req.json())))

// --- Sources ---
app.get('/api/sources/overview', async (c) => c.json(await getOverview()))
app.get('/api/sources/runs/:date', async (c) => {
  const detail = await getRunDetail(c.req.param('date'))
  if (!detail) return c.json({ error: 'Run not found' }, 404)
  return c.json(detail)
})

// --- Published ---
app.get('/api/published', (c) => c.json(listPublished()))
app.get('/api/published/:week', (c) => {
  const result = getPublished(c.req.param('week'))
  if (!result) return c.json({ error: 'Not found' }, 404)
  return c.json(result)
})
app.put('/api/published/:week', async (c) => {
  const body = await c.req.json()
  const meta = savePublished(c.req.param('week'), body.content, body.meta || {})
  return c.json({ ok: true, meta })
})
app.post('/api/published/:week/exclusions', async (c) =>
  c.json(await extractExclusions({ week: c.req.param('week') })))

// --- Podcasts ---
app.get('/api/podcasts', async (c) => c.json(await handleGetPodcasts(c.req.query())))
app.get('/api/podcasts/transcript', async (c) => c.json(await handleGetTranscript(c.req.query())))
app.patch('/api/podcasts/:date/:source/:slug', async (c) => {
  const { date, source, slug } = c.req.param()
  return c.json(await handlePatchPodcast(date, source, slug, await c.req.json()))
})

// --- Editorial ---
app.get('/api/editorial/state', async (c) => c.json(await getEditorialState(c.req.query())))
app.get('/api/editorial/search', async (c) => c.json(await searchEditorial(c.req.query())))
app.get('/api/editorial/backlog', async (c) => c.json(await getEditorialBacklog(c.req.query())))
app.get('/api/editorial/themes', async (c) => c.json(await getEditorialThemes(c.req.query())))
app.get('/api/editorial/notifications', async (c) => c.json(await getEditorialNotifications()))
app.put('/api/editorial/notifications/:id/dismiss', async (c) =>
  c.json(await dismissNotification(c.req.param('id'))))
app.get('/api/editorial/status', async (c) => c.json(await getEditorialStatus()))
app.get('/api/editorial/cost', async (c) => c.json(await getEditorialCost(c.req.query())))
app.get('/api/editorial/activity', async (c) => c.json(await getEditorialActivity(c.req.query())))
app.get('/api/editorial/render', async (c) => c.json(await renderEditorialSection(c.req.query())))
app.get('/api/editorial/entry/:id', async (c) => {
  const { getDb } = await import('./lib/db.js')
  const { getAnalysisEntry } = await import('./lib/editorial-queries.js')
  const entry = await getAnalysisEntry(getDb(), Number(c.req.param('id')))
  if (!entry) return c.json({ error: 'Not found' }, 404)
  return c.json(entry)
})
app.get('/api/editorial/theme/:code', async (c) => {
  const { getDb } = await import('./lib/db.js')
  const { getThemeWithEvidence, getAnalysisEntries } = await import('./lib/editorial-queries.js')
  const db = getDb()
  const code = c.req.param('code').toUpperCase()
  const detail = await getThemeWithEvidence(db, code)
  if (!detail) return c.json({ error: 'Not found' }, 404)
  // Also find all analysis entries that reference this theme
  const allEntries = await getAnalysisEntries(db, { showArchived: true })
  const linkedEntries = allEntries.filter(e => {
    const themes = typeof e.themes === 'string' ? JSON.parse(e.themes || '[]') : (e.themes || [])
    return themes.includes(code)
  }).map(e => ({ id: e.id, title: e.title, source: e.source, date: e.date, session: e.session, tier: e.tier, summary: e.summary }))
  return c.json({ ...detail, linkedEntries })
})
app.get('/api/editorial/discover', async (c) => c.json(await getDiscoverProgress(c.req.query())))
app.get('/api/editorial/draft', async (c) => c.json(await getEditorialDraft(c.req.query())))

// Editorial chat (SSE streaming — returns raw Response, CORS handled in handler)
app.post('/api/editorial/chat', async (c) => {
  const body = await c.req.json()
  return await postEditorialChat(body, c.req.raw)
})

// Editorial triggers
app.post('/api/editorial/trigger/analyse', async (c) => {
  const result = await postTriggerAnalyse()
  if (result?._conflict) { const { _conflict, ...body } = result; return c.json(body, 409) }
  return c.json(result)
})
app.post('/api/editorial/trigger/discover', async (c) => {
  const result = await postTriggerDiscover()
  if (result?._conflict) { const { _conflict, ...body } = result; return c.json(body, 409) }
  return c.json(result)
})
app.post('/api/editorial/trigger/draft', async (c) => {
  const result = await postTriggerDraft()
  if (result?._conflict) { const { _conflict, ...body } = result; return c.json(body, 409) }
  return c.json(result)
})
app.post('/api/editorial/trigger/track', async (c) => {
  const result = await postTriggerTrack()
  if (result?._conflict) { const { _conflict, ...body } = result; return c.json(body, 409) }
  return c.json(result)
})

// --- EV Recommendations ---
app.get('/api/editorial/ev-recommendations', (c) => c.json(getEvRecommendations()))
app.put('/api/editorial/ev-recommendations/:domain', async (c) =>
  c.json(updateEvRecommendation(c.req.param('domain'), await c.req.json())))

// --- Editorial Backlog/Analysis/Theme/Decision mutations ---
app.put('/api/editorial/backlog/:id/status', async (c) => {
  const id = c.req.param('id'), body = await c.req.json()
  const result = await putBacklogStatus(id, body)
  audit(c.get('user'), 'backlog.status', id, { status: body.status })
  return c.json(result)
})
app.put('/api/editorial/analysis/:id/archive', async (c) => {
  const id = c.req.param('id'), body = await c.req.json()
  const result = await putAnalysisArchive(id, body)
  audit(c.get('user'), 'analysis.archive', id, { archived: body?.archived !== false })
  return c.json(result)
})
app.put('/api/editorial/themes/:code/archive', async (c) => {
  const code = c.req.param('code'), body = await c.req.json()
  const result = await putThemeArchive(code, body)
  audit(c.get('user'), 'theme.archive', code, { archived: body?.archived !== false })
  return c.json(result)
})
app.post('/api/editorial/decisions', async (c) => {
  const body = await c.req.json()
  const result = await postDecision(body)
  audit(c.get('user'), 'decision.create', result.id, { title: body.title })
  return c.json(result)
})
app.put('/api/editorial/decisions/:id/archive', async (c) => {
  const id = c.req.param('id'), body = await c.req.json()
  const result = await putDecisionArchive(id, body)
  audit(c.get('user'), 'decision.archive', id, { archived: body?.archived !== false })
  return c.json(result)
})

// --- Subscriptions ---
app.get('/api/subscriptions', (c) => c.json(getSubscriptions()))
app.put('/api/subscriptions/credentials', async (c) =>
  c.json(await saveSubCredentials(await c.req.json())))
app.post('/api/subscriptions/test', async (c) => c.json(await testLogins()))
app.post('/api/subscriptions/fetch', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return c.json(triggerFetch(body))
})

// --- Bugs ---
app.get('/api/bugs', listBugsHandler)
app.get('/api/bugs/:id', getBugHandler)
app.post('/api/bugs', createBugHandler)
app.put('/api/bugs/:id', updateBugHandler)

// --- API 404 catch-all ---
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

// --- Static files in production (must be AFTER API routes, BEFORE notFound) ---
if (config.isProduction) {
  const { serveStatic } = await import('hono/bun')
  const distDir = resolve(import.meta.dir, '../app/dist')
  app.use('/*', serveStatic({ root: distDir }))
  // SPA fallback: serve index.html for non-API, non-static routes
  app.get('*', (c) => {
    const html = readFileSync(resolve(distDir, 'index.html'), 'utf-8')
    return c.html(html)
  })
}

// --- 404 for everything else (dev mode, or non-static paths in prod) ---
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// --- Start server ---
const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
})

// --- Warm the dashboard caches in the background after startup ---
// On Fly's persistent volume, walking 4576+ verified articles synchronously
// takes 30-60 seconds and blocks the event loop. If the first user request
// triggers this, the health check fails and the machine restarts before the
// cache can populate. Warming on startup means the first user request hits
// a primed cache. The stale-while-revalidate pattern in the route handlers
// then absorbs every refresh after this one.
//
// We delay slightly so the server can pass its initial health check before
// the heavy work starts. All three walks run in parallel — the yields in
// walkArticleDirAsync let the health check endpoint run between file reads.
setTimeout(async () => {
  console.log('[startup] Warming caches...')
  const t0 = Date.now()
  const warm = (name, fn) =>
    fn()
      .then(() => console.log(`[startup]   ${name} warmed in ${Date.now() - t0}ms`))
      .catch(err => console.error(`[startup]   ${name} warm failed: ${err.message}`))
  await Promise.all([
    warm('status', () => getStatus()),
    warm('articles', () => getArticles({})),
    warm('podcasts', () => handleGetPodcasts({})),
  ])
  console.log(`[startup] All caches warmed in ${Date.now() - t0}ms`)
}, 2000)

// --- Graceful shutdown ---
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...')
  server.stop()
  setTimeout(() => process.exit(0), 5000)
})

console.log(`SNI API server listening on http://localhost:${config.PORT}`)

// --- DB migration (non-blocking — runs after server is already accepting connections) ---
// Must be after Bun.serve() so health checks pass during the initial Turso replica sync,
// which downloads the full database on first boot and can take 30-60 seconds.
;(async () => {
  try {
    const db = getDb()
    await migrateSchema(db)
    console.log('[startup] DB schema migrated')
    if (process.env.FLY_MACHINE_ID) {
      await db.sync()
      console.log('[startup] Embedded replica synced')
    }
  } catch (err) {
    console.error('[startup] DB migration failed:', err.message)
  }
})()
