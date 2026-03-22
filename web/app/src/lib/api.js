export async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    const err = new Error(body.error || `API ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export async function apiStream(path, body, signal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }))
    const err = new Error(errBody.error || `API ${res.status}`)
    err.status = res.status
    throw err
  }
  return res
}

/**
 * Read an SSE stream and invoke callback for each parsed event.
 * Handles buffering, line splitting, and JSON parsing.
 *
 * @param {ReadableStreamDefaultReader} reader
 * @param {(data: object) => boolean|void} onEvent — return false to stop reading
 */
export async function readSSEStream(reader, onEvent) {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let data
      try {
        data = JSON.parse(line.slice(6))
      } catch { continue } // skip unparseable SSE lines
      if (onEvent(data) === false) return
    }
  }
}

export async function apiPatch(path, body) {
  return apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' })
}

export async function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function apiPut(path, body) {
  return apiFetch(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
