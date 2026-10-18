import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CloudReplayOptions } from '../../projects/demo-app/src/app/pages/cloud-volumes-lab/cloud-replay-probe';

const runDir = process.env['CLOUD_PROBE_RUN_DIR'] ?? path.resolve('artifacts/cloud-feasibility/manual');
const frames = Number(process.env['CLOUD_PROBE_FRAMES'] ?? 1200);
const checkpoints = [...new Set([0, .25, .45, .5, .55, .75, 1].map((f) => Math.round(f * (frames - 1))))];
type ReplayResult = {
  profile: { backend: string; adapter: null | { vendor: string; architecture: string; device: string; description: string; isFallbackAdapter: boolean | null }; glRenderer: string | null; timestampSupported: boolean; [key: string]: unknown };
  frames: number; wallMs: number; errors: string[];
  samples: Array<{ frame: number; simulatedSeconds: number; engineSeconds: number; shaderSeconds: number; shaderFrame: number; camera: { position: number[]; quaternion: number[] }; scene: { sunElevation: number; spinAngle: number; volumes: Array<{ densityBakes: number; lightBakes: number; cameraInside: boolean }> }; cpuMs: number; gpuMs: number | null }>;
  captures: Array<{ frame: number; width: number; height: number; png: string }>;
};
type Probe = {
  prepare(options?: { mode?: 'mesh' | 'proxy'; fault?: 'readiness'; readinessTimeoutMs?: number }): Promise<ReplayResult['profile']>;
  run(options: CloudReplayOptions): Promise<ReplayResult>;
};
declare global { interface Window { __cloudReplayProbe?: Probe } }

async function comparePng(page: Page, a: string, b: string) {
  return page.evaluate(async ({ a, b }) => {
    const decode = async (url: string) => {
      const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
    };
    const [left, right] = await Promise.all([decode(a), decode(b)]);
    if (left.width !== right.width || left.height !== right.height) throw new Error('CAPTURE_SIZE_MISMATCH');
    let changedPixels = 0, maximumChannelDelta = 0, sum = 0;
    for (let i = 0; i < left.data.length; i += 4) {
      let changed = false;
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(left.data[i + c] - right.data[i + c]);
        maximumChannelDelta = Math.max(maximumChannelDelta, delta); sum += delta; changed ||= delta > 0;
      }
      if (changed) changedPixels++;
    }
    return { changedPixels, maximumChannelDelta, meanChannelDelta: sum / (left.width * left.height * 3) };
  }, { a, b });
}

function normalizedStates(result: ReplayResult) {
  return result.samples.map(({ cpuMs, gpuMs, ...state }) => JSON.parse(JSON.stringify(state, (_, value) => typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value)));
}

