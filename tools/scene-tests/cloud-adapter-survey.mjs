import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Discovery only: no OS graphics preference changes and no spoofed adapter identity.
const directory = path.resolve('artifacts/cloud-adapters', new Date().toISOString().replace(/[:.]/g, '-') + `-${process.pid}`);
fs.mkdirSync(directory, { recursive: true });
const results = [];
for (const args of [['--enable-gpu'], ['--enable-gpu', '--force-high-performance-gpu']]) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  try {
    const page = await browser.newPage();
    // localhost is a secure context; route locally so discovery needs no external server.
    await page.route('http://localhost/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Adapter survey</title>' }));
    await page.goto('http://localhost/');
    const adapters = await page.evaluate(async () => {
      const readings = [];
      for (const powerPreference of ['low-power', 'high-performance']) {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference });
        if (!adapter) { readings.push({ powerPreference, available: false }); continue; }
        const { vendor, architecture, device, description, isFallbackAdapter } = adapter.info;
        let deviceError = null;
        try { const gpuDevice = await adapter.requestDevice(); gpuDevice.destroy(); }
        catch (error) { deviceError = String(error); }
        readings.push({ powerPreference, available: true, vendor, architecture, device, description, isFallbackAdapter, deviceError });
      }
      return readings;
    });
    results.push({ args, browser: browser.version(), adapters });
  } finally { await browser.close(); }
}
fs.writeFileSync(path.join(directory, 'survey.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ directory, results }, null, 2));
