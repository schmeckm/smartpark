/**
 * End-to-end smoke for AI insights: login, park context, wait grid, ride detail, studio tabs, feature monitor.
 *
 * Prerequisites: API reachable via Vite proxy, admin credentials. Prefer a park with `externalEntityId`
 * (otherwise the wait grid shows `ai-wait-need-park-external`). Optional: `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`.
 */
import { test, expect } from '@playwright/test'
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './helpers/session'

test.describe('Admin dashboard — AI insights flow', () => {
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

  test('login, park, AI grid, ride detail, studio, feature monitor', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'

    await test.step('Login as admin', async () => {
      await page.goto(`${root}/login`)
      await expect(page.getByTestId('login-email')).toBeVisible()
      await page.getByTestId('login-email').fill(E2E_ADMIN_EMAIL)
      await page.getByTestId('login-password').fill(E2E_ADMIN_PASSWORD)
      await page.getByTestId('login-submit').click()
      await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 })
    })

    await test.step('Select a park (header)', async () => {
      const parkSelect = page.getByTestId('header-park-select')
      await expect(parkSelect).toBeVisible({ timeout: 60_000 })
      const optionValues = await parkSelect
        .locator('option')
        .evaluateAll((opts) =>
          opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v && String(v).trim() !== '')
        )
      expect(optionValues.length, 'Expected at least one park in header selector').toBeGreaterThan(0)
      const firstParkId = optionValues[0]
      expect(firstParkId).toBeTruthy()
      await parkSelect.selectOption(String(firstParkId))
    })

    await test.step('Open /ai-insights and verify forecast table + columns', async () => {
      await page.goto(`${root}/ai-insights`)
      await expect(page.getByTestId('ai-wait-need-park-external')).not.toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('ai-wait-forecast-table')).toBeVisible({ timeout: 90_000 })
      for (const id of ['ai-wait-col-current', 'ai-wait-col-f15', 'ai-wait-col-f60', 'ai-wait-col-trend', 'ai-wait-col-basis']) {
        await expect(page.getByTestId(id)).toBeVisible()
      }
    })

    await test.step('Open ride details and verify sections', async () => {
      const openBtn = page.getByTestId('ai-wait-open-detail').first()
      await expect(openBtn).toBeVisible({ timeout: 30_000 })
      await openBtn.click()
      const detail = page.getByTestId('ai-wait-ride-detail')
      await expect(detail).toBeVisible({ timeout: 30_000 })
      await expect(detail.getByTestId('ai-wait-detail-history')).toBeVisible()
      await expect(detail.getByTestId('ai-wait-detail-influencing')).toBeVisible()
      await expect(detail.getByTestId('ai-wait-detail-explainability')).toBeVisible()
      await expect(detail.getByTestId('ai-wait-detail-accuracy')).toBeVisible()
    })

    await test.step('Open /ai-insights/studio and verify tabs', async () => {
      await page.goto(`${root}/ai-insights/studio`)
      await expect(page.getByTestId('ai-studio-tab-overview')).toBeVisible({ timeout: 60_000 })
      for (const tab of ['overview', 'datasets', 'training', 'registry', 'predictions']) {
        await expect(page.getByTestId(`ai-studio-tab-${tab}`)).toBeVisible()
      }
    })

    await test.step('Open /ai/ml/feature-monitor and verify filters', async () => {
      await page.goto(`${root}/ai/ml/feature-monitor`)
      await expect(page.getByTestId('ml-feature-monitor-root')).toBeVisible({ timeout: 90_000 })
      const filters = page.getByTestId('ml-feature-monitor-filters')
      await expect(filters).toBeVisible()
      await expect(filters.locator('#fm-filter-ride')).toBeVisible()
      await expect(filters.locator('#fm-filter-model')).toBeVisible()
    })
  })
})
