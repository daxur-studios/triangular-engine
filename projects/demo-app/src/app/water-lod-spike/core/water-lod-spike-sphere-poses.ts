import { FIXTURE_GROUND, FIXTURE_HEADING_RAD, type Vec3 } from 'triangular-engine/lod-surface/core';
import { MID_ALTITUDE_M, ORBIT_ALTITUDE_M, ORBIT_PITCH_RAD, type PlanetView } from '../../pages/planet-scene/planet-camera';
import { sphereDirectionAt } from './water-lod-spike-sphere-land';

/**
 * Plan 080, water on a planet (stage A): the camera poses of the sphere water page and its cost suite. The planet camera of the
 * planet scene page (a ground direction, an altitude above the ground under it, a heading from north and a pitch), standing at
 * the places the plane spike's views stand at: the home point, and the coast view's spot 500 m south and 300 m east of it.
 */
export type SpherePoseId = 'orbit' | 'mid-20km' | 'coast-300m' | 'eye-2m';

export const SPHERE_POSES: readonly { readonly id: SpherePoseId; readonly label: string }[] = [
  { id: 'orbit', label: 'orbit' },
  { id: 'mid-20km', label: '20 km' },
  { id: 'coast-300m', label: 'coast, 50 m' },
  { id: 'eye-2m', label: '2 m eye' },
];

const DEG = Math.PI / 180;

/** The coast view of the plane spike (position 300 east, 500 south; target 150 north): heading from north towards east, and the pitch to its target 5 m up. */
const COAST_GROUND: Vec3 = sphereDirectionAt(300, -500);
const COAST_HEADING_RAD = Math.atan2(-300, 650);
const COAST_PITCH_RAD = -Math.atan2(45, Math.hypot(300, 650));

/** The camera view of a pose. */
export function spherePoseView(id: SpherePoseId): PlanetView {
  switch (id) {
    case 'orbit': return { ground: FIXTURE_GROUND.sphere, altitudeM: ORBIT_ALTITUDE_M, headingRad: FIXTURE_HEADING_RAD.sphere, pitchRad: ORBIT_PITCH_RAD };
    case 'mid-20km': return { ground: FIXTURE_GROUND.sphere, altitudeM: MID_ALTITUDE_M, headingRad: 0, pitchRad: -25 * DEG };
    case 'coast-300m': return { ground: COAST_GROUND, altitudeM: 50, headingRad: COAST_HEADING_RAD, pitchRad: COAST_PITCH_RAD };
    case 'eye-2m': return { ground: COAST_GROUND, altitudeM: 2, headingRad: COAST_HEADING_RAD, pitchRad: -3 * DEG };
  }
}
