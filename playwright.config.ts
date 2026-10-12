import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'layout.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4187',
    browserName: 'webkit',
    viewport: { width: 375, height: 667 },
  },
  webServer: {
    command: 'npm run build && PORT=4187 npm start',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
