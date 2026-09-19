import {
  buildPlanetMorphBorderGeometry,
  evaluateLeftBorderTrack,
  evaluateTopBorderTrack,
} from './planet-morph-border-geometry';

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

  describe('evaluateTopBorderTrack', () => {
    it('evaluates top track position in 2.5D flat mode', () => {
      const topCenter = evaluateTopBorderTrack(0, 2.0, 'equalEarth', 1.0);
      expect(topCenter.position.x).toBeCloseTo(0, 3);
      expect(topCenter.position.y).toBeCloseTo(3.058, 2);
      expect(topCenter.normal.z).toBeCloseTo(1, 3);
    });

    it('evaluates top track position in 3D sphere mode', () => {
      const topCenter = evaluateTopBorderTrack(0, 2.0, 'equalEarth', 0.0);
      expect(topCenter.position.y).toBeGreaterThan(1.5); // near North Pole
    });
  });

  describe('evaluateLeftBorderTrack', () => {
    it('curves along Equal Earth arc in flat mode', () => {
      // Equator (lat = 0) is at widest extent: -mapWidth / 2 = -2 * PI = -6.283
      const equator = evaluateLeftBorderTrack(0, 2.0, 'equalEarth', 1.0);
      expect(equator.position.x).toBeCloseTo(-2 * Math.PI, 2);
      expect(equator.position.y).toBeCloseTo(0, 3);

      // North Pole (lat = PI/2) narrows inward in Equal Earth
      const northPole = evaluateLeftBorderTrack(Math.PI / 2, 2.0, 'equalEarth', 1.0);
      expect(Math.abs(northPole.position.x)).toBeLessThan(Math.abs(equator.position.x));
      expect(northPole.position.y).toBeCloseTo(3.058, 2);
    });

    it('stays along a straight vertical line in Equirectangular', () => {
      const equator = evaluateLeftBorderTrack(0, 2.0, 'equirectangular', 1.0);
      const northPole = evaluateLeftBorderTrack(Math.PI / 2, 2.0, 'equirectangular', 1.0);
      const southPole = evaluateLeftBorderTrack(-Math.PI / 2, 2.0, 'equirectangular', 1.0);

      expect(equator.position.x).toBeCloseTo(-2 * Math.PI, 3);
      expect(northPole.position.x).toBeCloseTo(-2 * Math.PI, 3);
      expect(southPole.position.x).toBeCloseTo(-2 * Math.PI, 3);
    });
  });
});

