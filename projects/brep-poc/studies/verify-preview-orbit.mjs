import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const studies = [
  ['brep-swept-hair', /^Both hairstyles/, 'Front'],
  ['brep-space-buns', /^Both GLB presets/, 'Front'],
  ['brep-bob', /^Valid solid/, 'Side'],
  ['brep-space-cat-silhouette', /^Loaded 2 baked/, 'Side'],
];

async function orbit(page, canvas, drag) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  if (drag) {
    await page.mouse.down();
    await page.mouse.move(x, y + 54, { steps: 5 });
    await page.mouse.up();
  } else {
    await page.mouse.wheel(0, -250);
  }
  await page.locator('[data-angle][aria-pressed="true"]').waitFor({ state: 'detached' });
}

async function pinch(page, canvas) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);
  const points = radius => [{ x: x - radius, y }, { x: x + radius, y }];
  try {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(25) });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(59) });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('[data-angle][aria-pressed="true"]').waitFor({ state: 'detached' });
  } finally {
    await client.detach();
  }
}

async function checkFrame(page, canvas, reference, changed, message) {
  const actual = await canvas.screenshot();
  // Allow for minor rasterization differences when restoring the same camera.
  const distance = await page.evaluate(async ([before, after]) => {
    const sample = new OffscreenCanvas(96, 96);
    const context = sample.getContext('2d');
    const read = async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      context.drawImage(bitmap, 0, 0, 96, 96);
      bitmap.close();
      return context.getImageData(0, 0, 96, 96).data;
    };
    const a = await read(before);
    const b = await read(after);
    return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
  }, [reference.toString('base64'), actual.toString('base64')]);
  assert.ok(changed ? distance > 1 : distance < .5, `${message} (mean pixel difference ${distance.toFixed(2)})`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [folder, ready, initialView] of studies) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(resolve('artifacts', folder, 'preview.html')).href);
      await page.getByRole('status').filter({ hasText: ready }).waitFor();
      const canvases = page.locator('canvas');
      const first = canvases.first();
      const last = canvases.last();
      const preset = page.getByRole('button', { name: initialView, exact: true });
      await preset.click();
      const firstFixed = await first.screenshot();
      const lastFixed = await last.screenshot();

      await orbit(page, first, true);
      await checkFrame(page, first, firstFixed, true, `${folder} did not orbit vertically`);
      await checkFrame(page, last, lastFixed, true, `${folder} did not synchronize orbit`);

      await preset.click();
      await checkFrame(page, first, firstFixed, false, `${folder} did not restore the fixed angle`);
      await checkFrame(page, last, lastFixed, false, `${folder} did not restore the comparison angle`);

      await orbit(page, last, false);
      await checkFrame(page, first, firstFixed, true, `${folder} did not synchronize zoom`);
      await checkFrame(page, last, lastFixed, true, `${folder} did not zoom`);
      await preset.click();
      await checkFrame(page, first, firstFixed, false, `${folder} did not reset zoom`);
      if (folder === 'brep-swept-hair') {
        await pinch(page, first);
        await checkFrame(page, first, firstFixed, true, 'Pinch did not zoom');
        await checkFrame(page, last, lastFixed, true, 'Pinch did not synchronize zoom');
        console.log(`${folder}: two-finger pinch passed`);
      }
      assert.deepEqual(errors, []);
      console.log(`${folder}: pitch, synchronized orbit and zoom, and preset reset passed`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
