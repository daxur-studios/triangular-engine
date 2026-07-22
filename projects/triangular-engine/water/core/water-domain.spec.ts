import { Vector3 } from 'three';
import { PlaneWaterDomain, SphereWaterDomain } from './water-domain';

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

  it('rejects a non-positive radius', () => {
    expect(() => new SphereWaterDomain(0)).toThrowError();
    expect(() => new SphereWaterDomain(-5)).toThrowError();
  });
});
