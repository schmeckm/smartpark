import { test, expect, request as playwrightRequest } from '@playwright/test'

const email = process.env.E2E_ADMIN_EMAIL || 'admin@smartpark.com'
const password = process.env.E2E_ADMIN_PASSWORD || 'Smartpark123!'
const mdmRideId = process.env.E2E_MDM_RIDE_ID?.trim()

function describeMdm(title: string, fn: () => void) {
  if (mdmRideId) test.describe(title, fn)
  else
    test.describe.skip(
      `${title} (skipped — set E2E_MDM_RIDE_ID; see docs/validation/mdm-ride-signal-metadata-e2e.md)`,
      fn
    )
}

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

describeMdm('MDM ride signal metadata (Phase E.1)', () => {
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

  test('persists new signal row after save and reload', async ({ page }) => {
    const rideId = mdmRideId as string
    const signalKey = `queue.e2e_pw_${Date.now()}`
    await page.goto(`/mdm/rides/${rideId}`)

    await expect(page.getByRole('heading', { name: 'Signals & capabilities' })).toBeVisible({ timeout: 60_000 })

    const saveSignal = page.getByRole('button', { name: /^Save$/ })
    await expect(saveSignal).toBeVisible({ timeout: 15_000 })

    await page.getByPlaceholder(/e\.g\. queue\.wait_time_min/i).fill(signalKey)
    await page.getByRole('button', { name: /Add signal/i }).click()

    await expect(page.getByText(signalKey, { exact: true })).toBeVisible()

    const patchUrlPart = `/api/v1/mdm/rides/${rideId}/extensions`
    const patchOk = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes(patchUrlPart) && r.status() === 200
    )
    await Promise.all([patchOk, saveSignal.click()])

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Signals & capabilities' })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(signalKey, { exact: true })).toBeVisible({ timeout: 15_000 })
  })
})
