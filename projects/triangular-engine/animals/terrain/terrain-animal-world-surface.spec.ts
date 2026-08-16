import {
  ConstantTerrainField,
  CylinderTerrainDomain,
  PlaneTerrainDomain,
  SphereTerrainDomain,
} from 'triangular-engine/terrain';
import { TerrainAnimalWorldSurface } from './terrain-animal-world-surface';

function vector(x: number, y: number, z: number) {
  return { x, y, z };
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(a: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x, a.y, a.z);
}

describe('TerrainAnimalWorldSurface', () => {
  it('supports infinite plane coordinates, including negative patches', () => {
    const surface = new TerrainAnimalWorldSurface(
      new ConstantTerrainField(7),
      new PlaneTerrainDomain(100),
    );
    const sample = surface.sample(vector(-250.5, 0, 375.25));

    expect(surface.kind).toBe('plane');
    expect(sample.position).toEqual(vector(-250.5, 7, 375.25));
    expect(sample.surfaceUp).toEqual(vector(0, 1, 0));
    expect(sample.elevationM).toBe(7);
    expect(sample.walkable).toBeTrue();
    expect(dot(sample.surfaceUp, sample.tangentU)).toBeCloseTo(0, 6);
    expect(dot(sample.surfaceUp, sample.tangentV)).toBeCloseTo(0, 6);

    const moved = surface.moveAlongSurface(
      sample.position,
      vector(10, 50, -20),
      2,
    );
    expect(moved).toEqual(vector(-230.5, 7, 335.25));
    expect(surface.projectToSurface(vector(-230.5, 99, 335.25))).toEqual(moved);
    expect(surface.surfaceDistance(vector(-10, 0, -20), vector(20, 0, 20))).toBeCloseTo(50, 6);
  });

  it('projects and moves on a sphere with outward up and tangent frames', () => {
    const radius = 100;
    const surface = new TerrainAnimalWorldSurface(
      new ConstantTerrainField(5),
      new SphereTerrainDomain(radius),
    );
    const sample = surface.sample(vector(radius, 0, 0));

    expect(surface.kind).toBe('sphere');
    expect(sample.position.x).toBeCloseTo(radius + 5, 6);
    expect(sample.position.y).toBeCloseTo(0, 6);
    expect(sample.surfaceUp).toEqual(vector(1, 0, 0));
    expect(dot(sample.surfaceUp, sample.tangentU)).toBeCloseTo(0, 6);
    expect(dot(sample.surfaceUp, sample.tangentV)).toBeCloseTo(0, 6);
    expect(length(sample.position)).toBeCloseTo(radius + 5, 6);

    const moved = surface.moveAlongSurface(sample.position, vector(0, 20, 0), 1);
    expect(length(moved)).toBeCloseTo(radius + 5, 6);
    expect(moved.x).toBeGreaterThan(0);
    expect(moved.y).toBeGreaterThan(0);
    expect(dot(moved, surface.sample(moved).surfaceUp)).toBeGreaterThan(0);
    expect(surface.surfaceDistance(vector(100, 0, 0), vector(0, 100, 0)))
      .toBeCloseTo(Math.PI * radius / 2, 6);
  });

  it('keeps cylinder animals on the inward-facing wall and wraps the angular seam', () => {
    const radius = 50;
    const surface = new TerrainAnimalWorldSurface(
      new ConstantTerrainField(3),
      new CylinderTerrainDomain({
        radiusM: radius,
        lengthM: 100,
        levelZeroAngularPatchCount: 8,
        levelZeroAxialPatchCount: 2,
      }),
    );
    const angle = Math.PI * 2 - 0.01;
    const sample = surface.sample(vector(0, radius * Math.cos(angle), radius * Math.sin(angle)));

    expect(surface.kind).toBe('cylinder');
    expect(sample.surfaceUp.y).toBeLessThan(0);
    expect(sample.surfaceUp.x).toBeCloseTo(0, 6);
    expect(length(vector(sample.position.y, sample.position.z, 0))).toBeCloseTo(radius - 3, 6);
    expect(dot(sample.surfaceUp, sample.tangentU)).toBeCloseTo(0, 6);
    expect(dot(sample.surfaceUp, sample.tangentV)).toBeCloseTo(0, 6);

    const moved = surface.moveAlongSurface(sample.position, vector(0, 0, 20), 1);
    expect(length(vector(moved.y, moved.z, 0))).toBeCloseTo(radius - 3, 6);
    expect(moved.x).toBeCloseTo(0, 6);
    // The positive angular tangent crosses 2π without leaving the cylinder.
    expect(moved.z).toBeGreaterThan(0);
    expect(surface.sample(moved).position).toEqual(jasmine.objectContaining({
      x: jasmine.any(Number),
      y: jasmine.any(Number),
      z: jasmine.any(Number),
    }));
    expect(surface.surfaceDistance(
      vector(0, radius * Math.cos(0.01), radius * Math.sin(0.01)),
      vector(0, radius * Math.cos(-0.01), radius * Math.sin(-0.01)),
    )).toBeCloseTo(radius * 0.02, 6);
  });
});
