import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CityTransitGraphBuilder } from '../core/city-transit-graph';
import { ICityCrossSection, ICityTransitGraph } from '../core/city-transit-types';

export interface IVoronoiCell {
  readonly id: string;
  readonly center: [number, number]; // [x, z]
  readonly polygon: readonly [number, number][]; // vertices in CCW order
}

export interface IVoronoiCityResult {
  readonly cells: readonly IVoronoiCell[];
  readonly buildingsMeshGeometry: BufferGeometry;
  readonly roadMeshGeometry: BufferGeometry;
  readonly buildingCount: number;
  readonly graph: ICityTransitGraph;
}

export interface IVoronoiCityConfig {
  readonly radiusM?: number;
  readonly seedCount?: number;
  readonly lloydIterations?: number;
  readonly streetWidthM?: number;
  readonly maxStories?: number; // 2 to 4 stories (default: 3)
  readonly density?: number;
  readonly seed?: number;
}

function createRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sutherland-Hodgman convex polygon clipping.
 */
function clipPolygonWithHalfPlane(
  polygon: readonly [number, number][],
  planeP: [number, number],
  planeNormal: [number, number],
): [number, number][] {
  if (polygon.length === 0) return [];
  const out: [number, number][] = [];

  const isInside = (p: [number, number]) => {
    return (p[0] - planeP[0]) * planeNormal[0] + (p[1] - planeP[1]) * planeNormal[1] <= 1e-6;
  };

  const computeIntersection = (p1: [number, number], p2: [number, number]): [number, number] => {
    const d1 = (p1[0] - planeP[0]) * planeNormal[0] + (p1[1] - planeP[1]) * planeNormal[1];
    const d2 = (p2[0] - planeP[0]) * planeNormal[0] + (p2[1] - planeP[1]) * planeNormal[1];
    const denom = d1 - d2;
    if (Math.abs(denom) < 1e-7) return [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5];
    const t = Math.max(0, Math.min(1, d1 / denom));
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  };

  let prev = polygon[polygon.length - 1];
  let prevInside = isInside(prev);

  for (let i = 0; i < polygon.length; i++) {
    const curr = polygon[i];
    const currInside = isInside(curr);

    if (currInside) {
      if (!prevInside) {
        out.push(computeIntersection(prev, curr));
      }
      out.push(curr);
    } else if (prevInside) {
      out.push(computeIntersection(prev, curr));
    }

    prev = curr;
    prevInside = currInside;
  }

  return out;
}

/**
 * Calculates polygon centroid.
 */
export function computePolygonCentroid(polygon: readonly [number, number][]): [number, number] {
  if (polygon.length === 0) return [0, 0];
  let cx = 0;
  let cz = 0;
  let signedArea = 0;

  for (let i = 0; i < polygon.length; i++) {
    const p0 = polygon[i];
    const p1 = polygon[(i + 1) % polygon.length];
    const a = p0[0] * p1[1] - p1[0] * p0[1];
    signedArea += a;
    cx += (p0[0] + p1[0]) * a;
    cz += (p0[1] + p1[1]) * a;
  }

  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-4) {
    let sx = 0;
    let sz = 0;
    for (const p of polygon) {
      sx += p[0];
      sz += p[1];
    }
    return [sx / polygon.length, sz / polygon.length];
  }

  return [cx / (6 * signedArea), cz / (6 * signedArea)];
}

/**
 * Computes Voronoi cells bounded by a circular area.
 */
export function computeVoronoiCells(
  seeds: readonly [number, number][],
  boundRadius: number,
): IVoronoiCell[] {
  const R = boundRadius * 1.35;
  const cells: IVoronoiCell[] = [];

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    let poly: [number, number][] = [
      [-R, -R],
      [R, -R],
      [R, R],
      [-R, R],
    ];

    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      const other = seeds[j];
      const midX = (seed[0] + other[0]) * 0.5;
      const midZ = (seed[1] + other[1]) * 0.5;
      const nx = other[0] - seed[0];
      const nz = other[1] - seed[1];
      const len = Math.sqrt(nx * nx + nz * nz);
      if (len < 1e-4) continue;

      poly = clipPolygonWithHalfPlane(poly, [midX, midZ], [nx / len, nz / len]);
      if (poly.length < 3) break;
    }

    if (poly.length >= 3) {
      cells.push({
        id: `cell_${i}`,
        center: seed,
        polygon: poly,
      });
    }
  }

  return cells;
}

/**
 * Computes the inward-offset (inset) polygon for a convex Voronoi block.
 */
