// Runs the shared tests against one running example. Point BASE_URL at it, and pick the
// example's project:
//   BASE_URL=http://localhost:8080 npx playwright test --project=checkout
//   BASE_URL=http://localhost:8090 npx playwright test --project=webhooks
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: './test-results',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'checkout', testMatch: 'checkout.spec.js', use: { ...devices['Desktop Chrome'] } },
    { name: 'webhooks', testMatch: 'webhooks.spec.js' },
  ],
});
