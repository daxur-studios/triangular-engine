import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import type { PlanetMotion, PlanetPoseId } from './planet-camera';

/** Everything a planet-scene case sets; also the snapshot a run restores. Plain JSON. */
export interface PlanetSceneTestSettings {
  readonly pose: PlanetPoseId;
  /** `<planetTerrain>` is in the scene. */
  readonly terrain: boolean;
  /**
   * `<planetAtmosphere [enabled]>`: off hides the sky and takes the lighting and haze off the terrain without a recompile,
   * so the cost of the air is the difference between a case and its `-atmosphere-off` partner.
   */
  readonly atmosphere: boolean;
  /**
   * `<planet [morph]>`: 0 the globe, 1 the flat map. The terrain bends into the map; the pole fan draws a flat colour only;
   * the atmosphere and the clouds do not morph yet, so above 0 the sky is the globe's sky.
   */
  readonly morph: number;
  /**
   * A scripted camera runs during the window instead of a still pose: `descent` flies orbit to the 2 m eye over one ground
   * point; `yaw360` holds the ground pose and turns the heading once round; `morphSweep` holds the orbit pose and sweeps the
   * morph 0 to 1 and back to 0.
   */
  readonly motion?: PlanetMotion;
}

/** The scene as a game would run it: terrain and atmosphere on, the globe. */
export const DEFAULT_PLANET_SCENE_SETTINGS: PlanetSceneTestSettings = {
  pose: 'orbit', terrain: true, atmosphere: true, morph: 0,
};

/** A still case: a 500 ms warm-up and a 4 s window (quick mode stops once the series settle). */
function still(id: string, label: string, change: Partial<PlanetSceneTestSettings>): TestScenario<PlanetSceneTestSettings> {
  return { id, label, settings: { ...DEFAULT_PLANET_SCENE_SETTINGS, ...change }, warmupMs: 500, durationMs: 4000 };
}

/** A scripted case: the motion runs for `durationMs`, or `quickMs` in quick mode. */
function scripted(id: string, label: string, motion: PlanetMotion, change: Partial<PlanetSceneTestSettings>): TestScenario<PlanetSceneTestSettings> {
  return { id, label, settings: { ...DEFAULT_PLANET_SCENE_SETTINGS, ...change, motion }, warmupMs: 500, durationMs: 12_000, quickMs: 6000 };
}

/**
 * Suite `planet-scene` v1 (Plan 059, step G5): `<planet>` with `<planetTerrain>` and `<planetAtmosphere>` as a game writes
 * it, 600 km radius, a baked cell planet, the globe (morph 0). Clouds are a placeholder: `<planetClouds>` has its own plan.
 *
 * Still poses (orbit, 20 km, the 2 m eye), a scripted descent from orbit to the eye and a scripted 360 degree turn at the eye.
 * The GPU timer splits by render pass, not by layer, so the per-layer cost is read from two atmosphere-off partners (orbit and
 * eye): same view, same terrain, the sky and the lighting and haze stages off. v1 has no morph cases; v2 adds them.
 */
const PLANET_SCENE_V1: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene',
  version: 1,
  title: 'Planet scene: <planet> with terrain and atmosphere at orbit, 20 km and the 2 m eye, a descent and a turn (Plan 059 G5)',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: [
    still('orbit', 'orbit · whole planet', { pose: 'orbit' }),
    still('mid-20km', '20 km altitude', { pose: 'mid-20km' }),
    still('ground', '2 m eye', { pose: 'ground' }),
    scripted('descent', 'descent · orbit to the 2 m eye', 'descent', { pose: 'orbit' }),
    scripted('yaw-360', 'turn · 360 degrees at the 2 m eye', 'yaw360', { pose: 'ground' }),
    still('orbit-atmosphere-off', 'orbit · atmosphere off (A/B partner of orbit)', { pose: 'orbit', atmosphere: false }),
    still('ground-atmosphere-off', '2 m eye · atmosphere off (A/B partner of ground)', { pose: 'ground', atmosphere: false }),
  ],
};

/**
 * Suite `planet-scene` v2 (Plan 059, step G6f): v1 unchanged, plus the morph. `<planet [morph]>` at 0.5 (half way: the terrain
 * is part way into the map) and 1 (the flat map) at orbit and at the 2 m eye, and a scripted sweep at orbit that goes 0 to 1
 * and back to 0 over the window with the camera still. The sky does not morph yet, so at morph above 0 the timed sky is the
 * globe's sky. The morph cases keep the atmosphere on and the terrain in the scene, as orbit and ground do.
 */
const PLANET_SCENE_V2: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene',
  version: 2,
  title: 'Planet scene: <planet> with terrain and atmosphere at orbit, 20 km and the 2 m eye, a descent, a turn and the morph 0 to 1 (Plan 059 G6f)',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: [
    ...PLANET_SCENE_V1.scenarios,
    still('orbit-morph-0.5', 'orbit · morph 0.5', { pose: 'orbit', morph: 0.5 }),
    still('orbit-morph-1', 'orbit · morph 1', { pose: 'orbit', morph: 1 }),
    still('ground-morph-0.5', '2 m eye · morph 0.5', { pose: 'ground', morph: 0.5 }),
    still('ground-morph-1', '2 m eye · morph 1', { pose: 'ground', morph: 1 }),
    scripted('morph-sweep', 'morph sweep · orbit, 0 to 1 and back to 0', 'morphSweep', { pose: 'orbit' }),
  ],
};

/**
 * Suite `planet-scene` v3: v2 unchanged, plus the atmosphere-off partners of the two flat-map cases. At morph 1 the terrain
 * has been seen to go missing; with the air off the same view separates a terrain or discard fault (still missing) from a
 * lighting or haze fault (terrain comes back).
 */
const PLANET_SCENE_V3: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene',
  version: 3,
  title: 'Planet scene: v2 plus the atmosphere-off partners of the flat-map cases (Plan 059 G6f)',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: [
    ...PLANET_SCENE_V2.scenarios,
    still('orbit-morph-1-atmosphere-off', 'orbit · morph 1 · atmosphere off (A/B partner of orbit-morph-1)', { pose: 'orbit', morph: 1, atmosphere: false }),
    still('ground-morph-1-atmosphere-off', '2 m eye · morph 1 · atmosphere off (A/B partner of ground-morph-1)', { pose: 'ground', morph: 1, atmosphere: false }),
  ],
};

/** Oldest first; the final entry is "Run latest test". */
export const PLANET_SCENE_TEST_HISTORY: readonly TestSuite<PlanetSceneTestSettings>[] = [PLANET_SCENE_V1, PLANET_SCENE_V2, PLANET_SCENE_V3];
