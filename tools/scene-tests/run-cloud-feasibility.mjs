import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { estimateDuration, readRunRecords, runStatus, writeRunRecord } from './cloud-run-records.mjs';

const root = process.cwd();
const archive = path.resolve('artifacts/cloud-feasibility');
if (process.argv[2] === '--status') {
  console.log(JSON.stringify(runStatus(archive), null, 2));
  process.exit(0);
}
const startedAt = new Date().toISOString();
const started = performance.now();
const runId = `${startedAt.replace(/[:.]/g, '-')}-${process.pid}`;
const runDir = path.join(archive, runId);
fs.mkdirSync(runDir, { recursive: true });
const performanceMode = process.argv.includes('--performance');
const cliArguments = process.argv.slice(2).filter((arg) => arg !== '--performance');
const profile = { frames: Number(process.env.CLOUD_PROBE_FRAMES ?? 1200), build: process.env.CLOUD_PROBE_BUILD_DIR ? 'reused' : 'fresh', arguments: process.argv.slice(2),
  ...(performanceMode ? { expectedAdapter: process.env.CLOUD_PROBE_EXPECT_VENDOR ?? 'nvidia', measurement: 'redundant-render-batch-v1' } : {}) };
const record = { schemaVersion: 1, runId, pid: process.pid, status: 'running', startedAt, finishedAt: null, durationMs: null, profile, estimate: estimateDuration(readRunRecords(archive), profile) };
writeRunRecord(runDir, record);
console.log(`Cloud feasibility evidence: ${runDir}`);
console.log(record.estimate ? `Previous comparable runs: ${record.estimate.sampleCount}; median ${(record.estimate.medianMs / 1000).toFixed(1)} s; suggested wait ${Math.ceil(record.estimate.suggestedWaitMs / 1000)} s (estimate only).` : 'No timed comparable history yet; wait for process completion.');
try {
const tracked = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true });
if (tracked.status !== 0) throw new Error(tracked.stderr || 'git ls-files failed');
const files = [...new Set(tracked.stdout.split('\0').filter((file) =>
  /^(projects\/|tests\/cloud-feasibility\/|tools\/scene-tests\/|playwright.cloud|angular.json|tsconfig|package)/.test(file)
))].sort();
const sources = files.filter((file) => fs.existsSync(file)).map((file) => ({
  file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
}));
const sourceHash = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
fs.writeFileSync(path.join(runDir, 'source-manifest.json'), JSON.stringify({ sourceHash, sources }, null, 2));
const diff = spawnSync('git', ['diff', 'HEAD', '--binary', '--', 'projects', 'tests/cloud-feasibility', 'tools/scene-tests', 'package.json', 'playwright.cloud-feasibility.config.ts'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
fs.writeFileSync(path.join(runDir, 'working-tree.patch'), diff.stdout ?? '');
// Retain new probe inputs too: git diff does not contain untracked files.
for (const file of files.filter((file) => /cloud-replay-probe|cloud-feasibility|playwright.cloud|tools\/scene-tests\/cloud-/.test(file))) {
  const dest = path.join(runDir, 'probe-source', file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
const server = net.createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const child = spawn(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'playwright.cloud-feasibility.config.ts', ...cliArguments], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, CLOUD_PROBE_RUN_DIR: runDir, CLOUD_PROBE_PORT: String(port), CLOUD_PROBE_PERFORMANCE: performanceMode ? '1' : '0' },
});
let spawnError;
child.once('error', (error) => { spawnError = error; });
const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
const serverStillListening = await new Promise((resolve) => {
  const socket = net.createConnection({ port, host: '127.0.0.1' });
  const finish = (listening) => { socket.destroy(); resolve(listening); };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.setTimeout(1000, () => finish(true));
});
const changed = sources.filter(({ file, sha256 }) => !fs.existsSync(file) || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== sha256).map(({ file }) => file);
record.finishedAt = new Date().toISOString();
record.durationMs = Math.round(performance.now() - started);
record.status = !spawnError && !serverStillListening && exit.code === 0 ? 'passed' : 'failed';
record.code = exit.code;
record.signal = exit.signal;
fs.writeFileSync(path.join(runDir, 'execution.json'), JSON.stringify({ command: performanceMode ? 'npm run test:cloud-performance' : 'npm run test:cloud-feasibility', ...record, ...exit, spawnError: spawnError?.message, sourceHash, sourceFilesChangedDuringRun: changed, reusedBuild: process.env.CLOUD_PROBE_BUILD_DIR ?? null, serverStillListening, performanceValidity: 'diagnostic-only; laptop contention uncontrolled' }, null, 2));
if (!fs.existsSync(path.join(runDir, 'report.md'))) fs.writeFileSync(path.join(runDir, 'report.md'), `# Cloud replay U0 feasibility\n\nStartup failed (exit ${exit.code}, signal ${exit.signal}). See execution.json and terminal output. No GPU/replay evidence established.\n`);
fs.appendFileSync(path.join(runDir, 'report.md'), `\n\nProcess exit: ${exit.code}; dedicated server released: ${!serverStillListening}; sources changed during run: ${changed.length}. Total command duration (build through cleanup): ${(record.durationMs / 1000).toFixed(1)} s.\n`);
writeRunRecord(runDir, record);
console.log(`Evidence saved: ${path.join(runDir, 'report.md')}`);
process.exitCode = spawnError || serverStillListening ? 1 : exit.code ?? 1;
} catch (error) {
  Object.assign(record, { status: 'failed', finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), error: String(error) });
  writeRunRecord(runDir, record);
  console.error(error);
  process.exitCode = 1;
}
