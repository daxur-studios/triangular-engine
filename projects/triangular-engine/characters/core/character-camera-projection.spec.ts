import {
  characterCapsuleSideContour,
  characterEllipsoidContour,
  characterEllipsoidLevel,
  characterProjectedEllipseDistance,
  characterSegmentCapsuleEntry,
  characterSegmentEllipsoidEntry,
  projectCharacterEllipsoid,
  projectCharacterPoint,
  transformCharacterEllipsoid,
  transformCharacterPoint,
  type CharacterEllipsoid,
  type CharacterPinholeCamera,
} from './character-camera-projection';
import { characterQuaternionFromEuler, rotateCharacterVector3 } from './character-quaternion';

const frontCamera: CharacterPinholeCamera = {
  position: { x: 0, y: 0, z: 5 },
  target: { x: 0, y: 0, z: 0 },
  fovYDegrees: 90,
  width: 200,
  height: 100,
};

const obliqueCamera: CharacterPinholeCamera = {
  position: { x: 2.4, y: 1.1, z: 3.7 },
  target: { x: 0.2, y: 0.3, z: -0.1 },
  fovYDegrees: 30,
  width: 960,
  height: 540,
};

const q = characterQuaternionFromEuler(0.3, -0.7, 0.2);
const tilted: CharacterEllipsoid = {
  center: { x: 0.3, y: 0.2, z: 0.1 },
  axes: [
    rotateCharacterVector3(q, { x: 0.5, y: 0, z: 0 }),
    rotateCharacterVector3(q, { x: 0, y: 0.3, z: 0 }),
    rotateCharacterVector3(q, { x: 0, y: 0, z: 0.2 }),
  ],
};

