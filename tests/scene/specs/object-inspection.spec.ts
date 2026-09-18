import { expect, test } from '@playwright/test';

type Bridge = {
  discover(): Promise<{ fixture: string; objects: Array<{ id: string }> }>;
  reset(): Promise<unknown>;
  focus(request: { target: string; azimuthDeg?: number }): Promise<{ frame: { frameId: number } }>;
  orbit(request: { target: string }): Promise<{ checkpoints: unknown[] }>;
  projectToScreen(target: string): Promise<{ page: { x: number; y: number }; inFrustum: boolean }>;
  capture(checkpoint?: string): Promise<{ checkpoint: string; image: string; width: number; height: number; frame: { frameId: number; renderedAt: number } }>;
  diagnostics(): Promise<{ errors: unknown[] }>;
  injectFailure(kind: 'runtime-error' | 'readiness-timeout' | 'duplicate-id' | 'visual-mutation' | 'stale-render' | 'subscriber-error'): Promise<unknown>;
  clearFailure(): Promise<unknown>;
  stability(target: string, frames?: number): Promise<{ frames: number; poses: Array<{ position: number[]; quaternion: number[] }> }>;
};

async function bridge(page: import('@playwright/test').Page): Promise<Bridge> {
  await page.evaluate(() => {
    if (!(window as Window & { __sceneTest?: Bridge }).__sceneTest) throw new Error('scene test adapter is not enabled');
  });
  return {
    discover: () => page.evaluate(() => (window as Window & { __sceneTest: Bridge }).__sceneTest.discover()),
    reset: () => page.evaluate(() => (window as Window & { __sceneTest: Bridge }).__sceneTest.reset()),
    focus: (request) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.focus(value), request),
    orbit: (request) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.orbit(value), request),
    projectToScreen: (target) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.projectToScreen(value), target),
    capture: (checkpoint) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.capture(value), checkpoint),
    diagnostics: () => page.evaluate(() => (window as Window & { __sceneTest: Bridge }).__sceneTest.diagnostics()),
    injectFailure: (kind) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.injectFailure(value), kind),
    clearFailure: () => page.evaluate(() => (window as Window & { __sceneTest: Bridge }).__sceneTest.clearFailure()),
    stability: (target, frames) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.stability(value.target, value.frames), { target, frames }),
  };
}

test('agent can discover, frame, orbit, click and capture the reference scene', async ({ page }, testInfo) => {
  const failures: Array<{ source: string; message: string }> = [];
  page.on('pageerror', (error) => failures.push({ source: 'pageerror', message: error.message }));
  page.on('console', (message) => { if (message.type() === 'error') failures.push({ source: 'console.error', message: message.text() }); });
  page.on('requestfailed', (request) => failures.push({ source: 'requestfailed', message: `${request.url()} ${request.failure()?.errorText ?? ''}` }));
  await page.addInitScript(() => window.addEventListener('scene-test-hit', (event) => {
    (window as Window & { __sceneHits?: string[] }).__sceneHits ??= [];
    (window as Window & { __sceneHits?: string[] }).__sceneHits!.push((event as CustomEvent).detail.target);
  }));
  await page.goto('/scene-inspection-lab?sceneTest=agent-reference-v1');
  await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));
  const scene = await bridge(page);
  const found = await scene.discover();
  expect(found.fixture).toBe('agent-reference-v1');
  expect(found.objects.map((object) => object.id)).toEqual(['large-sphere', 'small-box', 'transformed-box']);
  await scene.reset();
  await scene.focus({ target: 'small-box', azimuthDeg: 45 });
  const stability = await scene.stability('small-box', 30);
  expect(stability.frames).toBe(30);
  expect(new Set(stability.poses.map((pose) => JSON.stringify(pose))).size).toBe(1);
  const projection = await scene.projectToScreen('small-box');
  expect(projection.inFrustum).toBe(true);
  await page.mouse.click(projection.page.x, projection.page.y);
  await expect.poll(() => page.evaluate(() => (window as Window & { __sceneHits?: string[] }).__sceneHits ?? [])).toContain('small-box');
  const orbit = await scene.orbit({ target: 'small-box' });
  expect(orbit.checkpoints).toHaveLength(5);
  const capture = await scene.capture('m1-reference');
  expect(capture.width).toBeGreaterThan(0);
  expect(capture.height).toBeGreaterThan(0);
  expect(capture.image.startsWith('data:image/png;base64,')).toBe(true);
  await testInfo.attach('m1-reference.png', { body: Buffer.from(capture.image.split(',')[1], 'base64'), contentType: 'image/png' });
  await testInfo.attach('m1-run-manifest.json', { body: JSON.stringify({ schema: 'scene-test-run-v1', runId: testInfo.testId, fixture: found.fixture, command: 'npx playwright test -c playwright.config.ts', build: { sourceHash: 'unavailable', buildHash: 'unavailable' }, browser: { name: testInfo.project.name, backend: 'unavailable' }, viewport: { width: 960, height: 540, dpr: 1 }, frames: [capture.frame], captures: [{ checkpoint: 'm1-reference', width: capture.width, height: capture.height }], errors: failures, status: 'needs-review', baseline: 'not-created' }, null, 2), contentType: 'application/json' });
  expect((await scene.diagnostics()).errors).toEqual([]);
});

