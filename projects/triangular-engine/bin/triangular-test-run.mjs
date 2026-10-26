#!/usr/bin/env node
// Runs one browser test suite unattended: waits its turn in a machine-wide queue, waits for the owner to be away (if the
// machine has an away switch; not for --profile headless-hardware, which never takes the screen) and for a quiet GPU, opens a
// dedicated full-screen Chrome (hidden headless Chrome on the real GPU for headless-hardware) at the suite's autostart URL, waits for the receiver to save the result, closes that
// Chrome and prints the summary. Dev only, local only. Made for agents: start it in the background and wait for exit.
//   triangular-test-run --url http://my-app.localhost:4200/lab --suite my-suite --version 1 [options]
// --noisy: the owner keeps working or playing meanwhile, so do not wait for a quiet GPU, and tag the run `noisy`. Every run
// samples GPU and CPU load and lists known heavy programs at start and end (saved as <result>.load.json).
// Exit codes: 0 saved and passed, 1 saved but not passed, 2 no result in time (or Chrome closed), 3 the owner never went
// away or the GPU never got quiet, 4 setup error (no receiver, no Chrome, bad arguments).
import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { cpus, tmpdir } from 'node:os';
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
  noisy: false, quietPct: 10, quietWindowS: 10, quietWaitMin: 120, awayWaitMin: 480, chrome: undefined, keepOpen: false,
};
/**
 * Headless window size in CSS pixels plus device scale factor. They are what the headed full-screen runs on the owner's
 * machine recorded (viewport 1707x872, devicePixelRatio 1.5, so 2560x1308 device pixels): same canvas pixel count.
 */
export const HEADLESS_WINDOW = { width: 1707, height: 872, scaleFactor: 1.5 };
/** Browsers are skipped when judging quiet (the user's own Chrome idles on the GPU); their load still counts. */
const BROWSER_PROCESS = /^(chrome|msedge|firefox|opera|brave|vivaldi)(\.exe)?$/i;

export function parseArgs(argv) {
  const out = { ...DEFAULTS };
  const flags = { '--url': 'url', '--suite': 'suite', '--version': 'version', '--profile': 'profile', '--mode': 'mode', '--repetitions': 'repetitions',
    '--timeout-min': 'timeoutMin', '--quiet-pct': 'quietPct', '--quiet-window-s': 'quietWindowS', '--quiet-wait-min': 'quietWaitMin', '--away-wait-min': 'awayWaitMin', '--chrome': 'chrome', '--window-size': 'windowSize' };
  const numbers = new Set(['version', 'repetitions', 'timeoutMin', 'quietPct', 'quietWindowS', 'quietWaitMin', 'awayWaitMin']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-thumbnails') { out.thumbnails = false; continue; }
    if (arg === '--keep-open') { out.keepOpen = true; continue; }
    if (arg === '--noisy') { out.noisy = true; continue; }
    const key = flags[arg];
    if (!key || i + 1 >= argv.length) throw new Error(`Unknown or incomplete argument: ${arg}`);
    const value = argv[++i];
    if (key === 'windowSize') {
      const match = /^(\d{3,5})x(\d{3,5})$/i.exec(value);
      if (!match) throw new Error('--window-size is <width>x<height> in CSS pixels, e.g. 1707x872');
      out.windowSize = { width: Number(match[1]), height: Number(match[2]) };
      continue;
    }
    out[key] = numbers.has(key) ? Number(value) : value;
  }
  if (!out.url || !out.suite || out.version === undefined) throw new Error('--url, --suite and --version are required');
  if (!Number.isInteger(out.version) || out.version < 1) throw new Error('--version must be a whole number from 1');
  if (!MODES.includes(out.mode) || !PROFILES.includes(out.profile)) throw new Error(`--mode is one of ${MODES.join('|')}, --profile one of ${PROFILES.join('|')}`);
  if (!Number.isInteger(out.repetitions) || out.repetitions < 1 || out.repetitions > 5) throw new Error('--repetitions is 1-5');
  for (const key of ['timeoutMin', 'quietPct', 'quietWindowS', 'quietWaitMin', 'awayWaitMin']) if (!(out[key] >= 0)) throw new Error(`--${key} must be a number >= 0`);
  new URL(out.url);
  return out;
}

