#!/usr/bin/env node
// Compact table over artifacts/test-runs/index.jsonl plus run-adjacent visual-review metadata.
// Usage: triangular-test-summary [--suite id] [--last N] [--metric text] [--json] [--dir artifacts/test-runs]
// --json prints the same runs as machine-readable JSON (see summaryJson).
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ablationSummaries, caseSummaries, computeFingerprint, loadConfig } from './triangular-test-receiver.mjs';

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

/**
 * `noisy gpu 45/80% cpu 30/60% [game-client, ide]`: the run's load condition, then GPU and CPU median/p95 and the heavy
 * program categories seen, from the launcher's `<result>.load.json`. A row without a record shows its tag, or nothing
 * when it has neither (older rows were clean).
 */
export function loadText(row, load) {
  const condition = load?.condition ?? row.load;
  if (!condition) return '';
  const pair = (med, p95) => (med === undefined ? 'n/a' : `${med}/${p95 ?? 'n/a'}%`);
  if (!load) return `  load: ${condition}`;
  const programs = load.categories?.length ? ` [${load.categories.join(', ')}]` : '';
  return `  load: ${condition} gpu ${pair(load.gpuMedPct, load.gpuP95Pct)} cpu ${pair(load.cpuMedPct, load.cpuP95Pct)}${programs}`;
}

/** Name of the load record beside a result file. */
export const loadFile = (file) => file.replace(/\.json$/, '.load.json');