export function insetPolygon(
  polygon: readonly [number, number][],
  setbackM: number,
  centroid: [number, number],
): [number, number][] {
  const n = polygon.length;
  if (n < 3) return [];
  const inset: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    const dPrevX = curr[0] - prev[0];
    const dPrevZ = curr[1] - prev[1];
    const lenPrev = Math.sqrt(dPrevX * dPrevX + dPrevZ * dPrevZ);
    if (lenPrev < 1e-4) continue;

    const dNextX = next[0] - curr[0];
    const dNextZ = next[1] - curr[1];
    const lenNext = Math.sqrt(dNextX * dNextX + dNextZ * dNextZ);
    if (lenNext < 1e-4) continue;

    let n1x = -dPrevZ / lenPrev;
    let n1z = dPrevX / lenPrev;
    let n2x = -dNextZ / lenNext;
    let n2z = dNextX / lenNext;

    const toCentroidX = centroid[0] - curr[0];
    const toCentroidZ = centroid[1] - curr[1];
    if (n1x * toCentroidX + n1z * toCentroidZ < 0) {
      n1x = -n1x;
      n1z = -n1z;
    }
    if (n2x * toCentroidX + n2z * toCentroidZ < 0) {
      n2x = -n2x;
      n2z = -n2z;
    }

    const bisectX = n1x + n2x;
    const bisectZ = n1z + n2z;
    const bisectLen = Math.sqrt(bisectX * bisectX + bisectZ * bisectZ);

    if (bisectLen < 1e-4) {
      inset.push([curr[0] + n1x * setbackM, curr[1] + n1z * setbackM]);
    } else {
      const scale = Math.min(setbackM * 2.0, setbackM / Math.max(0.35, bisectLen * 0.5));
      inset.push([
        curr[0] + (bisectX / bisectLen) * scale,
        curr[1] + (bisectZ / bisectLen) * scale,
      ]);
    }
  }

  return inset;
}

const OLD_TOWN_WALL_PALETTE = [
  0xd97c55, // Venetian terracotta
  0xdfa074, // Warm ochre
  0xe3bb88, // Tuscan sandstone
  0xba6a50, // Burnt Sienna
  0xcaa27d, // Roman travertine
  0x948375, // Historic stone grey
];

const ROOF_PALETTE = [
  0xa63a22, // Deep clay tile red
  0xbf492e, // Terracotta orange tile
  0x8c2b18, // Rustic dark brick roof
  0x4a7060, // Copper green patina (cathedral/tower spires)
];

/**
 * Builds a charming 2-3 story European old-town building with pitched roof and foundation.
 */
