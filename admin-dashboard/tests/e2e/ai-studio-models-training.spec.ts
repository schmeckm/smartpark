/**
 * Modelle & Training — KI-Studio (`/ai-insights/studio`).
 *
 * Voraussetzungen: wie `ai-predictions-ride-waits.spec.ts`. Benötigt u. a. `ai` · `read` für den Nutzer.
 * Optional: `E2E_PARK_ID` für Park-Kontext (Katalog/Datensätze).
 */
import { test, expect } from '@playwright/test'
import { loginAndApplyTokens } from './helpers/session'

const parkId = process.env.E2E_PARK_ID?.trim()

test.describe('KI-Studio — Modelle & Training', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root, { activeParkId: parkId || undefined })
  })

  test('lädt KI-Studio mit Tabs und Überblicks-Karte', async ({ page }) => {
    await page.goto('/ai-insights/studio')
    await expect(page.getByRole('heading', { name: /AI Studio|KI-Studio/i })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: /^Überblick$|^Overview$/i })).toBeVisible()
    await expect(page.getByRole('note')).toContainText(/Experiment|Experimental/i)
  })

  test('Tab Training zeigt Trainings-Steuerung', async ({ page }) => {
    await page.goto('/ai-insights/studio')
    await page.getByRole('button', { name: /^Training$/i }).click()
    await expect(
      page.getByRole('button', { name: /Start new training|Neues Training starten/i })
    ).toBeVisible({ timeout: 30_000 })
  })

  test('Tab Modell-Registry zeigt Registry-Bereich', async ({ page }) => {
    await page.goto('/ai-insights/studio')
    await page.getByRole('button', { name: /Model registry|Modell-Registry/i }).click()
    await expect(page.locator('body')).toContainText(/Registry|Modell/i, { timeout: 30_000 })
  })

  test('Kurz-URL /ai/studio leitet auf Studio', async ({ page }) => {
    await page.goto('/ai/studio')
    await expect(page).toHaveURL(/\/ai-insights\/studio/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /AI Studio|KI-Studio/i })).toBeVisible({ timeout: 30_000 })
  })
})
