import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { CellPlanetMorphCameraRig, type ICellPlanetMorphCameraControls } from './cell-planet-morph-camera';
import type { MapProjectionKind } from './core/map-projections';

const RADIUS = 1000;

function rig(kind: MapProjectionKind = 'equirectangular'): CellPlanetMorphCameraRig {
  return new CellPlanetMorphCameraRig({ radiusM: RADIUS, projection: () => kind });
}

function controlsAt(camera: Vector3, target: Vector3): ICellPlanetMorphCameraControls & { setUps: Vector3[] } {
  const object = new PerspectiveCamera();
  object.position.copy(camera);
  const setUps: Vector3[] = [];
  return {
    target: target.clone(),
    object,
    setUps,
    setUpVector(up: Vector3) {
      object.up.copy(up);
      setUps.push(up.clone());
    },
  };
}

/** Camera 400 above the ground at `dir`, 300 back along the horizontal, looking at the ground point. */
function poseOver(r: CellPlanetMorphCameraRig, dir: Vector3, morph: number): { camera: Vector3; target: Vector3 } {
  const frame = r.groundFrame(dir, morph);
  const camera = frame.position
    .clone()
    .addScaledVector(frame.normal, 400)
    .addScaledVector(frame.east, 120)
    .addScaledVector(frame.north, -280);
  return { camera, target: frame.position.clone() };
}

/** Where `point` stands in the ground frame, as east, north and height. */
function groundCoordinates(r: CellPlanetMorphCameraRig, dir: Vector3, morph: number, point: Vector3): Vector3 {
  const frame = r.groundFrame(dir, morph);
  const offset = point.clone().sub(frame.position);
  return new Vector3(offset.dot(frame.east), offset.dot(frame.north), offset.dot(frame.normal));
}

const DIRECTIONS = [
  new Vector3(0.3, 0.4, 0.86),
  new Vector3(-0.6, -0.3, 0.5),
  new Vector3(0.7, 0.2, -0.4),
  new Vector3(0.1, -0.9, 0.2),
].map((v) => v.normalize());

