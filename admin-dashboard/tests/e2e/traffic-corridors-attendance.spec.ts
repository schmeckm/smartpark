/**

 * Smoke: traffic corridors admin page + attendance risk card on Control Tower.

 *

 * Installs `traffic_corridors` via API before the SPA mounts so MainLayout’s first

 * `installedAdapters.hydrate()` sees the adapter (Pinia does not refresh after install-local alone).

 */

import { test, expect } from '@playwright/test'

import { seedSession, loginAndApplyTokens } from './helpers/session'



test.describe('Traffic corridors & attendance risk', () => {

  test.beforeEach(async ({ page, context }) => {

    await context.clearCookies()

    await page.goto('/login')

    await page.evaluate(() => {

      try {

        localStorage.clear()

        sessionStorage.clear()

      } catch {

        /* ignore */

      }

    })

  })



  test('corridors page loads; dashboard shows forecast card', async ({ page, baseURL }) => {

    test.setTimeout(90_000)

    const root = baseURL || 'http://localhost:5173'



    const tokens = await seedSession(root)



    const inst = await page.request.post(`${root}/api/v1/integrations/installed-adapters/install-local`, {

      headers: { Authorization: `Bearer ${tokens.accessToken}` },

      data: {

        adapterKey: 'traffic_corridors',

        name: 'Traffic corridors (E2E)',

        configJson: {},

        contextJson: {},

        outputProfiles: ['UNS_JSON'],

        emitEnabled: false,

        scheduleCron: null,

      },

    })

    if (!inst.ok()) {

      throw new Error(`install-local failed ${inst.status()}: ${await inst.text()}`)

    }



    // Stable empty latest row — card shell still mounts; avoids waiting on backend forecast rows.

    await page.route('**/api/v1/parks/*/attendance-risk-forecast/latest', async (route) => {

      await route.fulfill({

        status: 200,

        contentType: 'application/json',

        body: JSON.stringify({ success: true, data: null }),

      })

    })



    await loginAndApplyTokens(page, root)



    await page.goto(`${root}/operations/traffic-corridors`)

    await expect(page.getByTestId('traffic-corridors-page')).toBeVisible({ timeout: 60_000 })

    await expect(page.getByText('Loading corridors…')).not.toBeVisible({ timeout: 60_000 })

    await expect(page.getByTestId('traffic-corridors-table')).toBeVisible({ timeout: 30_000 })



    await page.goto(`${root}/`)

    await expect(page.getByTestId('attendance-risk-forecast-card')).toBeVisible({ timeout: 60_000 })

  })

})

