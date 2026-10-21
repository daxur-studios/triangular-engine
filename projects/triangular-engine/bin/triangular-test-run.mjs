#!/usr/bin/env node
// Runs one browser test suite unattended: waits its turn in a machine-wide queue, waits for a quiet GPU, opens a
// dedicated full-screen Chrome at the suite's autostart URL, waits for the receiver to save the result, closes that
// Chrome and prints the summary. Dev only, local only. Made for agents: start it in the background and wait for exit.
//   triangular-test-run --url http://my-app.localhost:4200/lab --suite my-suite --version 1 [options]
// Exit codes: 0 saved and passed, 1 saved but not passed, 2 no result in time (or Chrome closed), 3 the GPU never got
// quiet, 4 setup error (no receiver, no Chrome, bad arguments).
import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pidAlive } from './triangular-test-lock.mjs';
import { SYSTEM_GPU_PROCESS } from './triangular-test-machine.mjs';
import { loadConfig, receiverRoot, SINK_PATH } from './triangular-test-receiver.mjs';

const execFileAsync = promisify(execFile);

/** One folder in the OS temp folder: every app's launcher on this machine queues here, oldest ticket first. */
export const QUEUE_DIR = 'triangular-test-queue';
const MODES = ['quick', 'standard', 'soak'];
const PROFILES = ['visible-browser', 'human-observed', 'headless-hardware'];
const DEFAULTS = {
  version: undefined, profile: 'visible-browser', mode: 'standard', repetitions: 1, thumbnails: true, timeoutMin: 30,
  quietPct: 10, quietWindowS: 10, quietWaitMin: 120, chrome: undefined, keepOpen: false,
};
/** Browsers are skipped when judging quiet (the user's own Chrome idles on the GPU); their load still counts. */
const BROWSER_PROCESS = /^(chrome|msedge|firefox|opera|brave|vivaldi)(\.exe)?$/i;

export function parseArgs(argv) {
  const out = { ...DEFAULTS };
  const flags = { '--url': 'url', '--suite': 'suite', '--version': 'version', '--profile': 'profile', '--mode': 'mode', '--repetitions': 'repetitions',
    '--timeout-min': 'timeoutMin', '--quiet-pct': 'quietPct', '--quiet-window-s': 'quietWindowS', '--quiet-wait-min': 'quietWaitMin', '--chrome': 'chrome' };
  const numbers = new Set(['version', 'repetitions', 'timeoutMin', 'quietPct', 'quietWindowS', 'quietWaitMin']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-thumbnails') { out.thumbnails = false; continue; }
    if (arg === '--keep-open') { out.keepOpen = true; continue; }
    const key = flags[arg];
    if (!key || i + 1 >= argv.length) throw new Error(`Unknown or incomplete argument: ${arg}`);
    const value = argv[++i];
    out[key] = numbers.has(key) ? Number(value) : value;
  }
  if (!out.url || !out.suite || out.version === undefined) throw new Error('--url, --suite and --version are required');
  if (!Number.isInteger(out.version) || out.version < 1) throw new Error('--version must be a whole number from 1');
  if (!MODES.includes(out.mode) || !PROFILES.includes(out.profile)) throw new Error(`--mode is one of ${MODES.join('|')}, --profile one of ${PROFILES.join('|')}`);
  if (!Number.isInteger(out.repetitions) || out.repetitions < 1 || out.repetitions > 5) throw new Error('--repetitions is 1-5');
  for (const key of ['timeoutMin', 'quietPct', 'quietWindowS', 'quietWaitMin']) if (!(out[key] >= 0)) throw new Error(`--${key} must be a number >= 0`);
  new URL(out.url);
  return out;
}

/** Mirrors `buildTestLaunchUrl` of `triangular-engine/testing`; keep the two in step. */
export function buildRunUrl(page, { suite, version, profile, mode, repetitions, thumbnails }) {
  const url = new URL(page);
  url.searchParams.set('testSuite', suite);
  url.searchParams.set('testVersion', String(version));
  url.searchParams.set('testProfile', profile);
  url.searchParams.set('testMode', mode);
  url.searchParams.set('testRepetitions', String(repetitions));
  if (!thumbnails) url.searchParams.set('testThumbnails', '0');
  url.searchParams.set('testAutoStart', '1');
  return url.toString();
}

