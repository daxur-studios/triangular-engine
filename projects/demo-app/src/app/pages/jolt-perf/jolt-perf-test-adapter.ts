import {
  describeTimer,
  metric,
  type TestContext,
  type TestMetric,
  type TestObservation,
  type TestRunAdapter,
  type TestScenario,
  type TestSetting,
} from 'triangular-engine/testing';
import { TerrainJoltColliderAdapter, type IJoltMetadata } from 'triangular-engine/jolt';
import { MESH_PATCH_REPETITIONS, type JoltPerfSettings } from './jolt-perf-cases';
import {
  buildHeightGrid, classifyPrecision, float32Ulp, HEIGHT_GRID_SIDE, PRECISION_PROBES, PRECISION_VERDICT_PROBE, readbackErrorM,
} from './jolt-perf-math';
import { heightGridPatch, probePrecisionReadback } from './jolt-perf-probes';

/** What the jolt-perf page exposes to its adapter: its own setters plus read-only probes of the Jolt world. */
export interface JoltPerfTestHost {
  read(): JoltPerfSettings;
  apply(settings: JoltPerfSettings): void;
  /** The world's metadata once the physics component has created it. */
  metadata(): IJoltMetadata | undefined;
  /** Dynamic bodies the world holds now (boxes, or compound bodies; the ground is static). */
  dynamicBodies(): number;
  /** Calls `callback` once per rendered frame, after the frame's physics ticks. Returns the unsubscribe. */
  onFrame(callback: () => void): () => void;
  /** Calls `callback` before each Jolt step (one per substep). Returns the unsubscribe. */
  onSubstep(callback: () => void): () => void;
  /** The physics time the engine recorded for the latest frame, in ms. */
  physicsMs(): number;
  /** Physics steps that threw since the page loaded. */
  physicsFaults(): number;
}

const READY_TIMEOUT_MS = 10_000;
/** `performance.now()` is coarsened to 0.1 ms in this browser; the physics time is read through it. */
const TIMER_STEP_MS = 0.1;

async function waitForBodies(host: JoltPerfTestHost, expected: number, context: TestContext): Promise<void> {
  const began = performance.now();
  while (host.dynamicBodies() !== expected && performance.now() - began < READY_TIMEOUT_MS) {
    await context.wait(16);
  }
}

/**
 * Frame-paced physics step cost: per rendered frame the engine's recorded physics time, the substeps that frame ran and the
 * time per substep (frame time over its substeps). Samples come only from frames that stepped.
 */
async function measureSteps(
  host: JoltPerfTestHost, scenario: TestScenario<JoltPerfSettings>, context: TestContext,
): Promise<TestObservation> {
  const frameMs: number[] = [];
  const physicsFrameMs: number[] = [];
  const perSubstepMs: number[] = [];
  const substepCounts: number[] = [];
  let substeps = 0;
  let lastFrame = performance.now();
  const stopSubsteps = host.onSubstep(() => { substeps++; });
  const stopFrames = host.onFrame(() => {
    const now = performance.now();
    frameMs.push(now - lastFrame);
    lastFrame = now;
    const stepped = substeps;
    substeps = 0;
    if (stepped === 0) return;
    const ms = host.physicsMs();
    physicsFrameMs.push(ms);
    substepCounts.push(stepped);
    perSubstepMs.push(ms / stepped);
  });
  const faultsBefore = host.physicsFaults();
  try {
    await context.measureWindow(scenario, [{ name: 'physicsMs', samples: () => physicsFrameMs, resolution: TIMER_STEP_MS }]);
  } finally {
    stopSubsteps();
    stopFrames();
  }
  const expected = scenario.settings.count;
  const bodies = host.dynamicBodies();
  const faults = host.physicsFaults() - faultsBefore;
  const source = 'fpsController.physicsTime, read in the engine beforeRender$ of each frame that ran Jolt steps (all substeps plus the transform sync)';
  const metrics: TestMetric[] = [
    metric('physicsMsPerFrame', 'ms', source, physicsFrameMs),
    metric('physicsMsPerSubstep', 'ms', `${source}, divided by the substeps that frame ran`, perSubstepMs),
    metric('substepsPerFrame', 'steps', 'Jolt Step calls per rendered frame, counted before each Step', substepCounts),
    metric('frameMs', 'ms', 'wall time between consecutive rendered frames, in the window', frameMs.slice(1), { optional: true }),
  ];
  return {
    metrics,
    checks: [
      { name: 'dynamic bodies created equal the case count', passed: bodies === expected, detail: `${bodies} of ${expected}` },
      { name: 'physics stepped in the window', passed: physicsFrameMs.length > 0, detail: `${physicsFrameMs.length} frames stepped` },
      { name: 'no physics step faulted', passed: faults === 0, detail: `${faults} faults` },
    ],
    details: { bodies, expectedBodies: expected, steppedFrames: physicsFrameMs.length },
    limitations: ['Per-substep time is the frame counter divided by its substeps, not a timed Step call.'],
  };
}

