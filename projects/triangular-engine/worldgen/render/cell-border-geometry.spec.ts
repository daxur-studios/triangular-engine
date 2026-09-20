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

  it('clamps underwater border line vertices to sea level when clampToSeaLevel is true', () => {
    // Negative elevation for all cells (-0.4)
    const elevations = new Array(graph.cells.length).fill(-0.4);
    const heightScale = 0.2;
    const seaLevel = 0.0;

    const geoClamped = buildCellBorderLineGeometry({
      graph,
      elevation: elevations,
      radius: 2.0,
      heightScale,
      seaLevelElevation: seaLevel,
      seabedRelief: true,
      clampToSeaLevel: true,
    });

    const flatPosClamped = geoClamped.getAttribute('aFlatPos');
    // In flat map coordinates, flatZ is elev * heightScale + clearance
    // With clampToSeaLevel=true, elev must be >= seaLevel (0.0)
    for (let i = 0; i < flatPosClamped.count; i++) {
      expect(flatPosClamped.getZ(i)).toBeGreaterThanOrEqual(0.0);
    }
    geoClamped.dispose();

    const geoUnclamped = buildCellBorderLineGeometry({
      graph,
      elevation: elevations,
      radius: 2.0,
      heightScale,
      seaLevelElevation: seaLevel,
      seabedRelief: true,
      clampToSeaLevel: false,
    });

    const flatPosUnclamped = geoUnclamped.getAttribute('aFlatPos');
    // With clampToSeaLevel=false, elev is -0.4, so flatZ = -0.4 * 0.2 + clearance (< 0)
    let foundNegative = false;
    for (let i = 0; i < flatPosUnclamped.count; i++) {
      if (flatPosUnclamped.getZ(i) < 0) {
        foundNegative = true;
        break;
      }
    }
    expect(foundNegative).toBeTrue();
    geoUnclamped.dispose();
  });

  it('clamps underwater territory ribbon vertices to sea level when clampToSeaLevel is true', () => {
    const elevations = new Array(graph.cells.length).fill(-0.4);
    const edges = extractCellBorders(graph).slice(0, 5);

    const geoClamped = buildTerritoryRibbonGeometry({
      edges,
      elevation: elevations,
      radius: 2.0,
      heightScale: 0.2,
      seaLevelElevation: 0.0,
      seabedRelief: true,
      clampToSeaLevel: true,
    });
    const flatPosClamped = geoClamped.getAttribute('aFlatPos');
    for (let i = 0; i < flatPosClamped.count; i++) {
      expect(flatPosClamped.getZ(i)).toBeGreaterThanOrEqual(0.0);
    }
    geoClamped.dispose();

    const geoUnclamped = buildTerritoryRibbonGeometry({
      edges,
      elevation: elevations,
      radius: 2.0,
      heightScale: 0.2,
      seaLevelElevation: 0.0,
      seabedRelief: true,
      clampToSeaLevel: false,
    });
    const flatPosUnclamped = geoUnclamped.getAttribute('aFlatPos');
    let foundNegative = false;
    for (let i = 0; i < flatPosUnclamped.count; i++) {
      if (flatPosUnclamped.getZ(i) < 0) {
        foundNegative = true;
        break;
      }
    }
    expect(foundNegative).toBeTrue();
    geoUnclamped.dispose();
  });

  it('adaptively subdivides edges over mountain relief and stays unsubdivided over flat terrain', () => {
    const singleEdge = extractCellBorders(graph).slice(0, 1);
    const edgeA = singleEdge[0].a;
    const edgeB = singleEdge[0].b;

    // 1. Flat sampler: constant elevation (0.1)
    const flatSampler = {
      sample: () => ({
        elevation: 0.1,
        baseElevation: 0.1,
        ridgeRelief: 0,
        riverCarve: 0,
        seaLevel: 0,
        isLand: true,
      }),
    };

    const geoFlat = buildCellBorderLineGeometry({
      graph,
      edges: singleEdge,
      sampler: flatSampler,
      adaptiveReliefSubdivision: true,
      reliefThreshold: 0.008,
    });
    // For 1 flat edge without antimeridian crossing: exactly 2 vertices (1 segment)
    expect(geoFlat.getAttribute('position').count).toBe(2);
    geoFlat.dispose();

    // 2. Mountain peak sampler: midpoints bulge upward significantly
    const mountainSampler = {
      sample: (dir: { x: number; y: number; z: number }) => {
        // Dot product with midpoint direction to create a peak between A and B
        const midX = (edgeA.x + edgeB.x) * 0.5;
        const midY = (edgeA.y + edgeB.y) * 0.5;
        const midZ = (edgeA.z + edgeB.z) * 0.5;
        const len = Math.hypot(midX, midY, midZ);
        const normMid = { x: midX / len, y: midY / len, z: midZ / len };

        const d = dir.x * normMid.x + dir.y * normMid.y + dir.z * normMid.z;
        // Peak at midpoint (d ~ 1.0)
        const isNearMid = d > 0.999;
        const elev = isNearMid ? 0.5 : 0.1;
        return {
          elevation: elev,
          baseElevation: elev,
          ridgeRelief: 0,
          riverCarve: 0,
          seaLevel: 0,
          isLand: true,
        };
      },
    };

    // Subdivided when adaptiveReliefSubdivision: true
    const geoMountainSubdivided = buildCellBorderLineGeometry({
      graph,
      edges: singleEdge,
      sampler: mountainSampler,
      adaptiveReliefSubdivision: true,
      reliefThreshold: 0.008,
    });
    // Edge is split into 2 segments (4 vertices)
    expect(geoMountainSubdivided.getAttribute('position').count).toBe(4);
    geoMountainSubdivided.dispose();

    // Not subdivided when adaptiveReliefSubdivision: false
    const geoMountainUnsubdivided = buildCellBorderLineGeometry({
      graph,
      edges: singleEdge,
      sampler: mountainSampler,
      adaptiveReliefSubdivision: false,
    });
    expect(geoMountainUnsubdivided.getAttribute('position').count).toBe(2);
    geoMountainUnsubdivided.dispose();
  });

  it('subdivides cell overlay geometry into 4 subtriangles per sector with sampler', () => {
    const flatSampler = {
      sample: () => ({
        elevation: 0.2,
        baseElevation: 0.2,
        ridgeRelief: 0,
        riverCarve: 0,
        seaLevel: 0,
        isLand: true,
      }),
    };

    const geoSubdivided = buildCellOverlayGeometry({
      graph,
      sampler: flatSampler,
      adaptiveReliefSubdivision: true,
    });
    const geoUnsubdivided = buildCellOverlayGeometry({
      graph,
      sampler: flatSampler,
      adaptiveReliefSubdivision: false,
    });

    const posSub = geoSubdivided.getAttribute('position');
    const posUnsub = geoUnsubdivided.getAttribute('position');

    // 4 subtriangles per sector when subdivided
    expect(posSub.count).toBe(posUnsub.count * 4);

    // Verify distance attribute contains center (0.0), spoke midpoints (0.5), and outer boundary (1.0)
    const distAttr = geoSubdivided.getAttribute('aDist');
    let hasZero = false;
    let hasHalf = false;
    let hasOne = false;
    for (let i = 0; i < distAttr.count; i++) {
      const d = distAttr.getX(i);
      if (Math.abs(d - 0.0) < 1e-4) hasZero = true;
      if (Math.abs(d - 0.5) < 1e-4) hasHalf = true;
      if (Math.abs(d - 1.0) < 1e-4) hasOne = true;
    }
    expect(hasZero).toBeTrue();
    expect(hasHalf).toBeTrue();
    expect(hasOne).toBeTrue();

    geoSubdivided.dispose();
    geoUnsubdivided.dispose();
  });

  it('elevates cell overlay geometry to clear interior mountain peaks and scales with heightScale', () => {
    const cell0 = graph.cells[0];
    const center = cell0.center;

    // Peak at cell0 center
    const mountainSampler = {
      sample: (dir: { x: number; y: number; z: number }) => {
        const dotCenter = dir.x * center.x + dir.y * center.y + dir.z * center.z;
        const isNearCenter = dotCenter > 0.99;
        const elev = isNearCenter ? 0.8 : 0.1;
        return {
          elevation: elev,
          baseElevation: elev,
          ridgeRelief: 0,
          riverCarve: 0,
          seaLevel: 0,
          isLand: true,
        };
      },
    };

    const geoScale01 = buildCellOverlayGeometry({
      graph,
      sampler: mountainSampler,
      heightScale: 0.1,
    });
    const geoScale03 = buildCellOverlayGeometry({
      graph,
      sampler: mountainSampler,
      heightScale: 0.3,
    });

    const flatZ01 = geoScale01.getAttribute('aFlatPos').getZ(0);
    const flatZ03 = geoScale03.getAttribute('aFlatPos').getZ(0);

    // flatZ = elev * heightScale + clearance, where clearance also scales with heightScale
    expect(flatZ03).toBeGreaterThan(flatZ01);

    geoScale01.dispose();
    geoScale03.dispose();
  });

  it('scales border line and ribbon clearance dynamically with heightScale', () => {
    const geoLine01 = buildCellBorderLineGeometry({
      graph,
      radius: 2.0,
      heightScale: 0.1,
      minClearance: 0.004,
    });
    const geoLine03 = buildCellBorderLineGeometry({
      graph,
      radius: 2.0,
      heightScale: 0.3,
      minClearance: 0.004,
    });

    const flatZLine01 = geoLine01.getAttribute('aFlatPos').getZ(0);
    const flatZLine03 = geoLine03.getAttribute('aFlatPos').getZ(0);
    expect(flatZLine03).toBeGreaterThan(flatZLine01);

    geoLine01.dispose();
    geoLine03.dispose();
  });

  it('preserves floating ice shelf border elevation when seabedRelief is false', () => {
    const iceSampler = {
      sample: () => ({
        elevation: 0.05,
        baseElevation: 0.05,
        ridgeRelief: 0,
        riverCarve: 0,
        seaLevel: 0,
        isLand: false,
        isIce: true,
      }),
    };

    const geo = buildCellBorderLineGeometry({
      graph,
      sampler: iceSampler,
      seabedRelief: false,
      seaLevelElevation: 0,
      heightScale: 0.1,
      minClearance: 0.004,
    });

    const flatZ = geo.getAttribute('aFlatPos').getZ(0);
    // Should be at elev * heightScale + clearance = 0.05 * 0.1 + clearance > 0.005, not clamped to 0
    expect(flatZ).toBeGreaterThan(0.005);

    geo.dispose();
  });
});

