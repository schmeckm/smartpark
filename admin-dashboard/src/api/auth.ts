import type { AuthUser, LoginResult, UserDateFormat, UserTimeFormat, UserUiPreferences } from '@/types/auth'

const origin = import.meta.env.VITE_API_URL || ''

function url(path: string) {
  if (path.startsWith('http')) return path
  return `${origin}${path}`
}

function getAccessToken() {
  return localStorage.getItem('sp_access_token')
}

async function parseResponse<T>(res: Response): Promise<T> {
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
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return body as T
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(url('/api/v1/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = await parseResponse<{ success: boolean; data: LoginResult }>(res)
  return json.data
}

/** New access + refresh pair (rotation). Caller persists tokens. */
export async function refreshWithRefreshToken(refreshPlain: string): Promise<LoginResult> {
  const res = await fetch(url('/api/v1/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refreshToken: refreshPlain }),
  })
  const json = await parseResponse<{ success: boolean; data: LoginResult }>(res)
  return json.data
}

export async function getMe(): Promise<AuthUser> {
  const token = getAccessToken()
  const res = await fetch(url('/api/v1/auth/me'), {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const json = await parseResponse<{ success: boolean; data: AuthUser }>(res)
  return json.data
}

export type PatchUserSettingsBody = {
  languageCode?: string
  displayName?: string | null
  timezone?: string | null
  dateFormat?: UserDateFormat
  timeFormat?: UserTimeFormat
  locale?: string | null
  uiPreferences?: UserUiPreferences
}

export type MyUserSettingsPayload = {
  languageCode: string
  displayName: string | null
  timezone: string | null
  dateFormat: UserDateFormat
  timeFormat: UserTimeFormat
  locale: string | null
  uiPreferences: UserUiPreferences | Record<string, unknown>
}

export async function getMyUserSettings(): Promise<MyUserSettingsPayload> {
  const token = getAccessToken()
  const res = await fetch(url('/api/v1/users/me/settings'), {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const json = await parseResponse<{ success: boolean; data: MyUserSettingsPayload }>(res)
  return json.data
}

export async function patchMyUserSettings(body: PatchUserSettingsBody): Promise<AuthUser> {
  const token = getAccessToken()
  const res = await fetch(url('/api/v1/users/me/settings'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const json = await parseResponse<{ success: boolean; data: AuthUser }>(res)
  return json.data
}

export async function logout(refresh: string | null) {
  const token = getAccessToken()
  const res = await fetch(url('/api/v1/auth/logout'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(refresh ? { refreshToken: refresh } : {}),
  })
  await parseResponse<{ success: boolean }>(res)
}
