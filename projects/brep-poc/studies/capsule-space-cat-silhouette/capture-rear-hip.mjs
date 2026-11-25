import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const out = resolve('artifacts/brep-space-cat-silhouette');
const joined = process.argv.includes('--joined');
const concept = process.argv.includes('--concept');
const fusedLegs = process.argv.includes('--fused-legs');
const fusedTail = process.argv.includes('--fused-tail');
const fusedEars = process.argv.includes('--fused-ears');
const variant = fusedEars ? 'fused-ears' : fusedTail ? 'fused-tail' : fusedLegs ? 'fused-legs' : concept ? 'concept-fit' : joined ? 'joined-cat' : 'rear-hip';
const url = pathToFileURL(resolve(out, `${variant}.html`));
url.searchParams.set('paused', '');
if (fusedEars) url.searchParams.set('controls', '');
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
    fusedEars ? 'Fused ears' : fusedTail ? 'Fused tail' : fusedLegs ? 'All four legs fused' : concept ? 'Compact concept fit' : joined ? 'Joined legs and tail' : 'Fused rear hip');
  assert.equal(await page.locator('#tag-hose').textContent(),
    fusedEars ? 'Separate ears' : fusedTail ? 'Separate tail' : fusedLegs ? 'First fused rear hip' : concept ? 'Previous proportions' : joined ? 'Earlier hip study' : 'Separate baked leg');

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
  if (concept || fusedLegs || fusedTail) {
    await sharp(stills[2]).trim({ background: '#ede1d6', threshold: 2 }).extend({
      top: 28, bottom: 32, left: 24, right: 24, background: '#ede1d6',
    }).png().toFile(resolve(out, `${variant}-stride.png`));
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
  if (fusedTail) {
    url.searchParams.set('controls', '');
    await page.goto(url.href);
    await page.waitForFunction(() => document.documentElement.dataset.ready || document.documentElement.dataset.error);
    assert.equal(await page.locator('html').getAttribute('data-error'), null);
    const bones = page.getByRole('button', { name: 'Bones' });
    const play = page.getByRole('button', { name: 'Play', exact: true });
    const step = page.getByRole('button', { name: 'Step frame' });
    const crop = { x: 0, y: 0, width: 1280, height: 550 };
    await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('-42');
    const hidden = await page.screenshot({ clip: crop });
    await bones.click();
    assert.equal(await bones.getAttribute('aria-pressed'), 'true');
    const visible = await page.screenshot({ clip: crop });
    assert.notDeepEqual(visible, hidden);
    await step.click();
    assert.notDeepEqual(await page.screenshot({ clip: crop }), visible);
    await page.screenshot({ path: resolve(out, 'fused-tail-bones.png') });
    await page.getByRole('combobox', { name: 'Speed' }).selectOption('.25');
    await page.getByRole('combobox', { name: 'Animation' }).selectOption('bound_run');
    await page.evaluate(() => {
      for (let tick = 0; tick < 120; tick += 1) window.__walk.step(1 / 60);
    });
    await bones.click();
    assert.equal(await bones.getAttribute('aria-pressed'), 'false');
    await page.screenshot({ path: resolve(out, 'fused-tail-bound.png') });
    await play.click();
    await page.getByRole('button', { name: 'Pause' }).click();
    assert.equal(await step.isEnabled(), true);
    assert.deepEqual(errors, []);
  }
  if (fusedEars) {
    await page.getByRole('combobox', { name: 'Animation' }).selectOption('idle');
    await page.evaluate(() => window.__walk.setView(58));
    const expression = page.getByRole('combobox', { name: 'Expression' });
    const bones = page.getByRole('button', { name: 'Bones' });
    const helmet = page.getByRole('button', { name: 'Helmet' });
    const heads = { x: 90, y: 118, width: 1050, height: 290 };
    const neutral = await page.screenshot({ clip: heads });
    await sharp(neutral).toFile(resolve(out, 'fused-ears-neutral.png'));
    await expression.selectOption('surprised');
    const alert = await page.screenshot({ clip: heads });
    assert.notDeepEqual(alert, neutral);
    await expression.selectOption('fearful');
    const pinned = await page.screenshot({ clip: heads });
    assert.notDeepEqual(pinned, alert);
    await expression.selectOption('skeptical');
    const asymmetric = await page.screenshot({ clip: heads });
    assert.notDeepEqual(asymmetric, pinned);
    await bones.click();
    assert.equal(await bones.getAttribute('aria-pressed'), 'true');
    const rig = await page.screenshot({ clip: heads });
    assert.notDeepEqual(rig, asymmetric);
    await sharp(rig).toFile(resolve(out, 'fused-ears-bones.png'));
    await bones.click();
    await expression.selectOption('surprised');
    const bare = await page.screenshot({ clip: heads });
    await helmet.click();
    assert.equal(await helmet.getAttribute('aria-pressed'), 'true');
    const suited = await page.screenshot({ clip: heads });
    assert.notDeepEqual(suited, bare);
    await sharp(suited).toFile(resolve(out, 'fused-ears-helmet.png'));
    await helmet.click();
    assert.equal(await helmet.getAttribute('aria-pressed'), 'false');
    const hidden = await page.screenshot({ clip: heads });
    const barePixels = await sharp(bare).removeAlpha().raw().toBuffer();
    const hiddenPixels = await sharp(hidden).removeAlpha().raw().toBuffer();
    const changedBytes = barePixels.reduce((count, channel, i) => count + Number(Math.abs(channel - hiddenPixels[i]) > 2), 0);
    assert.ok(changedBytes < barePixels.length * .001, `${changedBytes} color channels changed when restoring the bare pose`);
    assert.deepEqual(errors, []);
  }
} finally {
  await browser.close();
}
