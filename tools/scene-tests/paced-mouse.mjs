/** Demo-local real input pacing. Step counts alone do not guarantee visible motion. */
export async function createPacedMouse(page, { x = 80, y = 80, onSample = () => {} } = {}) {
  let position = { x, y };
  async function set(point) {
    await page.mouse.move(point.x, point.y);
    position = point;
    onSample({ ...point, at: Date.now() / 1000 });
  }
  await set(position); // Match actual Playwright input to the displayed pointer before capture.
  async function moveTo(x, y) {
    const from = position, distance = Math.hypot(x - from.x, y - from.y);
    if (distance < 0.5) return;
    const duration = Math.min(1100, Math.max(500, distance * 0.8));
    const start = performance.now();
    let fraction = 0;
    do {
      fraction = Math.min(1, (performance.now() - start) / duration);
      const eased = fraction < 0.5 ? 4 * fraction ** 3 : 1 - (-2 * fraction + 2) ** 3 / 2;
      await set({ x: from.x + (x - from.x) * eased, y: from.y + (y - from.y) * eased });
      if (fraction < 1) await page.waitForTimeout(16); // Presentation pacing, not an application readiness gate.
    } while (fraction < 1);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  async function click(locator) {
    await locator.waitFor({ state: 'visible' });
    await locator.scrollIntoViewIfNeeded();
    if (!(await locator.isEnabled())) throw new Error('Recording control is disabled');
    for (let attempt = 0; attempt < 3; attempt++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Recording control has no bounds');
      await moveTo(box.x + box.width / 2, box.y + box.height / 2);
      const current = await locator.boundingBox();
      if (!current || Math.hypot(current.x + current.width / 2 - position.x, current.y + current.height / 2 - position.y) > 0.5) continue;
      const hit = await locator.evaluate((element, point) => {
        const target = element.ownerDocument.elementFromPoint(point.x, point.y);
        return target === element || element.contains(target);
      }, position);
      if (!hit) throw new Error('Recording control is covered at the pointer position');
      // Click at the displayed position; locator.click could silently reposition
      // the real mouse after layout changes and bypass the visible glide.
      await page.mouse.down();
      await page.waitForTimeout(90);
      await page.mouse.up();
      await page.waitForTimeout(120);
      return;
    }
    throw new Error('Recording control kept moving during approach');
  }
  return { moveTo, click };
}
