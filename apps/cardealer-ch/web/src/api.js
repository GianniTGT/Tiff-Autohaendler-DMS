/**
 * Dünner fetch()-Wrapper. `credentials: 'include'` ist Pflicht — der
 * Sitzungscookie ist httpOnly und muss bei jeder Anfrage mitgeschickt
 * werden, sonst verhält sich jede geschützte Route wie abgemeldet.
 */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

async function call(method, path, body) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, data)
  return data?.data
}

export const api = {
  get: (path) => call('GET', path),
  post: (path, body) => call('POST', path, body),
  patch: (path, body) => call('PATCH', path, body),
}
