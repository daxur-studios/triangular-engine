import { defineConfig } from '@playwright/test';

/** Reuse the existing application host; never launch a competing development server for this suite. */
export default defineConfig({
  testDir: './tests/scene/specs',
  testMatch: '**/*runner.spec.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/test-runner',
  use: {
    baseURL: process.env['TRIANGULAR_TEST_BASE_URL'] ?? 'http://triangular-demo.localhost:4200',
    headless: true,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
});