export function buildOldTownBuildingGeometry(
  quad: readonly [number, number][],
  groundElevation: number,
  storyCount: number,
  isCathedralTower: boolean,
  wallColorHex: number,
  roofColorHex: number,
): BufferGeometry {
  const [p0, p1, p2, p3] = quad;
  const floorHeightM = 3.2;
  const wallHeightM = isCathedralTower ? 26.0 : storyCount * floorHeightM;
  const roofHeightM = isCathedralTower ? 8.0 : 2.5;
  const foundationDepthM = 2.0;

  const yBase = groundElevation - foundationDepthM;
  const yEaves = groundElevation + wallHeightM;
  const yRidge = yEaves + roofHeightM;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  const wallCol = new Color(wallColorHex);
  const roofCol = new Color(roofColorHex);

  const addTri = (
    v0: [number, number, number],
    v1: [number, number, number],
    v2: [number, number, number],
    col: Color,
  ) => {
    // Normal calculation
    const e1x = v1[0] - v0[0];
    const e1y = v1[1] - v0[1];
    const e1z = v1[2] - v0[2];
    const e2x = v2[0] - v0[0];
    const e2y = v2[1] - v0[1];
    const e2z = v2[2] - v0[2];

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const n: [number, number, number] =
      len > 1e-4 ? [nx / len, ny / len, nz / len] : [0, 1, 0];

    positions.push(v0[0], v0[1], v0[2]);
    positions.push(v1[0], v1[1], v1[2]);
    positions.push(v2[0], v2[1], v2[2]);

    normals.push(n[0], n[1], n[2]);
    normals.push(n[0], n[1], n[2]);
    normals.push(n[0], n[1], n[2]);

    colors.push(col.r, col.g, col.b);
    colors.push(col.r, col.g, col.b);
    colors.push(col.r, col.g, col.b);
  };

  const addQuad = (
    v0: [number, number, number],
    v1: [number, number, number],
    v2: [number, number, number],
    v3: [number, number, number],
    col: Color,
  ) => {
    addTri(v0, v1, v2, col);
    addTri(v0, v2, v3, col);
  };

  // 1. Vertical Walls
  const eIdxs: [number, number][] = [
    [0, 1], // Street facade
    [1, 2], // Right party wall
    [2, 3], // Courtyard facade
    [3, 0], // Left party wall
  ];

  for (const [iA, iB] of eIdxs) {
    const a = quad[iA];
    const b = quad[iB];
    addQuad(
      [a[0], yBase, a[1]],
      [b[0], yBase, b[1]],
      [b[0], yEaves, b[1]],
      [a[0], yEaves, a[1]],
      wallCol,
    );
  }

  // 2. Pitched / Hipped Roof
  // Midpoint ridge line between front and back
  const r0: [number, number, number] = [
    (p0[0] + p3[0]) * 0.5,
    yRidge,
    (p0[1] + p3[1]) * 0.5,
  ];
  const r1: [number, number, number] = [
    (p1[0] + p2[0]) * 0.5,
    yRidge,
    (p1[1] + p2[1]) * 0.5,
  ];

  // Street-facing roof slope
  addQuad(
    [p0[0], yEaves, p0[1]],
    [p1[0], yEaves, p1[1]],
    r1,
    r0,
    roofCol,
  );

  // Courtyard-facing roof slope
  addQuad(
    [p2[0], yEaves, p2[1]],
    [p3[0], yEaves, p3[1]],
    r0,
    r1,
    roofCol,
  );

  // Left & Right roof gable ends
  addTri([p3[0], yEaves, p3[1]], [p0[0], yEaves, p0[1]], r0, roofCol);
  addTri([p1[0], yEaves, p1[1]], [p2[0], yEaves, p2[1]], r1, roofCol);

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  return geom;
}

/**
 * Generates an organic Voronoi Old-Town city with:
 * 1. Clean continuous 0-overlap polygonal road network (cobblestone streets + seamless intersection caps)
 * 2. 2-3 story historic European building blocks with pitched roofs, courtyards, and zero Z-fighting
 */
