import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  // Electron instances are heavy; launching several at once is flaky on CI
  // (debug-port/GPU contention), so run spec files serially.
  workers: 1,
  // Kill stray Electron processes left by tests that failed before app.close()
  globalTeardown: './e2e/teardown.ts',
  use: {
    headless: true,
    viewport: { width: 1400, height: 900 },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      use: {},
    },
  ],
})
