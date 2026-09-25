#!/usr/bin/env node
/**
 * Cross-platform wrapper for the Playwright perf suite (tests/perf).
 *
 *   node tools/run-perf.mjs [--reference] [--record] [--gate] [--headed] [--vsync] [playwright args...]
 *
 *   --reference  steadier protocol (5 s warm-up, 3 x 10 s) instead of the ~5 s smoke
 *   --record     append valid results to tests/perf/history/perf-history.jsonl
 *   --gate       fail tests whose timings regressed against comparable history
 *   --headed     run a headed browser (uses the real GPU on most desktops)
 *   --vsync      keep the browser frame-rate cap (default: uncapped)
 *
 * Remaining arguments go to `playwright test`, e.g. `-g instanced` or a spec path.
 */
import { spawnSync } from 'node:child_process';

const flags = {
  '--reference': ['PERF_PROTOCOL', 'reference'],
  '--record': ['PERF_RECORD', '1'],
  '--gate': ['PERF_GATE', '1'],
  '--headed': ['PERF_HEADED', '1'],
  '--vsync': ['PERF_UNCAPPED', '0'],
};

const env = { ...process.env };
const passthrough = [];
for (const arg of process.argv.slice(2)) {
  if (arg in flags) {
    const [name, value] = flags[arg];
    env[name] = value;
  } else {
    passthrough.push(arg);
  }
}

const result = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.perf.config.ts', ...passthrough], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
