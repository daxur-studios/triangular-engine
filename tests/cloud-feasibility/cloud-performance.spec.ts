import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { CloudPerformanceOptions } from '../../projects/demo-app/src/app/pages/cloud-volumes-lab/cloud-replay-probe';
import { comparePerformance, summarize, type PerformanceReading } from './cloud-performance-analysis';

const runDir = process.env['CLOUD_PROBE_RUN_DIR'] ?? path.resolve('artifacts/cloud-feasibility/manual');
const frames = Number(process.env['CLOUD_PROBE_FRAMES'] ?? 1200);
type Measurement = {
  profile: { backend: string; adapter: { vendor: string; architecture: string; isFallbackAdapter: boolean | null }; width: number; height: number; dpr: number; timestampSupported: boolean };
  steps: number; renderCopies: number; framesPerPath: number; paths: number; simulationFrames: number; renderedFrames: number; wallMs: number; minimumWindowReached: boolean;
  batches: Array<{ frames: number; wallMs: number; cpuMs: number; render: Array<[string, number]>; compute: Array<[string, number]> }>;
  initialState: { volumes: Array<{ lightBakes: number }> }; journeyStates: Array<{ volumes: Array<{ lightBakes: number }> }>;
  finalCapture: { png: string }; errors: string[];
};
type Hook = { prepare(): Promise<unknown>; measure(options: CloudPerformanceOptions): Promise<Measurement> };
type Reading = PerformanceReading & { label: string; steps: number; renderCopies: number; wallMsPerFrame: number; gpuComputeMsPerFrame: number; timestampFrames: number; renderedFrames: number };

