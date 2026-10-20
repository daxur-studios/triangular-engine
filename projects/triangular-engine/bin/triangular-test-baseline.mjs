#!/usr/bin/env node
// Turns a saved standard result into the committed baseline JSON of a suite (`TestSuite.baseline`).
//   node projects/triangular-engine/bin/triangular-test-baseline.mjs <result.json> [--metrics a,b] > baseline.json
// Mirrors `baselineFromRun` of `triangular-engine/testing`; keep the two in step.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const round = (n) => Math.round(n * 10_000) / 10_000;
const middle = (values) => { const x = [...values].sort((a, b) => a - b); return round(x[Math.min(x.length - 1, Math.max(0, Math.ceil(x.length * 0.5) - 1))]); };

/** Completed cases without a validity issue only; repetitions of a scenario are combined by their median. */
export function baselineFromRun(run, { metrics } = {}) {
  const found = {};
  for (const c of run.cases ?? []) {
    if (c.status !== 'completed' || c.validityIssues?.length) continue;
    for (const m of c.metrics ?? []) {
      if (!m.summary || (metrics && !metrics.includes(m.name))) continue;
      const entry = ((found[c.scenario.id] ??= {})[m.name] ??= { median: [], p95: [] });
      entry.median.push(m.summary.median);
      entry.p95.push(m.summary.p95);
    }
  }
  const cases = {};
  for (const [id, byMetric] of Object.entries(found)) {
    cases[id] = Object.fromEntries(Object.entries(byMetric).map(([name, s]) => [name, { median: middle(s.median), p95: middle(s.p95) }]));
  }
  const gpu = run.environment?.['gpu.description'];
  return { runId: run.runId, recordedAt: run.startedAt, mode: run.mode ?? 'standard', ...(typeof gpu === 'string' && gpu ? { gpu } : {}), cases };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--metrics');
  const metrics = at >= 0 ? args[at + 1]?.split(',').filter(Boolean) : undefined;
  const file = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--metrics');
  if (!file) { console.error('usage: triangular-test-baseline <result.json> [--metrics a,b]'); process.exit(2); }
  const baseline = baselineFromRun(JSON.parse(readFileSync(file, 'utf8')), { metrics });
  if (!Object.keys(baseline.cases).length) { console.error('No valid completed case with metric summaries in that result.'); process.exit(1); }
  console.log(JSON.stringify(baseline, null, 2));
}
