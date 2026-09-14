import { IPlanetSurfaceSampler, IVec3, normalize } from 'triangular-engine/worldgen';

/**
 * Fixed-resolution spherical geometry adapter for the shared planet surface sampler.
 *
 * This is deliberately **not** a LOD system. It tessellates one latitude/longitude grid at a
 * caller-chosen resolution and samples `IPlanetSurfaceSampler` once per vertex, then applies
 * radial displacement (`direction * (radius + elevation * heightScale)`). Streaming, quadtree
 * selection, Meshoptimizer simplification, seam stitching, scheduling and caching are owned by
 * runbook 031 and must not be reimplemented here — this adapter returns plain typed arrays so a
 * later renderer can consume it, or a future chunk provider can replace it.
 *
 * Why a new file rather than reusing an existing sphere utility (inspected first):
 * - `worldgen/core/fibonacci-sphere.ts` distributes Voronoi sites for the graph, not a render mesh.
 * - `terrain/domains/sphere-terrain-domain.ts` and the `terrain` quadtree/CDLOD modules are the
 *   cubesphere streaming path owned by runbook 031.
 * - `worldgen/core/chunking.ts`'s `buildChunkMeshData()` tessellates graph **cells** (Voronoi
 *   faces) and is the chunk path, not a fixed regular grid.
 * None of them produce a fixed-resolution, sampler-driven displaced sphere, so this small
 * framework-free adapter fills that gap.
 *
 * Topology notes (also covered by `globe-geometry.spec.ts`):
 * - The grid starts at longitude `-PI` and advances east, so the `+PI`/`-PI` antimeridian is a
 *   **single shared column** (`c === 0`) rather than two duplicated vertices. The wrap face
 *   reuses it, so the seam cannot crack and both longitudes sample the same elevation.
 * - Each pole is one vertex. Cap triangles are fans, never zero-area quads, so normals stay
 *   finite.
 * - Winding is outward: every triangle's geometric normal points along its centroid direction.
 */

/** Radial displacement per unit canonical elevation, matching `PlanetViewComponent`'s convention. */
export const DEFAULT_GLOBE_HEIGHT_SCALE = 0.02;

/** Longitude divisions around the equator for the prototype default. */
export const DEFAULT_GLOBE_LONGITUDE_SEGMENTS = 96;

/** Latitude bands between the two poles for the prototype default. */
export const DEFAULT_GLOBE_LATITUDE_RINGS = 48;

export interface IPlanetGlobeGeometryParams {
  /** Canonical planet-space surface query (see `createPlanetSurfaceSampler`). */
  readonly sampler: IPlanetSurfaceSampler;
  /**
   * Optional discrete cell-id lookup, evaluated once per vertex with the same unit direction the
   * sampler received. Keep cell identity discrete rather than interpolating biome/plate data.
   * Vertices without a resolved cell are `-1`.
   */
  readonly cellIdAt?: (direction: IVec3) => number;
  /** Base sphere radius in the adapter's own units. Must be positive. Default `1`. */
  readonly radius?: number;
  /** Radial units per canonical elevation unit. Display exaggeration only. Default `0.02`. */
  readonly heightScale?: number;
  /** Longitude divisions around the equator, `>= 3`. Default `96`. */
  readonly longitudeSegments?: number;
  /** Latitude bands between the poles, `>= 2`. Default `48`. */
  readonly latitudeRings?: number;
}