/** A concise, claim-scoped review line; visual reviews do not replace the runner's run-level status. */
export function visualReviewLines(reviews) {
  if (!Array.isArray(reviews)) return [];
  return reviews.map((review) => {
    const reviewer = review?.reviewer ?? {};
    const identity = [reviewer.kind, reviewer.id].filter(Boolean).join(' ') || 'unknown reviewer';
    const verdict = String(review?.verdict ?? 'unknown').toUpperCase();
    const claim = String(review?.claim ?? '').replace(/\s+/g, ' ').trim();
    const shortenedClaim = claim.length > 180 ? `${claim.slice(0, 177)}...` : claim;
    const artifact = review?.artifact?.file ? ` [${review.artifact.file}]` : '';
    return `  claim review ${verdict} (${identity}): ${shortenedClaim || '(no claim)'}${artifact}`;
  });
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');

/** `shadows @ orbit-600km gpuPassTotal median: B 0.081 vs A 0.045 (+80.0%) slower, noise 0.001`. */
export function ablationLine(a) {
  const head = `  A/B ${a.feature} @ ${a.group} ${a.metric} ${a.statistic}`;
  const invalid = a.invalidRounds ? ` | ${a.invalidRounds} invalid rounds` : '';
  if (a.verdict === 'invalid' || a.verdict === 'rejected') return `${head}: ${a.verdict.toUpperCase()} ${a.reasons.join('; ')}${invalid}`;
  const pct = Number.isFinite(a.relative) ? ` (${a.relative > 0 ? '+' : ''}${(a.relative * 100).toFixed(1)}%)` : '';
  return `${head}: B ${a.b} vs A ${a.a}${pct} ${a.verdict}, noise ${a.noise}${invalid}`;
}

/** `[settled 1.4s]`, `[max 5s, did not settle]`, `[fixed 60s, drift frameInterval +7.0%]`, plus redo count. */
function windowText(s) {
  const parts = [];
  if (s.window) {
    parts.push(`${s.window.stoppedBy} ${s.window.s}s`);
    for (const [name, d] of Object.entries(s.window.drift ?? {})) if (Math.abs(d) > 0.05) parts.push(`DRIFT ${name} ${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%`);
  }
  if (s.retries) parts.push(`redone ${s.retries}x`);
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

/** A constant metric (draw calls, triangle counts) prints once instead of as med/p95/max. */
const metricText = (name, s) => (s.min === s.max ? `${name} = ${fmt(s.max)}` : `${name} med ${fmt(s.med)} p95 ${fmt(s.p95)} max ${fmt(s.max)}`);

/**
 * Metrics that carry a `group` (a span breakdown) as a table sorted by share, largest first: share, median, p95. Rows
 * are `    <group>: name  42.1%  med 12.3 p95 14.0`. Empty when no metric has a group.
 */
export function breakdownLines(metrics, filter) {
  const groups = new Map();
  for (const [key, v] of Object.entries(metrics)) {
    if (v.group === undefined || (filter && !key.includes(filter))) continue;
    groups.set(v.group, [...(groups.get(v.group) ?? []), [key, v]]);
  }
  const lines = [];
  for (const [group, rows] of groups) {
    rows.sort((a, b) => (b[1].share ?? 0) - (a[1].share ?? 0));
    const width = Math.max(...rows.map(([key]) => key.length));
    lines.push(`    breakdown ${group}:`);
    for (const [key, v] of rows) lines.push(`      ${key.padEnd(width)}  ${(((v.share ?? 0) * 100).toFixed(1) + '%').padStart(6)}  med ${fmt(v.med)} p95 ${fmt(v.p95)}`);
  }
  return lines;
}

/**
 * Groups index rows by suite and version, keeping the last `last` runs of each group (all of them when fewer exist).
 * `suite` keeps only that suite id.
 */
export function selectRuns(rows, { suite, last = 5 } = {}) {
  const bySuite = Map.groupBy(rows.filter((r) => !suite || r.suite === suite), (r) => `${r.suite}@v${r.version}`);
  return [...bySuite].map(([key, list]) => ({ key, rows: list.slice(-last) }));
}

/** The suite ids in the index, sorted. */
export function knownSuites(rows) {
  return [...new Set(rows.map((r) => r.suite))].sort();
}

/** Error text when `suite` names no run in the index; null when it does, or when no suite was asked for. */
export function unknownSuiteMessage(rows, suite) {
  if (!suite || rows.some((r) => r.suite === suite)) return null;
  const known = knownSuites(rows);
  return `No runs for suite "${suite}" in the index. ${known.length ? `Known suites: ${known.join(', ')}.` : 'The index has no runs yet.'}`;
}

/**
 * Index lines written since summaries were added carry `cases`, so no result file is opened. Older lines fall back
 * to reading their file. `metric` keeps only metrics whose name contains that text.
 */
export function summarize(rows, readRun, currentHash, { suite, last = 5, metric, readLoad = () => null, readReviews = () => [] } = {}) {
  const lines = [];
  for (const { key, rows: list } of selectRuns(rows, { suite, last })) {
    lines.push(`## ${key}`);
    for (const row of list) {
      const stale = currentHash && row.fingerprint !== currentHash ? 'STALE' : 'current';
      lines.push(`${row.startedAt?.slice(0, 16) ?? row.savedAt.slice(0, 16)}  ${row.profile} ${row.mode ?? 'standard'}  ${row.fingerprint} ${stale}  auto=${row.automatedVerdict} perf=${row.performanceVerdict} visual=${row.visualReview}`);
      const claimReviews = readReviews(row.file) ?? [];
      if (claimReviews.length) lines.push(...visualReviewLines(claimReviews));
      else if (row.visualReview === 'pending') lines.push('  claim reviews: none recorded');
      const load = loadText(row, readLoad(row.file));
      if (load) lines.push(load);
      const machine = machineText(row);
      if (machine) lines.push(machine);
      let cases = row.cases;
      let errors = row.errors;
      let ablations = row.ablations;
      if (!cases) {
        const run = readRun(row.file);
        if (!run) { lines.push('  (full result file missing)'); continue; }
        cases = caseSummaries(run);
        errors = run.errors;
        ablations = ablationSummaries(run);
      }
      for (const [id, s] of Object.entries(cases)) {
        const m = Object.entries(s.metrics).filter(([name, v]) => v.group === undefined && (!metric || name.includes(metric))).map(([name, v]) => metricText(name, v));
        lines.push(`  ${id}${windowText(s)}: ${m.join(' | ') || 'no metrics'}`);
        lines.push(...breakdownLines(s.metrics, metric));
        for (const f of s.failed) lines.push(`    FAIL ${f}`);
        // A validity issue (wrong GPU, lost focus, software renderer) means these timings are not hardware numbers.
        for (const i of s.invalid ?? []) lines.push(`    INVALID ${i}`);
      }
      for (const a of ablations ?? []) lines.push(ablationLine(a));
      for (const n of row.performanceNotes ?? []) lines.push(`  PERF NOTE ${n}`);
      for (const e of errors ?? []) lines.push(`  RUN ERROR ${e}`);
      lines.push(`  file: ${row.file}`);
    }
  }
  return lines.join('\n');
}

/**
 * The same runs `summarize` prints, as data for other tools. Each run carries its verdicts, its case summaries (`metric`
 * keeps matching metrics only), ablations, performance notes, errors, visual-review claims and load condition.
 * `stale` is true when the run's fingerprint differs from `currentHash`. `fileMissing` is true when neither the index
 * line nor the result file has the case data.
 */
export function summaryJson(rows, readRun, currentHash, { suite, last = 5, metric, readLoad = () => null, readReviews = () => [] } = {}) {
  const runs = [];
  for (const { rows: list } of selectRuns(rows, { suite, last })) {
    for (const row of list) {
      let cases = row.cases;
      let errors = row.errors;
      let ablations = row.ablations;
      if (!cases) {
        const run = readRun(row.file);
        cases = run ? caseSummaries(run) : null;
        errors = run?.errors;
        ablations = run ? ablationSummaries(run) : undefined;
      }
      const keepMetric = (metrics) => Object.fromEntries(Object.entries(metrics).filter(([name]) => !metric || name.includes(metric)));
      runs.push({
        suite: row.suite,
        version: row.version,
        profile: row.profile,
        mode: row.mode ?? 'standard',
        startedAt: row.startedAt ?? row.savedAt,
        fingerprint: row.fingerprint,
        stale: Boolean(currentHash && row.fingerprint !== currentHash),
        automatedVerdict: row.automatedVerdict,
        performanceVerdict: row.performanceVerdict,
        visualReview: row.visualReview,
        file: row.file,
        fileMissing: cases === null,
        cases: Object.fromEntries(Object.entries(cases ?? {}).map(([id, s]) => [id, { ...s, metrics: keepMetric(s.metrics) }])),
        ablations: ablations ?? [],
        performanceNotes: row.performanceNotes ?? [],
        errors: errors ?? [],
        claimReviews: readReviews(row.file) ?? [],
        load: readLoad(row.file) ?? null,
        machine: row.machine ?? null,
      });
    }
  }
  return runs;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
  const root = process.cwd();
  const config = loadConfig(root);
  const dir = join(root, opt('--dir', config.outputDir));
  const indexFile = join(dir, 'index.jsonl');
  const json = args.includes('--json');
  if (!existsSync(indexFile)) {
    if (json) console.log(JSON.stringify({ fingerprint: null, runs: [] }, null, 2));
    else console.log(`No results yet (${indexFile}). Run a suite in a visible tab with the sink enabled.`);
    process.exit(0);
  }
  const rows = readFileSync(indexFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const readRun = (file) => { try { return JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { return null; } };
  const readReviews = (file) => {
    if (typeof file !== 'string' || !file.endsWith('.json')) return [];
    const sidecar = resolve(dir, file.replace(/\.json$/, '.reviews.json'));
    const relativeSidecar = relative(resolve(dir), sidecar);
    if (!relativeSidecar || relativeSidecar === '..' || relativeSidecar.startsWith(`..${sep}`) || isAbsolute(relativeSidecar) || !existsSync(sidecar)) return [];
    try {
      const parsed = JSON.parse(readFileSync(sidecar, 'utf8'));
      return parsed?.schemaVersion === 1 && parsed.run === file && Array.isArray(parsed.reviews) ? parsed.reviews : [];
    } catch { return []; }
  };
  const current = computeFingerprint(root, config.fingerprintPaths).hash;
  const suite = opt('--suite');
  const options = { suite, last: Number(opt('--last', 5)), metric: opt('--metric'), readLoad: (file) => readRun(loadFile(file)), readReviews };
  const missing = unknownSuiteMessage(rows, suite);
  if (missing) {
    console.error(missing);
    process.exitCode = 1;
  } else if (json) {
    console.log(JSON.stringify({ fingerprint: current, runs: summaryJson(rows, readRun, current, options) }, null, 2));
  } else {
    console.log(`current fingerprint ${current}
`);
    console.log(summarize(rows, readRun, current, options));
  }
}
