import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createPacedMouse } from './paced-mouse.mjs';

test('recording pointer crosses rendered intermediate positions before clicking', { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent('<button style="position:absolute;left:600px;top:400px;width:120px;height:50px">Collect</button>');
    await page.evaluate(() => {
      window.pointer = { x: 20, y: 20 };
      window.rendered = [];
      document.addEventListener('pointermove', e => { window.pointer = { x: e.clientX, y: e.clientY }; });
      document.querySelector('button').addEventListener('click', e => { window.clicked = { x: e.clientX, y: e.clientY }; });
      const sample = () => { window.rendered.push({ ...window.pointer, at: performance.now() }); requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    });
    const samples = [];
    const mouse = await createPacedMouse(page, { x: 20, y: 20, onSample: sample => samples.push(sample) });
    await mouse.click(page.getByRole('button'));
    const { clicked, rendered } = await page.evaluate(() => ({ clicked: window.clicked, rendered: window.rendered }));
    assert.deepEqual(clicked, { x: 660, y: 425 });
    assert.ok(samples.at(-1).at - samples[0].at >= 0.5, 'movement must span wall time');
    assert.ok(new Set(rendered.filter(p => p.x > 20 && p.x < 650).map(p => Math.round(p.x))).size >= 5,
      'browser paints intermediate pointer positions, not only input events');
    const before = samples.length;
    await mouse.click(page.getByRole('button'));
    assert.equal(samples.length, before, 'same-target repeat click does not reset or drift the pointer');
    await page.getByRole('button').evaluate(el => { el.disabled = true; });
    await assert.rejects(mouse.click(page.getByRole('button')), /disabled/);
    await page.getByRole('button').evaluate(el => { el.disabled = false; });
    await page.evaluate(() => {
      const blocker = document.createElement('div');
      blocker.style.cssText = 'position:fixed;inset:0;z-index:999';
      document.body.append(blocker);
    });
    await assert.rejects(mouse.click(page.getByRole('button')), /covered/);
  } finally { await browser.close(); }
});
