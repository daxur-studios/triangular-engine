import { Box3, Vector3 } from 'three';
import { LatLonTerrainDomain } from 'triangular-engine/terrain';
import { MAP_PROJECTIONS, type MapProjectionKind } from './map-projections';
import {
  maximumCellPlanetPatchDirectionDot,
  populateCellPlanetMorphPatchBounds,
} from './cell-planet-morph-patch-bounds';

describe('cell planet morph patch bounds', () => {
  const radius = 600_000;
  const relief = 2_000;
  const domain = new LatLonTerrainDomain(radius, 4, 2);
  const roots = domain.createLevelZeroRoots();
  const addresses = [...roots, ...[1, 3, 7].flatMap((level) => [
    { level, x: 0, y: 0 },
    { level, x: 4 * 2 ** level - 1, y: 2 ** level },
    { level, x: 2 * 2 ** level, y: 2 ** level },
  ])];

  for (const kind of ['equirectangular', 'equalEarth'] as const) {
    it(`contains independently sampled elevated terrain throughout the ${kind} morph`, () => {
      const point = new Vector3();
      const box = new Box3();
      let firstOutside: string | undefined;
      for (const morph of [0, 0.02, 0.25, 0.5, 0.9, 1]) {
        for (const address of addresses) {
          const bounds = domain.getPatchBounds(address);
          populateCellPlanetMorphPatchBounds(bounds, radius, morph, kind, relief, 0.0875, box);
          for (let i = 0; i <= 12; i++) {
            for (let j = 0; j <= 12; j++) {
              const lon = bounds.minU + (bounds.maxU - bounds.minU) * i / 12;
              const lat = bounds.minV + (bounds.maxV - bounds.minV) * j / 12;
              const direction = domain.getFieldPosition(address, lon, lat);
              const projection = MAP_PROJECTIONS[kind].project(lon, lat, 2 * Math.PI * radius, Math.PI * radius);
              for (const elevation of [-relief, 0, relief]) {
                point.set(
                  (1 - morph) * direction[0] * (radius + elevation) + morph * (projection.x - Math.PI * radius),
                  (1 - morph) * direction[1] * (radius + elevation) + morph * (Math.PI * radius / 2 - projection.y),
                  (1 - morph) * direction[2] * (radius + elevation) + morph * elevation,
                );
                if (!box.containsPoint(point)) {
                  firstOutside ??= JSON.stringify({ address, morph, lon, lat, elevation, point });
                }
              }
            }
          }
        }
      }
      expect(firstOutside).toBeUndefined();
    });
  }

  it('never shrinks bounds when increasing the visibility buffer', () => {
    for (const kind of ['equirectangular', 'equalEarth'] as MapProjectionKind[]) {
      for (const morph of [0, 0.4, 1]) {
        for (const address of addresses) {
          const bounds = domain.getPatchBounds(address);
          const tight = new Box3();
          const buffered = new Box3();
          populateCellPlanetMorphPatchBounds(bounds, radius, morph, kind, relief, 0, tight);
          populateCellPlanetMorphPatchBounds(bounds, radius, morph, kind, relief, 0.175, buffered);
          expect(buffered.containsBox(tight)).toBeTrue();
        }
      }
    }
  });

  it('finds the closest latitude instead of independently clamping the camera latitude', () => {
    const latitude = 80 * Math.PI / 180;
    const dot = maximumCellPlanetPatchDirectionDot(
      { minU: Math.PI / 2, maxU: Math.PI, minV: 0, maxV: Math.PI / 2 },
      0, latitude,
    );
    expect(dot).toBeCloseTo(Math.sin(latitude), 12);
  });

  it('bounds every sampled direction near both poles and the longitude seam', () => {
    let largestUnderestimate = 0;
    for (const cameraLon of [-Math.PI + 0.001, 0.7, Math.PI - 0.001]) {
      for (const cameraLat of [-Math.PI / 2 + 0.001, -0.3, Math.PI / 2 - 0.001]) {
        const cameraDirection = new Vector3(...domain.getFieldPosition(roots[0], cameraLon, cameraLat));
        for (const address of addresses) {
          const bounds = domain.getPatchBounds(address);
          const maximum = maximumCellPlanetPatchDirectionDot(bounds, cameraLon, cameraLat);
          for (let i = 0; i <= 12; i++) {
            for (let j = 0; j <= 12; j++) {
              const direction = new Vector3(...domain.getFieldPosition(
                address,
                bounds.minU + (bounds.maxU - bounds.minU) * i / 12,
                bounds.minV + (bounds.maxV - bounds.minV) * j / 12,
              ));
              largestUnderestimate = Math.max(largestUnderestimate, cameraDirection.dot(direction) - maximum);
            }
          }
        }
      }
    }
    expect(largestUnderestimate).toBeLessThan(1e-12);
  });
});
