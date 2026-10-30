import { planetMapRowHalfWidth, planetMapXY, planetMapExtents, PLANET_MAP_EQUAL_EARTH_SCALE } from 'triangular-engine/planet-material';
import { blendedExtents, blendedProjection, equalEarthRow } from './bent-planet';

/**
 * The atmosphere's CPU twin (`blendedProjection`) and the globe material's map (`planetMapXY`) are the same Equal Earth
 * up to one constant: the material fits the equator to `2 pi R`, the atmosphere uses the unit-sphere form. This pins
 * that constant so the atmosphere can move onto the material's map (Plan 059, G6e) knowing exactly what changes.
 */
describe('blendedProjection vs the planet material map', () => {
  const R = 6_371_000;
  const pts: [number, number][] = [];
  for (const lon of [-3, -1.5, -0.2, 0.4, 2.2, 3.1]) {
    for (const lat of [-1.5, -0.9, -0.2, 0.3, 1.1, 1.5]) pts.push([lon, lat]);
  }

  it('is narrower and shorter than the material by the constant PLANET_MAP_EQUAL_EARTH_SCALE at morph 1', () => {
    for (const [lon, lat] of pts) {
      const atmosphere = blendedProjection(lon, lat, 1, R);
      const material = planetMapXY(lon, lat, 1, 'equal-earth', R);
      expect(material[0] / atmosphere[0]).withContext(`x @ ${lon},${lat}`).toBeCloseTo(PLANET_MAP_EQUAL_EARTH_SCALE, 9);
      expect(material[1] / atmosphere[1]).withContext(`y @ ${lon},${lat}`).toBeCloseTo(PLANET_MAP_EQUAL_EARTH_SCALE, 9);
    }
  });

  it('is the same map at morph 0 (the globe parameterisation)', () => {
    for (const [lon, lat] of pts) {
      const atmosphere = blendedProjection(lon, lat, 0, R);
      const material = planetMapXY(lon, lat, 0, 'equal-earth', R);
      expect(material[0]).toBeCloseTo(atmosphere[0], 6);
      expect(material[1]).toBeCloseTo(atmosphere[1], 6);
    }
  });

  it('shares the unit-sphere Equal Earth row with the material scale applied', () => {
    for (const lat of [-1.4, 0, 0.8]) {
      const row = equalEarthRow(lat);
      const xAtLon1 = planetMapXY(1, lat, 1, 'equal-earth', 1)[0];
      expect(xAtLon1).toBeCloseTo(PLANET_MAP_EQUAL_EARTH_SCALE * row.c, 9);
    }
  });

  it('has the atmosphere blend p = 1 outline narrower than the material outline by the same constant', () => {
    const atmosphere = blendedExtents(1, R);
    const material = planetMapExtents(1, 'equal-earth', R);
    expect(material.halfWidth / atmosphere.halfWidth).toBeCloseTo(PLANET_MAP_EQUAL_EARTH_SCALE, 9);
    expect(material.halfHeight / atmosphere.halfHeight).toBeCloseTo(PLANET_MAP_EQUAL_EARTH_SCALE, 9);
    // The material's row outline at the pole, against the atmosphere's pole row scaled the same way.
    const pole = equalEarthRow(Math.PI / 2).c;
    expect(planetMapRowHalfWidth(Math.PI / 2, 1, 'equal-earth', R)).toBeCloseTo(
      Math.PI * R * PLANET_MAP_EQUAL_EARTH_SCALE * pole,
      3,
    );
  });
});
