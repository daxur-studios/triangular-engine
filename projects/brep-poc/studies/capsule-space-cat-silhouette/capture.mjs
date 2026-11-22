import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const folder = join('artifacts', 'brep-space-cat-silhouette');
const output = folder;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(pathToFileURL(join(folder, 'preview.html')).href);
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.startsWith('Loaded'), null, { timeout: 60000 });
  await page.waitForTimeout(600);

  const views = [
    { name: 'Side', angle: '0', slug: 'side' },
    { name: 'Three-quarter', angle: '35', slug: 'three-quarter' },
    { name: 'Front', angle: '90', slug: 'front' },
    { name: 'Back', angle: '-90', slug: 'back' },
  ];
  const captures = [];
  for (const view of views) {
    await page.getByRole('button', { name: view.name, exact: true }).click();
    await page.waitForTimeout(200);
    const file = join(output, `compare-${view.slug}.png`);
    await page.locator('.stages.assembled').screenshot({ path: file });
    captures.push(file);
    await page.locator('.stages.silhouettes').screenshot({ path: join(output, `silhouettes-${view.slug}.png`) });
  }
  await page.getByRole('button', { name: 'Side', exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(output, 'preview-page.png'), fullPage: true });

  const images = await Promise.all(captures.map(file => sharp(file).toBuffer()));
  const meta = await Promise.all(images.map(image => sharp(image).metadata()));
  const width = Math.max(...meta.map(entry => entry.width));
  const height = Math.max(...meta.map(entry => entry.height));
  await sharp({
    create: { width, height: height * images.length + 12 * (images.length - 1), channels: 3, background: '#171a20' },
  }).composite(images.map((input, index) => ({
    input, left: 0, top: index * (height + 12),
  }))).png().toFile(join(output, 'compare-views.png'));

  assert.deepEqual(errors, []);
  assert.match(await page.locator('[role=status]').textContent(), /\d[\d,]+ triangles/);
  console.log(`Captured side, three-quarter and front comparisons in ${output}`);
} finally {
  await browser.close();
}
