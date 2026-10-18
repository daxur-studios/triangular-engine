import type { TestScenario, TestSuite } from 'triangular-engine/testing';

export type ExtensionsVec3 = readonly [number, number, number];

/**
 * Fully resolved scenario inputs: every control the page offers that changes what is drawn, plus the camera as
 * plain numbers. `orbit` revolves the camera round +Y about `cameraTarget` from `cameraPosition`, keeping its
 * distance and height, over the scenario's `durationMs`.
 */
export interface ExtensionsTestSettings {
  readonly kind: 'static' | 'orbit';
  readonly road: boolean;
  readonly eclipse: boolean;
  readonly lights: boolean;
  /** Sun longitude, degrees round +Y (0 = +Z, the camera side; 180 = the night side faces the camera). */
  readonly sunDegrees: number;
  /** Moon offset from the sun axis, degrees (0 puts it between the sun and the +Z side). */
  readonly moonDegrees: number;
  readonly cameraPosition: ExtensionsVec3;
  readonly cameraTarget: ExtensionsVec3;
  /** Orbit sweep in degrees; 0 for a static scenario. */
  readonly orbitSweepDegrees: number;
  /** Pointer input is off during a run so a person cannot fight the scripted pose. */
  readonly controls: { readonly enabled: boolean; readonly damping: boolean };
}

/** The page's initial camera (`raycastOrbitControls [cameraPosition]` / `[target]`), written out so a retained suite never drifts. */
export const EXTENSIONS_HOME_CAMERA: ExtensionsVec3 = [0, 0.6, 3.2];
export const EXTENSIONS_HOME_TARGET: ExtensionsVec3 = [0, 0, 0];

const BASE: ExtensionsTestSettings = {
  kind: 'static', road: true, eclipse: true, lights: true, sunDegrees: 0, moonDegrees: 0,
  cameraPosition: EXTENSIONS_HOME_CAMERA, cameraTarget: EXTENSIONS_HOME_TARGET, orbitSweepDegrees: 0,
  controls: { enabled: false, damping: false },
};

function scenario(
  id: string, label: string, durationMs: number, warmupMs: number, overrides: Partial<ExtensionsTestSettings>,
): TestScenario<ExtensionsTestSettings> {
  return { id, label, durationMs, warmupMs, settings: { ...BASE, ...overrides } };
}

const ORBIT = { kind: 'orbit', orbitSweepDegrees: 360 } as const;

/** Append new suites/versions at the end; Run latest resolves the final entry once at launch. */
export const EXTENSIONS_TEST_HISTORY: readonly TestSuite<ExtensionsTestSettings>[] = [
  {
    id: 'planet-material-extensions-features', version: 1,
    title: 'Extension slots: every feature on/off, eclipse and night geometry, camera orbit',
    purpose: 'functional', requiresVisualReview: true,
    scenarios: [
      scenario('baseline-day', 'All features on, sun on the camera side', 400, 0, {}),
      scenario('plain', 'No extension slots (plain day/night sphere)', 400, 0, { road: false, eclipse: false, lights: false }),
      scenario('road-only', 'Road layer only', 400, 0, { eclipse: false, lights: false }),
      scenario('eclipse-total', 'Moon eclipse only, moon between sun and camera side', 400, 0, { road: false, lights: false }),
      scenario('eclipse-offset', 'Moon eclipse only, moon moved 40 degrees off the sun axis', 400, 0, { road: false, lights: false, moonDegrees: 40 }),
      scenario('night-lights', 'City lights only, night side facing the camera', 400, 0, { road: false, eclipse: false, sunDegrees: 180 }),
      scenario('orbit-all', 'All features on, camera orbit', 1500, 0, { ...ORBIT }),
    ],
  },
  {
    id: 'planet-material-extensions-cost', version: 1,
    title: 'Extension slot cost: baseline, one slot removed at a time, plain, and a camera orbit',
    purpose: 'performance', requiresVisualReview: true,
    scenarios: [
      scenario('baseline-day', 'All features on, day side', 3000, 1000, {}),
      scenario('baseline-night', 'All features on, night side facing the camera', 3000, 1000, { sunDegrees: 180 }),
      scenario('no-road', 'Without the road layer', 3000, 1000, { road: false }),
      scenario('no-eclipse', 'Without the moon eclipse', 3000, 1000, { eclipse: false }),
      scenario('no-lights', 'Without city lights', 3000, 1000, { lights: false }),
      scenario('plain', 'No extension slots', 3000, 1000, { road: false, eclipse: false, lights: false }),
      scenario('orbit-all', 'All features on, 360 degree camera orbit', 6000, 1000, { ...ORBIT }),
      scenario('orbit-plain', 'No extension slots, 360 degree camera orbit', 6000, 1000, { ...ORBIT, road: false, eclipse: false, lights: false }),
    ],
  },
];
