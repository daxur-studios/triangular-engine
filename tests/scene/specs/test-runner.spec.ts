import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const smoke = '/cloud-volumes-lab?backend=webgl2&testSuite=cloud-runner-smoke&testVersion=1&testProfile=headless-hardware&testAutoStart=1';

test('URL autostart runs static and moving cloud cases, restores settings and retains JSON', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(smoke);
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  await expect(output).toBeVisible({ timeout: 60_000 });
  const result = JSON.parse(await output.inputValue());
  expect(result.suite.id).toBe('cloud-runner-smoke');
  expect(result.status).toBe('completed');
  expect(result.automatedVerdict).toBe('pass');
  expect(result.performanceVerdict).toBe('not-run');
  expect(result.cases.map((item: { scenario: { id: string } }) => item.scenario.id)).toEqual(['static', 'flyby']);
  expect(new URL(result.rerunUrl).searchParams.get('testVersion')).toBe('1');
  const slider = page.getByRole('slider', { name: 'March steps', includeHidden: true });
  await expect(slider).toHaveAttribute('aria-valuenow', '64');
  await expect(page.getByRole('button', { name: 'Run latest test', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
  fs.mkdirSync('artifacts/test-runner', { recursive: true });
  fs.writeFileSync('artifacts/test-runner/cloud-smoke.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: 'artifacts/test-runner/cloud-runner.png', fullPage: true });

  // Exact-version rerun uses the same contract as the initial URL launch.
  await page.getByRole('button', { name: 'Run selected', exact: true }).click();
  await expect(output).not.toBeVisible();
  await expect(output).toBeVisible({ timeout: 60_000 });
  const rerun = JSON.parse(await output.inputValue());
  expect(rerun.suite).toEqual(result.suite);
  expect(rerun.runId).not.toBe(result.runId);
});

test('Run latest chooses the final history entry and cancellation restores the page', async ({ page }) => {
  await page.goto(smoke.replace('testAutoStart=1', 'testAutoStart=0'));
  const latest = page.getByRole('button', { name: 'Run latest test', exact: true });
  await expect(latest).toBeEnabled({ timeout: 60_000 });
  await latest.click();
  await expect(page.getByLabel('Effective test settings')).toContainText('"volumes": 12');
  await expect(page.getByRole('slider', { name: 'March steps', includeHidden: true })).toHaveAttribute('aria-valuenow', '24');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  await expect(output).toBeVisible({ timeout: 30_000 });
  const result = JSON.parse(await output.inputValue());
  expect(result.suite.id).toBe('cloud-haze-cost');
  expect(result.status).toBe('cancelled');
  expect(result.visualReview).toBe('pending');
  await expect(page.getByRole('slider', { name: 'March steps', includeHidden: true })).toHaveAttribute('aria-valuenow', '64');
  await expect(latest).toBeEnabled();
});

test('stale URL versions fail visibly without starting another suite', async ({ page }) => {
  await page.goto(smoke.replace('testVersion=1', 'testVersion=999'));
  await expect(page.getByText('Unknown test suite/version', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Test result JSON' })).not.toBeVisible();
});

test('the packaged shared UI slider updates the reactive form through real keyboard input', async ({ page }) => {
  await page.goto(smoke.replace('testAutoStart=1', 'testAutoStart=0'));
  await expect(page.getByRole('button', { name: 'Run latest test', exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByText('4 · Quality and bake budget', { exact: true }).click();
  const slider = page.getByRole('slider', { name: 'March steps' });
  await slider.focus();
  await slider.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '56');
  await expect(page.getByTestId('march-steps-state')).toHaveText('March steps 56');
});
