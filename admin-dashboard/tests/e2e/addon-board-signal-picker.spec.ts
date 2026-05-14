import { test, expect, request as playwrightRequest } from '@playwright/test'

const email = process.env.E2E_ADMIN_EMAIL || 'admin@smartpark.com'
const password = process.env.E2E_ADMIN_PASSWORD || 'Smartpark123!'
const parkId = process.env.E2E_ADDON_BOARD_PARK_ID?.trim()
const rideAssetId = process.env.E2E_ADDON_BOARD_RIDE_ID?.trim()

function describePicker(title: string, fn: () => void) {
  if (parkId && rideAssetId) test.describe(title, fn)
  else
    test.describe.skip(
      `${title} (skipped — set E2E_ADDON_BOARD_PARK_ID and E2E_ADDON_BOARD_RIDE_ID; see docs/validation/addon-board-signal-source-picker-qa.md)`,
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

describePicker('Add-on Board L3 custom signal widgets (picker)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    const tokens = await seedSession(root)
    await page.goto('/login')
    await page.evaluate(
      ({ accessToken, refreshToken, pid }) => {
        localStorage.setItem('sp_access_token', accessToken)
        localStorage.setItem('sp_refresh_token', refreshToken)
        localStorage.setItem('sp_active_park_id', pid)
      },
      { ...tokens, pid: parkId as string }
    )
  })

  test('picker visible with flag; selection clears when ride changes', async ({ page }) => {
    const pid = parkId as string
    const firstRide = rideAssetId as string

    await page.goto('/operations/addon-board')
    await expect(page.getByRole('heading', { name: 'Add-on Board' })).toBeVisible({ timeout: 60_000 })

    await page.getByRole('button', { name: 'Ride (L3)' }).click()

    const l3 = page.getByTestId('addon-board-l3-tab')
    await expect(l3).toBeVisible({ timeout: 30_000 })

    const rideSelect = l3.locator('select').first()
    await expect(rideSelect).toBeVisible({ timeout: 30_000 })
    await rideSelect.selectOption(firstRide)

    const panel = page.getByTestId('addon-board-signal-picker-panel')
    await page
      .waitForSelector('[data-testid="addon-board-signal-picker-panel"]', { state: 'visible', timeout: 12_000 })
      .catch(() => {})
    if (!(await panel.isVisible())) {
      test.skip(
        true,
        'Picker panel not visible — enable UI rollback switch VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=true (e.g. PLAYWRIGHT_ADDON_BOARD_PICKER=1 when using PLAYWRIGHT_START_WEB_SERVER=1) and rebuild/restart Vite.'
      )
    }

    await expect(page.getByTestId('board-signal-source-picker-root').getByText('Board signal source')).toBeVisible()

    const radios = panel.locator('input[type="radio"]')
    const count = await radios.count()
    if (count === 0) {
      await expect(
        page.getByText(/No board-eligible signals are configured/i)
      ).toBeVisible()
      return
    }

    await radios.first().check()
    await expect(page.getByTestId('board-signal-source-selected')).toBeVisible()

    const optionValues = await rideSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => Boolean(v))
    )
    const other = optionValues.find((v) => v !== firstRide)
    if (!other) {
      test.skip(true, 'Need at least two rides in the park dropdown to assert selection clears on ride change.')
    }

    await rideSelect.selectOption(other!)
    await expect(page.getByTestId('board-signal-source-selected')).toHaveCount(0)
  })
})
