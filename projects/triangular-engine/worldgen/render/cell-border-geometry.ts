import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import {
  computeEdgeSagitta,
  extractCellBorders,
  ICellBorderEdge,
  IPlanetGraphCore,
  IPlanetSurfaceSampler,
  IVec3,
  normalize,
} from 'triangular-engine/worldgen';
import {
  IMapProjection,
  MAP_PROJECTIONS,
  MapProjectionKind,
} from './map-projections';
import {
  edgeCrossesAntimeridian,
  projectedLongitude,
} from './antimeridian-seam';

export interface ICellBorderLineGeometryParams {
  readonly graph: IPlanetGraphCore;
  readonly edges?: readonly ICellBorderEdge[];
  readonly sampler?: IPlanetSurfaceSampler;
  readonly elevation?: number[];
  readonly radius?: number;
  readonly heightScale?: number;
  readonly minClearance?: number;
  readonly projectionKind?: MapProjectionKind;
  readonly seabedRelief?: boolean;
  readonly seaLevelElevation?: number;
  readonly clampToSeaLevel?: boolean;
  readonly adaptiveReliefSubdivision?: boolean;
  readonly reliefThreshold?: number;
  readonly maxSubdivisionDepth?: number;
}

export interface ITerritoryRibbonGeometryParams {
  readonly edges: readonly ICellBorderEdge[];
  readonly sampler?: IPlanetSurfaceSampler;
  readonly elevation?: number[];
  readonly radius?: number;
  readonly heightScale?: number;
  readonly ribbonWidth?: number;
  readonly minClearance?: number;
  readonly projectionKind?: MapProjectionKind;
  readonly seabedRelief?: boolean;
  readonly seaLevelElevation?: number;
  readonly clampToSeaLevel?: boolean;
  readonly adaptiveReliefSubdivision?: boolean;
  readonly reliefThreshold?: number;
  readonly maxSubdivisionDepth?: number;
}

export interface ICellOverlayGeometryParams {
  readonly graph: IPlanetGraphCore;
  readonly sampler?: IPlanetSurfaceSampler;
  readonly elevation?: number[];
  readonly radius?: number;
  readonly heightScale?: number;
  readonly minClearance?: number;
  readonly projectionKind?: MapProjectionKind;
  readonly seabedRelief?: boolean;
  readonly seaLevelElevation?: number;
  readonly clampToSeaLevel?: boolean;
  readonly adaptiveReliefSubdivision?: boolean;
}

interface ISplitVertex {
  dir: IVec3;
  elev: number;
  pLon: number;
  pLat: number;
  cellA: number;
  cellB: number;
}

function resolveElevation(
  dir: IVec3,
  sampler?: IPlanetSurfaceSampler,
  elevation?: number[],
  cellA = 0,
  cellB = 0,
  seabedRelief = true,
  seaLevelElevation = 0,
  clampToSeaLevel = true,
): number {
  let elev = 0;
  if (sampler) {
    const s = sampler.sample(dir);
    if (!seabedRelief && !s.isLand) {
      return seaLevelElevation;
    }
    elev = s.elevation;
  } else if (elevation && cellA >= 0 && cellB >= 0) {
    const eA = elevation[cellA] ?? 0;
    const eB = elevation[cellB] ?? 0;
    const avg = (eA + eB) * 0.5;
    if (!seabedRelief && avg < seaLevelElevation) {
      return seaLevelElevation;
    }
    elev = avg;
  }
  if (clampToSeaLevel && elev < seaLevelElevation) {
    return seaLevelElevation;
  }
  return elev;
}