export interface IPlanetGlobeGeometry {
  /** Displaced world positions, `vertexCount * 3`, XYZ. */
  readonly positions: Float32Array;
  /** Smooth outward vertex normals derived from `positions`/`indices`, `vertexCount * 3`. */
  readonly normals: Float32Array;
  /** Undisplaced unit directions, `vertexCount * 3` — reuse to re-displace without resampling. */
  readonly directions: Float32Array;
  /** Canonical elevation per vertex (includes below-sea bathymetry). */
  readonly elevations: Float32Array;
  /** 1 for land, 0 for water, per vertex. */
  readonly landMask: Uint8Array;
  /** Discrete source cell id per vertex, or `-1` when no `cellIdAt` was supplied. */
  readonly cellIds: Int32Array;
  /** Triangle indices, `triangleCount * 3`. */
  readonly indices: Uint32Array;
  readonly radius: number;
  readonly heightScale: number;
  readonly longitudeSegments: number;
  readonly latitudeRings: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/**
 * Writes `direction * (radius + elevation * heightScale)` for every vertex. Exported so a display
 * exaggeration slider can re-displace an existing geometry's directions/elevations without paying
 * for another sampler pass.
 */
export function writePlanetGlobePositions(
  out: Float32Array,
  directions: Readonly<Float32Array>,
  elevations: Readonly<Float32Array>,
  radius: number,
  heightScale: number,
): void {
  const vertexCount = elevations.length;
  if (directions.length !== vertexCount * 3) {
    throw new RangeError(
      `writePlanetGlobePositions: directions length ${directions.length} does not match ${vertexCount} vertices.`,
    );
  }
  if (out.length !== vertexCount * 3) {
    throw new RangeError(
      `writePlanetGlobePositions: out length ${out.length} does not match ${vertexCount} vertices.`,
    );
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`writePlanetGlobePositions: radius must be positive and finite, got ${radius}.`);
  }
  if (!Number.isFinite(heightScale)) {
    throw new RangeError(`writePlanetGlobePositions: heightScale must be finite, got ${heightScale}.`);
  }

  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    const displacedRadius = radius + elevations[i] * heightScale;
    out[o] = directions[o] * displacedRadius;
    out[o + 1] = directions[o + 1] * displacedRadius;
    out[o + 2] = directions[o + 2] * displacedRadius;
  }
}

/**
 * Accumulates area-weighted vertex normals from triangle winding, then normalizes. Winding must be
 * outward for the result to face outward; a zero-sum vertex (no non-degenerate incident triangle)
 * falls back to its radial position direction.
 */
export function writePlanetGlobeNormals(
  out: Float32Array,
  positions: Readonly<Float32Array>,
  indices: ArrayLike<number>,
): void {
  const vertexCount = positions.length / 3;
  if (out.length !== positions.length) {
    throw new RangeError(
      `writePlanetGlobeNormals: out length ${out.length} does not match positions length ${positions.length}.`,
    );
  }
  if (indices.length % 3 !== 0) {
    throw new RangeError(`writePlanetGlobeNormals: indices length ${indices.length} is not a multiple of 3.`);
  }

  out.fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;

    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    out[a] += nx;
    out[a + 1] += ny;
    out[a + 2] += nz;
    out[b] += nx;
    out[b + 1] += ny;
    out[b + 2] += nz;
    out[c] += nx;
    out[c + 1] += ny;
    out[c + 2] += nz;
  }

  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    const length = Math.hypot(out[o], out[o + 1], out[o + 2]);
    if (length > 0) {
      out[o] /= length;
      out[o + 1] /= length;
      out[o + 2] /= length;
      continue;
    }
    const positionLength = Math.hypot(positions[o], positions[o + 1], positions[o + 2]) || 1;
    out[o] = positions[o] / positionLength;
    out[o + 1] = positions[o + 1] / positionLength;
    out[o + 2] = positions[o + 2] / positionLength;
  }
}

/**
 * Builds one fixed-resolution displaced sphere. Sampling is deterministic: identical params (and
 * an identical sampler) reproduce byte-for-byte identical arrays.
 */
