'use strict';

// Browser execution is intentionally limited to the authorized GitHub CI job.
// The job builds index.html and serves it at /econ/index.html before this runs.
if (!process.env.CI) {
  throw new Error('Browser tests are CI-only. Run the GitHub Actions validation workflow.');
}

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.cjs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/browser-junit.xml' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  webServer: {
    command: 'node scripts/test-server.cjs',
    url: 'http://127.0.0.1:4173/econ/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: process.env.FICC_TEST_BASE_URL || 'http://127.0.0.1:4173',
    acceptDownloads: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
});
