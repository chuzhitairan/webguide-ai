import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 8000 },
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'node tests/fixtures/collaboration/server.mjs',
    url: 'http://127.0.0.1:43131/fixture-team/guide/issue?number=1',
    reuseExistingServer: false,
    timeout: 15000,
  },
});