export function buildPlanetGlobeGeometry(params: IPlanetGlobeGeometryParams): IPlanetGlobeGeometry {
  const longitudeSegments = Math.max(3, Math.floor(params.longitudeSegments ?? DEFAULT_GLOBE_LONGITUDE_SEGMENTS));
  const latitudeRings = Math.max(2, Math.floor(params.latitudeRings ?? DEFAULT_GLOBE_LATITUDE_RINGS));
  const radius = params.radius ?? 1;
  const heightScale = params.heightScale ?? DEFAULT_GLOBE_HEIGHT_SCALE;
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`buildPlanetGlobeGeometry: radius must be positive and finite, got ${radius}.`);
  }
  if (!Number.isFinite(heightScale)) {
    throw new RangeError(`buildPlanetGlobeGeometry: heightScale must be finite, got ${heightScale}.`);
  }

  const segments = longitudeSegments;
  const rings = latitudeRings;
  const vertexCount = 2 + (rings - 1) * segments;
  const southPoleIndex = vertexCount - 1;

  const directions = new Float32Array(vertexCount * 3);
  const elevations = new Float32Array(vertexCount);
  const landMask = new Uint8Array(vertexCount);
  const cellIds = new Int32Array(vertexCount);
  const { sampler, cellIdAt } = params;

  const writeVertex = (index: number, x: number, y: number, z: number): void => {
    const direction = normalize({ x, y, z });
    const o = index * 3;
    directions[o] = direction.x;
    directions[o + 1] = direction.y;
    directions[o + 2] = direction.z;
    const sample = sampler.sample(direction);
    elevations[index] = sample.elevation;
    landMask[index] = sample.isLand ? 1 : 0;
    cellIds[index] = cellIdAt ? cellIdAt(direction) : -1;
  };

  writeVertex(0, 0, 1, 0);
  for (let ring = 1; ring <= rings - 1; ring++) {
    const latitude = Math.PI / 2 - (ring * Math.PI) / rings;
    const cosLatitude = Math.cos(latitude);
    const sinLatitude = Math.sin(latitude);
    const ringStart = 1 + (ring - 1) * segments;
    for (let column = 0; column < segments; column++) {
      // Starts at -PI so column 0 is the shared +PI/-PI antimeridian seam.
      const longitude = -Math.PI + (column * 2 * Math.PI) / segments;
      writeVertex(
        ringStart + column,
        cosLatitude * Math.cos(longitude),
        sinLatitude,
        cosLatitude * Math.sin(longitude),
      );
    }
  }
  writeVertex(southPoleIndex, 0, -1, 0);

  const ringVertex = (ring: number, column: number): number =>
    1 + (ring - 1) * segments + (((column % segments) + segments) % segments);

  const triangleCount = 2 * segments * (rings - 1);
  const indices = new Uint32Array(triangleCount * 3);
  let cursor = 0;
  // North cap fan: the pole is the "upper" ring, so the shared triangle is (pole, next, current).
  for (let column = 0; column < segments; column++) {
    indices[cursor++] = 0;
    indices[cursor++] = ringVertex(1, column + 1);
    indices[cursor++] = ringVertex(1, column);
  }
  // Middle bands: two outward triangles per cell quad.
  for (let ring = 1; ring <= rings - 2; ring++) {
    for (let column = 0; column < segments; column++) {
      const topLeft = ringVertex(ring, column);
      const topRight = ringVertex(ring, column + 1);
      const bottomLeft = ringVertex(ring + 1, column);
      const bottomRight = ringVertex(ring + 1, column + 1);
      indices[cursor++] = topLeft;
      indices[cursor++] = topRight;
      indices[cursor++] = bottomLeft;
      indices[cursor++] = topRight;
      indices[cursor++] = bottomRight;
      indices[cursor++] = bottomLeft;
    }
  }
  // South cap fan.
  for (let column = 0; column < segments; column++) {
    indices[cursor++] = ringVertex(rings - 1, column);
    indices[cursor++] = ringVertex(rings - 1, column + 1);
    indices[cursor++] = southPoleIndex;
  }
  if (cursor !== indices.length) {
    throw new Error(`buildPlanetGlobeGeometry: wrote ${cursor} indices, expected ${indices.length}.`);
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  writePlanetGlobePositions(positions, directions, elevations, radius, heightScale);
  writePlanetGlobeNormals(normals, positions, indices);

  return {
    positions,
    normals,
    directions,
    elevations,
    landMask,
    cellIds,
    indices,
    radius,
    heightScale,
    longitudeSegments: segments,
    latitudeRings: rings,
    vertexCount,
    triangleCount: indices.length / 3,
  };
}
