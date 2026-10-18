import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const base = '/cell-planet-morph-streaming';
const smoke = `${base}?testSuite=morph-streaming-smoke&testVersion=1&testProfile=headless-hardware&testAutoStart=1`;
const diagnostic = `${base}?testSuite=morph-streaming-morph-cost&testVersion=1&testProfile=headless-hardware&testAutoStart=1`;

test('morph smoke suite autostarts, passes its functional checks and restores the page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(smoke);
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  await expect(output).toBeVisible({ timeout: 240_000 });
  const result = JSON.parse(await output.inputValue());
  expect(result.suite.id).toBe('morph-streaming-smoke');
  expect(result.status).toBe('completed');
  expect(result.automatedVerdict).toBe('pass');
  expect(result.performanceVerdict).toBe('not-run');
  expect(result.visualReview).toBe('not-required');
  expect(result.cases.map((item: { status: string }) => item.status)).toEqual(['completed', 'completed', 'completed']);
  expect(new URL(result.rerunUrl).searchParams.get('testVersion')).toBe('1');
  expect(errors).toEqual([]);
  fs.mkdirSync('artifacts/test-runner', { recursive: true });
  fs.writeFileSync('artifacts/test-runner/morph-smoke.json', JSON.stringify(result, null, 2));
  // Restoration: the manual Globe state is back, and the controls are unlocked.
  await expect(page.getByRole('button', { name: 'Run latest test', exact: true })).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('fieldset.test-lock')).toBeEnabled();
});

test('morph diagnostic suite records static 0 / 0.5 / 1 and a smooth sweep, and marks appearance for review', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(diagnostic);
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  await expect(output).toBeVisible({ timeout: 800_000 });
  const result = JSON.parse(await output.inputValue());
  fs.mkdirSync('artifacts/test-runner', { recursive: true });
  fs.writeFileSync('artifacts/test-runner/morph-diagnostic.json', JSON.stringify(result, null, 2));
  expect(result.suite.id).toBe('morph-streaming-morph-cost');
  expect(result.status).toBe('inconclusive');
  expect(result.visualReview).toBe('pending');
  expect(result.performanceVerdict).toBe('inconclusive');
  expect(result.cases.map((item: { scenario: { id: string } }) => item.scenario.id))
    .toEqual(['morph-0', 'morph-0_5', 'morph-1', 'sweep-0-1-0']);
  expect(errors).toEqual([]);
});
