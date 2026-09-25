import { defineConfig } from '@playwright/test';

/**
 * Performance suite (tests/perf). Kept separate from the visual scene suite:
 * no video, trace or screenshots (they perturb timings), one worker, fixed
 * viewport and DPR. Prefer `node tools/run-perf.mjs` over calling this
 * directly — it sets the PERF_* switches cross-platform. See tests/perf/README.md.
 */
const reference = process.env['PERF_PROTOCOL'] === 'reference';
const uncapped = process.env['PERF_UNCAPPED'] !== '0';

// One id for every test in this invocation, shared with workers through env.
process.env['PERF_RUN_ID'] ??= new Date().toISOString().replace(/[:.]/g, '-');

export default defineConfig({
  testDir: './tests/perf/specs',
  testMatch: '**/*.perf.spec.ts',
  timeout: reference ? 240_000 : 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'test-results/perf',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/perf' }]],
  use: {
    baseURL: 'http://127.0.0.1:4222',
    browserName: 'chromium',
    headless: process.env['PERF_HEADED'] !== '1',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: {
      args: [
        // Let frames run faster than vsync so frame intervals reflect work, not the display.
        ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
        // window.gc() before each sampling window reduces GC noise between runs.
        '--js-flags=--expose-gc',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        ...(process.env['PERF_CHROMIUM_ARGS']?.split(' ').filter(Boolean) ?? []),
      ],
    },
  },
  webServer: {
    command: 'npx ng serve demo-app --configuration development --host 127.0.0.1 --port 4222',
    url: 'http://127.0.0.1:4222/perf-lab',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
