/**
 * Widget Runtime Studio — list, preview, fallbacks (stubbed API).
 */
import { test, expect } from '@playwright/test'
import { loginAndApplyTokens } from './helpers/session'

const STUB_INSTANCE_ID = 'aaaaaaaa-widg-4000-8000-111111111111'

test.describe('Widget Runtime Studio', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {
        /* ignore */
      }
    })
    await context.clearCookies()
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
  })

  test('studio loads with instance list and preview', async ({ page, baseURL }) => {
    test.setTimeout(90_000)
    const root = baseURL || 'http://localhost:5173'

    await page.route('**/api/v1/integrations/feature-flags', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { widgetRuntimeEnabled: true, integrationFlowEngineEnabled: true },
        }),
      })
    })

    await page.route('**/api/v1/widget-runtime/widgets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              widgetKey: 'FLOW_HEALTH_CARD',
              displayName: 'Flow health',
              category: 'Integration Flows',
              description: null,
              componentName: 'FlowHealthCardWidget',
              configSchema: { type: 'object', properties: {}, additionalProperties: false },
              enabled: true,
            },
            {
              id: '22222222-2222-4222-8222-222222222222',
              widgetKey: 'FAILED_RUNS_CARD',
              displayName: 'Failed runs',
              category: 'Integration Flows',
              description: null,
              componentName: 'FailedRunsCardWidget',
              configSchema: { type: 'object', properties: {}, additionalProperties: false },
              enabled: true,
            },
          ],
        }),
      })
    })

    await page.route('**/api/v1/widget-runtime/data-sources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              dataSourceKey: 'integration_flows.health_summary',
              displayName: 'Health summary',
              category: 'Integration Flows',
              description: null,
              sourceType: 'internal_api',
              endpoint: 'integration_flows.health_summary',
              refreshSeconds: 60,
              enabled: true,
            },
          ],
        }),
      })
    })

    const instance = {
      id: STUB_INSTANCE_ID,
      widgetKey: 'FLOW_HEALTH_CARD',
      title: 'Ops health widget',
      description: null,
      widgetConfig: {},
      dataSourceKey: 'integration_flows.health_summary',
      enabled: true,
      createdBy: null,
      updatedBy: null,
    }

    await page.route('**/api/v1/widget-runtime/instances', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [instance] }),
        })
        return
      }
      await route.continue()
    })

    await page.route(`**/api/v1/widget-runtime/instances/${STUB_INSTANCE_ID}/data`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            instance,
            data: { totalFlows: 4, enabledFlows: 3, scheduledFlows: 1, failedRuns: 2, flowsWithRecentFailure: 1 },
          },
        }),
      })
    })

    await loginAndApplyTokens(page, root)
    await page.goto(`${root}/admin/widget-runtime-studio`)
    await expect(page.getByTestId('widget-runtime-studio-root')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('widget-runtime-studio-instance-list')).toBeVisible()
    await page.getByRole('button', { name: 'Ops health widget' }).click()
    await expect(page.getByTestId('widget-runtime-renderer')).toBeVisible()
    await expect(page.getByTestId('widget-flow-health')).toBeVisible()
  })

  test('fallback for unknown component name in registry', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'

    await page.route('**/api/v1/integrations/feature-flags', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { widgetRuntimeEnabled: true } }),
      })
    })

    await page.route('**/api/v1/widget-runtime/widgets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              widgetKey: 'BAD_WIDGET',
              displayName: 'Bad',
              category: 'Test',
              description: null,
              componentName: 'NotARealComponent',
              configSchema: null,
              enabled: true,
            },
          ],
        }),
      })
    })

    await page.route('**/api/v1/widget-runtime/data-sources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    })

    await page.route('**/api/v1/widget-runtime/instances', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: STUB_INSTANCE_ID,
              widgetKey: 'BAD_WIDGET',
              title: 'Bad widget',
              description: null,
              widgetConfig: {},
              dataSourceKey: null,
              enabled: true,
              createdBy: null,
              updatedBy: null,
            },
          ],
        }),
      })
    })

    await loginAndApplyTokens(page, root)
    await page.goto(`${root}/admin/widget-runtime-studio`)
    await expect(page.getByTestId('widget-runtime-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Bad widget' }).click()
    await expect(page.getByTestId('widget-runtime-fallback-unknown-component')).toBeVisible()
  })
})
