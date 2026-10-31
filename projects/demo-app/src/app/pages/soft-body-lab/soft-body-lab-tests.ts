import type { TestScenario, TestSuite } from 'triangular-engine/testing';

/** Which official Jolt.js page the lab reproduces. */
export type SoftBodyExampleId = 'cloth' | 'pressure';

export interface SoftBodyLabSettings {
  readonly example: SoftBodyExampleId;
  /** Seed of the ten cloth-drop spheres; the official page uses `Math.random()`. */
  readonly seed: number;
}

const BASE: SoftBodyLabSettings = { example: 'cloth', seed: 1337 };

function scenario(
  id: string, label: string, durationMs: number, quickMs: number,
  overrides: Partial<SoftBodyLabSettings>, warmupMs = 1200,
): TestScenario<SoftBodyLabSettings> {
  return {
    id, label, durationMs, quickMs, warmupMs,
    settings: { ...BASE, ...overrides },
    // A drop runs for a fixed length; it never "settles" in the quick-mode sense.
    phases: { window: { kind: 'scripted' } },
  };
}

/**
 * Parity suite: the two official Jolt.js soft-body pages, rebuilt with `<joltSoftBody>`.
 *
 * - `soft/soft_body.html`: 40 x 40 pinned cloth with ten 100 kg spheres dropped on it.
 * - `soft/soft_sphere_pressure.html`: eleven 2 m spheres, pressure 0 .. 10 000.
 *
 * The checks are sanity gates on the shape and contact behaviour, not a pixel comparison.
 * `requiresVisualReview` because matching the official pages is a look-at-it judgement.
 */
export const SOFT_BODY_LAB_TEST_HISTORY: readonly TestSuite<SoftBodyLabSettings>[] = [
  {
    id: 'jolt-soft-body-examples',
    version: 1,
    title: 'Official Jolt.js soft-body examples: cloth + spheres, pressure spheres',
    purpose: 'functional',
    requiresVisualReview: true,
    scenarios: [
      scenario('cloth-spheres', 'Cloth 40 x 40 with ten 100 kg spheres', 6000, 3500, { example: 'cloth' }),
      scenario('pressure-row', 'Eleven spheres, pressure 0 to 10 000', 5000, 3000, { example: 'pressure' }),
    ],
  },
];

