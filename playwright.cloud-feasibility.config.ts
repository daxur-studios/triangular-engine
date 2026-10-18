import { defineConfig } from '@playwright/test';
import path from 'node:path';

const runDir = process.env['CLOUD_PROBE_RUN_DIR'] ?? path.resolve('artifacts/cloud-feasibility/manual');
const port = Number(process.env['CLOUD_PROBE_PORT'] ?? 4233);

export default defineConfig({
  testDir: './tests/cloud-feasibility',
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  outputDir: path.join(runDir, 'test-results'),
  reporter: [['list'], ['html', { outputFolder: path.join(runDir, 'playwright-report'), open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 640, height: 360 },
    deviceScaleFactor: 1,
    // No SwiftShader/unsafe WebGPU override: prove the ordinary hardware path first.
    launchOptions: { args: ['--enable-gpu'] },
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node tools/scene-tests/cloud-probe-server.mjs',
    url: `http://127.0.0.1:${port}/cloud-volumes-lab`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
