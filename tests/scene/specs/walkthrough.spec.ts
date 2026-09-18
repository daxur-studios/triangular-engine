import { expect, test } from '@playwright/test';

type Bridge = {
  focus(request: { target: string; azimuthDeg?: number }): Promise<unknown>;
  capture(checkpoint?: string): Promise<{ image: string }>;
  diagnostics(): Promise<{ errors: unknown[] }>;
};

async function bridge(page: import('@playwright/test').Page): Promise<Bridge> {
  await page.evaluate(() => {
    if (!(window as Window & { __sceneTest?: Bridge }).__sceneTest) throw new Error('scene test adapter is not enabled');
  });
  return {
    focus: (request) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.focus(value), request),
    capture: (checkpoint) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.capture(value), checkpoint),
    diagnostics: () => page.evaluate(() => (window as Window & { __sceneTest: Bridge }).__sceneTest.diagnostics()),
  };
}

test.use({
  video: 'on',
  // Give the recording enough room to show the scene and make camera motion
  // legible when opened remotely from the Playwright report.
  viewport: { width: 1280, height: 720 },
});

test('records a camera walkthrough of the real canvas', async ({ page }) => {
  // The video starts when Playwright creates the page, before Angular has
  // bootstrapped. Paint the document background immediately so that startup
  // frames are part of the scene's visual language instead of a white flash.
  await page.evaluate(() => {
    document.documentElement.style.background = '#091116';
    document.body.style.background = '#091116';
  });
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'html, body { background: #091116 !important; }';
    document.documentElement.appendChild(style);
  });
  await page.goto('/scene-inspection-lab?sceneTest=agent-reference-v1');
  await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));

  // The inspection panel is useful for agent assertions, but it obscures the
  // scene in a visual walkthrough. Keep the real engine/canvas and remove only
  // the diagnostic UI from this recording.
  await page.addStyleTag({
    content: `
      .panel { display: none !important; }
      html, body, app-root, app-scene-inspection-lab-page, scene,
      scene > .flex-page, scene .canvas-size-observer,
      engine-ui, engine-ui .ui-layer-1, engine-ui .main-wrapper,
      engine-ui .ui-main { width: 100% !important; height: 100% !important; min-height: 100% !important; }
      scene .canvas-size-observer { flex: 1 1 auto !important; }
      scene canvas { width: 100% !important; height: 100% !important; }
    `,
  });
  await page.waitForTimeout(1200);

  const scene = await bridge(page);
  await scene.focus({ target: 'large-sphere', azimuthDeg: 45 });
  await page.waitForTimeout(1200);

  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  const centerX = canvasBox.x + canvasBox.width / 2;
  const centerY = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 180, centerY + 15, { steps: 45 });
  await page.waitForTimeout(900);
  await page.mouse.move(centerX - 120, centerY - 30, { steps: 45 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await page.mouse.wheel(0, -450);
  await page.waitForTimeout(1500);

  const capture = await scene.capture('walkthrough-final');
  expect(capture.image.startsWith('data:image/png;base64,')).toBe(true);
  expect((await scene.diagnostics()).errors).toEqual([]);
});
