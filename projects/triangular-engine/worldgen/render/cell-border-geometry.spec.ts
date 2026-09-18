import {
  buildPlanetGraphCore,
  extractCellBorders,
} from 'triangular-engine/worldgen';
import {
  buildCellBorderLineGeometry,
  buildCellOverlayGeometry,
  buildTerritoryRibbonGeometry,
} from './cell-border-geometry';

describe('cell-border-geometry', () => {
  const graph = buildPlanetGraphCore({
    cellCount: 40,
    seed: 12,
    relaxationIterations: 1,
  });

  it('builds cell border LineSegments geometry with morph attributes', () => {
    const geo = buildCellBorderLineGeometry({
      graph,
      radius: 2.0,
      heightScale: 0.16,
    });

    expect(geo.getAttribute('position')).toBeDefined();
    expect(geo.getAttribute('aSpherePos')).toBeDefined();
    expect(geo.getAttribute('aFlatPos')).toBeDefined();
    expect(geo.getAttribute('aSphereNorm')).toBeDefined();
    expect(geo.getAttribute('aFlatNorm')).toBeDefined();
    expect(geo.getAttribute('aCellIds')).toBeDefined();

    // Verify vertex count is a multiple of 2 (line segments)
    const pos = geo.getAttribute('position');
    expect(pos.count % 2).toBe(0);
    expect(pos.count).toBeGreaterThan(0);
    expect(geo.boundingSphere).toBeDefined();

    geo.dispose();
  });

  it('builds territory ribbon geometry with valid triangles and UVs', () => {
    const edges = extractCellBorders(graph).slice(0, 10);
    const geo = buildTerritoryRibbonGeometry({
      edges,
      radius: 2.0,
      ribbonWidth: 0.02,
    });

    const pos = geo.getAttribute('position');
    const uvs = geo.getAttribute('uv');
    const index = geo.getIndex();

    expect(pos.count).toBeGreaterThanOrEqual(edges.length * 4); // 4 vertices per quad segment
    expect(uvs.count).toBe(pos.count);
    expect(index).toBeDefined();
    expect(index!.count).toBe((pos.count / 4) * 6); // 2 triangles (6 indices) per quad segment

    geo.dispose();
  });

  it('builds cell overlay fan geometry with cellId and dist attributes', () => {
    const geo = buildCellOverlayGeometry({
      graph,
      radius: 2.0,
    });

    const pos = geo.getAttribute('position');
    const cellIdAttr = geo.getAttribute('aCellId');
    const distAttr = geo.getAttribute('aDist');
    const other1 = geo.getAttribute('aOtherDir1');
    const other2 = geo.getAttribute('aOtherDir2');

    expect(pos.count).toBeGreaterThan(0);
    expect(pos.count % 3).toBe(0); // Triangles
    expect(cellIdAttr.count).toBe(pos.count);
    expect(distAttr.count).toBe(pos.count);
    expect(other1.count).toBe(pos.count);
    expect(other2.count).toBe(pos.count);

    // Verify aDist contains both 0 (center) and 1 (corners)
    let hasZero = false;
    let hasOne = false;
    for (let i = 0; i < distAttr.count; i++) {
      if (distAttr.getX(i) === 0) hasZero = true;
      if (distAttr.getX(i) === 1) hasOne = true;
    }
    expect(hasZero).toBeTrue();
    expect(hasOne).toBeTrue();

    geo.dispose();
  });

  it('assigns both counterpart directions per overlay vertex so the seam test can see every edge', () => {
    const geo = buildCellOverlayGeometry({ graph, radius: 2.0 });

    const self = geo.getAttribute('aSphereNorm');
    const other1 = geo.getAttribute('aOtherDir1');
    const other2 = geo.getAttribute('aOtherDir2');

    const key = (x: number, y: number, z: number): string =>
      `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;

    for (let tri = 0; tri < self.count / 3; tri++) {
      const dirs: string[][] = [];
      for (let v = 0; v < 3; v++) {
        const i = tri * 3 + v;
        dirs.push([
          key(self.getX(i), self.getY(i), self.getZ(i)),
          key(other1.getX(i), other1.getY(i), other1.getZ(i)),
          key(other2.getX(i), other2.getY(i), other2.getZ(i)),
        ]);
      }

      // Every vertex of a triangle must reference the same three corner directions, otherwise the
      // shader's pairwise angular-span test can miss the edge that crosses the antimeridian.
      const sorted = dirs.map((d) => [...d].sort().join('|'));
      expect(sorted[0]).toBe(sorted[1]);
      expect(sorted[1]).toBe(sorted[2]);
    }

    geo.dispose();
  });
});