/** Create and destroy of one static triangle-mesh collider from the 64x64 height grid, `MESH_PATCH_REPETITIONS` times. */
async function measureMeshPatch(host: JoltPerfTestHost, context: TestContext): Promise<TestObservation> {
  const metadata = host.metadata();
  if (!metadata) throw new Error('The Jolt world does not exist yet');
  const collider = new TerrainJoltColliderAdapter(metadata);
  const grid = buildHeightGrid(HEIGHT_GRID_SIDE);
  const patch = heightGridPatch(grid);
  const samples: number[] = [];
  let resident = 0;
  for (let rep = 0; rep < MESH_PATCH_REPETITIONS; rep++) {
    context.signal.throwIfAborted();
    const key = `jolt-perf-patch-${rep}`;
    const began = performance.now();
    collider.add({ key, mesh: patch });
    collider.remove(key);
    samples.push(performance.now() - began);
    resident = collider.residentCount;
    await context.wait(0);
  }
  const triangles = grid.indices.length / 3;
  return {
    metrics: [metric(
      'meshPatchCreateDestroyMs', 'ms',
      `performance.now around TerrainJoltColliderAdapter.add + remove of a ${grid.side}x${grid.side} height grid (${triangles} triangles), one sample per repetition`,
      samples,
    )],
    checks: [{ name: 'no collider left resident after the cycles', passed: resident === 0, detail: `${resident} resident` }],
    details: { repetitions: MESH_PATCH_REPETITIONS, triangles, vertices: grid.side * grid.side },
  };
}

/** Writes far positions into bodies and reads them back through the engine; the errors show the float precision of the build. */
async function measurePrecision(host: JoltPerfTestHost, context: TestContext): Promise<TestObservation> {
  const metadata = host.metadata();
  if (!metadata) throw new Error('The Jolt world does not exist yet');
  const errors: number[] = [];
  const details: Record<string, TestSetting> = {};
  let verdict: string = 'could not determine';
  for (const probe of PRECISION_PROBES) {
    context.signal.throwIfAborted();
    const read = probePrecisionReadback(metadata, probe);
    const error = readbackErrorM(probe.x, read);
    errors.push(error);
    details[`${probe.label}.written`] = probe.x;
    details[`${probe.label}.read`] = read;
    details[`${probe.label}.errorM`] = error;
    details[`${probe.label}.ulpM`] = float32Ulp(probe.x);
    if (probe.label === PRECISION_VERDICT_PROBE) verdict = classifyPrecision(probe.x, read);
    await context.wait(0);
  }
  details['precisionVerdict'] = verdict;
  return {
    metrics: [metric('readbackErrorM', 'm', 'read-back position minus written position, one sample per precision probe (labels in details)', errors)],
    checks: [{ name: 'every probe read back a finite position', passed: errors.every(Number.isFinite) }],
    details,
    limitations: ['A read-back error is the storage precision of this build, not a physics result.'],
  };
}

/** The adapter of the jolt-perf suite; `measure` dispatches on the case's probe. */
export function createJoltPerfTestAdapter(host: JoltPerfTestHost): TestRunAdapter<JoltPerfSettings, JoltPerfSettings> {
  return {
    windowModes: true,
    capture: () => host.read(),
    apply: (scenario) => host.apply(scenario.settings),
    ready: async (context, scenario) => {
      if (scenario.settings.probe !== 'steps') return;
      await waitForBodies(host, scenario.settings.count, context);
    },
    measure: (scenario, context) => {
      if (scenario.settings.probe === 'steps') return measureSteps(host, scenario, context);
      if (scenario.settings.probe === 'mesh-patch') return measureMeshPatch(host, context);
      return measurePrecision(host, context);
    },
    restore: (snapshot) => host.apply(snapshot),
    environment: () => {
      const timer = describeTimer();
      return { 'timer.resolutionMs': timer.resolutionMs, 'timer.source': timer.source, 'jolt.substepSeconds': 1 / 240 };
    },
  };
}
