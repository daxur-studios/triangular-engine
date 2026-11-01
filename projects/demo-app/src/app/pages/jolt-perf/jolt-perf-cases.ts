import type { TestScenario, TestSuite } from 'triangular-engine/testing';

/** What the page's Jolt world holds for a case: nothing, dynamic boxes, or dynamic four-box compound bodies. */
export type JoltPerfScene = 'empty' | 'boxes' | 'compound';

/**
 * What a case measures: the physics step of the scene (`steps`), the create and destroy of a static triangle-mesh
 * collider (`mesh-patch`), or the read-back precision of bodies placed far from the origin (`precision`).
 */
export type JoltPerfProbe = 'steps' | 'mesh-patch' | 'precision';

/** Everything a case sets; also the snapshot a run restores. Plain JSON. */
export interface JoltPerfSettings {
  readonly scene: JoltPerfScene;
  /** Dynamic bodies the scene creates (boxes, or compound bodies); 0 for the other cases. */
  readonly count: number;
  readonly probe: JoltPerfProbe;
}

/** Repetitions of the static mesh patch create and destroy. */
export const MESH_PATCH_REPETITIONS = 20;

const STEP_WARMUP_MS = 1500;
const STEP_WINDOW_MS = 4000;
const STEP_QUICK_MS = 2000;
/** The probe cases run no timed window; this is only the nominal length the run timeout counts. */
const PROBE_NOMINAL_MS = 1000;

function stepCase(id: string, label: string, settings: JoltPerfSettings): TestScenario<JoltPerfSettings> {
  return { id, label, settings, warmupMs: STEP_WARMUP_MS, durationMs: STEP_WINDOW_MS, quickMs: STEP_QUICK_MS };
}

function probeCase(id: string, label: string, settings: JoltPerfSettings): TestScenario<JoltPerfSettings> {
  return { id, label, settings, durationMs: PROBE_NOMINAL_MS };
}

/**
 * Suite `jolt-perf` v1: record-only numbers, no budgets and no baseline. The step cases stand on a static ground box with
 * gravity on; each measures the physics tick per rendered frame over a fixed window after a warm-up.
 */
const JOLT_PERF_V1: TestSuite<JoltPerfSettings> = {
  id: 'jolt-perf',
  version: 1,
  title: 'Jolt physics: step cost per frame, static mesh patch create and destroy, and far-position precision',
  purpose: 'performance',
  requiresVisualReview: false,
  scenarios: [
    stepCase('step-bodies-1', '1 dynamic box', { scene: 'boxes', count: 1, probe: 'steps' }),
    stepCase('step-bodies-10', '10 dynamic boxes', { scene: 'boxes', count: 10, probe: 'steps' }),
    stepCase('step-bodies-100', '100 dynamic boxes', { scene: 'boxes', count: 100, probe: 'steps' }),
    stepCase('step-compound-10', '10 compound bodies, 4 boxes each', { scene: 'compound', count: 10, probe: 'steps' }),
    probeCase('static-mesh-patch', `static mesh patch, 64x64 height grid, create + destroy x${MESH_PATCH_REPETITIONS}`, {
      scene: 'empty', count: 0, probe: 'mesh-patch',
    }),
    probeCase('precision-far', 'far-position read-back (20000 m, 1e7 m)', { scene: 'empty', count: 0, probe: 'precision' }),
  ],
};

/** Oldest first; the final entry is "Run latest test". */
export const JOLT_PERF_TEST_HISTORY: readonly TestSuite<JoltPerfSettings>[] = [JOLT_PERF_V1];

/** The scene a case starts from when the run restores or the page first loads. */
export const JOLT_PERF_IDLE_SETTINGS: JoltPerfSettings = { scene: 'empty', count: 0, probe: 'steps' };
