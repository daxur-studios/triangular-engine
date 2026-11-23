import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const out = resolve('artifacts/brep-space-cat-silhouette');
const joined = process.argv.includes('--joined');
const concept = process.argv.includes('--concept');
const variant = concept ? 'concept-fit' : joined ? 'joined-cat' : 'rear-hip';
const url = pathToFileURL(resolve(out, `${variant}.html`));
url.searchParams.set('paused', '');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 630 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url.href);
  await page.waitForFunction(() => document.documentElement.dataset.ready || document.documentElement.dataset.error);
  assert.equal(await page.locator('html').getAttribute('data-error'), null);
  assert.equal(await page.locator('#tag-baked').textContent(),
    concept ? 'Compact concept fit' : joined ? 'Joined legs and tail' : 'Fused rear hip');
  assert.equal(await page.locator('#tag-hose').textContent(),
    concept ? 'Previous proportions' : joined ? 'Earlier hip study' : 'Separate baked leg');

  await page.evaluate(() => {
    window.__walk.setGait('idle');
    window.__walk.step(0);
  });
  const stills = [await page.screenshot()];
  await page.evaluate(() => window.__walk.setGait('goofy_walk'));
  // Goofy walk is 4.2 radians per second. The snapshot series starts after
  // the 0.3 s actor warm-up, so steps 2 and 6 are near the hind paw's extremes.
  const cycle = 2 * Math.PI / 4.2;
  for (let phase = 0; phase < 8; phase += 1) {
    await page.evaluate(delta => {
      for (let tick = 0; tick < 5; tick += 1) window.__walk.step(delta / 5);
    }, cycle / 8);
    stills.push(await page.screenshot());
  }
  assert.equal(new Set(stills.map(still => still.toString('base64'))).size, stills.length);
  assert.deepEqual(errors, []);
  if (concept) {
    await sharp(stills[2]).trim({ background: '#ede1d6', threshold: 2 }).extend({
      top: 28, bottom: 32, left: 24, right: 24, background: '#ede1d6',
    }).png().toFile(resolve(out, 'concept-fit-stride.png'));
  }
  const selected = [stills[0], stills[2], stills[6]];
  const images = await Promise.all(selected.map(still => sharp(still).resize({ width: 900 }).png().toBuffer()));
  const [first] = images;
  const { width, height } = await sharp(first).metadata();
  const gap = 4;
  const file = resolve(out, `${variant}-compare.png`);
  await sharp({
    create: { width, height: images.length * (height + gap) - gap, channels: 3, background: '#fff9f2' },
  }).composite(images.map((input, index) => ({ input, left: 0, top: index * (height + gap) }))).png().toFile(file);
  console.log('Captured idle and a full goofy walk cycle:', file);
} finally {
  await browser.close();
}
