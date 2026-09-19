import { buildPlanetMorphBorderGeometry } from './planet-morph-border-geometry';

describe('buildPlanetMorphBorderGeometry', () => {
  it('generates a valid BufferGeometry with required attributes for equalEarth', () => {
    const data = buildPlanetMorphBorderGeometry({
      radius: 2.0,
      borderWidth: 0.05,
      projectionKind: 'equalEarth',
      longitudeSegments: 32,
      latitudeRings: 16,
    });

    expect(data.geometry).toBeDefined();
    expect(data.vertexCount).toBeGreaterThan(0);
    expect(data.triangleCount).toBe(data.vertexCount / 3);
    expect(data.borderWidth).toBe(0.05);

    const attrs = data.geometry.attributes;
    expect(attrs['position']).toBeDefined();
    expect(attrs['aSpherePos']).toBeDefined();
    expect(attrs['aFlatPos']).toBeDefined();
    expect(attrs['aSphereNorm']).toBeDefined();
    expect(attrs['aFlatNorm']).toBeDefined();
    expect(attrs['uv']).toBeDefined();
    expect(attrs['aTick']).toBeDefined();

    expect(attrs['position'].count).toBe(data.vertexCount);
    expect(attrs['aSpherePos'].count).toBe(data.vertexCount);
    expect(attrs['aFlatPos'].count).toBe(data.vertexCount);
  });

  it('generates geometry for equirectangular projection with expected bounding sphere', () => {
    const data = buildPlanetMorphBorderGeometry({
      radius: 1.5,
      borderWidth: 0.08,
      projectionKind: 'equirectangular',
      longitudeSegments: 24,
      latitudeRings: 12,
    });

    expect(data.geometry.boundingSphere).toBeDefined();
    expect(data.geometry.boundingSphere!.radius).toBeGreaterThanOrEqual(1.5 * 3);
    expect(data.mapWidth).toBeCloseTo(2 * Math.PI * 1.5, 3);
    expect(data.mapHeight).toBeCloseTo(Math.PI * 1.5, 3);
  });

  it('contains tick marks along the perimeter', () => {
    const data = buildPlanetMorphBorderGeometry({
      radius: 2.0,
      longitudeSegments: 48,
      latitudeRings: 24,
    });

    const ticks = data.geometry.attributes['aTick'].array as Float32Array;
    let tickCount = 0;
    for (let i = 0; i < ticks.length; i++) {
      if (ticks[i] > 0.5) tickCount++;
    }
    expect(tickCount).toBeGreaterThan(0);
  });
});
