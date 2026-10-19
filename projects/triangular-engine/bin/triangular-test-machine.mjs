// Machine context for timing runs: what the computer was doing while a case was measured. Dev only, local only.
// The page sends prepare/start/stop messages (see `TestSession`); the receiver owns the monitor below.
// `percentile` and `round` come from the receiver (a cycle that is safe: they are only used inside functions).
import { execFile, spawn } from 'node:child_process';
import { cpus as osCpus, freemem as osFreemem } from 'node:os';
import { promisify } from 'node:util';
import { percentile, round } from './triangular-test-receiver.mjs';

const execFileAsync = promisify(execFile);

/**
 * Placeholders. Phase 0 sets them from measured idle readings on the reference machine; until then a warning only
 * marks the run, it never fails it.
 */
export const MACHINE_THRESHOLDS = {
  /** Median GPU utilisation (%) in the preflight window above which the GPU counts as busy before the run. */
  gpuBusyPct: 20,
  /** GPU temperature (C) at or above which the GPU counts as hot before the run. */
  gpuHotC: 80,
  /** `clocks_event_reasons.active` bits that mean the clocks were held down: SW power cap, HW slowdown, SW/HW thermal, power brake. */
  throttleMask: 0xecn,
};

export const GPU_QUERY = 'utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,clocks.sm,pstate,clocks_event_reasons.active';
const MAX_RUNS = 20;

/** `{ n, min, med, p95, max }` over the finite values (nearest rank, as the case summaries), or `undefined`. */
export function distribution(list) {
  const x = list.filter(Number.isFinite).sort((a, b) => a - b);
  if (!x.length) return undefined;
  return { n: x.length, min: round(x[0]), med: round(percentile(x, 0.5)), p95: round(percentile(x, 0.95)), max: round(x.at(-1)) };
}

/** One `nvidia-smi --format=csv,noheader,nounits` line; unsupported columns ("[N/A]") become `undefined`. */
export function parseGpuLine(line) {
  const cells = line.split(',').map((s) => s.trim());
  if (cells.length < 8) return null;
  const num = (s) => (s && Number.isFinite(Number(s)) ? Number(s) : undefined);
  const pstate = /^P(\d+)$/.exec(cells[6]);
  let throttle;
  try { throttle = BigInt(cells[7]); } catch { /* column unsupported by this driver */ }
  return {
    util: num(cells[0]), vramUsedMiB: num(cells[1]), vramTotalMiB: num(cells[2]), tempC: num(cells[3]), powerW: num(cells[4]),
    smClockMHz: num(cells[5]), pstate: pstate ? Number(pstate[1]) : undefined, throttle,
  };
}

/**
 * Samples CPU load and free RAM every `intervalMs`, and GPU state from a looping `nvidia-smi` when it exists.
 * `start()` returns `{ stop(): Promise<capture> }`; `capture` is `{ ms, cpu: [%], ram: [free MiB], gpu: [rows], gpuReason? }`.
 * Any sampler with this shape can be injected into the monitor (the specs do).
 */