/** Mirrors `buildTestLaunchUrl` of `triangular-engine/testing`; keep the two in step. */
export function buildRunUrl(page, { suite, version, profile, mode, repetitions, thumbnails, noisy }) {
  const url = new URL(page);
  url.searchParams.set('testSuite', suite);
  url.searchParams.set('testVersion', String(version));
  url.searchParams.set('testProfile', profile);
  url.searchParams.set('testMode', mode);
  url.searchParams.set('testRepetitions', String(repetitions));
  url.searchParams.set('testLoad', noisy ? 'noisy' : 'clean');
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

/** The owner's "I'm away" switch, written by a local dashboard: `{ away, setAt, expiresAt (ms) }` in the OS temp folder. */
export const AWAY_FILE = 'triangular-test-away.json';

/**
 * May a run take over the screen? No switch file means the machine does not use one: yes. Otherwise only while the
 * switch is on and not expired; an unreadable file counts as not away, so a half-written file never starts a run.
 */
export function awayVerdict(text, now = Date.now()) {
  if (text === undefined) return { ok: true, reason: 'no away switch on this machine' };
  let state;
  try { state = JSON.parse(text); } catch { return { ok: false, reason: 'away switch unreadable' }; }
  if (state?.away !== true) return { ok: false, reason: 'owner not away' };
  if (Number.isFinite(state.expiresAt) && state.expiresAt <= now) return { ok: false, reason: `away switch expired ${new Date(state.expiresAt).toISOString()}` };
  return { ok: true, reason: `owner away${Number.isFinite(state.expiresAt) ? ` until ${new Date(state.expiresAt).toISOString()}` : ''}` };
}

function readAway(path = join(tmpdir(), AWAY_FILE)) {
  try { return readFileSync(path, 'utf8'); } catch { return undefined; }
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

/** One whole-machine GPU utilisation reading in percent (first GPU), or undefined without nvidia-smi. */
export async function gpuUtilOnce() {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits', '-i', '0'], { windowsHide: true, timeout: 15_000 });
    const value = Number(stdout.trim());
    return Number.isFinite(value) ? value : undefined;
  } catch { return undefined; }
}

/**
 * Programs whose load makes timings noisy, by category. Matched on the process image name, case-insensitive.
 * game: a game running; game-client: a game's launcher or client, which render and poll in the background;
 * ide: editors and IDEs; agent: the desktop agent app.
 */
export const HEAVY_PROGRAMS = {
  game: ['League of Legends.exe'],
  'game-client': ['LeagueClient.exe', 'LeagueClientUx.exe', 'RiotClientServices.exe'],
  ide: ['Code.exe', 'Cursor.exe', 'idea64.exe', 'webstorm64.exe', 'devenv.exe'],
  agent: ['claude.exe'],
};

/** Image names from `tasklist /FO CSV /NH` (or one name per line, as `ps -A -o comm=` prints). */
export function parseProcessNames(text) {
  const names = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const quoted = /^"([^"]+)"/.exec(line.trim());
    const name = (quoted ? quoted[1] : line.trim().split(/[\\/]/).pop())?.trim();
    if (name) names.add(name);
  }
  return [...names];
}

/** The known heavy programs among `names`: `{ programs, categories }`, programs sorted in their listed spelling. */
export function classifyPrograms(names) {
  const known = new Map();
  for (const [category, list] of Object.entries(HEAVY_PROGRAMS)) for (const exe of list) known.set(exe.toLowerCase(), { exe, category });
  const programs = new Set();
  const categories = new Set();
  for (const name of names) {
    const hit = known.get(String(name).toLowerCase());
    if (hit) { programs.add(hit.exe); categories.add(hit.category); }
  }
  return { programs: [...programs].sort(), categories: Object.keys(HEAVY_PROGRAMS).filter((c) => categories.has(c)) };
}

/** Default process listing: one `tasklist` call on Windows, one `ps` elsewhere. `run(file, args)` resolves to stdout; injectable. */
export async function listHeavyPrograms(run = async (file, args) => (await execFileAsync(file, args, { windowsHide: true, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 })).stdout, platform = process.platform) {
  try {
    const text = platform === 'win32' ? await run('tasklist', ['/FO', 'CSV', '/NH']) : await run('ps', ['-A', '-o', 'comm=']);
    return classifyPrograms(parseProcessNames(text));
  } catch { return { programs: [], categories: [] }; }
}

