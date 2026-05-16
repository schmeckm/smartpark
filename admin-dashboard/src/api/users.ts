import type { AuthUser } from '@/types/auth'
import { resolveApiOrigin } from '@/utils/apiOrigin'

const origin = resolveApiOrigin()

function url(path: string) {
  if (path.startsWith('http')) return path
  return `${origin}${path}`
}

function getAccessToken() {
  return localStorage.getItem('sp_access_token')
}

function authHeaders(json = false): HeadersInit {
  const token = getAccessToken()
  return {
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { message: text }
  }
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: string }).message)
        : res.statusText
    const err = new Error(msg || `HTTP ${res.status}`)
    ;(err as Error & { status?: number; code?: string }).status = res.status
    if (typeof body === 'object' && body && 'code' in body) {
      ;(err as Error & { code?: string }).code = String((body as { code: string }).code)
    }
    throw err
  }
  return (body as { success: boolean; data: T }).data
}

export type CreateAdminUserBody = {
  firstName: string
  lastName: string
  email: string
  password: string
  roleCode: string
  active?: boolean
}

export type UpdateAdminUserBody = {
  firstName?: string
  lastName?: string
  email?: string
  password?: string
  roleCode?: string
  active?: boolean
}

export async function listAdminUsers(): Promise<AuthUser[]> {
  const res = await fetch(url('/api/v1/users'), { headers: authHeaders() })
  return parseEnvelope<AuthUser[]>(res)
}

export async function createAdminUser(body: CreateAdminUserBody): Promise<AuthUser> {
  const res = await fetch(url('/api/v1/users'), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(body),
  })
  return parseEnvelope<AuthUser>(res)
}

export async function updateAdminUser(id: string, body: UpdateAdminUserBody): Promise<AuthUser> {
  const res = await fetch(url(`/api/v1/users/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: authHeaders(true),
    body: JSON.stringify(body),
  })
  return parseEnvelope<AuthUser>(res)
}

export async function deleteAdminUser(id: string): Promise<void> {
  const res = await fetch(url(`/api/v1/users/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok && res.status !== 204) {
    await parseEnvelope<never>(res)
  }
}
