import { Vector3 } from 'three';
import {
  CylinderWaterDomain,
  PlaneWaterDomain,
  SphereWaterDomain,
} from './water-domain';

/** Perpendicular distance from `point` to the infinite line through `center` along unit `axis`. */
function distanceFromAxisLine(
  point: Vector3,
  center: Vector3,
  axis: Vector3,
): number {
  const relative = new Vector3().subVectors(point, center);
  const axialComponent = relative.dot(axis);
  return relative.addScaledVector(axis, -axialComponent).length();
}

describe('PlaneWaterDomain', () => {
  it('reproduces the legacy flat formula exactly', () => {
    const domain = new PlaneWaterDomain();
    const frame = domain.getLocalFrame(new Vector3(123, 5, -456));
    const world = domain.composeWorldPosition(frame, 10, -20, 1.5);
    expect(world.x).toBeCloseTo(10);
    expect(world.y).toBeCloseTo(1.5);
    expect(world.z).toBeCloseTo(-20);
  });

  it('honours a configured sea level', () => {
    const domain = new PlaneWaterDomain({ seaLevelY: 42 });
    const frame = domain.getLocalFrame(new Vector3());
    const world = domain.composeWorldPosition(frame, 0, 0, 0);
    expect(world.y).toBeCloseTo(42);
  });
});

describe('SphereWaterDomain', () => {
  it('finds the nearest surface point as the frame origin', () => {
    const domain = new SphereWaterDomain(100);
    const frame = domain.getLocalFrame(new Vector3(0, 250, 0));
    expect(frame.origin.distanceTo(new Vector3(0, 100, 0))).toBeCloseTo(0);
    expect(frame.normal.distanceTo(new Vector3(0, 1, 0))).toBeCloseTo(0);
  });

  it('gives the reference position zero projection onto the tangent basis', () => {
    const domain = new SphereWaterDomain(100);
    const referencePositions = [
      new Vector3(0, 250, 0),
      new Vector3(300, 40, -80),
      new Vector3(0.01, 500, 0.02),
      new Vector3(-60, -0.05, 500),
    ];
    for (const referencePosition of referencePositions) {
      const frame = domain.getLocalFrame(referencePosition);
      const toReference = new Vector3().subVectors(
        referencePosition,
        frame.origin,
      );
      expect(toReference.dot(frame.tangentU)).toBeCloseTo(0, 6);
      expect(toReference.dot(frame.tangentV)).toBeCloseTo(0, 6);
    }
  });

  it('keeps the tangent basis orthonormal near the poles', () => {
    const domain = new SphereWaterDomain(100);
    const frame = domain.getLocalFrame(new Vector3(0, 1000, 0.001));
    expect(frame.tangentU.length()).toBeCloseTo(1);
    expect(frame.tangentV.length()).toBeCloseTo(1);
    expect(frame.tangentU.dot(frame.tangentV)).toBeCloseTo(0);
    expect(frame.tangentU.dot(frame.normal)).toBeCloseTo(0);
    expect(frame.tangentV.dot(frame.normal)).toBeCloseTo(0);
  });

  it('renormalizes composed positions onto radius + height from center', () => {
    const center = new Vector3(10, -20, 30);
    const domain = new SphereWaterDomain(500, { center });
    const frame = domain.getLocalFrame(new Vector3(10, 520, 30));
    const world = domain.composeWorldPosition(frame, 50, -75, 3);
    expect(world.distanceTo(center)).toBeCloseTo(503);
  });

  it('keeps a fixed surface sample stable while the camera frame moves', () => {
    const radius = 500;
    const domain = new SphereWaterDomain(radius);
    const sampleDirection = new Vector3(0.72, 0.31, -0.62).normalize();
    const cameraPositions = [
      new Vector3(0, 650, 0),
      new Vector3(520, 260, 300),
      new Vector3(-410, 180, -470),
    ];

    const surfaceCoordinates = cameraPositions.map((cameraPosition) => {
      const frame = domain.getLocalFrame(cameraPosition);
      // Invert the tangent-plane projection used by composeWorldPosition for
      // this fixed direction, as each camera frame represents it differently.
      const projectedRadius = radius / sampleDirection.dot(frame.normal);
      const flatSample = sampleDirection.clone().multiplyScalar(projectedRadius);
      const fromOrigin = flatSample.sub(frame.origin);
      const localX = fromOrigin.dot(frame.tangentU);
      const localZ = fromOrigin.dot(frame.tangentV);
      const world = domain.composeWorldPosition(frame, localX, localZ, 0);

      expect(world.clone().normalize().distanceTo(sampleDirection)).toBeCloseTo(0, 6);
      return domain.getSurfaceXZ(frame, localX, localZ);
    });

    for (const coordinates of surfaceCoordinates.slice(1)) {
      expect(coordinates.distanceTo(surfaceCoordinates[0])).toBeCloseTo(0, 6);
    }
  });

  it('rejects a non-positive radius', () => {
    expect(() => new SphereWaterDomain(0)).toThrowError();
    expect(() => new SphereWaterDomain(-5)).toThrowError();
  });
});