describe('character-camera-projection', () => {
  it('projects points like a Three.js perspective camera', () => {
    // focal = 50 / tan(45°) = 50 px.
    const right = projectCharacterPoint(frontCamera, { x: 1, y: 0, z: 0 })!;
    expect(right.x).toBeCloseTo(110, 9);
    expect(right.y).toBeCloseTo(50, 9);
    expect(right.depth).toBeCloseTo(5, 9);
    expect(projectCharacterPoint(frontCamera, { x: 0, y: 1, z: 0 })!.y).toBeCloseTo(40, 9);
    expect(projectCharacterPoint(frontCamera, { x: 0, y: 0, z: 6 })).toBeNull();
  });

  it('applies column-major matrices', () => {
    // Rotation of 90° about +Y, then a translation of (1, 2, 3).
    const m = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 2, 3, 1];
    const p = transformCharacterPoint(m, { x: 1, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(1, 12);
    expect(p.y).toBeCloseTo(2, 12);
    expect(p.z).toBeCloseTo(2, 12);
    const e = transformCharacterEllipsoid(m, tilted);
    expect(characterEllipsoidLevel(e, transformCharacterPoint(m, tilted.center))).toBeCloseTo(0, 12);
  });

  it('projects a sphere to a circle of the expected radius', () => {
    const sphere: CharacterEllipsoid = {
      center: { x: 0, y: 0, z: 0 },
      axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    };
    const ellipse = projectCharacterEllipsoid(frontCamera, sphere)!;
    const expected = 50 / Math.sqrt(24);
    expect(ellipse.center.x).toBeCloseTo(100, 9);
    expect(ellipse.center.y).toBeCloseTo(50, 9);
    expect(ellipse.semiMajor).toBeCloseTo(expected, 9);
    expect(ellipse.semiMinor).toBeCloseTo(expected, 9);
  });

  it('puts the projected contour generator exactly on the projected ellipse', () => {
    const ellipse = projectCharacterEllipsoid(obliqueCamera, tilted)!;
    const contour = characterEllipsoidContour(tilted, obliqueCamera.position, 64);
    expect(contour.length).toBe(64);
    for (const p of contour) {
      expect(characterEllipsoidLevel(tilted, p)).toBeCloseTo(1, 9);
      const image = projectCharacterPoint(obliqueCamera, p)!;
      expect(Math.abs(characterProjectedEllipseDistance(ellipse, image).distance)).toBeLessThan(1e-6);
    }
    // The axis directions agree with the shape matrix.
    const tip = {
      x: ellipse.center.x + Math.cos(ellipse.angle) * ellipse.semiMajor,
      y: ellipse.center.y + Math.sin(ellipse.angle) * ellipse.semiMajor,
    };
    expect(Math.abs(characterProjectedEllipseDistance(ellipse, tip).distance)).toBeLessThan(1e-6);
  });

  it('keeps every projected surface point inside the projected ellipse', () => {
    const ellipse = projectCharacterEllipsoid(obliqueCamera, tilted)!;
    for (let k = 0; k < 200; k++) {
      const theta = Math.acos(1 - (2 * (k + 0.5)) / 200);
      const phi = k * 2.399963;
      const u = { x: Math.sin(theta) * Math.cos(phi), y: Math.sin(theta) * Math.sin(phi), z: Math.cos(theta) };
      const [a, b, c] = tilted.axes;
      const p = {
        x: tilted.center.x + a.x * u.x + b.x * u.y + c.x * u.z,
        y: tilted.center.y + a.y * u.x + b.y * u.y + c.y * u.z,
        z: tilted.center.z + a.z * u.x + b.z * u.y + c.z * u.z,
      };
      const image = projectCharacterPoint(obliqueCamera, p)!;
      expect(characterProjectedEllipseDistance(ellipse, image).distance).toBeLessThan(1e-6);
    }
  });

  it('finds where a segment enters an ellipsoid or a capsule', () => {
    const unitSphere: CharacterEllipsoid = {
      center: { x: 0, y: 0, z: 0 },
      axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    };
    expect(characterSegmentEllipsoidEntry({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -5 }, unitSphere)).toBeCloseTo(0.4, 12);
    expect(characterSegmentEllipsoidEntry({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 2 }, unitSphere)).toBeNull();
    expect(characterSegmentEllipsoidEntry({ x: 2, y: 0, z: 5 }, { x: 2, y: 0, z: -5 }, unitSphere)).toBeNull();

    const capsule = { start: { x: 0, y: -1, z: 0 }, end: { x: 0, y: 1, z: 0 }, radius: 1 };
    expect(characterSegmentCapsuleEntry({ x: 5, y: 0, z: 0 }, { x: -5, y: 0, z: 0 }, capsule)).toBeCloseTo(0.4, 12);
    expect(characterSegmentCapsuleEntry({ x: 0, y: 5, z: 0 }, { x: 0, y: -5, z: 0 }, capsule)).toBeCloseTo(0.3, 12);
    expect(characterSegmentCapsuleEntry({ x: 5, y: 1.5, z: 0 }, { x: -5, y: 1.5, z: 0 }, capsule)).toBeCloseTo(
      (5 - Math.sqrt(0.75)) / 10,
      12,
    );
    expect(characterSegmentCapsuleEntry({ x: 5, y: 2.5, z: 0 }, { x: -5, y: 2.5, z: 0 }, capsule)).toBeNull();
    expect(characterSegmentCapsuleEntry({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, capsule)).toBe(0);
  });

  it('samples capsule side contour lines that graze the surface', () => {
    const capsule = { start: { x: 0, y: -0.4, z: 0 }, end: { x: 0, y: 0.4, z: 0 }, radius: 0.3 };
    const viewpoint = { x: 0.8, y: 0.5, z: 3 };
    const [first, second] = characterCapsuleSideContour(capsule, viewpoint, 9);
    expect(first.length).toBe(9);
    expect(second.length).toBe(9);
    for (const p of [...first, ...second]) {
      const normal = { x: p.x / 0.3, y: 0, z: p.z / 0.3 };
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(0.3, 12);
      const ray = { x: p.x - viewpoint.x, y: p.y - viewpoint.y, z: p.z - viewpoint.z };
      expect(normal.x * ray.x + normal.z * ray.z).toBeCloseTo(0, 12);
    }
    // Viewed from +Z with +Y up, the first line is on the image right (+X).
    expect(first[0].x).toBeGreaterThan(second[0].x);
  });
});
