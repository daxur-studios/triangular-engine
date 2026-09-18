import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/scene',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4222', browserName: 'chromium', viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, trace: 'retain-on-failure' },
  webServer: {
    command: 'npx ng serve demo-app --configuration development --host 127.0.0.1 --port 4222',
    url: 'http://127.0.0.1:4222/scene-inspection-lab',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
