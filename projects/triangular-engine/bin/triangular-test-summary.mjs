#!/usr/bin/env node
// Compact table over artifacts/test-runs/index.jsonl. Read this first; open a full JSON only for a failure.
// Usage: triangular-test-summary [--suite id] [--last N] [--metric text] [--dir artifacts/test-runs]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseSummaries, computeFingerprint, loadConfig } from './triangular-test-receiver.mjs';

/** One compact line: GPU adapter vendor and backend, sampled load, and warnings. Empty for runs without machine data. */
export function machineText(row) {
  const m = row.machine;
  if (!row.gpu && !row.gpuBackend && !m) return '';
  const parts = [`gpu ${[row.gpu, row.gpuBackend].filter(Boolean).join('/') || 'not recorded'}`];
  if (m) {
    const load = [m.gpuUtilMedPct !== undefined ? `gpu ${Math.round(m.gpuUtilMedPct)}%` : m.gpuSampling === 'unavailable' ? 'gpu n/a' : '',
      m.cpuMedPct !== undefined ? `cpu ${Math.round(m.cpuMedPct)}%` : '', m.gpuTempMaxC !== undefined ? `${Math.round(m.gpuTempMaxC)}C` : ''].filter(Boolean);
    if (load.length) parts.push(`load med ${load.join(' ')}`);
    if (m.warnings?.length) parts.push(`WARN ${m.warnings.join(', ')}`);
  }
  return `  machine: ${parts.join(' | ')}`;
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');

/** A constant metric (draw calls, triangle counts) prints once instead of as med/p95/max. */
const metricText = (name, s) => (s.min === s.max ? `${name} = ${fmt(s.max)}` : `${name} med ${fmt(s.med)} p95 ${fmt(s.p95)} max ${fmt(s.max)}`);

/**
 * Index lines written since summaries were added carry `cases`, so no result file is opened. Older lines fall back
 * to reading their file. `metric` keeps only metrics whose name contains that text.
 */
export function summarize(rows, readRun, currentHash, { suite, last = 5, metric } = {}) {
  const lines = [];
  const bySuite = Map.groupBy(rows.filter((r) => !suite || r.suite === suite), (r) => `${r.suite}@v${r.version}`);
  for (const [key, list] of bySuite) {
    lines.push(`## ${key}`);
    for (const row of list.slice(-last)) {
      const stale = currentHash && row.fingerprint !== currentHash ? 'STALE' : 'current';
      lines.push(`${row.startedAt?.slice(0, 16) ?? row.savedAt.slice(0, 16)}  ${row.profile}  ${row.fingerprint} ${stale}  auto=${row.automatedVerdict} perf=${row.performanceVerdict} visual=${row.visualReview}`);
      const machine = machineText(row);
      if (machine) lines.push(machine);
      let cases = row.cases;
      let errors = row.errors;
      if (!cases) {
        const run = readRun(row.file);
        if (!run) { lines.push('  (full result file missing)'); continue; }
        cases = caseSummaries(run);
        errors = run.errors;
      }
      for (const [id, s] of Object.entries(cases)) {
        const m = Object.entries(s.metrics).filter(([name]) => !metric || name.includes(metric)).map(([name, v]) => metricText(name, v));
        lines.push(`  ${id}: ${m.join(' | ') || 'no metrics'}`);
        for (const f of s.failed) lines.push(`    FAIL ${f}`);
        // A validity issue (wrong GPU, lost focus, software renderer) means these timings are not hardware numbers.
        for (const i of s.invalid ?? []) lines.push(`    INVALID ${i}`);
      }
      for (const e of errors ?? []) lines.push(`  RUN ERROR ${e}`);
      lines.push(`  file: ${row.file}`);
    }
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
  const root = process.cwd();
  const config = loadConfig(root);
  const dir = join(root, opt('--dir', config.outputDir));
  const indexFile = join(dir, 'index.jsonl');
  if (!existsSync(indexFile)) { console.log(`No results yet (${indexFile}). Run a suite in a visible tab with the sink enabled.`); process.exit(0); }
  const rows = readFileSync(indexFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const readRun = (file) => { try { return JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { return null; } };
  const current = computeFingerprint(root, config.fingerprintPaths).hash;
  console.log(`current fingerprint ${current}\n`);
  console.log(summarize(rows, readRun, current, { suite: opt('--suite'), last: Number(opt('--last', 5)), metric: opt('--metric') }));
}
