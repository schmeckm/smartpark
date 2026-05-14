/**
 * Smoke: traffic corridors admin page + attendance risk card on Control Tower.
 */
import { test, expect } from '@playwright/test'
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './helpers/session'

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
    const root = baseURL || 'http://localhost:5173'

    await page.goto(`${root}/login`)
    await expect(page.getByTestId('login-email')).toBeVisible()
    await page.getByTestId('login-email').fill(E2E_ADMIN_EMAIL)
    await page.getByTestId('login-password').fill(E2E_ADMIN_PASSWORD)
    await page.getByTestId('login-submit').click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 })

    await page.goto(`${root}/operations/demand/corridors`)
    await expect(page.getByTestId('traffic-corridors-page')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('traffic-corridors-table')).toBeVisible()

    await page.goto(`${root}/`)
    await expect(page.getByTestId('attendance-risk-forecast-card')).toBeVisible({ timeout: 60_000 })
  })
})
