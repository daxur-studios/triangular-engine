import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const base = '/planet-material-extensions?backend=webgl2';
const features = `${base}&testSuite=planet-material-extensions-features&testVersion=1&testProfile=headless-hardware&testRepetitions=1&testAutoStart=1`;
const cost = `${base}&testSuite=planet-material-extensions-cost&testVersion=1&testProfile=headless-hardware&testRepetitions=1&testAutoStart=1`;

/** The planet, clear of the side panel and its shadow (left) and the FPS overlay (top right): the panel's own text changes during a run. */
const sceneClip = { x: 600, y: 120, width: 480, height: 700 };

/** Counts page loads: a dev-server rebuild from a concurrent edit reloads the page and ends the run in progress. */
function watchReloads(page: Page): () => number {
  let loads = 0;
  page.on('load', () => { loads++; });
  return () => loads - 1;
}

/** The result box, or a failure that names a reload as the cause when the page was reloaded mid-run. */
async function resultBox(page: Page, reloads: () => number, timeout: number) {
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  try {
    await expect(output).toBeVisible({ timeout });
  } catch (error) {
    if (reloads() > 0) throw new Error(`The page reloaded ${reloads()} time(s) during the run (a dev-server rebuild from a concurrent edit): rerun. ${String(error)}`);
    throw error;
  }
  return output;
}

/** The retained evidence: the full result JSON is written even when a check failed, then asserted on. */
async function runSuite(page: Page, url: string, artifact: string): Promise<any> {
  const errors: string[] = [];
  const reloads = watchReloads(page);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  const output = await resultBox(page, reloads, 170_000);
  const result = JSON.parse(await output.inputValue());
  fs.mkdirSync('artifacts/test-runner', { recursive: true });
  fs.writeFileSync(`artifacts/test-runner/${artifact}.json`, JSON.stringify(result, null, 2));
  expect(errors).toEqual([]);
  return result;
}

/** Restoration: the page's own defaults are back and the controls are unlocked. */
async function expectRestored(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Run latest test', exact: true })).toBeEnabled({ timeout: 30_000 });
  // A fieldset is not itself a form control to Playwright, so check a control inside it.
  await expect(page.getByLabel('road layer')).toBeEnabled();
  await expect(page.locator('fieldset.test-lock')).not.toHaveAttribute('disabled', /.*/);
  for (const label of ['road layer', 'moon eclipse', 'city lights']) await expect(page.getByLabel(label)).toBeChecked();
  const sliders = page.locator('input[type=range]');
  await expect(sliders.nth(0)).toHaveValue('0');
  await expect(sliders.nth(1)).toHaveValue('0');
}

test('features suite autostarts, passes its functional checks, restores the page and marks appearance for review', async ({ page }) => {
  test.setTimeout(240_000);
  const result = await runSuite(page, features, 'planet-material-extensions-features');
  expect(result.suite.id).toBe('planet-material-extensions-features');
  expect(result.suite.version).toBe(1);
  const failed = result.cases.flatMap((item: any) => item.checks.filter((check: any) => !check.passed).map((check: any) => `${item.scenario.id}: ${check.name} (${check.detail})`));
  expect(failed).toEqual([]);
  expect(result.status).toBe('completed');
  expect(result.automatedVerdict).toBe('pass');
  expect(result.visualReview).toBe('pending');
  expect(result.cases.map((item: any) => item.scenario.id)).toEqual([
    'baseline-day', 'plain', 'road-only', 'eclipse-total', 'eclipse-offset', 'night-lights', 'orbit-all']);
  expect(new URL(result.rerunUrl).searchParams.get('testVersion')).toBe('1');
  await expectRestored(page);
});

test('cost suite records frame intervals for the slot matrix and camera orbit, labelled as software-rendered diagnostics', async ({ page }) => {
  test.setTimeout(240_000);
  const result = await runSuite(page, cost, 'planet-material-extensions-cost');
  expect(result.suite.id).toBe('planet-material-extensions-cost');
  expect(result.cases.map((item: any) => item.scenario.id)).toEqual([
    'baseline-day', 'baseline-night', 'no-road', 'no-eclipse', 'no-lights', 'plain', 'orbit-all', 'orbit-plain']);
  expect(result.visualReview).toBe('pending');
  expect(result.performanceVerdict).not.toBe('unassessed');
  expect(result.environment.softwareRenderer).toBe(true);
  await expectRestored(page);
});

test('Run latest, cancelled mid-orbit, keeps the cancelled result and restores settings, camera and controls', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const reloads = watchReloads(page);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator('summary', { hasText: 'Tests' }).click();
  await expect(page.getByRole('button', { name: 'Run latest test', exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.waitForTimeout(2_000);
  const before = await page.screenshot({ clip: sceneClip });
  await page.getByRole('button', { name: 'Run latest test', exact: true }).click();
  // Cancel during the first camera orbit, after the static cases have changed toggles and the sun. The page itself
  // clicks Cancel the moment the orbit scenario's settings appear: polling from here misses a window that is a few
  // slow software-rendered frames long.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const settings = document.querySelector('pre.effective-settings')?.textContent ?? '';
      if (!settings.includes('"kind": "orbit"')) return;
      observer.disconnect();
      (window as unknown as { cancelledWhileLocked: boolean }).cancelledWhileLocked =
        ([...document.querySelectorAll('label')].find((label) => label.textContent?.includes('road layer'))?.querySelector('input') as HTMLInputElement).matches(':disabled');
      [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Cancel')?.click();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const output = await resultBox(page, reloads, 60_000);
  const result = JSON.parse(await output.inputValue());
  fs.mkdirSync('artifacts/test-runner', { recursive: true });
  fs.writeFileSync('artifacts/test-runner/planet-material-extensions-cost-cancelled.json', JSON.stringify(result, null, 2));
  expect(await page.evaluate(() => (window as unknown as { cancelledWhileLocked?: boolean }).cancelledWhileLocked)).toBe(true);
  expect(result.suite.id).toBe('planet-material-extensions-cost');
  expect(result.status).toBe('cancelled');
  expect(result.cases.at(-1).status).toBe('cancelled');
  expect(errors).toEqual([]);
  await expectRestored(page);
  await page.waitForTimeout(2_000);
  // Same camera, toggles and sun: the software-rendered frame is pixel-identical to the one before the run.
  const after = await page.screenshot({ clip: sceneClip });
  fs.writeFileSync('artifacts/test-runner/planet-material-extensions-before-run.png', before);
  fs.writeFileSync('artifacts/test-runner/planet-material-extensions-after-cancel.png', after);
  expect(after.equals(before)).toBe(true);
});