test('agent IDs survive reload and failures produce bounded diagnostics', async ({ page }) => {
  await page.goto('/scene-inspection-lab?sceneTest=agent-reference-v1');
  await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));
  let scene = await bridge(page);
  expect((await scene.discover()).objects.map((object) => object.id)).toContain('small-box');
  await expect(scene.focus({ target: 'missing-object' })).rejects.toThrow('TARGET_NOT_FOUND');
  await scene.injectFailure('duplicate-id');
  await expect(scene.focus({ target: 'small-box' })).rejects.toThrow('DUPLICATE_ID');
  await scene.clearFailure();
  await scene.injectFailure('readiness-timeout');
  await expect(scene.reset()).rejects.toThrow('TIMEOUT');
  await scene.clearFailure();
  await scene.injectFailure('visual-mutation');
  await expect(scene.focus({ target: 'small-box' })).rejects.toThrow('INVALID_BOUNDS');
  await scene.clearFailure();
  await scene.injectFailure('stale-render');
  await expect(scene.focus({ target: 'small-box' })).rejects.toThrow('TIMEOUT');
  await scene.clearFailure();
  await scene.injectFailure('subscriber-error');
  await expect(scene.focus({ target: 'small-box' })).rejects.toThrow('RUNTIME_ERROR');
  await scene.clearFailure();
  await page.reload();
  await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));
  scene = await bridge(page);
  expect((await scene.discover()).objects.map((object) => object.id)).toContain('small-box');
});

test.describe('portrait viewport', () => {
  test.use({ viewport: { width: 540, height: 960 } });
  test('focus, orbit and capture remain usable', async ({ page }) => {
    await page.goto('/scene-inspection-lab?sceneTest=agent-reference-v1');
    await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));
    const scene = await bridge(page);
    await scene.focus({ target: 'transformed-box', azimuthDeg: 45 });
    expect((await scene.projectToScreen('transformed-box')).inFrustum).toBe(true);
    expect((await scene.orbit({ target: 'transformed-box' })).checkpoints).toHaveLength(5);
    expect((await scene.capture('portrait')).image.startsWith('data:image/png;base64,')).toBe(true);
  });
});

test('same-build captures are repeatable and adapter is opt-in', async ({ page }) => {
  await page.goto('/scene-inspection-lab');
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest))).toBe(false);
  await page.goto('/scene-inspection-lab?sceneTest=agent-reference-v1');
  await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));
  const scene = await bridge(page);
  await scene.focus({ target: 'large-sphere', azimuthDeg: 45 });
  const first = await scene.capture('repeat-1');
  const second = await scene.capture('repeat-2');
  expect(second.image).toBe(first.image);
});

test('fresh browser contexts produce the same capture', async ({ browser }) => {
  const captures: string[] = [];
  for (let index = 0; index < 2; index++) {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto('/scene-inspection-lab?sceneTest=agent-reference-v1');
    await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));
    const scene = await bridge(page);
    await scene.focus({ target: 'small-box', azimuthDeg: 45 });
    captures.push((await scene.capture(`fresh-${index}`)).image);
    await context.close();
  }
  expect(captures[1]).toBe(captures[0]);
});
