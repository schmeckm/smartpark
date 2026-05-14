/**
 * Smoke: traffic corridors page + attendance risk card on Operations dashboard.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'

const email = process.env.E2E_ADMIN_EMAIL || 'admin@smartpark.com'
const password = process.env.E2E_ADMIN_PASSWORD || 'Smartpark123!'

async function seedSession(baseURL: string) {
  const ctx = await playwrightRequest.newContext({ baseURL })
  const res = await ctx.post('/api/v1/auth/login', {
    data: { email, password },
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

test.describe('Traffic corridors & attendance risk', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    const tokens = await seedSession(root)
    await page.goto('/login')
    await page.evaluate((t) => {
      localStorage.setItem('sp_access_token', t.accessToken)
      localStorage.setItem('sp_refresh_token', t.refreshToken)
    }, tokens)
  })

  test('corridors page loads; dashboard shows forecast card', async ({ page }) => {
    await page.goto('/operations/traffic-corridors')
    await expect(page.getByTestId('traffic-corridors-page')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('traffic-corridors-table')).toBeVisible()

    await page.goto('/')
    await expect(page.getByTestId('attendance-risk-forecast-card')).toBeVisible({ timeout: 60_000 })
  })
})
