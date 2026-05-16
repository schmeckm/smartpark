import { defineConfig, devices } from '@playwright/test'

const pwOwnServer = process.env.PLAYWRIGHT_START_WEB_SERVER === '1'
/** Own Vite on 5174 avoids reusing a Docker frontend on 5173 with a stale node_modules volume. */
const e2ePort = pwOwnServer ? (process.env.PLAYWRIGHT_E2E_PORT || '5174') : (process.env.PLAYWRIGHT_E2E_PORT || '5173')
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${e2ePort}`

/** When Playwright starts Vite, optionally set the Add-on Board L3 UI rollback switch on (see `tests/e2e/addon-board-signal-picker.spec.ts`). */
const webServerEnv = {
  ...process.env,
  ...(process.env.PLAYWRIGHT_ADDON_BOARD_PICKER === '1' ? { VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER: 'true' } : {}),
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: pwOwnServer
    ? {
        command: `npm run dev -- --host 127.0.0.1 --port ${e2ePort}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: webServerEnv,
      }
    : undefined,
})