export function systemSampler({ gpuIndex = 0, spawnImpl = spawn, cpus = osCpus, freemem = osFreemem, gpuCommand = 'nvidia-smi' } = {}) {
  const times = () => cpus().reduce((a, c) => {
    const t = c.times;
    return { idle: a.idle + t.idle, total: a.total + t.user + t.nice + t.sys + t.idle + t.irq };
  }, { idle: 0, total: 0 });
  return {
    start(intervalMs = 500) {
      const began = performance.now();
      const capture = { ms: 0, cpu: [], ram: [], gpu: [], gpuReason: 'no readings' };
      let previous = times();
      const tick = () => {
        const now = times();
        if (now.total > previous.total) capture.cpu.push(100 * (1 - (now.idle - previous.idle) / (now.total - previous.total)));
        previous = now;
        capture.ram.push(freemem() / (1024 * 1024));
      };
      const timer = setInterval(tick, intervalMs);
      let child;
      try {
        child = spawnImpl(gpuCommand, [`--query-gpu=${GPU_QUERY}`, '--format=csv,noheader,nounits', '-lms', String(intervalMs), '-i', String(gpuIndex)],
          { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        let pending = '';
        child.stdout?.on('data', (chunk) => {
          const lines = (pending + chunk).split(/\r?\n/);
          pending = lines.pop() ?? '';
          for (const text of lines) { const row = parseGpuLine(text); if (row) capture.gpu.push(row); }
        });
        child.on('error', (error) => { capture.gpuReason = error.code === 'ENOENT' ? `${gpuCommand} not found` : `${gpuCommand}: ${error.message}`; });
        child.on('exit', (code) => { if (!capture.gpu.length && code) capture.gpuReason = `${gpuCommand} exited with ${code}`; });
      } catch (error) { capture.gpuReason = `${gpuCommand}: ${error instanceof Error ? error.message : error}`; }
      return {
        async stop() {
          clearInterval(timer);
          capture.ms = Math.round(performance.now() - began);
          try { child?.kill(); } catch { /* already gone */ }
          return capture;
        },
      };
    },
  };
}

/** Compact per-case block: count/min/median/p95/max per field. GPU fields are `gpu: 'unavailable'` when no reading arrived. */
export function summarizeCapture(capture) {
  const block = { ms: capture.ms, cpuPct: distribution(capture.cpu), freeRamMiB: distribution(capture.ram) };
  if (!capture.gpu.length) return { ...block, gpu: 'unavailable', gpuReason: capture.gpuReason };
  const field = (name) => distribution(capture.gpu.map((row) => row[name]).filter((v) => v !== undefined));
  const throttle = capture.gpu.reduce((mask, row) => mask | (row.throttle ?? 0n), 0n);
  const total = capture.gpu.find((row) => row.vramTotalMiB !== undefined)?.vramTotalMiB;
  const gpu = { util: field('util'), vramUsedMiB: field('vramUsedMiB'), vramTotalMiB: total, tempC: field('tempC'),
    powerW: field('powerW'), smClockMHz: field('smClockMHz'), pstate: field('pstate'), throttleReasons: `0x${throttle.toString(16)}` };
  return { ...block, gpu: Object.fromEntries(Object.entries(gpu).filter(([, v]) => v !== undefined)) };
}

/** Windows power, the heaviest processes by CPU during one second, and GPU memory per process when nvidia-smi lists it. */
export async function systemProbe({ platform = process.platform, exec = execFileAsync, gpuCommand = 'nvidia-smi' } = {}) {
  const probe = { platform, power: { source: 'unchecked' }, processes: [], gpuApps: [] };
  const options = { timeout: 15_000, windowsHide: true, encoding: 'utf8' };
  const jobs = [];
  if (platform === 'win32') {
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      '$b = Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty BatteryStatus',
      '$p1 = @{}; Get-Process | ForEach-Object { $p1[$_.Id] = $_.CPU }',
      'Start-Sleep -Milliseconds 1000',
      '$top = @(Get-Process | Where-Object { $p1.ContainsKey($_.Id) } | ForEach-Object { [pscustomobject]@{ pid=$_.Id; name=$_.ProcessName; cpuS=[math]::Round($_.CPU - $p1[$_.Id], 3) } } | Where-Object { $_.cpuS -gt 0 } | Sort-Object cpuS -Descending | Select-Object -First 5)',
      '[pscustomobject]@{ batteryStatus=$b; top=$top } | ConvertTo-Json -Compress -Depth 4',
    ].join('; ');
    jobs.push(exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], options).then(({ stdout }) => {
      const data = JSON.parse(stdout);
      // Win32_Battery.BatteryStatus: 1 discharging, 4 low, 5 critical; the other codes are on AC. No battery object: a desktop.
      const status = data.batteryStatus;
      probe.power.source = status == null ? 'ac' : [1, 4, 5].includes(status) ? 'battery' : 'ac';
      probe.power.battery = status != null;
      // cpuS over a one-second window is CPU-seconds, so it is a share of one core.
      probe.processes = (data.top ?? []).map((p) => ({ pid: p.pid, name: p.name, cpuCoreShare: p.cpuS }));
    }).catch((error) => { probe.power.source = 'unknown'; probe.error = `power/process probe failed: ${error.message}`; }));
    jobs.push(exec('powercfg', ['/getactivescheme'], options).then(({ stdout }) => {
      probe.power.scheme = /\(([^)]+)\)\s*$/.exec(stdout.trim())?.[1] ?? stdout.trim();
    }).catch(() => {}));
  }
  jobs.push(exec(gpuCommand, ['--query-compute-apps=pid,process_name,used_gpu_memory', '--format=csv,noheader,nounits'], options).then(({ stdout }) => {
    probe.gpuApps = stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((s) => s.trim())).map(([pid, name, mem]) => ({
      pid: Number(pid), name: name?.split(/[\\/]/).pop(), memMiB: Number.isFinite(Number(mem)) ? Number(mem) : undefined,
    })).sort((a, b) => (b.memMiB ?? -1) - (a.memMiB ?? -1)).slice(0, 5);
  }).catch(() => {}));
  await Promise.all(jobs);
  return probe;
}

/** Warnings mark a run; they never fail it. */
export function machineWarnings(preflight, cases, thresholds = MACHINE_THRESHOLDS) {
  const out = new Set();
  if (preflight?.power?.source === 'battery') out.add('on-battery');
  const idle = preflight?.idle?.gpu;
  if (idle && typeof idle === 'object') {
    if ((idle.util?.med ?? 0) > thresholds.gpuBusyPct) out.add('gpu-busy-before-start');
    if ((idle.tempC?.max ?? 0) >= thresholds.gpuHotC) out.add('gpu-hot-before-start');
  }
  if (preflight?.overlapped) out.add('preflight-overlapped-measurement');
  for (const block of Object.values(cases ?? {})) {
    if (block.gpu && typeof block.gpu === 'object' && (BigInt(block.gpu.throttleReasons ?? 0) & thresholds.throttleMask)) out.add('gpu-throttled');
  }
  return [...out];
}