/**
 * Machine-wide FIFO of runs. Each waiting launcher writes one ticket file named `<ms>-<pid>.json`; the oldest ticket
 * whose pid is alive runs, and dead tickets are removed by whoever looks. `dir`, `now`, `alive` and `pid` are
 * injectable for specs.
 */
export function createRunQueue({ dir = join(tmpdir(), QUEUE_DIR), now = Date.now, alive = pidAlive, pid = process.pid } = {}) {
  let ticket;
  const tickets = () => {
    let names = [];
    try { names = readdirSync(dir).filter((name) => /^\d+-\d+\.json$/.test(name)); } catch { return []; }
    const live = [];
    for (const name of names) {
      const [ms, owner] = name.slice(0, -5).split('-').map(Number);
      if (!alive(owner)) { rmSync(join(dir, name), { force: true }); continue; }
      let info = {};
      try { info = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { /* still being written */ }
      live.push({ name, ms, pid: owner, ...info });
    }
    return live.sort((a, b) => a.ms - b.ms || a.pid - b.pid);
  };
  return {
    dir,
    enter(info) {
      mkdirSync(dir, { recursive: true });
      ticket = `${now()}-${pid}.json`;
      writeFileSync(join(dir, ticket), JSON.stringify({ ...info, queuedAt: new Date(now()).toISOString() }));
      return ticket;
    },
    /** The live tickets ahead of ours; empty means it is our turn. */
    ahead() {
      const all = tickets();
      const index = all.findIndex((t) => t.name === ticket);
      return index < 0 ? all : all.slice(0, index);
    },
    leave() { if (ticket) rmSync(join(dir, ticket), { force: true }); ticket = undefined; },
  };
}

/** Quiet = median GPU load at or under `maxPct` and no non-browser, non-system process on the GPU. */
export function quietVerdict(utils, apps, { maxPct }) {
  const values = utils.filter(Number.isFinite).sort((a, b) => a - b);
  const others = apps.filter((app) => !BROWSER_PROCESS.test(app.name ?? '') && !SYSTEM_GPU_PROCESS.test(app.name ?? ''));
  if (others.length) return { quiet: false, reason: `GPU in use by ${others.map((app) => app.name ?? `pid ${app.pid}`).join(', ')}` };
  if (!values.length) return { quiet: true, reason: 'no GPU readings (nvidia-smi missing?): not checked' };
  const med = values[Math.floor((values.length - 1) / 2)];
  return med <= maxPct ? { quiet: true, reason: `GPU load median ${med}%` } : { quiet: false, reason: `GPU load median ${med}% > ${maxPct}%` };
}

async function gpuReadings(windowS) {
  const utils = [];
  let apps = [];
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-compute-apps=pid,process_name', '--format=csv,noheader'], { windowsHide: true, timeout: 15_000 });
    apps = stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [pid, path] = line.split(',').map((s) => s.trim());
      return { pid: Number(pid), name: path?.split(/[\\/]/).pop() };
    });
    const count = Math.max(1, Math.round(windowS * 2));
    for (let i = 0; i < count; i++) {
      const { stdout: util } = await execFileAsync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits', '-i', '0'], { windowsHide: true, timeout: 15_000 });
      utils.push(Number(util.trim()));
      await sleep(500);
    }
  } catch { /* no nvidia-smi: quietVerdict says so */ }
  return { utils, apps };
}

/** The first saved row of this suite/version that started at or after `since` (ms). */
export function findResult(text, { suite, version, since }) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.suite === suite && row.version === version && Date.parse(row.startedAt) >= since) return row;
  }
  return undefined;
}