function appendAdaptiveReliefSegments(
  v0: ISplitVertex,
  v1: ISplitVertex,
  out: [ISplitVertex, ISplitVertex][],
  depth: number,
  maxDepth: number,
  reliefThreshold: number,
  sampler?: IPlanetSurfaceSampler,
  elevation?: number[],
  seabedRelief = true,
  seaLevelElevation = 0,
  clampToSeaLevel = true,
): void {
  if (depth < maxDepth && sampler) {
    const midX = (v0.dir.x + v1.dir.x) * 0.5;
    const midY = (v0.dir.y + v1.dir.y) * 0.5;
    const midZ = (v0.dir.z + v1.dir.z) * 0.5;
    const midDir = normalize({ x: midX, y: midY, z: midZ });

    const midElev = resolveElevation(
      midDir,
      sampler,
      elevation,
      v0.cellA,
      v0.cellB,
      seabedRelief,
      seaLevelElevation,
      clampToSeaLevel,
    );

    const expectedElev = (v0.elev + v1.elev) * 0.5;
    const reliefDelta = midElev - expectedElev;

    if (reliefDelta > reliefThreshold) {
      const latMid = Math.asin(Math.max(-1, Math.min(1, midDir.y)));
      let midLon = projectedLongitude(midDir);
      if (Math.abs(v0.pLon - Math.PI) < 1e-4 || Math.abs(v1.pLon - Math.PI) < 1e-4) {
        if (v0.pLon > 0 || v1.pLon > 0) midLon = Math.abs(midLon);
      } else if (Math.abs(v0.pLon + Math.PI) < 1e-4 || Math.abs(v1.pLon + Math.PI) < 1e-4) {
        if (v0.pLon < 0 || v1.pLon < 0) midLon = -Math.abs(midLon);
      }

      const vMid: ISplitVertex = {
        dir: midDir,
        elev: midElev,
        pLon: midLon,
        pLat: latMid,
        cellA: v0.cellA,
        cellB: v0.cellB,
      };

      appendAdaptiveReliefSegments(
        v0,
        vMid,
        out,
        depth + 1,
        maxDepth,
        reliefThreshold,
        sampler,
        elevation,
        seabedRelief,
        seaLevelElevation,
        clampToSeaLevel,
      );
      appendAdaptiveReliefSegments(
        vMid,
        v1,
        out,
        depth + 1,
        maxDepth,
        reliefThreshold,
        sampler,
        elevation,
        seabedRelief,
        seaLevelElevation,
        clampToSeaLevel,
      );
      return;
    }
  }

  out.push([v0, v1]);
}