const caseKey = (scenarioId, repetition) => `${scenarioId}#${repetition}`;

/**
 * Holds machine data per run while the page measures. `prepare` runs the slow preflight once; `start`/`stop` bracket
 * one case's sampling; `finish(runId)` stops anything still sampling and returns what was collected.
 */
export function createMachineMonitor({ sampler = systemSampler(), probe = systemProbe, intervalMs = 500, maxCaseMs = 300_000, preflightMs = 1000 } = {}) {
  const runs = new Map();
  const runOf = (runId) => {
    let run = runs.get(runId);
    if (!run) {
      run = { preflight: undefined, settled: false, active: new Map(), cases: {}, pending: new Set() };
      runs.set(runId, run);
      while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
    }
    return run;
  };
  const prepare = (runId) => {
    const run = runOf(runId);
    if (run.preflight) return run.preflight;
    run.preflight = (async () => {
      const handle = sampler.start(Math.min(intervalMs, 250));
      const [system] = await Promise.all([probe(), new Promise((resolve) => setTimeout(resolve, preflightMs))]);
      return { at: new Date().toISOString(), ...system, idle: summarizeCapture(await handle.stop()) };
    })().catch((error) => ({ error: String(error?.message ?? error) })).then((value) => { run.settled = true; run.value = value; return value; });
    return run.preflight;
  };
  const stop = (runId, key) => {
    const run = runs.get(runId);
    const entry = run?.active.get(key);
    if (!entry) return Promise.resolve();
    run.active.delete(key);
    clearTimeout(entry.timer);
    const work = entry.handle.stop().then((capture) => { run.cases[key] = summarizeCapture(capture); }, (error) => {
      run.cases[key] = { gpu: 'unavailable', gpuReason: `sampler failed: ${error?.message ?? error}` };
    }).finally(() => run.pending.delete(work));
    run.pending.add(work);
    return work;
  };
  return {
    prepare,
    start({ runId, scenarioId, repetition }) {
      const run = runOf(runId);
      const key = caseKey(scenarioId, repetition);
      void stop(runId, key);
      if (!run.preflight) prepare(runId);
      if (!run.settled) run.overlapped = true;
      const handle = sampler.start(intervalMs);
      // A lost stop message must not leave nvidia-smi running.
      const timer = setTimeout(() => void stop(runId, key), maxCaseMs);
      timer.unref?.();
      run.active.set(key, { handle, timer });
    },
    stop: ({ runId, scenarioId, repetition }) => stop(runId, caseKey(scenarioId, repetition)),
    /** Stops anything still sampling, then returns `{ preflight, warnings, cases }`, or `undefined` for a run with no messages. */
    async finish(runId) {
      const run = runs.get(runId);
      if (!run) return undefined;
      await Promise.all([...run.active.keys()].map((key) => stop(runId, key)));
      await Promise.all([...run.pending]);
      const preflight = run.preflight ? { ...(await run.preflight), overlapped: run.overlapped || undefined } : undefined;
      return { preflight, cases: run.cases, warnings: machineWarnings(preflight, run.cases) };
    },
  };
}

/**
 * Adds `machine` to the saved result (per case, plus the preflight) and returns the tiny summary for the index line.
 * Process names live only in the saved result file.
 */
export function attachMachine(result, machine) {
  if (!machine) return { result, index: undefined };
  const warnings = [...machine.warnings];
  if (result.suite?.purpose === 'performance' && !result.environment?.['gpu.vendor']) warnings.push('gpu-adapter-unrecorded');
  const cases = (result.cases ?? []).map((c) => {
    const block = machine.cases[caseKey(c.scenario?.id, c.repetition)];
    return block ? { ...c, machine: block } : c;
  });
  const blocks = Object.values(machine.cases);
  const peak = (pick) => { const v = blocks.map(pick).filter(Number.isFinite); return v.length ? Math.max(...v) : undefined; };
  const index = {
    warnings, cases: blocks.length,
    cpuMedPct: peak((b) => b.cpuPct?.med),
    gpuUtilMedPct: peak((b) => b.gpu?.util?.med),
    gpuTempMaxC: peak((b) => b.gpu?.tempC?.max),
    gpuSampling: blocks.length ? (blocks.some((b) => typeof b.gpu === 'object') ? 'ok' : 'unavailable') : undefined,
  };
  return { result: { ...result, cases, machine: { warnings, preflight: machine.preflight } }, index };
}