export function findChrome(platform = process.platform, exists = existsSync, env = process.env) {
  const candidates = platform === 'win32'
    ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map((base) => join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  return candidates.find((path) => exists(path));
}

/** A fresh profile does not carry chrome://flags, so the precise GPU timer flag goes on the command line. */
export function chromeArgs(profileDir, url) {
  return [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--start-fullscreen',
    '--enable-webgpu-developer-features', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', url];
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (text) => console.log(`[triangular-test-run] ${text}`);

/**
 * GET JSON from `target`. A `*.localhost` host goes to 127.0.0.1 with its name in the Host header: browsers resolve
 * those names themselves, but Node on Windows cannot, and a gateway routes by that header.
 */
export function getJson(target, { timeoutMs = 5000, request = httpRequest } = {}) {
  const url = new URL(target);
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
  return new Promise((done, fail) => {
    const req = request({ host: local ? '127.0.0.1' : url.hostname, port: url.port || 80, path: url.pathname + url.search,
      headers: { host: url.host }, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { try { done(JSON.parse(text)); } catch { fail(new Error(`not JSON (HTTP ${res.statusCode})`)); } });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', fail);
    req.end();
  });
}

async function probeReceiver(pageUrl, root, config) {
  const target = new URL(SINK_PATH, pageUrl).toString();
  try {
    const body = await getJson(target);
    if (body?.receiver !== 'triangular-test') return `${target} answered, but not as a triangular-test receiver`;
    const mine = receiverRoot(root, config);
    if (body.root !== mine) return `${target} saves to another folder (root ${body.root}, this repo is ${mine}); run from the app's repo root`;
    return undefined;
  } catch (error) {
    return `no receiver at ${target} (${error?.message ?? error}); start the dev server with its receiver, or npm run test:receiver`;
  }
}

function closeChrome(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(child.pid); } catch { /* gone */ } }
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  let options;
  try { options = parseArgs(argv); } catch (error) { console.error(`[triangular-test-run] ${error.message}`); return 4; }
  const config = loadConfig(root);
  const index = join(root, config.outputDir, 'index.jsonl');
  const problem = await probeReceiver(options.url, root, config);
  if (problem) { console.error(`[triangular-test-run] ${problem}`); return 4; }
  const chromePath = options.chrome ?? findChrome();
  if (!chromePath) { console.error('[triangular-test-run] Chrome not found; pass --chrome <path>'); return 4; }

  const queue = createRunQueue();
  const leave = () => queue.leave();
  process.on('exit', leave);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { leave(); process.exit(130); });
  queue.enter({ suite: options.suite, version: options.version, root, url: options.url });
  let lastAhead = '';
  for (;;) {
    const ahead = queue.ahead();
    if (!ahead.length) break;
    const text = ahead.map((t) => `${t.suite ?? '?'}@v${t.version ?? '?'} (pid ${t.pid})`).join(', ');
    if (text !== lastAhead) log(`waiting for ${ahead.length} run(s) ahead: ${text}`);
    lastAhead = text;
    await sleep(5000);
  }

  const quietUntil = Date.now() + options.quietWaitMin * 60_000;
  for (let first = true; ; first = false) {
    const { utils, apps } = await gpuReadings(options.quietWindowS);
    const verdict = quietVerdict(utils, apps, { maxPct: options.quietPct });
    if (verdict.quiet) { log(`machine quiet: ${verdict.reason}`); break; }
    if (Date.now() >= quietUntil) { console.error(`[triangular-test-run] machine never got quiet in ${options.quietWaitMin} min: ${verdict.reason}`); return 3; }
    if (first) log(`waiting for a quiet machine: ${verdict.reason}`);
    await sleep(30_000);
  }

  const url = buildRunUrl(options.url, options);
  const profileDir = mkdtempSync(join(tmpdir(), 'triangular-test-chrome-'));
  const since = Date.now() - 2000;
  log(`opening ${url}`);
  const chrome = spawn(chromePath, chromeArgs(profileDir, url), { stdio: 'ignore', windowsHide: false });
  let chromeGone = false;
  chrome.on('exit', () => { chromeGone = true; });
  chrome.on('error', () => { chromeGone = true; });

  let row;
  const deadline = Date.now() + options.timeoutMin * 60_000;
  while (Date.now() < deadline && !chromeGone) {
    await sleep(5000);
    try { row = findResult(readFileSync(index, 'utf8'), { suite: options.suite, version: options.version, since }); } catch { /* no index yet */ }
    if (row) break;
  }
  if (!options.keepOpen) {
    closeChrome(chrome);
    await sleep(1000);
    try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* temp folder; the OS cleans it */ }
  }
  if (!row) {
    console.error(`[triangular-test-run] ${chromeGone ? 'Chrome closed' : `no result in ${options.timeoutMin} min`} before the run was saved`);
    return 2;
  }
  log(`saved ${row.file}: auto=${row.automatedVerdict} perf=${row.performanceVerdict} status=${row.status}`);
  spawnSync(process.execPath, [fileURLToPath(new URL('./triangular-test-summary.mjs', import.meta.url)), '--suite', options.suite, '--last', '1'],
    { cwd: root, stdio: 'inherit' });
  return row.status === 'completed' && row.automatedVerdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code));
}