/** Whole-machine CPU utilisation in percent between two `os.cpus()` snapshots; undefined when no time passed. */
export function cpuPercent(before, after) {
  const total = (list) => list.reduce((sum, c) => sum + Object.values(c.times).reduce((a, b) => a + b, 0), 0);
  const idle = (list) => list.reduce((sum, c) => sum + c.times.idle, 0);
  const span = total(after) - total(before);
  if (!(span > 0)) return undefined;
  return Math.min(100, Math.max(0, (1 - (idle(after) - idle(before)) / span) * 100));
}

const nearestRank = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];

/** Median and p95 (nearest rank) of the finite readings, rounded to whole percent; undefined for none. */
export function percentStats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? { med: Math.round(nearestRank(sorted, 0.5)), p95: Math.round(nearestRank(sorted, 0.95)), n: sorted.length } : undefined;
}

/**
 * The load record of one run, saved beside its result as `<result>.load.json`. `condition` is the launcher's tag,
 * `programs` and `categories` the union of the listings at start and end.
 */
export function summarizeLoad({ noisy, gpu = [], cpu = [], start = { programs: [], categories: [] }, end = { programs: [], categories: [] } }) {
  const g = percentStats(gpu);
  const c = percentStats(cpu);
  const programs = [...new Set([...start.programs, ...end.programs])].sort();
  const categories = Object.keys(HEAVY_PROGRAMS).filter((k) => start.categories.includes(k) || end.categories.includes(k));
  return {
    condition: noisy ? 'noisy' : 'clean',
    ...(g ? { gpuMedPct: g.med, gpuP95Pct: g.p95, gpuSamples: g.n } : {}),
    ...(c ? { cpuMedPct: c.med, cpuP95Pct: c.p95, cpuSamples: c.n } : {}),
    programs, categories, programsAtStart: start.programs, programsAtEnd: end.programs,
  };
}

/** Name of the load sidecar of a saved result file (`suite@v1/run.json` becomes `suite@v1/run.load.json`). */
export const loadSidecarName = (file) => file.replace(/\.json$/, '.load.json');

/** A reader returning CPU % since its previous call (the first call covers the time since the reader was made). */
export function cpuReader(snapshot = () => cpus()) {
  let last = snapshot();
  return async () => { const now = snapshot(); const value = cpuPercent(last, now); last = now; return value; };
}

/**
 * Samples whole-machine GPU and CPU utilisation every `intervalMs` until `stop()`, which resolves to the readings.
 * `gpu` and `cpu` are injectable async readers.
 */