describe('CellPlanetMorphCameraRig', () => {
  it('has the sphere frame at morph 0 and the map frame at morph 1', () => {
    const r = rig();
    const dir = DIRECTIONS[0];
    const globe = r.groundFrame(dir, 0);
    expect(globe.position.distanceTo(dir.clone().multiplyScalar(RADIUS))).toBeLessThan(1e-9);
    expect(globe.normal.distanceTo(dir)).toBeLessThan(1e-12);

    const map = r.groundFrame(dir, 1);
    expect(map.position.z).toBeCloseTo(RADIUS, 9);
    expect(map.normal.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-12);
    expect(map.north.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-12);
    expect(map.east.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-12);
  });

  it('keeps the frame orthonormal at every morph, including the poles and the far side', () => {
    const r = rig('equalEarth');
    for (const dir of [...DIRECTIONS, new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)]) {
      for (const morph of [0, 0.2, 0.5, 0.8, 1]) {
        const f = r.groundFrame(dir, morph);
        for (const v of [f.east, f.north, f.normal]) {
          expect(Number.isFinite(v.x + v.y + v.z)).toBeTrue();
          expect(v.length()).toBeCloseTo(1, 9);
        }
        expect(Math.abs(f.east.dot(f.north))).toBeLessThan(1e-9);
        expect(Math.abs(f.east.dot(f.normal))).toBeLessThan(1e-9);
        expect(f.east.clone().cross(f.north).distanceTo(f.normal)).toBeLessThan(1e-9);
      }
    }
  });

  it('finds the ground under the line of sight at any morph', () => {
    for (const kind of ['equirectangular', 'equalEarth'] as const) {
      const r = rig(kind);
      for (const dir of DIRECTIONS) {
        for (const morph of [0, 0.35, 0.7, 1]) {
          const { camera, target } = poseOver(r, dir, morph);
          const found = r.groundUnderRay(camera, target, morph);
          expect(found).not.toBeNull();
          expect(found!.distanceTo(dir)).toBeLessThan(1e-5);
        }
      }
    }
  });

  it('finds the ground from a camera looking at the planet centre, as the demo starts', () => {
    const r = rig();
    for (const morph of [0, 0.5, 1]) {
      const found = r.groundUnderRay(new Vector3(0, 0, RADIUS * 2.6), new Vector3(0, 0, 0), morph);
      expect(found!.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
    }
  });

  it('keeps height, bearing and place over the ground as the morph runs, and returns exactly', () => {
    for (const dir of DIRECTIONS) {
      const r = rig();
      const { camera, target } = poseOver(r, dir, 0);
      const controls = controlsAt(camera, target);
      const before = groundCoordinates(r, dir, 0, controls.object.position);
      const targetBefore = groundCoordinates(r, dir, 0, controls.target);

      r.update(controls, 0);
      for (const morph of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) {
        r.update(controls, morph);
        const here = groundCoordinates(r, dir, morph, controls.object.position);
        expect(here.distanceTo(before)).toBeLessThan(1e-6);
        expect(groundCoordinates(r, dir, morph, controls.target).distanceTo(targetBefore)).toBeLessThan(1e-6);
        // The controls' up is the ground's normal, and the camera is aimed at the target with it.
        expect(controls.object.up.distanceTo(r.groundFrame(dir, morph).normal)).toBeLessThan(1e-6);
      }
      for (const morph of [0.6, 0.3, 0]) r.update(controls, morph);
      expect(controls.object.position.distanceTo(camera)).toBeLessThan(1e-5);
      expect(controls.target.distanceTo(target)).toBeLessThan(1e-5);
    }
  });

  it('keeps the angle between the view and the ground', () => {
    const r = rig();
    const dir = DIRECTIONS[1];
    const { camera, target } = poseOver(r, dir, 0);
    const controls = controlsAt(camera, target);
    const angleOf = (morph: number): number => {
      const view = controls.target.clone().sub(controls.object.position).normalize();
      return Math.asin(-view.dot(r.groundFrame(dir, morph).normal));
    };
    r.update(controls, 0);
    const start = angleOf(0);
    for (const morph of [0.3, 0.6, 1]) {
      r.update(controls, morph);
      expect(angleOf(morph)).toBeCloseTo(start, 6);
    }
  });

  it('moves in small steps for a small morph change (no jitter)', () => {
    const r = rig();
    const dir = DIRECTIONS[0];
    const { camera, target } = poseOver(r, dir, 0);
    const controls = controlsAt(camera, target);
    r.update(controls, 0);
    let previousUp = controls.object.up.clone();
    let previousPosition = controls.object.position.clone();
    for (let i = 1; i <= 100; i++) {
      r.update(controls, i / 100);
      expect(controls.object.up.angleTo(previousUp)).toBeLessThan(0.05);
      expect(controls.object.position.distanceTo(previousPosition)).toBeLessThan(RADIUS * 0.1);
      previousUp = controls.object.up.clone();
      previousPosition = controls.object.position.clone();
    }
  });

  it('follows the user: orbiting or panning while the morph is steady moves the anchor', () => {
    const r = rig();
    const start = DIRECTIONS[0];
    const { camera, target } = poseOver(r, start, 0.5);
    const controls = controlsAt(camera, target);
    r.update(controls, 0.5);
    expect(r.anchorDirection.distanceTo(start)).toBeLessThan(1e-5);

    // Pan to the ground at another direction, keeping the same offset.
    const next = DIRECTIONS[3];
    const pose = poseOver(r, next, 0.5);
    controls.object.position.copy(pose.camera);
    controls.target.copy(pose.target);
    r.update(controls, 0.5);
    expect(r.anchorDirection.distanceTo(next)).toBeLessThan(1e-5);
    // The next morph step carries the new place, not the old one.
    const before = groundCoordinates(r, next, 0.5, controls.object.position);
    r.update(controls, 0.8);
    expect(groundCoordinates(r, next, 0.8, controls.object.position).distanceTo(before)).toBeLessThan(1e-6);
  });

  it('sets the up vector through the controls when they offer it, and on the camera when they do not', () => {
    const r = rig();
    const { camera, target } = poseOver(r, DIRECTIONS[0], 0);
    const withSetter = controlsAt(camera, target);
    r.update(withSetter, 0);
    expect(withSetter.setUps.length).toBe(1);

    const plain: ICellPlanetMorphCameraControls = { target: target.clone(), object: new Object3D() as never };
    plain.object.position.copy(camera);
    const second = rig();
    second.update(plain, 0);
    expect(plain.object.up.distanceTo(DIRECTIONS[0])).toBeLessThan(1e-6);
  });

  it('tilts a straight top-down view a hair so the camera has an up', () => {
    const r = rig();
    const controls = controlsAt(new Vector3(0, 0, RADIUS * 2.6), new Vector3(0, 0, 0));
    r.update(controls, 0);
    const view = controls.target.clone().sub(controls.object.position).normalize();
    expect(Math.abs(view.dot(controls.object.up))).toBeLessThan(1 - 1e-10);
    expect((controls.object as PerspectiveCamera).quaternion.toArray().every(Number.isFinite)).toBeTrue();
    // And the pose is still the same ground, the same distance away.
    expect(controls.object.position.distanceTo(controls.target)).toBeCloseTo(RADIUS * 2.6, 3);
  });

  it('does nothing when the view misses the ground', () => {
    const r = rig();
    const controls = controlsAt(new Vector3(0, 0, RADIUS * 5), new Vector3(0, 0, RADIUS * 10));
    expect(r.update(controls, 0)).toBeFalse();
  });
});
