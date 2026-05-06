import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

/** When Playwright starts Vite, optionally set the Add-on Board L3 UI rollback switch on (see `e2e/addon-board-signal-picker.spec.ts`). */
const webServerEnv = {
  ...process.env,
  ...(process.env.PLAYWRIGHT_ADDON_BOARD_PICKER === '1' ? { VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER: 'true' } : {}),
}

export default defineConfig({
  testDir: './e2e',
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
  webServer:
    process.env.PLAYWRIGHT_START_WEB_SERVER === '1'
      ? {
          command: 'npm run dev -- --host 127.0.0.1 --port 5173',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
          env: webServerEnv,
        }
      : undefined,
})
