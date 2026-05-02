/**
 * mcp.js — Streamable-HTTP MCP route at /mcp.
 *
 * Auth via Bearer (or sni_session cookie). Single module-scope McpServer
 * + StreamableHTTPTransport per process. Stateless mode (no session IDs)
 * because Fly machines may rotate.
 *
 * Per-request auth — even after the transport is "connected", every
 * request re-runs authenticateMcpRequest so revocation takes effect
 * mid-session.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { bodyLimit } from 'hono/body-limit'
import { authenticateMcpRequest } from '../lib/mcp-auth.js'
import { rateLimitCheck } from '../lib/mcp-rate-limit.js'
import { registerReadTools } from '../lib/mcp-tools/reads.js'
// TODO(task-5):    import { registerWriteTools } from '../lib/mcp-tools/writes.js'

// Module-scope: one server, one transport per process. The closure flag
// `connected` exists because the SDK does not expose isConnected().
let mcpServer = null
let transport = null
let connected = false
let connectPromise = null   // mutex for concurrent first-connect

async function ensureConnected() {
  if (connected) return
  // Concurrent callers share the same in-flight connect promise.
  if (connectPromise) return connectPromise
  connectPromise = (async () => {
    try {
      if (!mcpServer) {
        mcpServer = new McpServer({ name: 'sni', version: '1.0.0' })
        registerReadTools(mcpServer)
        // TODO(task-5): registerWriteTools(mcpServer)
      }
      if (!transport) {
        transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined })
      }
      await mcpServer.connect(transport)
      connected = true
    } catch (e) {
      // Reset module state so a subsequent request can retry from scratch.
      // Without this, a transient connect failure permanently wedges the
      // module — every later caller sees the same rejected promise.
      mcpServer = null
      transport = null
      connectPromise = null
      throw e
    }
  })()
  return connectPromise
}

/**
 * Test-only reset. Lets each test get a fresh server/transport instance
 * so module-scope state doesn't bleed across cases.
 */
export function _resetMcpForTests() {
  mcpServer = null
  transport = null
  connected = false
  connectPromise = null
}

export function mountMcp(app) {
  app.use('/mcp', bodyLimit({ maxSize: 32 * 1024 }))

  app.all('/mcp', async (c) => {
    // Auth — runs every request so revocation takes effect mid-session.
    let user
    try {
      user = await authenticateMcpRequest(c)
    } catch (e) {
      c.header('WWW-Authenticate', 'Bearer realm="sni-mcp", error="invalid_token"')
      return c.json({ error: 'unauthorized', detail: e.message }, 401)
    }

    // Per-user rate limit (60/min sliding window).
    const rl = rateLimitCheck(user.sub)
    if (!rl.ok) {
      c.header('Retry-After', String(rl.retryAfterSec))
      return c.json({ error: 'rate_limited', retryAfterSec: rl.retryAfterSec }, 429)
    }

    // Bridge user identity into the tool callback via Hono ctx.
    // wrapTool (Task 4) reads this from extra.authInfo.
    c.set('auth', user)

    await ensureConnected()
    return transport.handleRequest(c)
  })
}