function splitEdgesForProjection(
  edges: readonly ICellBorderEdge[],
  sampler?: IPlanetSurfaceSampler,
  elevation?: number[],
  seabedRelief = true,
  seaLevelElevation = 0,
  clampToSeaLevel = true,
  adaptiveReliefSubdivision = true,
  reliefThreshold = 0.008,
  maxSubdivisionDepth = 2,
): [ISplitVertex, ISplitVertex][] {
  const segmentPairs: [ISplitVertex, ISplitVertex][] = [];

  const pushSegment = (s0: ISplitVertex, s1: ISplitVertex): void => {
    if (adaptiveReliefSubdivision && sampler) {
      appendAdaptiveReliefSegments(
        s0,
        s1,
        segmentPairs,
        0,
        maxSubdivisionDepth,
        reliefThreshold,
        sampler,
        elevation,
        seabedRelief,
        seaLevelElevation,
        clampToSeaLevel,
      );
    } else {
      segmentPairs.push([s0, s1]);
    }
  };

  for (const edge of edges) {
    const a = edge.a;
    const b = edge.b;

    const elevA = resolveElevation(
      a,
      sampler,
      elevation,
      edge.cellA,
      edge.cellB,
      seabedRelief,
      seaLevelElevation,
      clampToSeaLevel,
    );
    const elevB = resolveElevation(
      b,
      sampler,
      elevation,
      edge.cellA,
      edge.cellB,
      seabedRelief,
      seaLevelElevation,
      clampToSeaLevel,
    );

    const latA = Math.asin(Math.max(-1, Math.min(1, a.y)));
    const lonA = projectedLongitude(a);
    const latB = Math.asin(Math.max(-1, Math.min(1, b.y)));
    const lonB = projectedLongitude(b);

    const vA: ISplitVertex = {
      dir: a,
      elev: elevA,
      pLon: lonA,
      pLat: latA,
      cellA: edge.cellA,
      cellB: edge.cellB,
    };
    const vB: ISplitVertex = {
      dir: b,
      elev: elevB,
      pLon: lonB,
      pLat: latB,
      cellA: edge.cellA,
      cellB: edge.cellB,
    };

    // Check antimeridian seam crossing
    if (edgeCrossesAntimeridian(a, b)) {
      // Crosses the seam. Determine which is left and which is right
      if (lonA > 0 && lonB < 0) {
        // lonA is near +PI, lonB is near -PI
        const t = (Math.PI - lonA) / (lonB + 2 * Math.PI - lonA);
        const latCross = latA + t * (latB - latA);
        const elevCross = elevA + t * (elevB - elevA);
        const cosLatCross = Math.cos(latCross);
        const dirCross: IVec3 = {
          x: 0,
          y: Math.sin(latCross),
          z: -cosLatCross,
        };

        const crossPos: ISplitVertex = {
          dir: dirCross,
          elev: elevCross,
          pLon: Math.PI,
          pLat: latCross,
          cellA: edge.cellA,
          cellB: edge.cellB,
        };
        const crossNeg: ISplitVertex = {
          dir: dirCross,
          elev: elevCross,
          pLon: -Math.PI,
          pLat: latCross,
          cellA: edge.cellA,
          cellB: edge.cellB,
        };

        pushSegment(vA, crossPos);
        pushSegment(crossNeg, vB);
      } else if (lonA < 0 && lonB > 0) {
        // lonA is near -PI, lonB is near +PI
        const t = (Math.PI - lonB) / (lonA + 2 * Math.PI - lonB);
        const latCross = latB + t * (latA - latB);
        const elevCross = elevB + t * (elevA - elevB);
        const cosLatCross = Math.cos(latCross);
        const dirCross: IVec3 = {
          x: 0,
          y: Math.sin(latCross),
          z: -cosLatCross,
        };

        const crossPos: ISplitVertex = {
          dir: dirCross,
          elev: elevCross,
          pLon: Math.PI,
          pLat: latCross,
          cellA: edge.cellA,
          cellB: edge.cellB,
        };
        const crossNeg: ISplitVertex = {
          dir: dirCross,
          elev: elevCross,
          pLon: -Math.PI,
          pLat: latCross,
          cellA: edge.cellA,
          cellB: edge.cellB,
        };

        pushSegment(vA, crossNeg);
        pushSegment(crossPos, vB);
      } else {
        pushSegment(vA, vB);
      }
    } else {
      pushSegment(vA, vB);
    }
  }

  return segmentPairs;
}

/**
 * Builds a LineSegments BufferGeometry with GPU morph attributes for Voronoi cell borders.
 *
 * Each edge forms a floating straight line segment elevated slightly above the terrain with
 * sagitta clearance compensation. Antimeridian crossings are split into two segments so flat
 * 2.5D unrolling remains perfectly clean without artifacts.
 */
