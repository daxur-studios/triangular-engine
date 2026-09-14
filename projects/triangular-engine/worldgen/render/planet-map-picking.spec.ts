import { EQUAL_EARTH_PROJECTION, EQUIRECTANGULAR_PROJECTION } from './map-projections';
import {
  intersectPlanarHeightField,
  IPlanarHeightField,
  mapPlanetDirectionToMapXZ,
  mapXZToPlanetDirection,
  samplePlanarHeight,
} from './planet-map-picking';

function makeField(
  width: number,
  height: number,
  bounds: IPlanarHeightField['bounds'],
  heightAt: (worldX: number, worldZ: number, x: number, z: number) => number,
): IPlanarHeightField {
  const elevations = new Float32Array(width * height);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const worldX = bounds.minX + ((x + 0.5) / width) * (bounds.maxX - bounds.minX);
      const worldZ = bounds.minZ + ((z + 0.5) / height) * (bounds.maxZ - bounds.minZ);
      const value = heightAt(worldX, worldZ, x, z);
      elevations[z * width + x] = value;
      minY = Math.min(minY, value);
      maxY = Math.max(maxY, value);
    }
  }
  return { width, height, elevations, bounds, minY, maxY };
}

describe('samplePlanarHeight', () => {
  const bounds = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  const field = makeField(2, 2, bounds, (worldX) => worldX * 2);

  it('bilinearly samples texel centres', () => {
    expect(samplePlanarHeight(field, 0.5, 0.5)).toBeCloseTo(1, 5);
  });

  it('returns 0 outside the map footprint', () => {
    expect(samplePlanarHeight(field, -0.01, 0.5)).toBe(0);
    expect(samplePlanarHeight(field, 0.5, 1.01)).toBe(0);
  });

  it('clamps to edge texels', () => {
    expect(samplePlanarHeight(field, 0, 0)).toBeCloseTo(0.5, 5);
    expect(samplePlanarHeight(field, 1, 1)).toBeCloseTo(1.5, 5);
  });
});

describe('intersectPlanarHeightField', () => {
  it('hits a flat field at the exact surface height', () => {
    const field = makeField(4, 4, { minX: -10, minZ: -10, maxX: 10, maxZ: 10 }, () => 5);
    const hit = intersectPlanarHeightField(field, {
      origin: { x: 5, y: 20, z: 5 },
      direction: { x: 0, y: -1, z: 0 },
    });
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(5, 6);
    expect(hit!.z).toBeCloseTo(5, 6);
    expect(hit!.y).toBeCloseTo(5, 6);
    expect(hit!.distance).toBeCloseTo(15, 6);
  });

  it('hits an analytic slope at the sampled surface', () => {
    const field = makeField(41, 41, { minX: -10, minZ: -10, maxX: 10, maxZ: 10 }, (worldX) => worldX * 0.5);
    const hit = intersectPlanarHeightField(field, {
      origin: { x: 4, y: 20, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
    });
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(4, 1);
    expect(hit!.y).toBeCloseTo(samplePlanarHeight(field, hit!.x, hit!.z), 6);
    expect(hit!.y).toBeCloseTo(2, 1);
  });

  it('returns null for a ray that never drops below the surface', () => {
    const field = makeField(4, 4, { minX: -10, minZ: -10, maxX: 10, maxZ: 10 }, () => 5);
    expect(
      intersectPlanarHeightField(field, {
        origin: { x: 0, y: 5.5, z: 0 },
        direction: { x: 0, y: 1, z: 0 },
      }),
    ).toBeNull();
  });

  it('returns null when the ray misses the map footprint', () => {
    const field = makeField(4, 4, { minX: -10, minZ: -10, maxX: 10, maxZ: 10 }, () => 5);
    expect(
      intersectPlanarHeightField(field, {
        origin: { x: 40, y: 20, z: 40 },
        direction: { x: 0, y: -1, z: 0 },
      }),
    ).toBeNull();
  });

  it('returns null when the ray starts below the sampled surface', () => {
    const field = makeField(4, 4, { minX: -10, minZ: -10, maxX: 10, maxZ: 10 }, () => 5);
    expect(
      intersectPlanarHeightField(field, {
        origin: { x: 0, y: 2, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
      }),
    ).toBeNull();
  });
});

describe('map projection round trip', () => {
  const field = makeField(256, 128, { minX: -128, minZ: -64, maxX: 128, maxZ: 64 }, () => 0);

  it('maps the map centre to the (1, 0, 0) direction and back', () => {
    const direction = mapXZToPlanetDirection(EQUIRECTANGULAR_PROJECTION, field, 0, 0);
    expect(direction).not.toBeNull();
    expect(direction!.x).toBeCloseTo(1, 6);
    expect(direction!.y).toBeCloseTo(0, 6);
    expect(direction!.z).toBeCloseTo(0, 6);

    const xz = mapPlanetDirectionToMapXZ(EQUIRECTANGULAR_PROJECTION, field, direction!);
    expect(xz.x).toBeCloseTo(0, 6);
    expect(xz.z).toBeCloseTo(0, 6);
  });

  it('maps the north pole to the top edge', () => {
    const xz = mapPlanetDirectionToMapXZ(EQUIRECTANGULAR_PROJECTION, field, { x: 0, y: 1, z: 0 });
    expect(xz.x).toBeCloseTo(0, 6);
    expect(xz.z).toBeCloseTo(-64, 6);
  });

  it('rejects a rectangular corner outside the Equal Earth lens', () => {
    expect(mapXZToPlanetDirection(EQUAL_EARTH_PROJECTION, field, -128, -64)).toBeNull();
  });

  it('round-trips a direction through the Equal Earth lens interior', () => {
    const xz = mapPlanetDirectionToMapXZ(EQUAL_EARTH_PROJECTION, field, { x: 1, y: 0, z: 0 });
    const back = mapXZToPlanetDirection(EQUAL_EARTH_PROJECTION, field, xz.x, xz.z);
    expect(back).not.toBeNull();
    expect(back!.x).toBeCloseTo(1, 6);
    expect(back!.y).toBeCloseTo(0, 6);
    expect(back!.z).toBeCloseTo(0, 6);
  });
});
