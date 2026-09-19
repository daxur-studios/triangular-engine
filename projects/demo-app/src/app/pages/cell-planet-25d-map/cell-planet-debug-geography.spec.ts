import { EQUIRECTANGULAR_PROJECTION } from 'triangular-engine/worldgen/render';
import { buildPlanarDebugRibbonGeometry, projectPlanarDebugPoint } from './cell-planet-debug-geography';

describe('buildPlanarDebugRibbonGeometry', () => {
  const base = {
    projection: EQUIRECTANGULAR_PROJECTION,
    mapWidth: 2 * Math.PI,
    mapHeight: Math.PI,
    minX: -Math.PI,
    minZ: -Math.PI * 0.5,
    maxX: Math.PI,
    maxZ: Math.PI * 0.5,
    clearance: 0.1,
    defaultWidth: 0.2,
    heightAt: () => 1,
  };

  it('uses the same longitude axis as the 2.5D bake', () => {
    const pointAtLon0 = projectPlanarDebugPoint({ x: 1, y: 0, z: 0 }, base);
    const pointAtLon90 = projectPlanarDebugPoint({ x: 0, y: 0, z: 1 }, base);
    // (1, 0, 0) is lon 0 -> map X 0; (0, 0, 1) is lon pi/2 -> map X pi/2.
    expect(pointAtLon0.x).toBeCloseTo(0, 5);
    expect(pointAtLon90.x).toBeCloseTo(Math.PI / 2, 5);
  });

  it('closes coastline loops and preserves per-point widths', () => {
    const geometry = buildPlanarDebugRibbonGeometry({
      ...base,
      paths: [[
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: -1 },
      ]],
      closed: true,
      pointWidths: [[0.1, 0.2, 0.3]],
    });

    expect(geometry.getAttribute('position').count).toBe(12);
    expect(geometry.index?.count).toBe(18);
    expect((geometry.getAttribute('position').array as Float32Array)[1]).toBeCloseTo(1.1);
  });

  it('drops antimeridian segments instead of stretching across the map', () => {
    const geometry = buildPlanarDebugRibbonGeometry({
      ...base,
      paths: [[
        { x: Math.cos(Math.PI - 0.01), y: 0, z: Math.sin(Math.PI - 0.01) },
        { x: Math.cos(-Math.PI + 0.01), y: 0, z: Math.sin(-Math.PI + 0.01) },
      ]],
      closed: false,
    });

    expect(geometry.getAttribute('position').count).toBe(0);
    expect(geometry.index?.count).toBe(0);
  });

  it('clamps underwater paths and subdivides over midpoint relief', () => {
    const geometry = buildPlanarDebugRibbonGeometry({
      ...base,
      paths: [[
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ]],
      closed: false,
      seaLevelElevation: 0,
      clampToSeaLevel: true,
      adaptiveReliefSubdivision: true,
      reliefThreshold: 0.5,
      maxSubdivisionDepth: 1,
      heightAt: (direction) => direction.x > 0.9 || direction.z > 0.9 ? -1 : 1,
    });

    // The elevated midpoint forces two ribbon segments, while both underwater endpoints are
    // lifted to sea level before the debug clearance is applied.
    expect(geometry.getAttribute('position').count).toBe(8);
    const positions = geometry.getAttribute('position').array as Float32Array;
    for (let index = 1; index < positions.length; index += 3) {
      expect(positions[index]).toBeGreaterThanOrEqual(0.1);
    }
  });
});
