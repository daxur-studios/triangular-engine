import { EQUIRECTANGULAR_PROJECTION } from 'triangular-engine/worldgen/render';
import { buildPlanarDebugRibbonGeometry } from './cell-planet-debug-geography';

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
    const geometry = buildPlanarDebugRibbonGeometry({
      ...base,
      paths: [[
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ]],
      closed: false,
    });

    const positions = geometry.getAttribute('position');
    // (1, 0, 0) is lon 0 -> map X 0; (0, 0, 1) is lon pi/2 -> map X pi/2.
    expect(positions.getX(0)).toBeCloseTo(0, 5);
    expect(positions.getX(2)).toBeCloseTo(Math.PI / 2, 5);
    geometry.dispose();
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
});
