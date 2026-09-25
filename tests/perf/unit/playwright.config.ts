import { defineConfig } from '@playwright/test';

/** Pure Node unit tests for the perf tooling. No browser or dev server. */
export default defineConfig({
  testDir: '.',
  testMatch: '*.unit.spec.ts',
  reporter: 'list',
  outputDir: '../../../test-results/perf-unit',
});
