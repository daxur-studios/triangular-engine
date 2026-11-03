import { groundFrame } from 'triangular-engine/lod-surface/core';
import { MID_ALTITUDE_M, ORBIT_ALTITUDE_M } from '../../pages/planet-scene/planet-camera';
import { SPHERE_POSES, spherePoseView } from './water-lod-spike-sphere-poses';
import { SPHERE_ISLANDS, sphereLandHeightM, WATER_SPHERE_RADIUS_M } from './water-lod-spike-sphere-land';

describe('water-lod-spike sphere poses', () => {
  it('lists the four poses with distinct labels', () => {
    expect(SPHERE_POSES.map((pose) => pose.id)).toEqual(['orbit', 'mid-20km', 'coast-300m', 'eye-2m']);
    expect(new Set(SPHERE_POSES.map((pose) => pose.label)).size).toBe(4);
  });

  it('gives every pose a unit-length ground direction and a finite look', () => {
    for (const { id } of SPHERE_POSES) {
      const view = spherePoseView(id);
      const up = groundFrame('sphere', view.ground).up;
      expect(Math.hypot(...up)).toBeCloseTo(1, 12);
      expect(Number.isFinite(view.headingRad)).toBe(true);
      expect(Number.isFinite(view.pitchRad)).toBe(true);
      expect(view.altitudeM).toBeGreaterThan(0);
    }
  });

  it('puts orbit and 20 km at the planet scene altitudes and the coast poses low', () => {
    expect(spherePoseView('orbit').altitudeM).toBe(ORBIT_ALTITUDE_M);
    expect(spherePoseView('mid-20km').altitudeM).toBe(MID_ALTITUDE_M);
    expect(spherePoseView('coast-300m').altitudeM).toBe(50);
    expect(spherePoseView('eye-2m').altitudeM).toBe(2);
  });

  it('stands the coast poses over water, off the island, looking down toward the shore', () => {
    const view = spherePoseView('coast-300m');
    const R = WATER_SPHERE_RADIUS_M;
    const up = groundFrame('sphere', view.ground).up;
    const land = sphereLandHeightM(up[0] * R, up[1] * R, up[2] * R, SPHERE_ISLANDS);
    // The ground under the camera is below the sea (water), so the eye is above the swell.
    expect(land).toBeLessThan(0);
    expect(view.pitchRad).toBeLessThan(0);
    // The eye pose stands at the same ground point as the coast pose.
    expect(spherePoseView('eye-2m').ground).toEqual(view.ground);
  });
});