describe('CylinderWaterDomain', () => {
  it('finds the nearest wall point as the frame origin, radius from the axis line', () => {
    const domain = new CylinderWaterDomain(100);
    const frame = domain.getLocalFrame(new Vector3(150, 30, 0));
    expect(frame.origin.distanceTo(new Vector3(100, 30, 0))).toBeCloseTo(0);
    expect(frame.normal.distanceTo(new Vector3(-1, 0, 0))).toBeCloseTo(0);
  });

  it('gives the reference position zero projection onto the tangent basis', () => {
    const domain = new CylinderWaterDomain(100);
    const referencePositions = [
      new Vector3(150, 30, 0),
      new Vector3(-70, -400, 60),
      new Vector3(0.02, 250, -0.03),
      new Vector3(-99.99, 800, -1.5),
    ];
    for (const referencePosition of referencePositions) {
      const frame = domain.getLocalFrame(referencePosition);
      const toReference = new Vector3().subVectors(
        referencePosition,
        frame.origin,
      );
      expect(toReference.dot(frame.tangentU)).toBeCloseTo(0, 6);
      expect(toReference.dot(frame.tangentV)).toBeCloseTo(0, 6);
    }
  });

  it('falls back to a well-defined orthonormal basis exactly on the centerline', () => {
    const domain = new CylinderWaterDomain(100);
    const frame = domain.getLocalFrame(new Vector3(0, 250, 0));
    expect(frame.tangentU.length()).toBeCloseTo(1);
    expect(frame.tangentV.length()).toBeCloseTo(1);
    expect(frame.tangentU.dot(frame.tangentV)).toBeCloseTo(0);
    expect(frame.tangentU.dot(frame.normal)).toBeCloseTo(0);
    expect(frame.tangentV.dot(frame.normal)).toBeCloseTo(0);
    expect(distanceFromAxisLine(frame.origin, domain.center, domain.axis)).toBeCloseTo(100);
  });

  it('carries the axial coordinate through unchanged (zero curvature along the axis)', () => {
    const axis = new Vector3(0, 1, 0);
    const center = new Vector3(5, -10, 15);
    const domain = new CylinderWaterDomain(200, { axis, center });
    const frame = domain.getLocalFrame(new Vector3(305, 40, 15));
    const world = domain.composeWorldPosition(frame, 37.5, -12, 2);
    const originAxialOffset = new Vector3()
      .subVectors(frame.origin, center)
      .dot(axis);
    const worldAxialOffset = new Vector3().subVectors(world, center).dot(axis);
    expect(worldAxialOffset).toBeCloseTo(originAxialOffset + 37.5, 6);
  });

  it('renormalizes the perpendicular component onto radius - height from the axis line', () => {
    const axis = new Vector3(1, 0, 0);
    const center = new Vector3(0, 0, 0);
    const domain = new CylinderWaterDomain(500, { axis, center });
    const frame = domain.getLocalFrame(new Vector3(80, 0, 520));
    const world = domain.composeWorldPosition(frame, -60, 90, 4);
    expect(distanceFromAxisLine(world, center, axis)).toBeCloseTo(496);
  });

  it('computes surface XZ coordinates deterministically', () => {
    const axis = new Vector3(1, 0, 0);
    const center = new Vector3(0, 0, 0);
    const domain = new CylinderWaterDomain(500, { axis, center });
    const frame = domain.getLocalFrame(new Vector3(80, 0, 520));

    const surfXZ1 = domain.getSurfaceXZ(frame, 0, 0);
    const surfXZ2 = domain.getSurfaceXZ(frame, 50, 100);

    expect(Number.isFinite(surfXZ1.x)).toBe(true);
    expect(Number.isFinite(surfXZ1.y)).toBe(true);
    expect(surfXZ2.x - surfXZ1.x).toBeCloseTo(50, 4);
  });

  it('keeps a fixed surface sample stable across translated cylinder frames', () => {
    const radius = 500;
    const axis = new Vector3(1, 0, 0);
    const center = new Vector3(20, -30, 40);
    const domain = new CylinderWaterDomain(radius, { axis, center });
    const sampleAxial = 135;
    const sampleRadialDirection = new Vector3(0, 0.8, 0.6).normalize();
    const fixedSample = center
      .clone()
      .addScaledVector(axis, sampleAxial)
      .addScaledVector(sampleRadialDirection, radius);
    const cameraPositions = [
      center.clone().add(new Vector3(-80, 620, 0)),
      center.clone().add(new Vector3(250, 300, 520)),
      center.clone().add(new Vector3(40, -180, 590)),
    ];

    const surfaceCoordinates = cameraPositions.map((cameraPosition) => {
      const frame = domain.getLocalFrame(cameraPosition);
      const frameFromCenter = frame.origin.clone().sub(center);
      const frameAxial = frameFromCenter.dot(axis);
      const frameRadial = frameFromCenter
        .addScaledVector(axis, -frameAxial)
        .normalize();

      // Intersect the fixed radial ray with this frame's tangent plane, then
      // express that point in the frame's local axes.
      const projectedRadius =
        radius / sampleRadialDirection.dot(frameRadial);
      const flatSample = center
        .clone()
        .addScaledVector(axis, sampleAxial)
        .addScaledVector(sampleRadialDirection, projectedRadius);
      const fromOrigin = flatSample.sub(frame.origin);
      const localX = fromOrigin.dot(frame.tangentU);
      const localZ = fromOrigin.dot(frame.tangentV);
      const world = domain.composeWorldPosition(frame, localX, localZ, 0);

      expect(world.distanceTo(fixedSample)).toBeCloseTo(0, 6);
      return domain.getSurfaceXZ(frame, localX, localZ);
    });

    for (const coordinates of surfaceCoordinates.slice(1)) {
      expect(coordinates.distanceTo(surfaceCoordinates[0])).toBeCloseTo(0, 6);
    }
  });

  it('rejects a non-positive radius', () => {
    expect(() => new CylinderWaterDomain(0)).toThrowError();
    expect(() => new CylinderWaterDomain(-5)).toThrowError();
  });
});
