import type { TestBaseline, TestScenario, TestSuite } from 'triangular-engine/testing';
import baselineV1 from './planet-shape-baseline.v1.json';
import { BODIES, FIXED_SEED, type BodyId } from './planet-shape-config';
import type { CameraPoseId } from './planet-shape-camera';
import { defaultFeatureState, withFeature, type FeatureState } from './planet-shape-features';

/** Fully resolved, so a rerun cannot inherit anything from the manual controls. */
export interface PlanetShapeTestSettings {
  /** `empty` draws nothing at all: the noise floor of the machine, browser and renderer. */
  readonly kind: 'empty' | 'sphere';
  readonly seed: number;
  readonly bodyId: BodyId;
  readonly poseId: CameraPoseId;
  /** Time warp of the body spin; 0 = paused. */
  readonly spinWarp: number;
  readonly spinAngleDeg: number;
  readonly features: FeatureState;
  /** Sphere (0) to flat map (1): a visual transform only, applied by the engine's `planetMorphGraph`. */
  readonly morph: number;
}

export const PLANET_SHAPE_DEFAULTS: PlanetShapeTestSettings = {
  kind: 'sphere', seed: FIXED_SEED, bodyId: '600km', poseId: 'orbit', spinWarp: 1000, spinAngleDeg: 0, features: defaultFeatureState(), morph: 0,
};

const WARMUP_MS = 1500;
const DURATION_MS = 5000;

/**
 * Whole-frame GPU time (`gpuPassTotal`, p95) limits in ms, from Plan 055's frame budget (6.25 ms at 160 fps; terrain
 * incl. shadows <= 2.0 ms). The quiet standard run of 2026-10-20 measured a plain sphere at 0.09-0.14 ms and the empty
 * frame at 0.046 ms, so these are guards against a broken measurement or a gross regression, not targets; the baseline
 * catches smaller changes. Judgement changes, not the experiment, so the suite version stays 1.
 */
const SPHERE_GPU_P95_MS = 0.5;
const EMPTY_GPU_P95_MS = 0.2;

function scenario(id: string, label: string, settings: Partial<PlanetShapeTestSettings>): TestScenario<PlanetShapeTestSettings> {
  return { id, label, durationMs: DURATION_MS, warmupMs: WARMUP_MS, settings: { ...PLANET_SHAPE_DEFAULTS, ...settings } };
}

/** A scenario of the baseline suite: `scenario` plus its GPU budget. The A/B suite has none (it compares arms). */
function budgeted(id: string, label: string, settings: Partial<PlanetShapeTestSettings>): TestScenario<PlanetShapeTestSettings> {
  const p95 = settings.kind === 'empty' ? EMPTY_GPU_P95_MS : SPHERE_GPU_P95_MS;
  return { ...scenario(id, label, settings), budgets: { gpuPassTotal: { p95 } } };
}

const POSES = ['orbit', 'ground'] as const;
/** Morph values of the morph suite; ids use the percent so they contain no dot. */
const MORPH_VALUES = [0, 0.5, 1] as const;
/** Rounds per arm of an A/B suite: `compareAblation` needs two to measure noise; three survive one bad round. */
const AB_ROUNDS = 3;

/** Alternating rounds A (shadows off), B (shadows on), A, B, ... of one pose, as one ablation group. */
function shadowRounds(group: string, label: string, settings: Partial<PlanetShapeTestSettings>): TestScenario<PlanetShapeTestSettings>[] {
  return Array.from({ length: AB_ROUNDS * 2 }, (_, index) => {
    const arm = index % 2 === 0 ? 'A' : 'B';
    const round = Math.floor(index / 2) + 1;
    const state = arm === 'A' ? 'off' : 'on';
    const features = withFeature(PLANET_SHAPE_DEFAULTS.features, 'shadows', arm === 'B');
    return { ...scenario(`${group}-shadows-${state}-${round}`, `${label}, shadows ${state}, round ${round}`, { ...settings, features }),
      ablation: { group, arm } };
  });
}

/** Append new suites and versions at the end; a shared id/version keeps its meaning. */
export const PLANET_SHAPE_TEST_HISTORY: readonly TestSuite<PlanetShapeTestSettings>[] = [
  {
    id: 'planet-shape-baseline', version: 1,
    title: 'Plain sphere baseline: noise floor, orbit and ground at three body sizes',
    purpose: 'performance',
    // Plan 055 D1: timings count only on the reference machine's NVIDIA adapter, not the integrated GPU.
    expectedGpuVendor: 'nvidia',
    // Quiet standard run of 2026-10-20 21:57 on the RTX 3080, made with
    // `npm run test:baseline -- <result.json> --metrics gpuPassTotal,gpuScenePass,gpuOutputPass`. Left out: frameInterval
    // (the display refresh cap, not a cost) and the CPU submit timer (too noisy).
    baseline: baselineV1 as TestBaseline,
    scenarios: [
      budgeted('empty-frame', 'Empty frame (noise floor)', { kind: 'empty' }),
      ...BODIES.flatMap((body) => POSES.map((pose) =>
        budgeted(`plain-sphere-${pose}-${body.id}`, `Plain sphere, ${pose}, ${body.label}`, { bodyId: body.id, poseId: pose }))),
      budgeted('empty-frame-after', 'Empty frame again (did the machine drift?)', { kind: 'empty' }),
    ],
  },
  {
    id: 'planet-shape-morph', version: 1,
    title: 'Morph: plain sphere at morph 0, 0.5 and 1 (sphere, half-bent, flat map) at orbit and ground, 600 km',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // No baseline yet: record one from the owner's first quiet standard run with `npm run test:baseline`. Morph 0 is the
    // control: the same sphere as the baseline suite, now through the engine's morph graph. Shadows stay off (the sphere
    // does not cast while morphed), so the cases differ only in the vertex stage. The pose rides the morph
    // (`resolveCameraView`), so the ground cases stay 2 m over the surface at every morph.
    scenarios: MORPH_VALUES.flatMap((morph) => POSES.map((pose) =>
      budgeted(`morph-${Math.round(morph * 100).toString().padStart(3, '0')}-${pose}-600km`,
        `Plain sphere, morph ${morph}, ${pose}, 600 km`, { bodyId: '600km', poseId: pose, morph }))),
  },
  {
    id: 'planet-shape-shadows-ab', version: 1,
    title: 'Shadows A/B: plain sphere with shadows off (A) and on (B) in alternating rounds',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // The whole frame says what shadows cost; the scene pass alone shows the shadow lookups in the planet's shading.
    ablation: { feature: 'shadows', metrics: ['gpuPassTotal', 'gpuScenePass'] },
    scenarios: [
      ...shadowRounds('orbit-600km', 'Orbit, 600 km', { bodyId: '600km', poseId: 'orbit' }),
      ...shadowRounds('ground-600km', 'Ground, 600 km', { bodyId: '600km', poseId: 'ground' }),
    ],
  },
];