export function buildCellBorderLineGeometry(
  params: ICellBorderLineGeometryParams,
): BufferGeometry {
  const radius = params.radius ?? 2.0;
  const heightScale = params.heightScale ?? 0.16;
  const minClearance = params.minClearance ?? 0.004;
  const projectionKind = params.projectionKind ?? 'equalEarth';
  const projection: IMapProjection = MAP_PROJECTIONS[projectionKind];
  const mapWidth = 2 * Math.PI * radius;
  const mapHeight = Math.PI * radius;

  const edges = params.edges ?? extractCellBorders(params.graph);
  const segmentPairs = splitEdgesForProjection(
    edges,
    params.sampler,
    params.elevation,
    params.seabedRelief ?? true,
    params.seaLevelElevation ?? 0,
    params.clampToSeaLevel ?? true,
    params.adaptiveReliefSubdivision ?? true,
    params.reliefThreshold ?? 0.008,
    params.maxSubdivisionDepth ?? 2,
  );

  const vertexCount = segmentPairs.length * 2;
  const positions = new Float32Array(vertexCount * 3);
  const spherePositions = new Float32Array(vertexCount * 3);
  const flatPositions = new Float32Array(vertexCount * 3);
  const sphereNormals = new Float32Array(vertexCount * 3);
  const flatNormals = new Float32Array(vertexCount * 3);
  const otherDirs = new Float32Array(vertexCount * 3);
  const cellIds = new Float32Array(vertexCount * 2);

  let ptr3 = 0;
  let ptr2 = 0;

  for (const [start, end] of segmentPairs) {
    const sagitta = computeEdgeSagitta(start.dir, end.dir, radius);
    const heightClearance = heightScale * 0.025;
    const clearance = minClearance + sagitta + heightClearance;

    for (const v of [start, end]) {
      const other = v === start ? end.dir : start.dir;
      const displacedRadius = radius + v.elev * heightScale + clearance;

      // 3D Sphere coordinates (tangent at Z=0, curving into -Z)
      const sx = v.dir.x * displacedRadius;
      const sy = v.dir.y * displacedRadius;
      const sz = v.dir.z * displacedRadius - radius;

      spherePositions[ptr3] = sx;
      spherePositions[ptr3 + 1] = sy;
      spherePositions[ptr3 + 2] = sz;

      sphereNormals[ptr3] = v.dir.x;
      sphereNormals[ptr3 + 1] = v.dir.y;
      sphereNormals[ptr3 + 2] = v.dir.z;

      otherDirs[ptr3] = other.x;
      otherDirs[ptr3 + 1] = other.y;
      otherDirs[ptr3 + 2] = other.z;

      // 2.5D Flat coordinates
      const proj = projection.project(v.pLon, v.pLat, mapWidth, mapHeight);
      const fx = (proj.x / mapWidth - 0.5) * mapWidth;
      const fy = -(proj.y / mapHeight - 0.5) * mapHeight;
      const fz = v.elev * heightScale + clearance;

      flatPositions[ptr3] = fx;
      flatPositions[ptr3 + 1] = fy;
      flatPositions[ptr3 + 2] = fz;

      flatNormals[ptr3] = 0;
      flatNormals[ptr3 + 1] = 0;
      flatNormals[ptr3 + 2] = 1;

      // Initial position starts at sphere
      positions[ptr3] = sx;
      positions[ptr3 + 1] = sy;
      positions[ptr3 + 2] = sz;

      // Cell IDs
      cellIds[ptr2] = v.cellA;
      cellIds[ptr2 + 1] = v.cellB;

      ptr3 += 3;
      ptr2 += 2;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSpherePos', new BufferAttribute(spherePositions, 3));
  geometry.setAttribute('aFlatPos', new BufferAttribute(flatPositions, 3));
  geometry.setAttribute('aSphereNorm', new BufferAttribute(sphereNormals, 3));
  geometry.setAttribute('aFlatNorm', new BufferAttribute(flatNormals, 3));
  geometry.setAttribute('aOtherDir', new BufferAttribute(otherDirs, 3));
  geometry.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array(vertexCount * 2), 2),
  );
  geometry.setAttribute('aCellIds', new BufferAttribute(cellIds, 2));

  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius = Math.max(mapWidth, mapHeight, radius * 3);
  }

  return geometry;
}

/**
 * Builds a quad ribbon BufferGeometry for national/faction territory boundaries.
 *
 * Each edge is expanded into a flat ribbon tangent to the surface with true physical width
 * in world units, ensuring consistent thickness across all graphics platforms.
 */
