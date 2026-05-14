/**
 * Prognosen: Ride-Wartezeiten-Grid (`/ai-insights`).
 *
 * Voraussetzungen: laufendes Admin-Dashboard (z. B. `PLAYWRIGHT_START_WEB_SERVER=1` oder manuell Vite),
 * API erreichbar (Vite-Proxy), gültige E2E-Credentials.
 *
 * Optional: `E2E_PARK_ID` — interne Park-UUID für `sp_active_park_id` (sonst leerer Kontext).
 */
import { test, expect } from '@playwright/test'
import { loginAndApplyTokens } from './helpers/session'

const parkId = process.env.E2E_PARK_ID?.trim()

test.describe('AI Prognosen — Ride-Wartezeiten', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root, { activeParkId: parkId || undefined })
  })

  test('lädt Wartezeiten-Übersicht mit Hauptüberschrift', async ({ page }) => {
    await page.goto('/ai-insights')
    await expect(
      page.getByRole('heading', { name: /Ride waits|Wartezeiten/i })
    ).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('body')).toContainText(/Fahrgeschäft|Ride|Aktuell|Current/i)
  })

  test('Alias /ai/forecasts leitet auf dasselbe Grid', async ({ page }) => {
    await page.goto('/ai/forecasts')
    await expect(page).toHaveURL(/\/ai-insights(?:\?|$)/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /Ride waits|Wartezeiten/i })).toBeVisible({ timeout: 30_000 })
  })
})
