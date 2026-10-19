/** Fixed inputs of the Plan 055 test track: bodies, spin and sun. Everything here is deterministic. */

export const BODIES = [
  { id: '64km', label: '64 km', radiusM: 64_000 },
  { id: '600km', label: '600 km', radiusM: 600_000 },
  { id: '6371km', label: '6,371 km', radiusM: 6_371_000 },
] as const;
export type BodyId = (typeof BODIES)[number]['id'];

export function bodyById(id: BodyId): (typeof BODIES)[number] {
  const body = BODIES.find((item) => item.id === id);
  if (!body) throw new Error(`Unknown body: ${id}`);
  return body;
}

/** Every contender is judged on the same seed; the plain sphere has no terrain, so it only travels in the settings. */
export const FIXED_SEED = 55;

/** Sphere tessellation, the same for every body so the three sizes cost the same to draw. */
export const SPHERE_SEGMENTS = { width: 512, height: 256 } as const;

/** One rotation of the body per day at 1x. */
export const SPIN_PERIOD_S = 86_400;
export const MIN_SPIN_WARP = 1;
export const MAX_SPIN_WARP = 1_000_000;

/** Reference drawing buffer of the timing machine (Plan 055 D1). */
export const REFERENCE_DRAWING_BUFFER = { width: 2560, height: 1440 } as const;

/** The sun is fixed in space; the body turns under it. Azimuth is from +Z toward +X. */
const SUN_AZIMUTH_DEG = 30;
const SUN_ELEVATION_DEG = 20;

export function spinAngleAfter(angleRad: number, deltaS: number, warp: number): number {
  const turn = Math.PI * 2;
  return (angleRad + (deltaS * warp * turn) / SPIN_PERIOD_S) % turn;
}

/**
 * The sun direction in the body-fixed frame after the body has turned by `spinAngleRad` about +Y. The camera rides with
 * the surface, so a spinning planet shows up as a sun that travels westward around it.
 */
export function sunDirectionBody(spinAngleRad: number, target: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const az = (SUN_AZIMUTH_DEG * Math.PI) / 180;
  const el = (SUN_ELEVATION_DEG * Math.PI) / 180;
  const x = Math.cos(el) * Math.sin(az);
  const y = Math.sin(el);
  const z = Math.cos(el) * Math.cos(az);
  const c = Math.cos(spinAngleRad);
  const s = Math.sin(spinAngleRad);
  target[0] = x * c - z * s;
  target[1] = y;
  target[2] = x * s + z * c;
  return target;
}