export function startLoadSampler({ intervalMs = 3000, gpu = gpuUtilOnce, cpu = cpuReader() } = {}) {
  const readings = { gpu: [], cpu: [] };
  let busy = Promise.resolve();
  const tick = () => {
    busy = busy.then(async () => {
      const [g, c] = await Promise.all([gpu(), cpu()]);
      if (Number.isFinite(g)) readings.gpu.push(g);
      if (Number.isFinite(c)) readings.cpu.push(c);
    }).catch(() => {});
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return async function stop() { clearInterval(timer); tick(); await busy; return readings; };
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

/**
 * The first saved row of this suite/version (and, when given, profile and mode) that started at or after `since` (ms).
 * Profile and mode keep a run the owner starts by hand meanwhile (usually `quick`) from being taken for this one.
 */
export function findResult(text, { suite, version, since, profile, mode }) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (profile !== undefined && row.profile !== profile) continue;
    if (mode !== undefined && row.mode !== mode) continue;
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

/**
 * A fresh profile does not carry chrome://flags, so the precise GPU timer flag goes on the command line. The rest keep a
 * window that other windows cover rendering at full rate: without them Windows native occlusion marks it hidden, Chrome
 * stops producing frames and the run never finishes. `--disable-features` is passed once, with every feature joined.
 */
export function chromeArgs(profileDir, url, { profile = 'visible-browser', windowSize } = {}) {
  const disabledFeatures = ['CalculateNativeWinOcclusion'];
  // Headless: no screen to take over, so the window has a fixed size (same pixel count as a headed full-screen run) and
  // Chrome is told to use the real GPU (ANGLE on D3D11) instead of falling back to SwiftShader.
  const size = windowSize ?? HEADLESS_WINDOW;
  const display = isHeadlessProfile(profile)
    ? ['--headless=new', `--window-size=${size.width},${size.height}`, `--force-device-scale-factor=${HEADLESS_WINDOW.scaleFactor}`,
      '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-webgpu']
    : ['--start-fullscreen'];
  return [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', ...display,
    '--enable-webgpu-developer-features', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', `--disable-features=${disabledFeatures.join(',')}`, url];
}

/** A headless run takes over no screen. */
export function isHeadlessProfile(profile) { return profile === 'headless-hardware'; }

/** Does this profile hold back until the owner's "I'm away" switch is on? Visible profiles do; headless does not. */
export function needsAwaySwitch(profile) { return !isHeadlessProfile(profile); }

/** Why a run ended without a saved row. `chromeClosed` is true only when Chrome went away before the launcher closed it. */
export function noResultMessage({ chromeClosed, timeoutMin }) {
  return `${chromeClosed ? 'Chrome closed' : `timed out: no result in ${timeoutMin} min`} before the run was saved`;
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

  // Hold the head of the queue until the owner is away; a run never takes the screen from someone using it.
  const awayUntil = Date.now() + options.awayWaitMin * 60_000;
  if (!needsAwaySwitch(options.profile)) log('headless profile: not waiting for the owner to be away');
  else for (let first = true; ; first = false) {
    const verdict = awayVerdict(readAway());
    if (verdict.ok) { log(verdict.reason); break; }
    if (Date.now() >= awayUntil) { console.error(`[triangular-test-run] owner not away in ${options.awayWaitMin} min: ${verdict.reason}`); return 3; }
    if (first) log(`waiting for the owner to be away: ${verdict.reason}`);
    await sleep(30_000);
  }

  const quietUntil = Date.now() + options.quietWaitMin * 60_000;
  if (options.noisy) log('noisy run: not waiting for a quiet GPU; load is sampled and saved with the result');
  else for (let first = true; ; first = false) {
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
  const programsStart = await listHeavyPrograms();
  const sampler = startLoadSampler();
  log(`opening ${url}`);
  const chrome = spawn(chromePath, chromeArgs(profileDir, url, options), { stdio: 'ignore', windowsHide: isHeadlessProfile(options.profile) });
  let chromeGone = false;
  chrome.on('exit', () => { chromeGone = true; });
  chrome.on('error', () => { chromeGone = true; });

  let row;
  const deadline = Date.now() + options.timeoutMin * 60_000;
  while (Date.now() < deadline && !chromeGone) {
    await sleep(5000);
    try { row = findResult(readFileSync(index, 'utf8'), { suite: options.suite, version: options.version, since, profile: options.profile, mode: options.mode }); } catch { /* no index yet */ }
    if (row) break;
  }
  const readings = await sampler();
  const programsEnd = await listHeavyPrograms();
  const load = summarizeLoad({ noisy: options.noisy, gpu: readings.gpu, cpu: readings.cpu, start: programsStart, end: programsEnd });
  const chromeClosed = chromeGone; // read before closeChrome, which makes the exit handler set it too
  if (!options.keepOpen) {
    closeChrome(chrome);
    await sleep(1000);
    try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* temp folder; the OS cleans it */ }
  }
  if (!row) {
    console.error(`[triangular-test-run] ${noResultMessage({ chromeClosed, timeoutMin: options.timeoutMin })}`);
    return 2;
  }
  try { writeFileSync(join(root, config.outputDir, loadSidecarName(row.file)), JSON.stringify(load, null, 2)); } catch (error) { log(`could not save the load record: ${error?.message ?? error}`); }
  log(`load ${load.condition}: gpu ${load.gpuMedPct ?? 'n/a'}/${load.gpuP95Pct ?? 'n/a'}% cpu ${load.cpuMedPct ?? 'n/a'}/${load.cpuP95Pct ?? 'n/a'}% [${load.categories.join(', ')}]`);
  log(`saved ${row.file}: auto=${row.automatedVerdict} perf=${row.performanceVerdict} status=${row.status}`);
  spawnSync(process.execPath, [fileURLToPath(new URL('./triangular-test-summary.mjs', import.meta.url)), '--suite', options.suite, '--last', '1'],
    { cwd: root, stdio: 'inherit' });
  return row.status === 'completed' && row.automatedVerdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code));
}
