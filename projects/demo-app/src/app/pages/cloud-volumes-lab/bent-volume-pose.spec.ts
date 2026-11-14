import { Quaternion, Vector3 } from 'three';
import { bendFrame } from 'triangular-engine/atmosphere';
import { placeOnBentPlanet } from './bent-volume-pose';

const R = 2000;
const UP = new Vector3(0, 1, 0);

function rest(direction: Vector3, altitude: number, heading = 0) {
  const d = direction.clone().normalize();
  return {
    position: d.clone().multiplyScalar(R + altitude),
    quaternion: new Quaternion().setFromUnitVectors(UP, d).multiply(new Quaternion().setFromAxisAngle(UP, heading)),
  };
}

describe('placeOnBentPlanet (Plan 051 rigid placement)', () => {
  const poses = [
    rest(new Vector3(0, 1, 0), 250),
    rest(new Vector3(0.3, 1, 0.2), 60, 0.7),
    rest(new Vector3(-0.6, 0.8, -0.5), 250, 2.1),
    rest(new Vector3(0, 0.5, 1), 250),
  ];

  it('leaves the globe pose untouched at morph 0', () => {
    for (const pose of poses) {
      const placed = placeOnBentPlanet(pose, R, 0);
      expect(placed.position.distanceTo(pose.position)).toBeLessThan(1e-6);
      expect(placed.quaternion.angleTo(pose.quaternion)).toBeLessThan(1e-6);
      expect(placed.turn.angleTo(new Quaternion())).toBeLessThan(1e-6);
    }
  });

  it('keeps the map centre fixed and lays the ground flat at morph 1', () => {
    const centre = placeOnBentPlanet(poses[0], R, 1);
    expect(centre.position.distanceTo(new Vector3(0, R + 250, 0))).toBeLessThan(1e-6);

    const flat = placeOnBentPlanet(poses[1], R, 1);
    // On the flat map the volume sits 60 m above the plane through the map centre, and its up is the plane's up.
    expect(flat.position.y).toBeCloseTo(R + 60, 6);
    const up = UP.clone().applyQuaternion(flat.quaternion);
    const restUp = UP.clone().applyQuaternion(poses[1].quaternion);
    expect(restUp.length()).toBeCloseTo(1, 9);
    expect(up.y).toBeCloseTo(1, 6);
  });

  it('keeps the altitude above the bent ground at every morph', () => {
    for (const morph of [0, 0.25, 0.5, 0.75, 1]) {
      const placed = placeOnBentPlanet(poses[2], R, morph);
      // Distance from the bent ground's centre, (0, R - 1/k, 0), is 1/k + altitude: for k -> 0 use the plane instead.
      const k = (1 - morph) / R;
      if (k === 0) {
        expect(placed.position.y).toBeCloseTo(R + 250, 6);
      } else {
        const centre = new Vector3(0, R - 1 / k, 0);
        expect(placed.position.distanceTo(centre)).toBeCloseTo(1 / k + 250, 4);
      }
    }
  });

  it('keeps the volume frame-local sun unchanged when the sun is turned with the volume', () => {
    const sun = new Vector3(0.4, 0.7, -0.3).normalize();
    for (const pose of poses) {
      const globeLocal = sun.clone().applyQuaternion(pose.quaternion.clone().invert());
      for (const morph of [0.1, 0.5, 0.9, 1]) {
        const placed = placeOnBentPlanet(pose, R, morph);
        const turned = sun.clone().applyQuaternion(placed.turn);
        const local = turned.applyQuaternion(placed.quaternion.clone().invert());
        expect(local.distanceTo(globeLocal)).toBeLessThan(1e-6);
      }
    }
  });

  it('keeps the volume heading against east at every morph', () => {
    const pose = rest(new Vector3(0.3, 1, 0.2), 60, 0.7);
    const x = new Vector3(1, 0, 0);
    const angleToEast = (morph: number, placed: { quaternion: Quaternion }): number => {
      const direction = pose.position.clone().normalize();
      const k = (1 - morph) / R;
      const lon = Math.atan2(direction.x, direction.y);
      const lat = Math.asin(-direction.z);
      const frame = bendFrame(lon * R, lat * R, k);
      const east = new Vector3(frame.east[0], frame.east[2], -frame.east[1]);
      return x.clone().applyQuaternion(placed.quaternion).angleTo(east);
    };
    const atGlobe = angleToEast(0, placeOnBentPlanet(pose, R, 0));
    for (const morph of [0.3, 0.7, 1]) {
      expect(angleToEast(morph, placeOnBentPlanet(pose, R, morph))).toBeCloseTo(atGlobe, 6);
    }
  });
});
