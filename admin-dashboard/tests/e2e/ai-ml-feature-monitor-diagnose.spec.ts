/**
 * Diagnose — ML Feature Monitor (`/ai/ml/feature-monitor`, Menü „Feature monitor“ / Diagnose).
 *
 * Voraussetzungen: wie andere AI-E2E-Specs. Optional: `E2E_PARK_ID`.
 */
import { test, expect } from '@playwright/test'
import { loginAndApplyTokens } from './helpers/session'

const parkId = process.env.E2E_PARK_ID?.trim()

test.describe('ML Diagnose — Feature Monitor', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root, { activeParkId: parkId || undefined })
  })

  test('lädt ML Feature Monitor mit Hauptüberschrift', async ({ page }) => {
    await page.goto('/ai/ml/feature-monitor')
    await expect(page.getByRole('heading', { name: /ML Feature Monitor/i })).toBeVisible({ timeout: 90_000 })
    await expect(page.locator('body')).toContainText(/Feature|Park|ML/i)
  })

  test('Namespace /ai/ml leitet auf Feature Monitor', async ({ page }) => {
    await page.goto('/ai/ml')
    await expect(page).toHaveURL(/\/ai\/ml\/feature-monitor/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /ML Feature Monitor/i })).toBeVisible({ timeout: 60_000 })
  })
})
