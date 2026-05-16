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
    await page.locator('main details summary').first().click()
    await expect(page.getByRole('note')).toContainText(/Experiment|Experimental|Experimentier/i)
  })

  test('Tab Training zeigt Trainings-Steuerung', async ({ page }) => {
    await page.goto('/ai-insights/studio')
    await page.getByTestId('ai-studio-tab-training').click()
    await expect(page.getByTestId('ai-studio-training-assistant')).toBeVisible({ timeout: 30_000 })
  })

  test('FEATURE_STORE: Manual erlaubt Algorithmus; Auto deaktiviert Dropdown', async ({ page }) => {
    await page.goto('/ai-insights/studio')
    await page.getByTestId('ai-studio-tab-datasets').click()
    await page.getByTestId('ai-studio-dataset-source').selectOption('FEATURE_STORE')
    await page.getByTestId('ai-studio-tab-training').click()
    await expect(page.getByTestId('ai-studio-training-assistant')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /^2\./ }).click()
    const step2 = page.getByTestId('ai-studio-training-step-2')
    await expect(step2).toBeVisible()
    const assetSelect = step2.locator('select').last()
    const optCount = await assetSelect.locator('option').count()
    test.skip(optCount < 2, 'Park hat keine Ride-Assets im Testkontext — FEATURE_STORE-Schritt 2 braucht ein Asset.')
    await assetSelect.selectOption({ index: 1 })
    await page.getByRole('button', { name: /^3\./ }).click()
    await expect(page.getByTestId('ai-studio-training-step-3')).toBeVisible()
    const algo = page.getByTestId('ai-studio-train-algorithm')
    await expect(algo).toBeVisible()
    await page.locator('input[type=radio][value=MANUAL]').click()
    await expect(algo).toBeEnabled()
    await page.locator('input[type=radio][value=AUTO]').click()
    await expect(algo).toBeDisabled()
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
