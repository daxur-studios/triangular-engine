import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('cancel restores the camera, controls and selected terrain', async ({ page }) => {
  await page.goto('/illustrative-cell-planet');
  const run = page.getByRole('button', { name: 'Run latest test', exact: true });
  await expect(run).toBeEnabled({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  const clip = { x: 500, y: 150, width: 500, height: 500 };
  const before = await page.screenshot({ clip });
  await run.click();
  await expect(page.getByLabel('Terrain', { exact: true })).toBeDisabled();
  await expect(page.locator('pre.effective-settings')).toContainText('flyover');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  await expect(output).toBeVisible({ timeout: 30_000 });
  const result = JSON.parse(await output.inputValue());
  fs.mkdirSync('artifacts/illustrative-terrain', { recursive: true });
  fs.writeFileSync('artifacts/illustrative-terrain/cancelled.json', JSON.stringify(result, null, 2));
  expect(result.status).toBe('cancelled');
  await expect(run).toBeEnabled();
  await expect(page.getByLabel('Terrain', { exact: true })).toHaveValue('illustrative');
  expect(await page.screenshot({ clip })).toEqual(before);
});

test('illustrative landform comparison runs and restores the page', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /shader|WebGLProgram/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto(
    '/illustrative-cell-planet?testSuite=illustrative-terrain-look&testVersion=1&testProfile=headless-hardware&testRepetitions=1&testAutoStart=1',
  );
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  await expect(output).toBeVisible({ timeout: 140_000 });
  const result = JSON.parse(await output.inputValue());
  fs.mkdirSync('artifacts/illustrative-terrain', { recursive: true });
  fs.writeFileSync(
    'artifacts/illustrative-terrain/look.json',
    JSON.stringify(result, null, 2),
  );
  await page.screenshot({
    path: 'artifacts/illustrative-terrain/volcano-illustrative.png',
  });
  expect(errors).toEqual([]);
  expect(result.status).toBe('completed');
  expect(result.automatedVerdict).toBe('pass');
  expect(result.visualReview).toBe('pending');
  expect(result.cases).toHaveLength(8);
  await expect(page.getByLabel('Terrain', { exact: true })).toHaveValue(
    'illustrative',
  );
  await expect(page.getByLabel('View', { exact: true })).toHaveValue('volcano');
  await expect(page.getByLabel('Terrain', { exact: true })).toBeEnabled();
  await page
    .getByLabel('Terrain', { exact: true })
    .selectOption('cell-features');
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: 'artifacts/illustrative-terrain/volcano-existing.png',
  });
});

test('diagnostic motion records real completed frames and restores settings', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(
    '/illustrative-cell-planet?testSuite=illustrative-terrain-cost&testVersion=1&testProfile=headless-hardware&testRepetitions=1&testAutoStart=1',
  );
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  await expect(output).toBeVisible({ timeout: 140_000 });
  const result = JSON.parse(await output.inputValue());
  fs.mkdirSync('artifacts/illustrative-terrain', { recursive: true });
  fs.writeFileSync(
    'artifacts/illustrative-terrain/cost.json',
    JSON.stringify(result, null, 2),
  );
  expect(result.status).toBe('inconclusive');
  expect(result.automatedVerdict).toBe('pass');
  expect(result.visualReview).toBe('pending');
  expect(result.performanceVerdict).toBe('inconclusive');
  expect(
    result.cases.every(
      (c: any) =>
        c.metrics.find((m: any) => m.name === 'completed-frame-interval')
          ?.samples.length > 0,
    ),
  ).toBe(true);
  await expect(page.getByLabel('Terrain', { exact: true })).toHaveValue(
    'illustrative',
  );
});