export function buildTerritoryRibbonGeometry(
  params: ITerritoryRibbonGeometryParams,
): BufferGeometry {
  const radius = params.radius ?? 2.0;
  const heightScale = params.heightScale ?? 0.16;
  const ribbonWidth = params.ribbonWidth ?? 0.015;
  const halfW = ribbonWidth * 0.5;
  const minClearance = params.minClearance ?? 0.005;
  const projectionKind = params.projectionKind ?? 'equalEarth';
  const projection: IMapProjection = MAP_PROJECTIONS[projectionKind];
  const mapWidth = 2 * Math.PI * radius;
  const mapHeight = Math.PI * radius;

  const segmentPairs = splitEdgesForProjection(
    params.edges,
    params.sampler,
    params.elevation,
    params.seabedRelief ?? true,
    params.seaLevelElevation ?? 0,
    params.clampToSeaLevel ?? true,
    params.adaptiveReliefSubdivision ?? true,
    params.reliefThreshold ?? 0.008,
    params.maxSubdivisionDepth ?? 2,
  );

  const segmentCount = segmentPairs.length;
  const vertexCount = segmentCount * 4;
  const triangleCount = segmentCount * 2;

  const positions = new Float32Array(vertexCount * 3);
  const spherePositions = new Float32Array(vertexCount * 3);
  const flatPositions = new Float32Array(vertexCount * 3);
  const sphereNormals = new Float32Array(vertexCount * 3);
  const flatNormals = new Float32Array(vertexCount * 3);
  const otherDirs = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const cellIds = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(triangleCount * 3);

  let vPtr3 = 0;
  let vPtr2 = 0;
  let iPtr = 0;

  const vA3 = new Vector3();
  const vB3 = new Vector3();
  const dirSeg = new Vector3();
  const normSeg = new Vector3();
  const sideVec = new Vector3();

  for (let s = 0; s < segmentCount; s++) {
    const [start, end] = segmentPairs[s];
    const a = start.dir;
    const b = end.dir;

    const elevA = start.elev;
    const elevB = end.elev;

    const sagitta = computeEdgeSagitta(a, b, radius);
    const heightClearance = heightScale * 0.025;
    const clearance = minClearance + sagitta + heightClearance;

    const rA = radius + elevA * heightScale + clearance;
    const rB = radius + elevB * heightScale + clearance;

    // 3D Sphere endpoints
    vA3.set(a.x * rA, a.y * rA, a.z * rA);
    vB3.set(b.x * rB, b.y * rB, b.z * rB);

    dirSeg.subVectors(vB3, vA3).normalize();
    normSeg.addVectors(vA3, vB3).normalize();
    sideVec.crossVectors(dirSeg, normSeg).normalize().multiplyScalar(halfW);

    // 4 Sphere vertices
    const p00Sphere = new Vector3().subVectors(vA3, sideVec);
    const p01Sphere = new Vector3().addVectors(vA3, sideVec);
    const p10Sphere = new Vector3().subVectors(vB3, sideVec);
    const p11Sphere = new Vector3().addVectors(vB3, sideVec);

    // Flat map projected points
    const projA = projection.project(
      start.pLon,
      start.pLat,
      mapWidth,
      mapHeight,
    );
    const projB = projection.project(end.pLon, end.pLat, mapWidth, mapHeight);

    const fAx = (projA.x / mapWidth - 0.5) * mapWidth;
    const fAy = -(projA.y / mapHeight - 0.5) * mapHeight;
    const fAz = elevA * heightScale + clearance;

    const fBx = (projB.x / mapWidth - 0.5) * mapWidth;
    const fBy = -(projB.y / mapHeight - 0.5) * mapHeight;
    const fBz = elevB * heightScale + clearance;

    const flatDir = new Vector3(fBx - fAx, fBy - fAy, 0).normalize();
    const flatSide = new Vector3(-flatDir.y, flatDir.x, 0).multiplyScalar(
      halfW,
    );

    const baseVertexIndex = s * 4;

    const quadVertices = [
      {
        sphere: p00Sphere,
        flat: new Vector3(fAx - flatSide.x, fAy - flatSide.y, fAz),
        norm: a,
        other: b,
        u: 0,
        v: 0,
      },
      {
        sphere: p01Sphere,
        flat: new Vector3(fAx + flatSide.x, fAy + flatSide.y, fAz),
        norm: a,
        other: b,
        u: 1,
        v: 0,
      },
      {
        sphere: p10Sphere,
        flat: new Vector3(fBx - flatSide.x, fBy - flatSide.y, fBz),
        norm: b,
        other: a,
        u: 0,
        v: 1,
      },
      {
        sphere: p11Sphere,
        flat: new Vector3(fBx + flatSide.x, fBy + flatSide.y, fBz),
        norm: b,
        other: a,
        u: 1,
        v: 1,
      },
    ];

    for (const qv of quadVertices) {
      // Centered at z=0 for 3D sphere
      const sx = qv.sphere.x;
      const sy = qv.sphere.y;
      const sz = qv.sphere.z - radius;

      spherePositions[vPtr3] = sx;
      spherePositions[vPtr3 + 1] = sy;
      spherePositions[vPtr3 + 2] = sz;

      sphereNormals[vPtr3] = qv.norm.x;
      sphereNormals[vPtr3 + 1] = qv.norm.y;
      sphereNormals[vPtr3 + 2] = qv.norm.z;

      otherDirs[vPtr3] = qv.other.x;
      otherDirs[vPtr3 + 1] = qv.other.y;
      otherDirs[vPtr3 + 2] = qv.other.z;

      flatPositions[vPtr3] = qv.flat.x;
      flatPositions[vPtr3 + 1] = qv.flat.y;
      flatPositions[vPtr3 + 2] = qv.flat.z;

      flatNormals[vPtr3] = 0;
      flatNormals[vPtr3 + 1] = 0;
      flatNormals[vPtr3 + 2] = 1;

      positions[vPtr3] = sx;
      positions[vPtr3 + 1] = sy;
      positions[vPtr3 + 2] = sz;

      uvs[vPtr2] = qv.u;
      uvs[vPtr2 + 1] = qv.v;

      cellIds[vPtr2] = start.cellA;
      cellIds[vPtr2 + 1] = start.cellB;

      vPtr3 += 3;
      vPtr2 += 2;
    }

    // Two triangles per quad: (0, 1, 2) and (1, 3, 2)
    indices[iPtr++] = baseVertexIndex;
    indices[iPtr++] = baseVertexIndex + 1;
    indices[iPtr++] = baseVertexIndex + 2;

    indices[iPtr++] = baseVertexIndex + 1;
    indices[iPtr++] = baseVertexIndex + 3;
    indices[iPtr++] = baseVertexIndex + 2;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSpherePos', new BufferAttribute(spherePositions, 3));
  geometry.setAttribute('aFlatPos', new BufferAttribute(flatPositions, 3));
  geometry.setAttribute('aSphereNorm', new BufferAttribute(sphereNormals, 3));
  geometry.setAttribute('aFlatNorm', new BufferAttribute(flatNormals, 3));
  geometry.setAttribute('aOtherDir', new BufferAttribute(otherDirs, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('aCellIds', new BufferAttribute(cellIds, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));

  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius = Math.max(mapWidth, mapHeight, radius * 3);
  }

  return geometry;
}

/**
 * Builds a cell polygon fan BufferGeometry for GPU tactical highlight overlays
 * (movement range, reachable cells, territory fill, selection halo).
 */
export function buildCellOverlayGeometry(
  params: ICellOverlayGeometryParams,
): BufferGeometry {
  const radius = params.radius ?? 2.0;
  const heightScale = params.heightScale ?? 0.16;
  const minClearance = params.minClearance ?? 0.003;
  const projectionKind = params.projectionKind ?? 'equalEarth';
  const projection: IMapProjection = MAP_PROJECTIONS[projectionKind];
  const mapWidth = 2 * Math.PI * radius;
  const mapHeight = Math.PI * radius;
  const isSubdivided =
    (params.adaptiveReliefSubdivision ?? true) && !!params.sampler;
  const trianglesPerSector = isSubdivided ? 4 : 1;

  const graph = params.graph;

  // Count total triangles and vertices across all cells
  let totalTriangles = 0;
  for (const cell of graph.cells) {
    if (cell.corners.length >= 3) {
      totalTriangles += cell.corners.length * trianglesPerSector;
    }
  }

  const vertexCount = totalTriangles * 3;
  const positions = new Float32Array(vertexCount * 3);
  const spherePositions = new Float32Array(vertexCount * 3);
  const flatPositions = new Float32Array(vertexCount * 3);
  const sphereNormals = new Float32Array(vertexCount * 3);
  const flatNormals = new Float32Array(vertexCount * 3);
  const otherDirs1 = new Float32Array(vertexCount * 3);
  const otherDirs2 = new Float32Array(vertexCount * 3);
  const cellIds = new Float32Array(vertexCount);
  const distFromCenter = new Float32Array(vertexCount);
  const uvs = new Float32Array(vertexCount * 2);

  let ptr3 = 0;
  let ptr1 = 0;
  let ptr2 = 0;

  const seabedRelief = params.seabedRelief ?? true;
  const seaLevelElevation = params.seaLevelElevation ?? 0;
  const clampToSeaLevel = params.clampToSeaLevel ?? true;

  for (const cell of graph.cells) {
    const n = cell.corners.length;
    if (n < 3) continue;

    const centerDir = cell.center;
    const cornerDirs = cell.corners;

    // Estimate cell sagitta across diagonal
    const oppositeIdx = Math.floor(n / 2);
    const cellSagitta = computeEdgeSagitta(
      cornerDirs[0],
      cornerDirs[oppositeIdx],
      radius,
    );

    const centerElev = resolveElevation(
      centerDir,
      params.sampler,
      params.elevation,
      cell.id,
      cell.id,
      seabedRelief,
      seaLevelElevation,
      clampToSeaLevel,
    );

    const cornerElevs = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      cornerElevs[k] = resolveElevation(
        cornerDirs[k],
        params.sampler,
        params.elevation,
        cell.id,
        cell.id,
        seabedRelief,
        seaLevelElevation,
        clampToSeaLevel,
      );
    }

    // Measure maximum interior relief bulge across sectors to elevate overlay over summits
    let maxReliefDelta = 0;
    if (params.sampler) {
      for (let k = 0; k < n; k++) {
        const kNext = (k + 1) % n;
        const c1 = cornerDirs[k];
        const c2 = cornerDirs[kNext];
        const midDir = normalize({
          x: centerDir.x + c1.x + c2.x,
          y: centerDir.y + c1.y + c2.y,
          z: centerDir.z + c1.z + c2.z,
        });
        const midElev = resolveElevation(
          midDir,
          params.sampler,
          params.elevation,
          cell.id,
          cell.id,
          seabedRelief,
          seaLevelElevation,
          clampToSeaLevel,
        );
        const expectedElev =
          (centerElev + cornerElevs[k] + cornerElevs[kNext]) / 3;
        const delta = midElev - expectedElev;
        if (delta > maxReliefDelta) maxReliefDelta = delta;
      }
    }

    const heightClearance = heightScale * 0.025;
    const cellReliefLift = Math.min(0.04, maxReliefDelta * heightScale * 0.6);
    const cellClearance =
      minClearance + cellSagitta + heightClearance + cellReliefLift;

    const evalVertex = (
      dir: IVec3,
      elev: number,
      dist: number,
      u: number,
      v: number,
    ) => {
      const r = radius + elev * heightScale + cellClearance;
      const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      const lon = projectedLongitude(dir);
      const proj = projection.project(lon, lat, mapWidth, mapHeight);
      const fx = (proj.x / mapWidth - 0.5) * mapWidth;
      const fy = -(proj.y / mapHeight - 0.5) * mapHeight;
      const fz = elev * heightScale + cellClearance;
      return { dir, r, fx, fy, fz, dist, u, v };
    };

    const vCenter = evalVertex(centerDir, centerElev, 0.0, 0.5, 0.5);

    const vCorners = [];
    for (let k = 0; k < n; k++) {
      vCorners.push(evalVertex(cornerDirs[k], cornerElevs[k], 1.0, 0.0, 1.0));
    }

    const pushTriangle = (
      v0: ReturnType<typeof evalVertex>,
      v1: ReturnType<typeof evalVertex>,
      v2: ReturnType<typeof evalVertex>,
    ) => {
      const tri = [
        { v: v0, other1: v1.dir, other2: v2.dir },
        { v: v1, other1: v0.dir, other2: v2.dir },
        { v: v2, other1: v0.dir, other2: v1.dir },
      ];

      for (const item of tri) {
        const vert = item.v;
        const sx = vert.dir.x * vert.r;
        const sy = vert.dir.y * vert.r;
        const sz = vert.dir.z * vert.r - radius;

        spherePositions[ptr3] = sx;
        spherePositions[ptr3 + 1] = sy;
        spherePositions[ptr3 + 2] = sz;

        sphereNormals[ptr3] = vert.dir.x;
        sphereNormals[ptr3 + 1] = vert.dir.y;
        sphereNormals[ptr3 + 2] = vert.dir.z;

        otherDirs1[ptr3] = item.other1.x;
        otherDirs1[ptr3 + 1] = item.other1.y;
        otherDirs1[ptr3 + 2] = item.other1.z;

        otherDirs2[ptr3] = item.other2.x;
        otherDirs2[ptr3 + 1] = item.other2.y;
        otherDirs2[ptr3 + 2] = item.other2.z;

        flatPositions[ptr3] = vert.fx;
        flatPositions[ptr3 + 1] = vert.fy;
        flatPositions[ptr3 + 2] = vert.fz;

        flatNormals[ptr3] = 0;
        flatNormals[ptr3 + 1] = 0;
        flatNormals[ptr3 + 2] = 1;

        positions[ptr3] = sx;
        positions[ptr3 + 1] = sy;
        positions[ptr3 + 2] = sz;

        cellIds[ptr1] = cell.id;
        distFromCenter[ptr1] = vert.dist;

        uvs[ptr2] = vert.u;
        uvs[ptr2 + 1] = vert.v;

        ptr3 += 3;
        ptr1 += 1;
        ptr2 += 2;
      }
    };

    if (isSubdivided) {
      const vSpokes = [];
      for (let k = 0; k < n; k++) {
        const spDir = normalize({
          x: centerDir.x + cornerDirs[k].x,
          y: centerDir.y + cornerDirs[k].y,
          z: centerDir.z + cornerDirs[k].z,
        });
        const spElev = resolveElevation(
          spDir,
          params.sampler,
          params.elevation,
          cell.id,
          cell.id,
          seabedRelief,
          seaLevelElevation,
          clampToSeaLevel,
        );
        vSpokes.push(evalVertex(spDir, spElev, 0.5, 0.25, 0.75));
      }

      for (let k = 0; k < n; k++) {
        const kNext = (k + 1) % n;
        const vK1 = vCorners[k];
        const vK2 = vCorners[kNext];
        const vSp1 = vSpokes[k];
        const vSp2 = vSpokes[kNext];

        const edgeDir = normalize({
          x: cornerDirs[k].x + cornerDirs[kNext].x,
          y: cornerDirs[k].y + cornerDirs[kNext].y,
          z: cornerDirs[k].z + cornerDirs[kNext].z,
        });
        const edgeElev = resolveElevation(
          edgeDir,
          params.sampler,
          params.elevation,
          cell.id,
          cell.id,
          seabedRelief,
          seaLevelElevation,
          clampToSeaLevel,
        );
        const vEdge = evalVertex(edgeDir, edgeElev, 1.0, 0.5, 1.0);

        pushTriangle(vCenter, vSp1, vSp2);
        pushTriangle(vSp1, vK1, vEdge);
        pushTriangle(vEdge, vK2, vSp2);
        pushTriangle(vSp1, vEdge, vSp2);
      }
    } else {
      for (let k = 0; k < n; k++) {
        const kNext = (k + 1) % n;
        const vK1 = vCorners[k];
        const vK2 = vCorners[kNext];
        pushTriangle(vCenter, vK1, vK2);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSpherePos', new BufferAttribute(spherePositions, 3));
  geometry.setAttribute('aFlatPos', new BufferAttribute(flatPositions, 3));
  geometry.setAttribute('aSphereNorm', new BufferAttribute(sphereNormals, 3));
  geometry.setAttribute('aFlatNorm', new BufferAttribute(flatNormals, 3));
  geometry.setAttribute('aOtherDir1', new BufferAttribute(otherDirs1, 3));
  geometry.setAttribute('aOtherDir2', new BufferAttribute(otherDirs2, 3));
  geometry.setAttribute('aCellId', new BufferAttribute(cellIds, 1));
  geometry.setAttribute('aDist', new BufferAttribute(distFromCenter, 1));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));

  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius = Math.max(mapWidth, mapHeight, radius * 3);
  }

  return geometry;
}
