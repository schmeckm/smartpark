/**
 * Smoke: Integration Flow Studio — layout, panels, graceful 404 when engine routes are off.
 */
import { test, expect } from '@playwright/test'
import { loginAndApplyTokens } from './helpers/session'

const STUB_FLOW_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111'
const STUB_RUN_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-222222222222'
const NODE_CFG_FLOW_ID = 'cccccccc-cccc-4ccc-8ddd-333333333333'
const MAP_JSON_FLOW_ID = 'dddddddd-dddd-4ddd-8ddd-444444444444'
const UNKNOWN_NODE_FLOW_ID = 'eeeeeeee-eeee-4eee-8eee-555555555555'
const SCHED_TEST_FLOW_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const RETRY_PATCH_FLOW_ID = 'aaaaaaaa-1111-4111-8111-000000000001'
const RETRY_RUN_ID = 'aaaaaaaa-2222-4222-8222-000000000002'
const RETRY_RUN_FLOW_ID = 'aaaaaaaa-3333-4333-8333-000000000003'
const FAIL_INBOX_FLOW_ID = 'aaaaaaaa-fail-4000-8000-111111111111'
const FAIL_INBOX_RUN_ID = 'bbbbbbbb-fail-4000-8000-222222222222'

test.describe('Integration Flow Studio', () => {
  test.describe.configure({ mode: 'serial' })
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

  test('page loads, catalog + editor visible (stubbed engine on)', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                templateKey: 'manual_canonical_test_flow',
                displayName: 'Canonical test',
                description: 'E2E stub',
                category: 'Test',
                defaultConfigNotes: 'stub',
                flowJson: { nodes: [], edges: [] },
              },
            ],
          }),
        })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('integration-flow-studio-node-catalog')).toBeVisible()
    await expect(page.getByTestId('integration-flow-studio-flow-editor')).toBeVisible()
    await expect(page.getByTestId('integration-flow-studio-templates')).toBeVisible()
    await expect(page.getByTestId('integration-flow-studio-disabled')).not.toBeVisible()
  })

  test('shows disabled banner when engine returns 404', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Not found' }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Not found' }),
        })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('integration-flow-studio-disabled')).toBeVisible()
    await expect(page.getByTestId('integration-flow-studio-node-catalog')).toBeVisible()
    await expect(page.getByTestId('integration-flow-studio-flow-editor')).toBeVisible()
  })

  test('execution timeline panel visible after selecting a run (stubbed)', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: STUB_FLOW_ID,
                name: 'E2E flow',
                enabled: true,
                triggerType: 'MANUAL',
                flowJson: { nodes: [], edges: [] },
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${STUB_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: STUB_FLOW_ID,
              name: 'E2E flow',
              enabled: true,
              triggerType: 'MANUAL',
              flowJson: { nodes: [{ id: 't', type: 'MANUAL_TRIGGER', config: {} }], edges: [] },
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${STUB_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [{ id: STUB_RUN_ID, status: 'success', startedAt: '2026-01-01T12:00:00Z' }],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/runs/${STUB_RUN_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: STUB_RUN_ID,
              flowId: STUB_FLOW_ID,
              status: 'success',
              timeline: [
                {
                  nodeId: 'trigger_1',
                  nodeType: 'MANUAL_TRIGGER',
                  status: 'success',
                  startedAt: '2026-01-01T12:00:00.000Z',
                  finishedAt: '2026-01-01T12:00:00.100Z',
                  durationMs: 12,
                  errorMessage: null,
                },
              ],
              steps: [
                {
                  id: 'cccccccc-cccc-4ccc-8ddd-333333333333',
                  runId: STUB_RUN_ID,
                  nodeId: 'trigger_1',
                  nodeType: 'MANUAL_TRIGGER',
                  status: 'success',
                  startedAt: '2026-01-01T12:00:00.000Z',
                  finishedAt: '2026-01-01T12:00:00.100Z',
                  durationMs: 12,
                  inputJson: {},
                  outputJson: {},
                  errorMessage: null,
                },
              ],
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'E2E flow' }).click()
    await expect(page.locator('#ifs-name')).toHaveValue('E2E flow')
    await page.getByRole('cell', { name: 'success' }).first().click()
    await expect(page.getByTestId('integration-flow-studio-execution-timeline')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('integration-flow-studio-execution-timeline-panel')).toBeVisible()
  })

  test('node configuration panel: destinationId edits sync to Flow JSON', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    const flowJson = {
      nodes: [
        { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
        {
          id: 'tp_adapter',
          type: 'THEMEPARKS_LIVE_ADAPTER',
          config: { destinationId: 'park-a', parkId: null },
        },
        {
          id: 'map_1',
          type: 'CANONICAL_MAPPING',
          config: { eventType: 'QUEUE_TIME_OBSERVED', mappings: { a: '$.b' } },
        },
      ],
      edges: [{ source: 'trigger_1', target: 'tp_adapter' }],
    }

    const nodesStub = [
      {
        id: 'n1',
        nodeKey: 'MANUAL_TRIGGER',
        nodeType: 'trigger',
        displayName: 'Manual',
        category: 'Trigger',
        enabled: true,
        configSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
      {
        id: 'n2',
        nodeKey: 'THEMEPARKS_LIVE_ADAPTER',
        nodeType: 'adapter',
        displayName: 'ThemeParks',
        category: 'Adapter',
        enabled: true,
        configSchema: {
          type: 'object',
          additionalProperties: false,
          required: [],
          properties: {
            destinationId: { type: 'string' },
            parkId: { type: ['string', 'null'] },
          },
        },
      },
      {
        id: 'n3',
        nodeKey: 'CANONICAL_MAPPING',
        nodeType: 'transform',
        displayName: 'Map',
        category: 'Transform',
        enabled: true,
        configSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['eventType', 'mappings'],
          properties: {
            eventType: { type: 'string' },
            mappings: { type: 'object', additionalProperties: true },
          },
        },
      },
    ]

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: NODE_CFG_FLOW_ID,
                name: 'Node config stub flow',
                enabled: true,
                triggerType: 'MANUAL',
                flowJson,
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${NODE_CFG_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: NODE_CFG_FLOW_ID,
              name: 'Node config stub flow',
              enabled: true,
              triggerType: 'MANUAL',
              flowJson,
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${NODE_CFG_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: nodesStub }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Node config stub flow' }).click()

    await expect(page.getByTestId('integration-flow-studio-node-config')).toBeVisible()

    await page.getByTestId('integration-flow-node-config-select').selectOption('tp_adapter')
    const dest = page.getByTestId('integration-flow-node-config-field-destinationId')
    await expect(dest).toBeVisible()
    const flowJsonTa = page.locator('#ifs-flow-json')
    await expect(flowJsonTa).toHaveValue(/park-a/)
    await dest.fill('park-updated')
    await expect(flowJsonTa).toHaveValue(/park-updated/)
  })

  test('node configuration: invalid object JSON shows validation message', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    const flowJson = {
      nodes: [
        { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
        {
          id: 'map_1',
          type: 'CANONICAL_MAPPING',
          config: { eventType: 'QUEUE_TIME_OBSERVED', mappings: { ok: true } },
        },
      ],
      edges: [],
    }
    const nodesStub = [
      {
        id: 'n1',
        nodeKey: 'MANUAL_TRIGGER',
        nodeType: 'trigger',
        displayName: 'Manual',
        category: 'Trigger',
        enabled: true,
        configSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
      {
        id: 'n3',
        nodeKey: 'CANONICAL_MAPPING',
        nodeType: 'transform',
        displayName: 'Map',
        category: 'Transform',
        enabled: true,
        configSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['eventType', 'mappings'],
          properties: {
            eventType: { type: 'string' },
            mappings: { type: 'object', additionalProperties: true },
          },
        },
      },
    ]

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [{ id: MAP_JSON_FLOW_ID, name: 'Map JSON stub', enabled: true, triggerType: 'MANUAL', flowJson }],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${MAP_JSON_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { id: MAP_JSON_FLOW_ID, name: 'Map JSON stub', enabled: true, triggerType: 'MANUAL', flowJson },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${MAP_JSON_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: nodesStub }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Map JSON stub' }).click()
    await page.getByTestId('integration-flow-node-config-select').selectOption('map_1')
    const mapField = page.getByTestId('integration-flow-node-config-field-mappings')
    await mapField.fill('{')
    await mapField.blur()
    await expect(page.getByTestId('integration-flow-studio-node-config')).toContainText(
      /Invalid JSON|Ungültiges JSON|JSON no válido|JSON invalide/
    )
  })

  test('node configuration: unknown node type shows warning', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    const flowJson = {
      nodes: [
        { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
        { id: 'ghost_1', type: 'UNKNOWN_INTEGRATION_NODE', config: { x: 1 } },
      ],
      edges: [],
    }
    const nodesStub = [
      {
        id: 'n1',
        nodeKey: 'MANUAL_TRIGGER',
        nodeType: 'trigger',
        displayName: 'Manual',
        category: 'Trigger',
        enabled: true,
        configSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    ]

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [{ id: UNKNOWN_NODE_FLOW_ID, name: 'Unknown node stub', enabled: true, triggerType: 'MANUAL', flowJson }],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${UNKNOWN_NODE_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: UNKNOWN_NODE_FLOW_ID,
              name: 'Unknown node stub',
              enabled: true,
              triggerType: 'MANUAL',
              flowJson,
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${UNKNOWN_NODE_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: nodesStub }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Unknown node stub' }).click()
    await page.getByTestId('integration-flow-node-config-select').selectOption('ghost_1')
    await expect(page.getByTestId('integration-flow-node-config-unknown-type-warning')).toBeVisible()
    await expect(page.getByTestId('integration-flow-node-config-unknown-type-warning')).toContainText(
      'UNKNOWN_INTEGRATION_NODE'
    )
  })

  test('scheduling section: interval save and recalculate endpoint', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    const flowJson = {
      nodes: [{ id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} }],
      edges: [],
    }
    let patchSeen: Record<string, unknown> | null = null
    let recalcHits = 0

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: SCHED_TEST_FLOW_ID,
                name: 'Sched stub flow',
                enabled: true,
                triggerType: 'MANUAL',
                scheduleEnabled: true,
                scheduleIntervalSeconds: 300,
                lastScheduledRunAt: null,
                nextScheduledRunAt: '2026-01-15T12:00:00.000Z',
                scheduleLockUntil: null,
                flowJson,
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${SCHED_TEST_FLOW_ID}`,
      async (route) => {
        const m = route.request().method()
        if (m === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: SCHED_TEST_FLOW_ID,
                name: 'Sched stub flow',
                enabled: true,
                triggerType: 'MANUAL',
                scheduleEnabled: true,
                scheduleIntervalSeconds: 300,
                lastScheduledRunAt: null,
                nextScheduledRunAt: '2026-01-15T12:00:00.000Z',
                scheduleLockUntil: null,
                flowJson,
              },
            }),
          })
          return
        }
        if (m === 'PATCH') {
          patchSeen = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: SCHED_TEST_FLOW_ID,
                name: 'Sched stub flow',
                enabled: true,
                triggerType: 'MANUAL',
                ...patchSeen,
                flowJson,
              },
            }),
          })
          return
        }
        await route.continue()
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${SCHED_TEST_FLOW_ID}/schedule/recalculate`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue()
          return
        }
        recalcHits += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: SCHED_TEST_FLOW_ID,
              name: 'Sched stub flow',
              enabled: true,
              triggerType: 'MANUAL',
              scheduleEnabled: true,
              scheduleIntervalSeconds: 300,
              nextScheduledRunAt: '2026-06-01T10:00:00.000Z',
              flowJson,
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${SCHED_TEST_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Sched stub flow' }).click()
    await expect(page.getByTestId('integration-flow-studio-scheduling')).toBeVisible()
    await page.getByTestId('integration-flow-schedule-interval').selectOption({ value: '900' })
    await page.getByTestId('integration-flow-studio-save').click()
    await expect.poll(() => patchSeen).not.toBeNull()
    expect(patchSeen!.scheduleIntervalSeconds).toBe(900)

    await page.getByTestId('integration-flow-schedule-recalculate').click()
    expect(recalcHits).toBe(1)
  })

  test('retry section: save sends retry configuration', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    const flowJson = {
      nodes: [{ id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} }],
      edges: [],
    }
    let patchSeen: Record<string, unknown> | null = null

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: RETRY_PATCH_FLOW_ID,
                name: 'Retry patch stub',
                enabled: true,
                triggerType: 'MANUAL',
                scheduleEnabled: false,
                scheduleIntervalSeconds: null,
                retryEnabled: false,
                maxRetryAttempts: 0,
                retryDelaySeconds: null,
                retryOnNodeTypes: null,
                lastScheduledRunAt: null,
                nextScheduledRunAt: null,
                scheduleLockUntil: null,
                flowJson,
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${RETRY_PATCH_FLOW_ID}`,
      async (route) => {
        const m = route.request().method()
        if (m === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: RETRY_PATCH_FLOW_ID,
                name: 'Retry patch stub',
                enabled: true,
                triggerType: 'MANUAL',
                scheduleEnabled: false,
                scheduleIntervalSeconds: null,
                retryEnabled: false,
                maxRetryAttempts: 0,
                retryDelaySeconds: null,
                retryOnNodeTypes: null,
                lastScheduledRunAt: null,
                nextScheduledRunAt: null,
                scheduleLockUntil: null,
                flowJson,
              },
            }),
          })
          return
        }
        if (m === 'PATCH') {
          patchSeen = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: RETRY_PATCH_FLOW_ID,
                name: 'Retry patch stub',
                enabled: true,
                triggerType: 'MANUAL',
                flowJson,
                ...patchSeen,
              },
            }),
          })
          return
        }
        await route.continue()
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${RETRY_PATCH_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [{ id: 'n1', nodeKey: 'k', nodeType: 'MANUAL_TRIGGER', displayName: 'T', enabled: true }],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Retry patch stub' }).click()
    await expect(page.getByTestId('integration-flow-studio-retry')).toBeVisible()
    await page.getByTestId('integration-flow-retry-enabled').check()
    await page.getByTestId('integration-flow-retry-max-attempts').selectOption('2')
    await page.getByTestId('integration-flow-retry-delay').selectOption({ value: '900' })
    await page.getByTestId('integration-flow-studio-save').click()
    await expect.poll(() => patchSeen).not.toBeNull()
    expect(patchSeen!.retryEnabled).toBe(true)
    expect(patchSeen!.maxRetryAttempts).toBe(2)
    expect(patchSeen!.retryDelaySeconds).toBe(900)
  })

  test('failed run: retry metadata and retry now POST', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    const flowJson = {
      nodes: [{ id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} }],
      edges: [],
    }
    let retryPosts = 0

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: RETRY_RUN_FLOW_ID,
                name: 'Retry run stub',
                enabled: true,
                triggerType: 'MANUAL',
                scheduleEnabled: false,
                retryEnabled: true,
                maxRetryAttempts: 3,
                retryDelaySeconds: 60,
                retryOnNodeTypes: null,
                flowJson,
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${RETRY_RUN_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: RETRY_RUN_FLOW_ID,
              name: 'Retry run stub',
              enabled: true,
              triggerType: 'MANUAL',
              scheduleEnabled: false,
              retryEnabled: true,
              maxRetryAttempts: 3,
              retryDelaySeconds: 60,
              retryOnNodeTypes: null,
              flowJson,
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${RETRY_RUN_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: RETRY_RUN_ID,
                status: 'failed',
                startedAt: '2026-01-10T10:00:00.000Z',
                retryAttempt: 0,
                retryStatus: 'pending_retry',
                nextRetryAt: '2026-01-10T10:05:00.000Z',
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/runs/${RETRY_RUN_ID}`,
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: RETRY_RUN_ID,
                flowId: RETRY_RUN_FLOW_ID,
                status: 'failed',
                startedAt: '2026-01-10T10:00:00.000Z',
                finishedAt: '2026-01-10T10:00:01.000Z',
                durationMs: 1000,
                errorMessage: 'boom',
                retryAttempt: 0,
                retryStatus: 'pending_retry',
                nextRetryAt: '2026-01-10T10:05:00.000Z',
                steps: [],
                timeline: [],
              },
            }),
          })
          return
        }
        await route.continue()
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/runs/${RETRY_RUN_ID}/retry`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue()
          return
        }
        retryPosts += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              runId: '99999999-9999-4999-8999-999999999999',
              flowId: RETRY_RUN_FLOW_ID,
              status: 'success',
              steps: [],
              output: {},
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Retry run stub' }).click()
    await page.locator('tr', { hasText: 'failed' }).first().click()
    await expect(page.getByTestId('integration-flow-run-retry-meta')).toBeVisible()
    await expect(page.getByTestId('integration-flow-run-pending-retry')).toBeVisible()
    await page.getByTestId('integration-flow-run-retry-now').click()
    expect(retryPosts).toBe(1)
  })

  test('failure inbox: panel, row, open run, retry now, acknowledge', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    await loginAndApplyTokens(page, root)

    let failureInboxAcked = false
    let inboxRetryPosts = 0
    let inboxAckPosts = 0

    const flowJson = {
      nodes: [{ id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} }],
      edges: [],
    }

    const flowListItem = {
      id: FAIL_INBOX_FLOW_ID,
      name: 'Inbox stub flow',
      enabled: true,
      triggerType: 'MANUAL',
      retryEnabled: true,
      maxRetryAttempts: 3,
      retryDelaySeconds: 60,
      flowJson,
    }

    function failureInboxItem() {
      return {
        runId: FAIL_INBOX_RUN_ID,
        flowId: FAIL_INBOX_FLOW_ID,
        flowName: 'Inbox stub flow',
        status: 'failed',
        retryStatus: 'pending_retry',
        retryAttempt: 0,
        maxRetryAttempts: 3,
        retryEnabled: true,
        nextRetryAt: '2026-05-14T10:05:00.000Z',
        startedAt: '2026-05-14T10:00:00.000Z',
        finishedAt: '2026-05-14T10:00:01.000Z',
        durationMs: 1000,
        errorMessage: 'adapter timeout',
        failedNodeId: 'node_adapter',
        failedNodeType: 'adapter',
        failedStepErrorMessage: 'adapter timeout',
        acknowledgedAt: failureInboxAcked ? '2026-05-15T12:00:00.000Z' : null,
        acknowledgedBy: failureInboxAcked ? 'admin@smartpark.com' : null,
        acknowledgementNote: failureInboxAcked ? 'Reviewed' : null,
      }
    }

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/failures',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        const item = failureInboxItem()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: [item], total: 1, limit: 50, offset: 0 },
          }),
        })
      }
    )

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [flowListItem] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${FAIL_INBOX_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              ...flowListItem,
              description: null,
              parkId: null,
              scheduleEnabled: false,
              scheduleIntervalSeconds: null,
              lastScheduledRunAt: null,
              nextScheduledRunAt: null,
              scheduleLockUntil: null,
              retryOnNodeTypes: null,
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${FAIL_INBOX_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: FAIL_INBOX_RUN_ID,
                status: 'failed',
                startedAt: '2026-05-14T10:00:00.000Z',
                retryAttempt: 0,
                retryStatus: 'pending_retry',
                nextRetryAt: '2026-05-14T10:05:00.000Z',
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/runs/${FAIL_INBOX_RUN_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: FAIL_INBOX_RUN_ID,
              flowId: FAIL_INBOX_FLOW_ID,
              status: 'failed',
              startedAt: '2026-05-14T10:00:00.000Z',
              finishedAt: '2026-05-14T10:00:01.000Z',
              durationMs: 1000,
              errorMessage: 'adapter timeout',
              retryAttempt: 0,
              retryStatus: 'pending_retry',
              nextRetryAt: '2026-05-14T10:05:00.000Z',
              steps: [
                {
                  id: 'cccccccc-fail-4000-8000-333333333333',
                  runId: FAIL_INBOX_RUN_ID,
                  nodeId: 'node_adapter',
                  nodeType: 'adapter',
                  status: 'failed',
                  startedAt: '2026-05-14T10:00:00.500Z',
                  finishedAt: '2026-05-14T10:00:01.000Z',
                  durationMs: 500,
                  inputJson: {},
                  outputJson: {},
                  errorMessage: 'adapter timeout',
                },
              ],
              timeline: [],
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/runs/${FAIL_INBOX_RUN_ID}/retry`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue()
          return
        }
        inboxRetryPosts += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              runId: '99999999-fail-4000-8000-999999999999',
              flowId: FAIL_INBOX_FLOW_ID,
              status: 'success',
              steps: [],
              output: {},
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/runs/${FAIL_INBOX_RUN_ID}/acknowledge`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue()
          return
        }
        inboxAckPosts += 1
        failureInboxAcked = true
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: failureInboxItem() }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: 'n-ad',
                nodeKey: 'X',
                nodeType: 'adapter',
                displayName: 'Adapter',
                category: 'Adapter',
                enabled: true,
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })

    const panel = page.getByTestId('integration-flow-failures-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('integration-flow-failures-row').first()).toBeVisible()
    await expect(panel.getByText('adapter timeout').first()).toBeVisible()

    await panel.getByTestId('integration-flow-failure-open-run').first().click()
    await expect(page.getByTestId('integration-flow-studio-execution-timeline')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#ifs-name')).toHaveValue('Inbox stub flow')

    await panel.getByTestId('integration-flow-failure-retry-now').first().click()
    expect(inboxRetryPosts).toBe(1)

    await panel.getByTestId('integration-flow-failure-acknowledge').first().click()
    expect(inboxAckPosts).toBe(1)
    await expect(panel.getByText(/Acknowledged|Quittiert|Reconocido|Accusé/)).toBeVisible()
  })

  test('visual builder tab: canvas and palette visible', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const root = baseURL || 'http://localhost:5173'

    const VIS_FLOW_ID = 'aaaaaaaa-visu-4000-8000-111111111111'
    const flowListItem = {
      id: VIS_FLOW_ID,
      name: 'Visual tab stub',
      enabled: true,
      triggerType: 'MANUAL',
      flowJson: {
        nodes: [
          { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
          { id: 'map_1', type: 'CANONICAL_MAPPING', config: { eventType: 'QUEUE_TIME_OBSERVED', mappings: {} } },
        ],
        edges: [{ source: 'trigger_1', target: 'map_1' }],
      },
    }

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [flowListItem] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${VIS_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              ...flowListItem,
              description: null,
              parkId: null,
              scheduleEnabled: false,
              scheduleIntervalSeconds: null,
              lastScheduledRunAt: null,
              nextScheduledRunAt: null,
              scheduleLockUntil: null,
              retryEnabled: false,
              maxRetryAttempts: 0,
              retryDelaySeconds: null,
              retryOnNodeTypes: null,
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${VIS_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: 'n1',
                nodeKey: 'MANUAL_TRIGGER',
                nodeType: 'trigger',
                displayName: 'Manual',
                category: 'Trigger',
                enabled: true,
                configSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/failures',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { items: [], total: 0 } }),
        })
      }
    )

    await loginAndApplyTokens(page, root)

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: /Visual tab stub/ }).click()
    await expect(page.locator('#ifs-name')).toHaveValue('Visual tab stub')
    await page.getByTestId('integration-flow-tab-visual').click()
    await expect(page.getByTestId('integration-flow-visual-builder')).toBeVisible()
    await expect(page.getByTestId('integration-flow-visual-palette-add')).toBeVisible()
    await expect(page.getByTestId('integration-flow-visual-palette-search')).toBeVisible()
    await expect(page.getByTestId('integration-flow-visual-palette-group')).toBeVisible()
    await expect(page.getByTestId('integration-flow-visual-minimap')).toBeVisible()
    await expect(page.getByTestId('integration-flow-visual-controls')).toBeVisible()
    await expect(page.getByTestId('integration-flow-visual-fit-view')).toBeVisible()
    await expect(page.locator('.vue-flow')).toBeVisible()
    await page.getByTestId('integration-flow-visual-palette-search').fill('Manual')
    await expect(page.getByTestId('integration-flow-visual-palette-item').first()).toBeVisible()
  })

  test('visual builder: run timeline failed node and show in graph', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const root = baseURL || 'http://localhost:5173'

    const TIMELINE_FLOW_ID = 'aaaaaaaa-time-4000-8000-111111111111'
    const TIMELINE_RUN_ID = 'bbbbbbbb-time-4000-8000-222222222222'
    const flowListItem = {
      id: TIMELINE_FLOW_ID,
      name: 'Timeline visual stub',
      enabled: true,
      triggerType: 'MANUAL',
      flowJson: {
        nodes: [
          { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
          { id: 'map_1', type: 'CANONICAL_MAPPING', config: { eventType: 'QUEUE_TIME_OBSERVED', mappings: {} } },
        ],
        edges: [{ source: 'trigger_1', target: 'map_1' }],
      },
    }

    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [flowListItem] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${TIMELINE_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              ...flowListItem,
              description: null,
              parkId: null,
              scheduleEnabled: false,
              scheduleIntervalSeconds: null,
              lastScheduledRunAt: null,
              nextScheduledRunAt: null,
              scheduleLockUntil: null,
              retryEnabled: false,
              maxRetryAttempts: 0,
              retryDelaySeconds: null,
              retryOnNodeTypes: null,
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${TIMELINE_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: TIMELINE_RUN_ID,
                status: 'failed',
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/runs/${TIMELINE_RUN_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: TIMELINE_RUN_ID,
              flowId: TIMELINE_FLOW_ID,
              status: 'failed',
              durationMs: 1200,
              steps: [
                {
                  id: 'step-1',
                  runId: TIMELINE_RUN_ID,
                  nodeId: 'trigger_1',
                  nodeType: 'MANUAL_TRIGGER',
                  status: 'success',
                },
                {
                  id: 'step-2',
                  runId: TIMELINE_RUN_ID,
                  nodeId: 'map_1',
                  nodeType: 'CANONICAL_MAPPING',
                  status: 'failed',
                  errorMessage: 'mapping rejected',
                },
              ],
              timeline: [
                { nodeId: 'trigger_1', nodeType: 'MANUAL_TRIGGER', status: 'success' },
                {
                  nodeId: 'map_1',
                  nodeType: 'CANONICAL_MAPPING',
                  status: 'failed',
                  errorMessage: 'mapping rejected',
                },
              ],
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/failures',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { items: [], total: 0 } }),
        })
      }
    )

    await loginAndApplyTokens(page, root)
    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: /Timeline visual stub/ }).click()
    await expect(page.locator('#ifs-name')).toHaveValue('Timeline visual stub')
    await page.getByRole('cell', { name: 'failed' }).first().click()
    await expect(page.getByTestId('integration-flow-studio-execution-timeline')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('integration-flow-show-in-graph').first().click()
    await expect(page.getByTestId('integration-flow-visual-builder')).toBeVisible()
    await expect(page.getByTestId('integration-flow-visual-node-error')).toContainText('mapping rejected')
    await page.getByTestId('integration-flow-tab-json').click()
    await expect(page.locator('#ifs-flow-json')).toContainText('map_1')
  })

  test('node debug panel: previews, truncation badge, mapping compare, pin payload', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    const DEBUG_FLOW_ID = 'aaaaaaaa-preview-4000-8000-111111111111'
    const DEBUG_RUN_ID = 'bbbbbbbb-preview-4000-8000-222222222222'
    const flowJson = {
      nodes: [
        { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
        { id: 'map_1', type: 'CANONICAL_MAPPING', config: { eventType: 'QUEUE_TIME_OBSERVED', mappings: {} } },
      ],
      edges: [{ source: 'trigger_1', target: 'map_1' }],
    }
    const previewInput = {
      _preview: true,
      _truncated: true,
      _rowCount: 99,
      _fieldCount: 3,
      _originalBytes: 48000,
      items: [{ id: 1, wait: 25 }],
    }
    const previewOutput = { _preview: true, canonicalMessages: [{ entityType: 'ATTRACTION' }] }

    await loginAndApplyTokens(page, root)
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: DEBUG_FLOW_ID,
                name: 'Debug preview flow',
                enabled: true,
                triggerType: 'MANUAL',
                flowJson,
              },
            ],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${DEBUG_FLOW_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: DEBUG_FLOW_ID,
              name: 'Debug preview flow',
              enabled: true,
              triggerType: 'MANUAL',
              flowJson,
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/${DEBUG_FLOW_ID}/runs`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [{ id: DEBUG_RUN_ID, status: 'success', startedAt: '2026-01-01T12:00:00Z' }],
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === `/api/v1/integration-flows/runs/${DEBUG_RUN_ID}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: DEBUG_RUN_ID,
              flowId: DEBUG_FLOW_ID,
              status: 'success',
              steps: [
                {
                  id: 'step-map',
                  runId: DEBUG_RUN_ID,
                  nodeId: 'map_1',
                  nodeType: 'CANONICAL_MAPPING',
                  status: 'success',
                  previewInputJson: previewInput,
                  previewOutputJson: previewOutput,
                  inputJson: previewInput,
                  outputJson: previewOutput,
                },
              ],
              timeline: [{ nodeId: 'map_1', nodeType: 'CANONICAL_MAPPING', status: 'success' }],
            },
          }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-nodes',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/templates',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/v1/integration-flows/failures',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { items: [], total: 0 } }),
        })
      }
    )

    await page.goto(`${root}/admin/integration-flow-studio`)
    await expect(page.getByTestId('integration-flow-studio-root')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Debug preview flow' }).click()
    await page.getByRole('cell', { name: 'success' }).first().click()
    await expect(page.getByTestId('integration-flow-studio-debug-toggle')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('integration-flow-studio-debug-toggle').click()
    await expect(page.getByTestId('integration-flow-node-debug-panel')).toBeVisible()
    await page.getByTestId('integration-flow-tab-visual').click()
    await expect(page.getByTestId('integration-flow-visual-builder')).toBeVisible()
    await page.getByTestId('integration-flow-visual-node').filter({ hasText: 'map_1' }).first().click()
    await expect(page.getByTestId('integration-flow-debug-truncation-badge')).toBeVisible()
    await expect(page.getByTestId('integration-flow-debug-mapping-compare')).toBeVisible()
    await page.getByTestId('integration-flow-debug-pin').click()
    await expect(page.getByTestId('integration-flow-debug-pinned')).toBeVisible()
    await page.getByRole('cell', { name: 'success' }).first().click()
    await expect(page.getByTestId('integration-flow-debug-pinned')).toBeVisible()
  })

  test('flow designer: palette, inspector, transform governance', async ({ page, baseURL }) => {
    const root = baseURL || 'http://localhost:5173'
    const DESIGNER_FLOW_ID = 'aaaaaaaa-design-4000-8000-111111111111'
    await loginAndApplyTokens(page, root)
    await page.route('**/api/v1/integrations/feature-flags', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { integrationFlowEngineEnabled: true, integrationFlowScriptNodeEnabled: false },
        }),
      })
    })
    await page.route('**/api/v1/integration-flows', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: DESIGNER_FLOW_ID,
              name: 'Designer flow',
              enabled: true,
              triggerType: 'MANUAL',
              flowJson: {
                nodes: [
                  { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
                  {
                    id: 'pt_1',
                    type: 'PAYLOAD_TRANSFORM',
                    config: { mode: 'mapping', mappings: { x: '$.y' } },
                  },
                ],
                edges: [{ source: 'trigger_1', target: 'pt_1' }],
              },
            },
          ],
        }),
      })
    })
    await page.route(`**/api/v1/integration-flows/${DESIGNER_FLOW_ID}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: DESIGNER_FLOW_ID,
            name: 'Designer flow',
            enabled: true,
            triggerType: 'MANUAL',
            flowJson: {
              nodes: [
                { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
                {
                  id: 'pt_1',
                  type: 'PAYLOAD_TRANSFORM',
                  config: { mode: 'mapping', mappings: { x: '$.y' } },
                },
              ],
              edges: [{ source: 'trigger_1', target: 'pt_1' }],
            },
          },
        }),
      })
    })
    await page.route(`**/api/v1/integration-flows/${DESIGNER_FLOW_ID}/runs`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    })
    await page.route('**/api/v1/integration-nodes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'n1',
              nodeKey: 'MANUAL_TRIGGER',
              nodeType: 'trigger',
              displayName: 'Manual',
              category: 'Trigger',
              enabled: true,
              configSchema: { type: 'object', properties: {}, required: [] },
            },
            {
              id: 'n2',
              nodeKey: 'PAYLOAD_TRANSFORM',
              nodeType: 'transform',
              displayName: 'Payload Transform',
              category: 'Transform',
              enabled: true,
              configSchema: {
                type: 'object',
                properties: {
                  mode: { type: 'string', enum: ['mapping', 'script'] },
                  mappings: { type: 'object' },
                  script: { type: 'string' },
                },
                required: ['mode'],
              },
            },
            {
              id: 'n3',
              nodeKey: 'GENERATE_OUTPUT_FILE',
              nodeType: 'output',
              displayName: 'Generate Output File',
              category: 'Output',
              enabled: true,
              configSchema: {
                type: 'object',
                properties: { format: { type: 'string' }, filenameTemplate: { type: 'string' } },
              },
            },
          ],
        }),
      })
    })
    await page.route('**/api/v1/integration-flows/templates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    })
    await page.route('**/api/v1/integration-flows/failures', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { items: [], total: 0 } }),
      })
    })

    await page.goto(`${root}/admin/integration-flow-studio`)
    await page.getByRole('button', { name: 'Designer flow' }).click()
    await page.getByTestId('integration-flow-tab-visual').click()
    await expect(page.getByTestId('integration-flow-designer-workbench')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('integration-flow-node-palette')).toBeVisible()
    await page.getByTestId('integration-flow-palette-search').fill('Payload')
    await expect(page.getByTestId('integration-flow-palette-item').filter({ hasText: 'Payload Transform' })).toBeVisible()
    await page.getByTestId('integration-flow-visual-node').filter({ hasText: 'pt_1' }).click()
    await expect(page.getByTestId('integration-flow-node-inspector')).toBeVisible()
    await page.getByTestId('integration-flow-transform-mode').selectOption('script')
    await expect(page.getByTestId('integration-flow-script-governance-warning')).toBeVisible()
    await page.getByTestId('integration-flow-pin-sample').click()
    const pinned = await page.evaluate(() =>
      localStorage.getItem('sp-integration-flow-pinned:aaaaaaaa-design-4000-8000-111111111111:pt_1')
    )
    expect(pinned).toBeTruthy()
  })
})
