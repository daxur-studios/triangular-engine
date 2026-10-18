import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const base = '/atmosphere-lab';
const look = `${base}?testSuite=bent-atmosphere-look&testVersion=1&testProfile=headless-hardware&testAutoStart=1`;

test('bent atmosphere look suite autostarts, passes its functional checks, marks appearance for review and restores the lab', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(look);
  const output = page.getByRole('textbox', { name: 'Test result JSON' });
  await expect(output).toBeVisible({ timeout: 500_000 });
  const result = JSON.parse(await output.inputValue());
  fs.mkdirSync('artifacts/test-runner', { recursive: true });
  fs.writeFileSync('artifacts/test-runner/atmosphere-lab-look.json', JSON.stringify(result, null, 2));
  expect(result.suite.id).toBe('bent-atmosphere-look');
  expect(result.status).toBe('completed');
  expect(result.automatedVerdict).toBe('pass');
  expect(result.visualReview).toBe('pending');
  expect(result.cases.map((item: { scenario: { id: string } }) => item.scenario.id)).toEqual([
    'scrub-equirect', 'scrub-equal-earth', 'equal-earth-low-morph', 'rim-glow-equirect', 'rim-glow-equal-earth', 'side-on-east-edge']);
  expect(new URL(result.rerunUrl).searchParams.get('testVersion')).toBe('1');
  expect(errors).toEqual([]);
  // Restoration: the controls are unlocked and the bent planet is off again, as before the run.
  await expect(page.getByRole('button', { name: 'Run latest test', exact: true })).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('fieldset.locked')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'bent planet off' })).toBeVisible();
});
