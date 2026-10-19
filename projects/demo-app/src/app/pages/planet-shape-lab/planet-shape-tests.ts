import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import { BODIES, FIXED_SEED, type BodyId } from './planet-shape-config';
import type { CameraPoseId } from './planet-shape-camera';
import { defaultFeatureState, type FeatureState } from './planet-shape-features';

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
}

export const PLANET_SHAPE_DEFAULTS: PlanetShapeTestSettings = {
  kind: 'sphere', seed: FIXED_SEED, bodyId: '600km', poseId: 'orbit', spinWarp: 1000, spinAngleDeg: 0, features: defaultFeatureState(),
};

const WARMUP_MS = 1500;
const DURATION_MS = 5000;

function scenario(id: string, label: string, settings: Partial<PlanetShapeTestSettings>): TestScenario<PlanetShapeTestSettings> {
  return { id, label, durationMs: DURATION_MS, warmupMs: WARMUP_MS, settings: { ...PLANET_SHAPE_DEFAULTS, ...settings } };
}

const POSES = ['orbit', 'ground'] as const;

/** Append new suites and versions at the end; a shared id/version keeps its meaning. */
export const PLANET_SHAPE_TEST_HISTORY: readonly TestSuite<PlanetShapeTestSettings>[] = [
  {
    id: 'planet-shape-baseline', version: 1,
    title: 'Plain sphere baseline: noise floor, orbit and ground at three body sizes',
    purpose: 'performance',
    // Plan 055 D1: timings count only on the reference machine's NVIDIA adapter, not the integrated GPU.
    expectedGpuVendor: 'nvidia',
    scenarios: [
      scenario('empty-frame', 'Empty frame (noise floor)', { kind: 'empty' }),
      ...BODIES.flatMap((body) => POSES.map((pose) =>
        scenario(`plain-sphere-${pose}-${body.id}`, `Plain sphere, ${pose}, ${body.label}`, { bodyId: body.id, poseId: pose }))),
      scenario('empty-frame-after', 'Empty frame again (did the machine drift?)', { kind: 'empty' }),
    ],
  },
];