export function generateVoronoiCity(
  sampleGroundElevation: (x: number, z: number) => number,
  crossSection: ICityCrossSection,
  config: IVoronoiCityConfig = {},
): IVoronoiCityResult {
  const radius = config.radiusM ?? 110.0;
  const seedCount = config.seedCount ?? 28;
  const lloydIters = config.lloydIterations ?? 2;
  const streetWidth = config.streetWidthM ?? crossSection.roadwayWidthM + 2 * crossSection.sidewalkWidthM;
  const density = config.density ?? 0.85;
  const rng = createRng(config.seed ?? 777);

  // 1. Generate distributed seed points
  let seedPoints: [number, number][] = [];
  for (let i = 0; i < seedCount; i++) {
    const r = Math.sqrt(rng()) * (radius * 0.92);
    const theta = rng() * Math.PI * 2;
    seedPoints.push([Math.cos(theta) * r, Math.sin(theta) * r]);
  }

  // 2. Lloyd Relaxation
  let cells: IVoronoiCell[] = [];
  for (let iter = 0; iter < lloydIters; iter++) {
    cells = computeVoronoiCells(seedPoints, radius);
    seedPoints = cells.map((c) => computePolygonCentroid(c.polygon));
  }
  cells = computeVoronoiCells(seedPoints, radius);

  // 3. Build transit graph from cell boundary edges
  const graphBuilder = new CityTransitGraphBuilder();
  const nodeMap = new Map<string, string>();
  let nodeCounter = 0;

  const quantizeCoord = (val: number) => Math.round(val * 2) / 2;
  const getOrCreateNode = (x: number, z: number): string => {
    const key = `${quantizeCoord(x)},${quantizeCoord(z)}`;
    const existing = nodeMap.get(key);
    if (existing) return existing;

    const id = `vn_${nodeCounter++}`;
    const y = sampleGroundElevation(x, z);
    graphBuilder.addNode({
      id,
      position: [x, y, z],
      layer: 0,
      junctionType: 'intersection',
    });
    nodeMap.set(key, id);
    return id;
  };

  const addedEdges = new Set<string>();
  let edgeCounter = 0;

  for (const cell of cells) {
    const poly = cell.polygon;
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];

      const d0 = Math.sqrt(p0[0] * p0[0] + p0[1] * p0[1]);
      const d1 = Math.sqrt(p1[0] * p1[0] + p1[1] * p1[1]);
      if (d0 > radius * 1.05 && d1 > radius * 1.05) continue;

      const n0 = getOrCreateNode(p0[0], p0[1]);
      const n1 = getOrCreateNode(p1[0], p1[1]);
      if (n0 === n1) continue;

      const edgeKey = [n0, n1].sort().join('--');
      if (!addedEdges.has(edgeKey)) {
        addedEdges.add(edgeKey);
        graphBuilder.addEdge({
          id: `ve_${edgeCounter++}`,
          fromNodeId: n0,
          toNodeId: n1,
          layer: 0,
          allowedTransitTypes: ['car', 'pedestrian'],
          speedLimitKmh: 35,
          crossSection,
        });
      }
    }
  }

  // 4. Generate Inset Blocks & 2-3 Story Buildings + Continuous Road Polygons
  const buildingGeometries: BufferGeometry[] = [];
  const roadGeometries: BufferGeometry[] = [];
  let buildingCount = 0;
  const setbackM = streetWidth * 0.5; // Half-width street setback

  // Pre-calculate inset polygons for every cell
  const cellInsets = new Map<string, [number, number][]>();
  for (const cell of cells) {
    const centroid = computePolygonCentroid(cell.polygon);
    const distToCenter = Math.sqrt(centroid[0] * centroid[0] + centroid[1] * centroid[1]);
    if (distToCenter <= radius * 1.05) {
      const inset = insetPolygon(cell.polygon, setbackM, centroid);
      if (inset.length >= 3) {
        cellInsets.set(cell.id, inset);
      }
    }
  }

  // A. Generate Clean Continuous Road Mesh between adjacent cell insets
  for (let cA = 0; cA < cells.length; cA++) {
    const cellA = cells[cA];
    const insetA = cellInsets.get(cellA.id);
    if (!insetA) continue;

    for (let cB = cA + 1; cB < cells.length; cB++) {
      const cellB = cells[cB];
      const insetB = cellInsets.get(cellB.id);
      if (!insetB) continue;

      // Find shared boundary edge in the original Voronoi partition
      for (let iA = 0; iA < cellA.polygon.length; iA++) {
        const pA0 = cellA.polygon[iA];
        const pA1 = cellA.polygon[(iA + 1) % cellA.polygon.length];

        for (let iB = 0; iB < cellB.polygon.length; iB++) {
          const pB0 = cellB.polygon[iB];
          const pB1 = cellB.polygon[(iB + 1) % cellB.polygon.length];

          // Check if edge is shared (reversed direction)
          const isShared =
            (Math.hypot(pA0[0] - pB1[0], pA0[1] - pB1[1]) < 0.5 &&
              Math.hypot(pA1[0] - pB0[0], pA1[1] - pB0[1]) < 0.5);

          if (isShared && iA < insetA.length && iB < insetB.length) {
            const uA0 = insetA[iA];
            const uA1 = insetA[(iA + 1) % insetA.length];
            const uB0 = insetB[iB];
            const uB1 = insetB[(iB + 1) % insetB.length];

            // Build clean quad connecting both insets
            const yA0 = sampleGroundElevation(uA0[0], uA0[1]) + 0.05;
            const yA1 = sampleGroundElevation(uA1[0], uA1[1]) + 0.05;
            const yB0 = sampleGroundElevation(uB0[0], uB0[1]) + 0.05;
            const yB1 = sampleGroundElevation(uB1[0], uB1[1]) + 0.05;

            const roadPositions = [
              uA0[0], yA0, uA0[1],
              uA1[0], yA1, uA1[1],
              uB0[0], yB0, uB0[1],

              uA0[0], yA0, uA0[1],
              uB0[0], yB0, uB0[1],
              uB1[0], yB1, uB1[1],
            ];

            const roadNormals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
            const roadGeom = new BufferGeometry();
            roadGeom.setAttribute('position', new BufferAttribute(new Float32Array(roadPositions), 3));
            roadGeom.setAttribute('normal', new BufferAttribute(new Float32Array(roadNormals), 3));
            roadGeometries.push(roadGeom);
          }
        }
      }
    }
  }

  // B. Generate 2-3 Story Buildings with Shared Party Walls & Pitched Roofs
  for (const cell of cells) {
    const insetPoly = cellInsets.get(cell.id);
    if (!insetPoly || insetPoly.length < 3) continue;

    const centroid = computePolygonCentroid(cell.polygon);
    const distToCenter = Math.sqrt(centroid[0] * centroid[0] + centroid[1] * centroid[1]);
    if (distToCenter > radius * 0.95) continue;

    const centerFactor = 1.0 - distToCenter / radius;

    // Public Piazza / Open Square in the very center
    const isPiazza = distToCenter < radius * 0.18 && rng() > 0.6;
    if (isPiazza) continue;

    // Inner courtyard polygon
    const courtyardDepth = 9.0 + rng() * 4.0;
    const courtyardPoly = insetPolygon(insetPoly, courtyardDepth, centroid);
    if (courtyardPoly.length < 3) continue;

    for (let i = 0; i < insetPoly.length; i++) {
      if (rng() > density) continue;

      const u0 = insetPoly[i];
      const u1 = insetPoly[(i + 1) % insetPoly.length];
      const q1 = courtyardPoly[(i + 1) % courtyardPoly.length];
      const q0 = courtyardPoly[i];

      const edgeDx = u1[0] - u0[0];
      const edgeDz = u1[1] - u0[1];
      const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
      if (edgeLen < 6.0) continue;

      // Slices along the street edge
      const numSlices = edgeLen > 22.0 ? 3 : edgeLen > 12.0 ? 2 : 1;

      for (let s = 0; s < numSlices; s++) {
        const t0 = s / numSlices;
        const t1 = (s + 1) / numSlices;

        const subP0: [number, number] = [
          u0[0] + t0 * (u1[0] - u0[0]),
          u0[1] + t0 * (u1[1] - u0[1]),
        ];
        const subP1: [number, number] = [
          u0[0] + t1 * (u1[0] - u0[0]),
          u0[1] + t1 * (u1[1] - u0[1]),
        ];
        const subP2: [number, number] = [
          q0[0] + t1 * (q1[0] - q0[0]),
          q0[1] + t1 * (q1[1] - q0[1]),
        ];
        const subP3: [number, number] = [
          q0[0] + t0 * (q1[0] - q0[0]),
          q0[1] + t0 * (q1[1] - q0[1]),
        ];

        // Slight 0.08m inward margin to guarantee 0 Z-fighting
        const pMidX = (subP0[0] + subP1[0] + subP2[0] + subP3[0]) * 0.25;
        const pMidZ = (subP0[1] + subP1[1] + subP2[1] + subP3[1]) * 0.25;
        const shrink = (p: [number, number]): [number, number] => [
          p[0] + (pMidX - p[0]) * 0.03,
          p[1] + (pMidZ - p[1]) * 0.03,
        ];

        const quad: [number, number][] = [
          shrink(subP0),
          shrink(subP1),
          shrink(subP2),
          shrink(subP3),
        ];

        const groundY = sampleGroundElevation(pMidX, pMidZ);

        // 2 to 3 stories (or 4 in downtown, or rare cathedral tower)
        const isCathedralTower = centerFactor > 0.45 && rng() < 0.035;
        let storyCount: number;
        if (centerFactor > 0.5) {
          storyCount = rng() > 0.4 ? 3 : 4; // 3-4 stories downtown
        } else {
          storyCount = rng() > 0.5 ? 2 : 3; // 2-3 stories standard
        }

        const wallCol = OLD_TOWN_WALL_PALETTE[Math.floor(rng() * OLD_TOWN_WALL_PALETTE.length)];
        const roofCol = isCathedralTower
          ? 0x4a7060
          : ROOF_PALETTE[Math.floor(rng() * ROOF_PALETTE.length)];

        const bldgGeom = buildOldTownBuildingGeometry(
          quad,
          groundY,
          storyCount,
          isCathedralTower,
          wallCol,
          roofCol,
        );

        buildingGeometries.push(bldgGeom);
        buildingCount++;
      }
    }
  }

  // Merge building geometries
  let buildingsMeshGeometry: BufferGeometry;
  if (buildingGeometries.length > 0) {
    buildingsMeshGeometry = mergeGeometries(buildingGeometries, false) ?? new BufferGeometry();
  } else {
    buildingsMeshGeometry = new BufferGeometry();
  }

  // Merge road geometries
  let roadMeshGeometry: BufferGeometry;
  if (roadGeometries.length > 0) {
    roadMeshGeometry = mergeGeometries(roadGeometries, false) ?? new BufferGeometry();
  } else {
    roadMeshGeometry = new BufferGeometry();
  }

  const graph = graphBuilder.build();
  return {
    cells,
    buildingsMeshGeometry,
    roadMeshGeometry,
    buildingCount,
    graph,
  };
}