test('U0: hardware rendering, complete replay, delay invariance and injected faults', async ({ browser, baseURL }, testInfo) => {
  fs.mkdirSync(runDir, { recursive: true });
  const outcomes: Record<string, string> = { hardware: 'inconclusive', replay: 'inconclusive', failureDetection: 'inconclusive', unattended: 'inconclusive', contention: 'not-run', performance: 'inconclusive (uncontrolled laptop; no baseline)', video: 'not-created' };
  const evidence: Record<string, unknown> = { frames, checkpoints, browserVersion: browser.version(), baseline: 'not-created', outcomes };
  const messages: string[] = [];
  const bundleReads: Promise<void>[] = [];
  const bundles = new Map<string, string>();
  const gpuSession = await browser.newBrowserCDPSession();
  evidence['systemGpu'] = await gpuSession.send('SystemInfo.getInfo').then((info) => info.gpu);
  await gpuSession.detach();
  const results = new Map<string, ReplayResult>();
  async function withProbe<T>(label: string, action: (page: Page) => Promise<T>, mode: 'mesh' | 'proxy' = 'mesh', prepare = true, competing = false) {
    const context = await browser.newContext({ baseURL, viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    let loadPage: Page | undefined;
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('requestfailed', (req) => errors.push(`${req.url()} ${req.failure()?.errorText}`));
    page.on('response', (response) => {
      if (!response.url().split('?')[0].endsWith('.js')) return;
      bundleReads.push(response.body().then((body) => {
        const hash = createHash('sha256').update(body).digest('hex');
        bundles.set(response.url().replace(baseURL!, ''), hash);
        const dest = path.join(runDir, 'bundles', `${hash}.js`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, body);
      }).catch(() => undefined));
    });
    try {
      // The catalog's automatic ScreenshotService capture draws an extra frame after ~1 s.
      // Seed its normal cache in this disposable context before Angular starts, so it has
      // no work to schedule. Keep unexpected-render detection enabled in the probe.
      await page.goto('/__cloud-probe-load');
      await page.evaluate(() => new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('triangular-demo-thumbnails', 10); // Dexie schema version 1.
        open.onupgradeneeded = () => open.result.createObjectStore('images', { keyPath: 'route' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('images', 'readwrite');
          tx.objectStore('images').put({ route: '/cloud-volumes-lab', capturedAt: 0, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=' });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      }));
      evidence['catalogThumbnailFixture'] = 'existing cached thumbnail seeded before app boot; independent auto capture has no work';
      await page.goto('/cloud-volumes-lab?cloudReplay=u0');
      await page.waitForFunction(() => Boolean(window.__cloudReplayProbe), undefined, { timeout: 30000 });
      if (prepare) await page.evaluate((mode) => window.__cloudReplayProbe!.prepare({ mode }), mode);
      if (competing) {
        loadPage = await context.newPage();
        await loadPage.goto('/__cloud-probe-load');
        await loadPage.evaluate(async () => {
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) throw new Error('LOAD_GPU_ADAPTER_UNAVAILABLE');
          const device = await adapter.requestDevice();
          const buffer = device.createBuffer({ size: 65536 * 4, usage: GPUBufferUsage.STORAGE });
          const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: {
            module: device.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> output: array<f32>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) { var v = f32(id.x) * 0.01; for (var i = 0u; i < 128u; i++) { v = sin(v + f32(i) * 0.001) + cos(v * 0.97); } output[id.x] = v; }' }),
            entryPoint: 'main',
          } });
          const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
          const load = { batches: 0, running: true, adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, isFallbackAdapter: adapter.info.isFallbackAdapter }, gpuWallMs: 0, errors: [] as string[] };
          device.onuncapturederror = (event) => load.errors.push(event.error.message);
          let pending = Promise.resolve();
          const started = performance.now();
          const draw = () => {
            if (!load.running || performance.now() - started > 90000) return;
            const t = performance.now();
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(1024); pass.end();
            device.queue.submit([encoder.finish()]);
            pending = device.queue.onSubmittedWorkDone().then(() => {
              load.gpuWallMs += performance.now() - t; load.batches++;
              setTimeout(draw, 16);
            }).catch((error) => { load.errors.push(String(error)); load.running = false; });
          };
          (window as any).__u0Load = { stop: async () => {
            load.running = false; await pending; buffer.destroy(); device.destroy(); return load;
          } };
          draw();
        });
        await loadPage.bringToFront();
        evidence['contendedPageVisibility'] = await page.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState }));
      }
      const value = await action(page);
      expect(errors, `${label}: browser errors`).toEqual([]);
      return value;
    } catch (error) {
      evidence[`${label}-failure`] = String(error);
      throw error;
    } finally {
      if (loadPage) evidence['competingGpuLoad'] = await loadPage.evaluate(() => (window as any).__u0Load.stop()).catch(String);
      if (errors.length) evidence[`${label}-errors`] = errors;
      await context.close();
    }
  }
  async function run(label: string, mode: 'mesh' | 'proxy', options: Partial<CloudReplayOptions> = {}, competing = false) {
    const result = await withProbe(label, (page) => page.evaluate((options) => window.__cloudReplayProbe!.run(options), { frames, captureFrames: checkpoints, ...options }), mode, true, competing);
    // Save the evidence before assertions, including failed journeys.
    for (const capture of result.captures) fs.writeFileSync(path.join(runDir, `${label}-${capture.frame}.png`), Buffer.from(capture.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(runDir, `${label}.json`), JSON.stringify({ ...result, captures: result.captures.map(({ png, ...capture }) => ({ ...capture, file: `${label}-${capture.frame}.png` })) }, null, 2));
    expect(result.samples).toHaveLength(frames);
    expect(result.samples.map((sample) => sample.frame)).toEqual(Array.from({ length: frames }, (_, i) => i));
    for (const sample of result.samples) expect(Math.abs(sample.engineSeconds - sample.simulatedSeconds)).toBeLessThan(1e-7);
    expect(result.samples.at(-1)!.scene.volumes[0].lightBakes).toBeGreaterThan(result.samples[0].scene.volumes[0].lightBakes);
    expect(result.errors).toEqual([]);
    if (options.fault !== 'missing-cloud') {
      expect(result.samples[0].scene.volumes[0].cameraInside).toBe(false);
      expect(result.samples.at(-1)!.scene.volumes[0].cameraInside).toBe(false);
      expect(result.samples.some((sample) => sample.scene.volumes[0].cameraInside), 'journey enters the moving volume').toBe(true);
    }
    results.set(label, result);
    messages.push(`${label}: ${frames} frames, ${(result.wallMs / 1000).toFixed(1)} s wall time, ${result.samples.filter((s) => s.gpuMs !== null).length} GPU samples`);
    console.log(messages.at(-1));
    return result;
  }
  try {
    const normal = await browser.newPage();
    try {
      await normal.goto(`${baseURL}/cloud-volumes-lab`);
      await normal.getByRole('heading', { name: 'Cloud volumes lab · Plan 051' }).waitFor();
      expect(await normal.evaluate(() => Boolean(window.__cloudReplayProbe)), 'normal demo must not expose the hook').toBe(false);
      evidence['optInGate'] = 'go (absent on the normal development page)';
    } finally { await normal.close(); }
    const first = await run('mesh-reference', 'mesh');
    evidence['profile'] = first.profile;
    const adapter = first.profile.adapter;
    expect(first.profile.backend, 'WebGPU must not silently fall back').toBe('webgpu');
    expect(adapter, 'actual renderer device must expose adapter identity').not.toBeNull();
    expect([adapter!.vendor, adapter!.architecture, adapter!.device, adapter!.description].join(' ')).not.toMatch(/swiftshader|llvmpipe|software|microsoft basic render/i);
    expect(adapter!.isFallbackAdapter).not.toBe(true);
    expect([adapter!.vendor, adapter!.architecture, adapter!.device, adapter!.description].join(' ').trim()).not.toBe('');
    expect(first.profile.timestampSupported).toBe(true);
    expect(first.samples.filter((s) => s.gpuMs !== null).length).toBeGreaterThan(frames * .9);
    outcomes['hardware'] = 'go';
    const second = await run('mesh-repeat', 'mesh');
    const paused = await run('mesh-paused', 'mesh', { pauseEvery: Math.max(1, Math.floor(frames / 12)), pauseMs: 100 });
    const contended = await run('mesh-contended', 'mesh', {}, true);
    expect(normalizedStates(second)).toEqual(normalizedStates(first));
    expect(normalizedStates(paused)).toEqual(normalizedStates(first));
    expect(normalizedStates(contended)).toEqual(normalizedStates(first));
    const comparison = await browser.newPage();
    try {
      const comparisons = [];
      for (const candidate of [second, paused, contended]) for (let i = 0; i < first.captures.length; i++) {
        const diff = await comparePng(comparison, first.captures[i].png, candidate.captures[i].png);
        comparisons.push({ candidate: candidate === second ? 'repeat' : candidate === paused ? 'paused' : 'contended', frame: first.captures[i].frame, ...diff });
      }
      evidence['imageComparisons'] = comparisons;
      // Start with exact equality. Any relaxation requires measured evidence and a documented decision.
      expect(comparisons.every((diff) => diff.changedPixels === 0), JSON.stringify(comparisons)).toBe(true);
      // A non-blank image must also change as the camera moves.
      expect((await comparePng(comparison, first.captures[0].png, first.captures[3].png)).changedPixels).toBeGreaterThan(1000);
      const missing = await run('mesh-missing-cloud', 'mesh', { fault: 'missing-cloud' });
      const cloudDiffs = await Promise.all(first.captures.map((capture, i) => comparePng(comparison, capture.png, missing.captures[i].png)));
      evidence['missingCloudDiffs'] = cloudDiffs;
      expect(Math.max(...cloudDiffs.map((diff) => diff.changedPixels)), 'visual mutation must be detected').toBeGreaterThan(1000);
    } finally { await comparison.close(); }
    outcomes['replay'] = 'go (mesh; fixed state and exact checkpoint pixels under deliberate delays)';
    const load = evidence['competingGpuLoad'] as { batches: number; gpuWallMs: number; errors: string[]; adapter: { vendor: string; architecture: string } };
    expect(load.batches).toBeGreaterThan(10);
    expect(load.gpuWallMs).toBeGreaterThan(100);
    expect(load.errors).toEqual([]);
    expect(load.adapter.vendor).toBe(first.profile.adapter!.vendor);
    expect(load.adapter.architecture).toBe(first.profile.adapter!.architecture);
    outcomes['contention'] = 'go (bounded competing WebGPU compute session on same adapter; same replay state/pixels; gaming untested)';
    await expect(withProbe('missing-render', (page) => page.evaluate((options) => window.__cloudReplayProbe!.run(options), { frames: 12, captureFrames: [], fault: 'missing-render' as const }))).rejects.toThrow('MISSING_RENDER');
    await expect(withProbe('readiness-timeout', (page) => page.evaluate(() => window.__cloudReplayProbe!.prepare({ fault: 'readiness', readinessTimeoutMs: 200 })), 'mesh', false)).rejects.toThrow('READINESS_TIMEOUT');
    const recovered = await run('mesh-recovery', 'mesh');
    expect(normalizedStates(recovered)).toEqual(normalizedStates(first));
    outcomes['failureDetection'] = 'go (missing cloud, missing render, readiness timeout; fresh-page recovery)';
    // Second real lab draw mode: prove the hook preserves the screen-pass/proxy pipeline too.
    const proxy = await run('proxy-reference', 'proxy');
    const proxyPaused = await run('proxy-paused', 'proxy', { pauseEvery: Math.max(1, Math.floor(frames / 12)), pauseMs: 100 });
    expect(normalizedStates(proxyPaused)).toEqual(normalizedStates(proxy));
    const compareProxy = await browser.newPage();
    try {
      const diffs = await Promise.all(proxy.captures.map((capture, i) => comparePng(compareProxy, capture.png, proxyPaused.captures[i].png)));
      evidence['proxyComparisons'] = diffs;
      expect(diffs.every((diff) => diff.changedPixels === 0), JSON.stringify(diffs)).toBe(true);
    } finally { await compareProxy.close(); }
    outcomes['replay'] = 'go (mesh and proxy; complete fixed-step journey, exact checkpoint pixels under delays)';
    outcomes['unattended'] = 'go (headless, no manual focus/click/clipboard; contexts closed after success and injected failures)';
    expect(browser.contexts()).toHaveLength(0);
  } catch (error) {
    evidence['failure'] = String(error);
    throw error;
  } finally {
    await Promise.all(bundleReads);
    evidence['bundles'] = Object.fromEntries(bundles);
    fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(evidence, null, 2));
    const report = ['# Cloud replay U0 feasibility', '', ...Object.entries(outcomes).map(([key, value]) => `- ${key}: ${value}`), '', ...messages, '', 'GPU/CPU timings are diagnostic replay timings. Per-frame fences/readback alter pacing; external contention is uncontrolled. No idle-machine performance or real-time smoothness baseline established.', '', 'Source identity: source-manifest.json + working-tree.patch + probe-source/; actual served JavaScript retained under bundles/. Captures and raw frame records are alongside this report.', ...(evidence['failure'] ? ['', `Failure: ${String(evidence['failure'])}`] : [])].join('\n');
    fs.writeFileSync(path.join(runDir, 'report.md'), report);
    await testInfo.attach('cloud-feasibility-report', { body: report, contentType: 'text/markdown' });
  }
});
