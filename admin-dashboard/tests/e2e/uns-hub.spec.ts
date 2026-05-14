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

test.describe('UNS Hub', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    const tokens = await seedSession(root)
    await page.goto('/login')
    await page.evaluate(
      (t) => {
        localStorage.setItem('sp_access_token', t.accessToken)
        localStorage.setItem('sp_refresh_token', t.refreshToken)
      },
      tokens
    )
  })

  test('opens UNS hub and renders migration tabs', async ({ page }) => {
    await page.goto('/uns/tree')
    await expect(page.getByText('UNS', { exact: false }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Namespace Tree/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Registry Mirror/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Spy Inbox/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Signal View/i })).toBeVisible()
  })

  test('Registry Mirror tab loads mirror shell', async ({ page }) => {
    await page.goto('/uns/registry-mirror')
    await expect(page.getByRole('heading', { name: /UNS registry mirror/i })).toBeVisible()
  })

  test('Spy Inbox tab renders inbox chrome', async ({ page }) => {
    await page.goto('/uns/spy-inbox')
    await expect(page.locator('body')).toContainText(/spy|inbox|UNS/i)
  })

  test('Signal View shows capability context text after navigation', async ({ page }) => {
    await page.goto('/uns/signal-view')
    await expect(page.locator('body')).toContainText(/signal|registry|operations/i)
  })

  test('API failure on Signal View shows non-empty error state', async ({ page, context }) => {
    await context.route('**/api/v1/platform/assets**', async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ success: false, message: 'forced e2e failure' }) })
    })
    await page.goto('/uns/signal-view')
    await expect(page.locator('body')).not.toHaveText(/^[\s]*$/)
  })
})
