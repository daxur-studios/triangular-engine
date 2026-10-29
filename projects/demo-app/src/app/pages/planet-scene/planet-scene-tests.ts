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
  /** `<planet [morph]>`; every v1 case is the globe (0). The terrain does not bend until step G6. */
  readonly morph: number;
  /**
   * A scripted camera runs during the window instead of a still pose: `descent` flies orbit to the 2 m eye over one ground
   * point; `yaw360` holds the ground pose and turns the heading once round.
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
 * eye): same view, same terrain, the sky and the lighting and haze stages off. No morph cases; they come with step G6.
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

/** Oldest first; the final entry is "Run latest test". */
export const PLANET_SCENE_TEST_HISTORY: readonly TestSuite<PlanetSceneTestSettings>[] = [PLANET_SCENE_V1];
