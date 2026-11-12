export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && path !== '/login' && path !== '/me') {
      window.location.href = '/login'
    }
    throw new ApiError(res.status, data.erro || `Erro ${res.status}`)
  }
  return data
}

export function boardsQuery(selected) {
  return selected.length ? `quadros=${selected.join(',')}` : ''
}
