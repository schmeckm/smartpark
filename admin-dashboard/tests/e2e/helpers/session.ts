import type { Page } from '@playwright/test'
import { request as playwrightRequest } from '@playwright/test'

export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@smartpark.com'
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Smartpark123!'

export type SeedTokens = { accessToken: string; refreshToken: string }

/**
 * Logs in against the API (proxied from Vite when `npm run dev` is used).
 */
export async function seedSession(baseURL: string): Promise<SeedTokens> {
  const ctx = await playwrightRequest.newContext({ baseURL })
  const res = await ctx.post('/api/v1/auth/login', {
    data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
  })
  if (!res.ok()) {
    throw new Error(`E2E login failed ${res.status()}: ${await res.text()}`)
  }
  const body = (await res.json()) as { data?: { accessToken?: string; refreshToken?: string } }
  const accessToken = body?.data?.accessToken
  const refreshToken = body?.data?.refreshToken
  if (!accessToken || !refreshToken) throw new Error('E2E login missing tokens')
  await ctx.dispose()
  return { accessToken, refreshToken }
}

/**
 * Seeds JWT in localStorage (same pattern as other specs). Optional `activeParkId` → `sp_active_park_id`.
 */
export async function loginAndApplyTokens(
  page: Page,
  baseURL: string,
  opts?: { activeParkId?: string | null }
): Promise<SeedTokens> {
  const tokens = await seedSession(baseURL)
  await page.goto('/login')
  await page.evaluate(
    (payload: { accessToken: string; refreshToken: string; activeParkId: string | null | undefined }) => {
      localStorage.setItem('sp_access_token', payload.accessToken)
      localStorage.setItem('sp_refresh_token', payload.refreshToken)
      if (payload.activeParkId != null && String(payload.activeParkId).trim() !== '') {
        localStorage.setItem('sp_active_park_id', String(payload.activeParkId).trim())
      }
    },
    { ...tokens, activeParkId: opts?.activeParkId }
  )
  return tokens
}