function telemetry() {
  try { return execFileSync('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,power.draw,temperature.gpu,clocks.gr', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim(); }
  catch { return null; }
}

test('U0P: repeated rendering costs, redundant-render slowdown and known-contention rejection', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(600000);
  fs.mkdirSync(runDir, { recursive: true });
  const readings: Reading[] = [];
  const evidence: Record<string, unknown> = {
    schemaVersion: 1, experiment: 'cloud-performance-u0p-v1', browserVersion: browser.version(),
    browserArguments: ['--enable-gpu', '--force-high-performance-gpu'], framesPerPath: frames,
    comparisonPolicy: '3 alternating rounds, <=15% spread per group; slowdown >25% and nonoverlapping ranges',
    idleMachinePerformance: 'inconclusive: laptop isolation/power/thermal state not controlled',
    realtimeSmoothness: 'not measured: offscreen, fixed steps and batch backpressure', readings,
  };
  const bundleReads: Promise<void>[] = [];
  const bundles: Record<string, string> = {};
  const cdp = await browser.newBrowserCDPSession();
  evidence['systemGpu'] = (await cdp.send('SystemInfo.getInfo')).gpu;
  await cdp.detach();
  const baseline: Reading[] = [], slow: Reading[] = [], repeat: Reading[] = [];
  let measuredPaths: number | undefined;
  let referenceImage: Buffer | undefined;

  async function measure(label: string, renderCopies: 1 | 8, competing = false) {
    const context = await browser.newContext({ baseURL, viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const browserErrors: string[] = [];
    let loadPage: Awaited<ReturnType<typeof context.newPage>> | undefined;
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    page.on('response', (response) => {
      if (!response.url().split('?')[0].endsWith('.js')) return;
      bundleReads.push(response.body().then((body) => {
        const hash = createHash('sha256').update(body).digest('hex');
        bundles[response.url().replace(baseURL!, '')] = hash;
        const destination = path.join(runDir, 'bundles', `${hash}.js`);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (!fs.existsSync(destination)) fs.writeFileSync(destination, body);
      }).catch((error) => { browserErrors.push(`BUNDLE_RETENTION: ${String(error)}`); }));
    });
    const beforeTelemetry = telemetry();
    try {
      await page.goto('/__cloud-probe-load');
      // Use the same disposable thumbnail fixture as U0; keep unexpected-render detection active.
      await page.evaluate(() => new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('triangular-demo-thumbnails', 10);
        open.onupgradeneeded = () => open.result.createObjectStore('images', { keyPath: 'route' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction('images', 'readwrite');
          tx.objectStore('images').put({ route: '/cloud-volumes-lab', capturedAt: 0, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=' });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      }));
      await page.goto('/cloud-volumes-lab?cloudReplay=u0');
      await page.waitForFunction(() => Boolean((window as unknown as { __cloudReplayProbe?: Hook }).__cloudReplayProbe));
      const profile = await page.evaluate(() => (window as unknown as { __cloudReplayProbe: Hook }).__cloudReplayProbe.prepare());
      evidence[`${label}-profile`] = profile;
      const environment = await page.evaluate(async () => {
        const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> };
        const battery = await nav.getBattery?.();
        return { platform: navigator.platform, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
          power: battery ? { charging: battery.charging, level: battery.level } : null };
      });
      if (competing) {
        loadPage = await context.newPage();
        await loadPage.goto('/__cloud-probe-load');
        await loadPage.evaluate(async () => {
          const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
          if (!adapter) throw new Error('LOAD_ADAPTER_UNAVAILABLE');
          const device = await adapter.requestDevice();
          const buffer = device.createBuffer({ size: 65536 * 4, usage: GPUBufferUsage.STORAGE });
          const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: {
            module: device.createShaderModule({ code: '@group(0) @binding(0) var<storage,read_write> output:array<f32>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u) { var v=f32(id.x)*0.01; for(var i=0u;i<256u;i++){ v=sin(v+f32(i)*0.001)+cos(v*0.97); } output[id.x]=v; }' }), entryPoint: 'main',
          } });
          const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
          const state = { batches: 0, gpuWallMs: 0, errors: [] as string[], vendor: adapter.info.vendor, architecture: adapter.info.architecture };
          device.addEventListener('uncapturederror', (event) => state.errors.push(event.error.message));
          let active = true, pending = Promise.resolve();
          const started = performance.now();
          const draw = () => {
            if (!active || performance.now() - started > 30000) return;
            const start = performance.now(), encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
            pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(1024); pass.end();
            device.queue.submit([encoder.finish()]);
            pending = device.queue.onSubmittedWorkDone().then(() => {
              state.batches++; state.gpuWallMs += performance.now() - start; setTimeout(draw, 4);
            }).catch((error) => { state.errors.push(String(error)); active = false; });
          };
          (window as unknown as { __stopLoad: () => Promise<unknown> }).__stopLoad = async () => { active = false; await pending; buffer.destroy(); device.destroy(); return state; };
          draw();
        });
      }
      const result = await page.evaluate((options) => (window as unknown as { __cloudReplayProbe: Hook }).__cloudReplayProbe.measure(options),
        { frames, steps: 24 as const, renderCopies, paths: measuredPaths, minimumWallMs: measuredPaths === undefined ? 4000 : 3000 });
      measuredPaths ??= result.paths;
      evidence['measuredPaths'] = measuredPaths;
      const { finalCapture, ...raw } = result;
      const image = Buffer.from(finalCapture.png.split(',')[1], 'base64');
      fs.writeFileSync(path.join(runDir, `${label}.png`), image);
      fs.writeFileSync(path.join(runDir, `${label}.json`), JSON.stringify({ ...raw, finalCapture: `${label}.png`, environment,
        telemetry: { before: beforeTelemetry, after: telemetry() }, browserErrors }, null, 2));
      expect(result.profile.backend).toBe('webgpu');
      expect(result.profile.adapter.vendor).toBe(process.env['CLOUD_PROBE_EXPECT_VENDOR'] ?? 'nvidia');
      expect(result.profile.adapter.isFallbackAdapter).not.toBe(true);
      expect(result.profile.timestampSupported).toBe(true);
      expect(result.profile.width).toBe(640); expect(result.profile.height).toBe(360);
      expect(browserErrors).toEqual([]); expect(result.errors).toEqual([]);
      const renderPasses = result.batches.flatMap((batch) => batch.render);
      const renderFrames = new Set(renderPasses.map(([id]) => id.match(/:f(\d+)$/)?.[1]));
      expect(renderFrames.has(undefined), 'every query must identify its renderer frame').toBe(false);
      expect(renderFrames.size, 'every rendered frame has GPU timestamp evidence').toBe(result.renderedFrames);
      expect(result.batches.reduce((sum, batch) => sum + batch.frames, 0)).toBe(result.simulationFrames);
      expect(result.renderedFrames).toBe(result.simulationFrames * renderCopies);
      expect(result.journeyStates.at(-1)!.volumes[0].lightBakes).toBeGreaterThan(result.initialState.volumes[0].lightBakes);
      referenceImage ??= image;
      expect(image.equals(referenceImage), 'redundant renders must preserve the final checkpoint image').toBe(true);
      const gpuRenderMsPerFrame = renderPasses.reduce((sum, [, ms]) => sum + ms, 0) / result.simulationFrames;
      const reading: Reading = { label, steps: 24, renderCopies, gpuRenderMsPerFrame, gpuComputeMsPerFrame: result.batches.flatMap((b) => b.compute).reduce((sum, [, ms]) => sum + ms, 0) / result.simulationFrames,
        wallMsPerFrame: result.wallMs / result.simulationFrames, renderedFrames: result.renderedFrames, timestampFrames: renderFrames.size,
        knownContention: competing, valid: result.minimumWindowReached && gpuRenderMsPerFrame > 0 && environment.power?.charging !== false,
        profileKey: JSON.stringify({ browser: browser.version(), backend: result.profile.backend, adapter: result.profile.adapter, width: result.profile.width,
          height: result.profile.height, dpr: result.profile.dpr, frames, environment, batch: 16, mode: 'mesh', clock: 'fixed-60hz', output: 'offscreen-u8-srgb' }),
      };
      readings.push(reading);
      console.log(`${label}: ${reading.gpuRenderMsPerFrame.toFixed(3)} ms render GPU/simulation step, ${reading.wallMsPerFrame.toFixed(3)} ms wall/step, ${result.renderedFrames} renders`);
      return reading;
    } finally {
      if (loadPage) evidence[`${label}-load`] = await loadPage.evaluate(() => (window as unknown as { __stopLoad: () => Promise<unknown> }).__stopLoad()).catch(String);
      await context.close();
    }
  }
  try {
    // Rotate B (slow) between the two A repeats to expose order/thermal drift.
    for (let round = 0; round < 3; round++) {
      const order = round % 2 ? ['repeat', 'slow', 'baseline'] : ['baseline', 'slow', 'repeat'];
      for (const kind of order) {
        const reading = await measure(`${kind}-${round + 1}`, kind === 'slow' ? 8 : 1);
        (kind === 'slow' ? slow : kind === 'baseline' ? baseline : repeat).push(reading);
      }
    }
    const allReference = [...baseline, ...repeat];
    evidence['knownSlowdown'] = comparePerformance(allReference, slow);
    evidence['sameBuildRepeat'] = comparePerformance(baseline, repeat);
    evidence['referenceSpread'] = summarize(allReference.map((r) => r.gpuRenderMsPerFrame));
    const busy = await measure('known-contention', 1, true);
    // This one observed window is deliberately insufficient for a perf verdict, as well as busy.
    const busyVerdict = comparePerformance(baseline, [busy]);
    evidence['knownContention'] = busyVerdict;
    expect(busyVerdict.verdict).toBe('inconclusive');
    expect(busyVerdict.reasons).toContain('known-contention');
    const load = evidence['known-contention-load'] as { batches: number; gpuWallMs: number; vendor: string; architecture: string; errors: string[] };
    expect(load.batches).toBeGreaterThan(10); expect(load.gpuWallMs).toBeGreaterThan(100);
    expect(load.vendor).toBe(JSON.parse(busy.profileKey).adapter.vendor);
    expect(load.architecture).toBe(JSON.parse(busy.profileKey).adapter.architecture);
    expect(load.errors).toEqual([]);
    expect(browser.contexts()).toHaveLength(0);
  } catch (error) { evidence['failure'] = String(error); throw error; }
  finally {
    await Promise.all(bundleReads);
    evidence['bundles'] = bundles;
    fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(evidence, null, 2));
    const report = ['# Cloud performance U0P experiment', '',
      `Known slowdown: ${JSON.stringify(evidence['knownSlowdown'] ?? 'not-completed')}`,
      `Same-build repeat: ${JSON.stringify(evidence['sameBuildRepeat'] ?? 'not-completed')}`,
      `Reference spread: ${JSON.stringify(evidence['referenceSpread'] ?? 'not-completed')}`,
      `Known contention: ${JSON.stringify(evidence['knownContention'] ?? 'not-completed')}`, '',
      'Idle-machine performance: inconclusive (external activity, power and thermal state not controlled).',
      'These are offscreen GPU render-pass costs, not FPS or real-time smoothness. Captures happen after measurement.',
      'All per-frame costs use simulation steps as denominator. The positive control draws the real scene 8 times per step with identical output.',
      'Raw pass timestamps, wall/CPU batch timings, environment, telemetry, images and served bundles retained.',
      ...(evidence['failure'] ? ['', `Failure: ${evidence['failure']}`] : []),
    ].join('\n');
    fs.writeFileSync(path.join(runDir, 'report.md'), report);
    await testInfo.attach('cloud-performance-report', { body: report, contentType: 'text/markdown' });
  }
});
