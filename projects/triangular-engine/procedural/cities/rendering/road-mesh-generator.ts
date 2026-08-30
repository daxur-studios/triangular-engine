import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { ICityCrossSection } from '../core/city-transit-types';
import { IClassifiedRoadSpan } from '../terrain/road-terrain-adapter';

export interface IRoadMeshOptions {
  /** Texture tile frequency along curve length (default: 1 tile per 10m). */
  readonly uvRepeatLengthM?: number;
  /** Bridge deck slab thickness in meters (default: 1.2m). */
  readonly bridgeDeckThicknessM?: number;
  /** Pier radius in meters (default: 0.8m). */
  readonly pierRadiusM?: number;
}

export interface IRoadMeshResult {
  readonly roadGeometry: BufferGeometry;
  readonly bridgePiersGeometry?: BufferGeometry;
}

/**
 * Builds Three.js BufferGeometry for a classified road, bridge, or tunnel span.
 */
export function buildRoadSpanMesh(
  span: IClassifiedRoadSpan,
  crossSection: ICityCrossSection,
  options: IRoadMeshOptions = {},
): IRoadMeshResult {
  const points = span.roadPoints;
  if (points.length < 2) {
    return { roadGeometry: new BufferGeometry() };
  }

  const uvScale = 1.0 / (options.uvRepeatLengthM ?? 10.0);
  const deckThickness = options.bridgeDeckThicknessM ?? 1.2;

  // 1. Calculate frames (tangent, normal, binormal) along the 3D spline
  const pathPoints = points.map((p) => new Vector3(p[0], p[1], p[2]));
  const ringCount = pathPoints.length;

  // Cross-section profile points in local space (X: lateral offset, Y: vertical elevation)
  const profileOffsets = buildCrossSectionProfile(crossSection, span.type, deckThickness);
  const profileVerticesCount = profileOffsets.length;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let accumulatedDist = 0;

  for (let r = 0; r < ringCount; r++) {
    const p = pathPoints[r];
    const prev = r > 0 ? pathPoints[r - 1] : null;
    const next = r < ringCount - 1 ? pathPoints[r + 1] : null;

    if (prev) {
      accumulatedDist += p.distanceTo(prev);
    }

    // Forward tangent
    const tangent = new Vector3();
    if (next && prev) {
      tangent.subVectors(next, prev);
    } else if (next) {
      tangent.subVectors(next, p);
    } else if (prev) {
      tangent.subVectors(p, prev);
    }
    if (tangent.lengthSq() > 1e-6) {
      tangent.normalize();
    } else {
      tangent.set(0, 0, 1);
    }

    // Up vector (aligned with world Y or perpendicular to tangent)
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(tangent, up);
    if (right.lengthSq() > 1e-6) {
      right.normalize();
    } else {
      right.set(1, 0, 0);
    }
    const trueUp = new Vector3().crossVectors(right, tangent);
    if (trueUp.lengthSq() > 1e-6) {
      trueUp.normalize();
    } else {
      trueUp.set(0, 1, 0);
    }

    // Generate ring vertices
    for (let v = 0; v < profileVerticesCount; v++) {
      const prof = profileOffsets[v];
      const vertPos = new Vector3()
        .copy(p)
        .addScaledVector(right, prof.x)
        .addScaledVector(trueUp, prof.y);

      positions.push(vertPos.x, vertPos.y, vertPos.z);
      normals.push(prof.normal[0], prof.normal[1], prof.normal[2]);
      uvs.push(prof.u, accumulatedDist * uvScale);
    }
  }

  // Generate quad indices connecting rings
  for (let r = 0; r < ringCount - 1; r++) {
    const ringA = r * profileVerticesCount;
    const ringB = (r + 1) * profileVerticesCount;

    for (let v = 0; v < profileVerticesCount - 1; v++) {
      const a0 = ringA + v;
      const a1 = ringA + v + 1;
      const b0 = ringB + v;
      const b1 = ringB + v + 1;

      // Two triangles per quad
      indices.push(a0, b0, a1);
      indices.push(a1, b0, b1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array(normals), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // 2. Generate bridge support piers if applicable
  let bridgePiersGeometry: BufferGeometry | undefined = undefined;
  if (span.type === 'bridge' && span.pierPositions && span.pierPositions.length > 0) {
    bridgePiersGeometry = buildBridgePiers(
      span.pierPositions,
      options.pierRadiusM ?? 0.8,
    );
  }

  return {
    roadGeometry: geometry,
    bridgePiersGeometry,
  };
}

interface IProfilePoint {
  readonly x: number;
  readonly y: number;
  readonly u: number;
  readonly normal: readonly [number, number, number];
}

function buildCrossSectionProfile(
  cs: ICityCrossSection,
  type: string,
  deckThicknessM: number,
): readonly IProfilePoint[] {
  const points: IProfilePoint[] = [];

  const halfRoad = cs.roadwayWidthM * 0.5;
  const verge = cs.greenVergeWidthM;
  const sidewalk = cs.sidewalkWidthM;
  const curbH = cs.curbHeightM;

  const leftEdge = -(halfRoad + verge + sidewalk);
  const rightEdge = halfRoad + verge + sidewalk;

  // Left Outer Sidewalk Edge
  if (sidewalk > 0) {
    points.push({ x: leftEdge, y: curbH, u: 0.0, normal: [0, 1, 0] });
    points.push({ x: -(halfRoad + verge), y: curbH, u: 0.2, normal: [0, 1, 0] });
  }

  // Left Verge
  if (verge > 0) {
    points.push({ x: -halfRoad, y: curbH, u: 0.25, normal: [0, 1, 0] });
  }

  // Left Curb Drop
  if (curbH > 0) {
    points.push({ x: -halfRoad, y: 0.0, u: 0.3, normal: [1, 0, 0] });
  }

  // Roadway Surface
  points.push({ x: -halfRoad, y: 0.0, u: 0.3, normal: [0, 1, 0] });
  points.push({ x: 0.0, y: 0.02, u: 0.5, normal: [0, 1, 0] }); // slight crown for drainage
  points.push({ x: halfRoad, y: 0.0, u: 0.7, normal: [0, 1, 0] });

  // Right Curb Rise
  if (curbH > 0) {
    points.push({ x: halfRoad, y: curbH, u: 0.7, normal: [-1, 0, 0] });
  }

  // Right Verge
  if (verge > 0) {
    points.push({ x: halfRoad + verge, y: curbH, u: 0.75, normal: [0, 1, 0] });
  }

  // Right Outer Sidewalk Edge
  if (sidewalk > 0) {
    points.push({ x: rightEdge, y: curbH, u: 1.0, normal: [0, 1, 0] });
  }

  // If bridge, wrap under deck to form a solid box section
  if (type === 'bridge') {
    points.push({ x: rightEdge, y: -deckThicknessM, u: 1.0, normal: [0, -1, 0] });
    points.push({ x: leftEdge, y: -deckThicknessM, u: 0.0, normal: [0, -1, 0] });
    points.push({ x: leftEdge, y: curbH, u: 0.0, normal: [-1, 0, 0] });
  }

  return points;
}

function buildBridgePiers(
  pierPositions: readonly {
    readonly deckPosition: readonly [number, number, number];
    readonly groundPosition: readonly [number, number, number];
    readonly heightM: number;
  }[],
  radiusM: number,
  radialSegments = 8,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  let vertOffset = 0;

  for (const pier of pierPositions) {
    const topY = pier.deckPosition[1] - 0.5; // connect into deck bottom
    const botY = pier.groundPosition[1];
    const cx = pier.deckPosition[0];
    const cz = pier.deckPosition[2];

    for (let i = 0; i <= radialSegments; i++) {
      const angle = (i / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Top vertex
      positions.push(cx + cos * radiusM, topY, cz + sin * radiusM);
      normals.push(cos, 0, sin);

      // Bottom vertex
      positions.push(cx + cos * radiusM, botY, cz + sin * radiusM);
      normals.push(cos, 0, sin);
    }

    for (let i = 0; i < radialSegments; i++) {
      const a0 = vertOffset + i * 2;
      const a1 = vertOffset + i * 2 + 1;
      const b0 = vertOffset + (i + 1) * 2;
      const b1 = vertOffset + (i + 1) * 2 + 1;

      indices.push(a0, a1, b0);
      indices.push(b0, a1, b1);
    }

    vertOffset += (radialSegments + 1) * 2;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array(normals), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}
