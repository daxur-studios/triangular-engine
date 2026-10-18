#!/usr/bin/env node
// Compact table over artifacts/test-runs/index.jsonl. Read this first; open a full JSON only for a failure.
// Usage: triangular-test-summary [--suite id] [--last N] [--dir artifacts/test-runs]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFingerprint, loadConfig } from './triangular-test-receiver.mjs';

const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');

/** Per-scenario statistics for the first non-optional-unavailable metric samples, across repetitions. */
export function scenarioStats(run) {
  const by = new Map();
  for (const c of run.cases ?? []) {
    const entry = by.get(c.scenario.id) ?? { label: c.scenario.label ?? c.scenario.id, metrics: new Map(), failed: [] };
    for (const m of c.metrics ?? []) {
      if (!m.samples?.length) continue;
      const list = entry.metrics.get(`${m.name} (${m.unit})`) ?? [];
      list.push(...m.samples.filter(Number.isFinite));
      entry.metrics.set(`${m.name} (${m.unit})`, list);
    }
    for (const k of c.checks ?? []) if (!k.passed) entry.failed.push(`${k.name}${k.detail ? ` — ${k.detail}` : ''}`);
    if (c.error) entry.failed.push(`error: ${c.error}`);
    by.set(c.scenario.id, entry);
  }
  return by;
}

export function summarize(rows, readRun, currentHash, { suite, last = 5 } = {}) {
  const lines = [];
  const bySuite = Map.groupBy(rows.filter((r) => !suite || r.suite === suite), (r) => `${r.suite}@v${r.version}`);
  for (const [key, list] of bySuite) {
    lines.push(`## ${key}`);
    for (const row of list.slice(-last)) {
      const stale = currentHash && row.fingerprint !== currentHash ? 'STALE' : 'current';
      lines.push(`${row.startedAt?.slice(0, 16) ?? row.savedAt.slice(0, 16)}  ${row.profile}  ${row.fingerprint} ${stale}  auto=${row.automatedVerdict} perf=${row.performanceVerdict} visual=${row.visualReview}`);
      const run = readRun(row.file);
      if (!run) { lines.push('  (full result file missing)'); continue; }
      for (const [id, s] of scenarioStats(run)) {
        const m = [...s.metrics].map(([name, v]) => { const x = [...v].sort((a, b) => a - b); return `${name} med ${fmt(q(x, 0.5))} p95 ${fmt(q(x, 0.95))} max ${fmt(x.at(-1))}`; });
        lines.push(`  ${id}: ${m.join(' | ') || 'no metrics'}`);
        for (const f of s.failed) lines.push(`    FAIL ${f}`);
      }
      for (const e of run.errors ?? []) lines.push(`  RUN ERROR ${e}`);
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
  console.log(summarize(rows, readRun, current, { suite: opt('--suite'), last: Number(opt('--last', 5)) }));
}
