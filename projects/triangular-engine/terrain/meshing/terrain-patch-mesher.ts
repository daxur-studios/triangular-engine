import { ITerrainField } from '../core/terrain-field';
import { TerrainVector3 } from '../core/terrain-math';
import {
  ITerrainPatchGeometry,
  TerrainPatchEdgeSegments,
  ITerrainPatchMesh,
  TerrainPatchIndexArray,
} from '../core/terrain-patch';
import { ITerrainSurfaceDomain } from '../domains/terrain-surface-domain';

const XYZ_COUNT = 3;
const UV_COUNT = 2;
const UINT16_MAX_VERTICES = 65_535;

export interface ITerrainPatchMeshOptions<TAddress> {
  address: TAddress;
  /** Number of surface quads along each patch axis. */
  resolution: number;
  /**
   * Normal patch resolution before mixed-LOD refinement. When `resolution` is
   * higher, edges use the requested per-edge detail and otherwise follow this
   * coarser piecewise boundary exactly.
   */
  baseResolution?: number;
  /** Per-edge level deltas in north, east, south, west order. */
  edgeRefinementLevels?: readonly [number, number, number, number];
  /** Refined sections for each edge in north, east, south, west order. */
  edgeRefinementSegments?: TerrainPatchEdgeSegments;
  /** Optional visual-only edge extrusion used to cover mixed-LOD joins. */
  skirtDepthM?: number;
}

function createSkirt(
  positions: Float32Array,
  normals: Float32Array,
  resolution: number,
  depthM: number,
): ITerrainPatchGeometry {
  const row = resolution + 1;
  const edge: number[] = [];
  for (let u = 0; u <= resolution; u++) edge.push(u);
  for (let v = 1; v <= resolution; v++) edge.push(v * row + resolution);
  for (let u = resolution - 1; u >= 0; u--) edge.push(resolution * row + u);
  for (let v = resolution - 1; v > 0; v--) edge.push(v * row);
  const skirtPositions = new Float32Array(edge.length * 2 * XYZ_COUNT);
  const skirtNormals = new Float32Array(edge.length * 2 * XYZ_COUNT);
  const skirtUvs = new Float32Array(edge.length * 2 * UV_COUNT);
  for (let i = 0; i < edge.length; i++) {
    const source = edge[i];
    for (let axis = 0; axis < XYZ_COUNT; axis++) {
      const value = positions[source * XYZ_COUNT + axis];
      const direction = normals[source * XYZ_COUNT + axis];
      skirtPositions[i * 6 + axis] = value;
      skirtPositions[i * 6 + 3 + axis] = value - direction * depthM;
      skirtNormals[i * 6 + axis] = direction;
      skirtNormals[i * 6 + 3 + axis] = direction;
    }
    skirtUvs[i * 4] = i / edge.length;
    skirtUvs[i * 4 + 1] = 0;
    skirtUvs[i * 4 + 2] = i / edge.length;
    skirtUvs[i * 4 + 3] = 1;
  }
  const IndexArray =
    edge.length * 2 <= UINT16_MAX_VERTICES ? Uint16Array : Uint32Array;
  const indices = new IndexArray(edge.length * 6);
  for (let i = 0; i < edge.length; i++) {
    const next = (i + 1) % edge.length;
    const offset = i * 6;
    indices[offset] = i * 2;
    indices[offset + 1] = next * 2;
    indices[offset + 2] = next * 2 + 1;
    indices[offset + 3] = i * 2;
    indices[offset + 4] = next * 2 + 1;
    indices[offset + 5] = i * 2 + 1;
  }
  return {
    positions: skirtPositions,
    normals: skirtNormals,
    uvs: skirtUvs,
    indices,
  };
}

function setVector(
  buffer: Float32Array | Float64Array,
  index: number,
  value: TerrainVector3,
): void {
  const offset = index * XYZ_COUNT;
  buffer[offset] = value[0];
  buffer[offset + 1] = value[1];
  buffer[offset + 2] = value[2];
}

function point(buffer: Float64Array, index: number): TerrainVector3 {
  const offset = index * XYZ_COUNT;
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
}

function subtract(a: TerrainVector3, b: TerrainVector3): TerrainVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normal(a: TerrainVector3, b: TerrainVector3): TerrainVector3 {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError(
      'Terrain domain produced a degenerate surface normal.',
    );
  }
  return [x / length, y / length, z / length];
}

export function createIndices(
  resolution: number,
  vertexCount: number,
): TerrainPatchIndexArray {
  const indices =
    vertexCount <= UINT16_MAX_VERTICES
      ? new Uint16Array(resolution * resolution * 6)
      : new Uint32Array(resolution * resolution * 6);
  const row = resolution + 1;
  let output = 0;
  for (let v = 0; v < resolution; v += 1) {
    for (let u = 0; u < resolution; u += 1) {
      const bottomLeft = v * row + u;
      const bottomRight = bottomLeft + 1;
      const topLeft = bottomLeft + row;
      const topRight = topLeft + 1;
      indices[output++] = bottomLeft;
      indices[output++] = bottomRight;
      indices[output++] = topRight;
      indices[output++] = bottomLeft;
      indices[output++] = topRight;
      indices[output++] = topLeft;
    }
  }
  return indices;
}

export function conformPatchEdges(
  positions: Float32Array,
  normals: Float32Array,
  resolution: number,
  baseResolution: number,
  edgeLevelDeltas: readonly [number, number, number, number],
  edgeSegments: TerrainPatchEdgeSegments,
): void {
  const row = resolution + 1;
  const edgeVertices = [
    (offset: number) => offset,
    (offset: number) => offset * row + resolution,
    (offset: number) => resolution * row + offset,
    (offset: number) => offset * row,
  ] as const;

  for (let edge = 0; edge < edgeVertices.length; edge += 1) {
    const anchors = new Set<number>();
    const baseStride = resolution / baseResolution;
    for (let sample = 0; sample <= resolution; sample += baseStride) {
      anchors.add(sample);
    }
    const requestedSegments = edgeSegments[edge].length
      ? edgeSegments[edge]
      : edgeLevelDeltas[edge] > 0
        ? [{ start: 0, end: 1, levelDelta: edgeLevelDeltas[edge] }]
        : [];
    for (const segment of requestedSegments) {
      const targetSegments = baseResolution * 2 ** segment.levelDelta;
      const stride = resolution / targetSegments;
      if (!Number.isInteger(stride)) {
        throw new RangeError(
          'Terrain transition resolution must be divisible by every edge resolution.',
        );
      }
      const start = Math.round(segment.start * resolution);
      const end = Math.round(segment.end * resolution);
      anchors.add(start);
      anchors.add(end);
      for (let sample = start; sample <= end; sample += stride) {
        anchors.add(sample);
      }
    }
    const orderedAnchors = [...anchors].sort((left, right) => left - right);
    const vertexAt = edgeVertices[edge];
    for (let anchor = 0; anchor < orderedAnchors.length - 1; anchor += 1) {
      const lowerSample = orderedAnchors[anchor];
      const upperSample = orderedAnchors[anchor + 1];
      for (let sample = lowerSample + 1; sample < upperSample; sample += 1) {
        const alpha = (sample - lowerSample) / (upperSample - lowerSample);
        interpolateVector(
          positions,
          vertexAt(sample),
          vertexAt(lowerSample),
          vertexAt(upperSample),
          alpha,
          false,
        );
        interpolateVector(
          normals,
          vertexAt(sample),
          vertexAt(lowerSample),
          vertexAt(upperSample),
          alpha,
          true,
        );
      }
    }
  }
}

function interpolateVector(
  values: Float32Array,
  target: number,
  lower: number,
  upper: number,
  alpha: number,
  normalize: boolean,
): void {
  const targetOffset = target * XYZ_COUNT;
  const lowerOffset = lower * XYZ_COUNT;
  const upperOffset = upper * XYZ_COUNT;
  let lengthSquared = 0;
  for (let axis = 0; axis < XYZ_COUNT; axis += 1) {
    const value =
      values[lowerOffset + axis] * (1 - alpha) +
      values[upperOffset + axis] * alpha;
    values[targetOffset + axis] = value;
    lengthSquared += value * value;
  }
  if (!normalize || lengthSquared === 0) return;
  const inverseLength = 1 / Math.sqrt(lengthSquared);
  for (let axis = 0; axis < XYZ_COUNT; axis += 1) {
    values[targetOffset + axis] *= inverseLength;
  }
}

/** Generates a domain-independent patch with f64 sampling and f32 local offsets. */
export function generateTerrainPatchMesh<TAddress>(
  field: ITerrainField,
  domain: ITerrainSurfaceDomain<TAddress>,
  options: ITerrainPatchMeshOptions<TAddress>,
): ITerrainPatchMesh<TAddress> {
  const {
    address,
    resolution,
    baseResolution = resolution,
    edgeRefinementLevels = [0, 0, 0, 0],
    edgeRefinementSegments = [[], [], [], []],
    skirtDepthM = 0,
  } = options;
  if (!Number.isInteger(resolution) || resolution < 2) {
    throw new RangeError(
      'Terrain patch resolution must be an integer of at least two quads.',
    );
  }
  if (
    !Number.isInteger(baseResolution) ||
    baseResolution < 2 ||
    baseResolution > resolution ||
    resolution % baseResolution !== 0
  ) {
    throw new RangeError(
      'Terrain base resolution must divide the generated resolution.',
    );
  }
  const bounds = domain.getPatchBounds(address);
  const stepU = (bounds.maxU - bounds.minU) / resolution;
  const stepV = (bounds.maxV - bounds.minV) / resolution;
  if (
    !Number.isFinite(stepU) ||
    !Number.isFinite(stepV) ||
    stepU <= 0 ||
    stepV <= 0
  ) {
    throw new RangeError(
      'Terrain patch bounds must have positive finite area.',
    );
  }

  // The extra sample ring gives adjacent patches matching edge normals.
  const extendedRow = resolution + 3;
  const extendedCount = extendedRow * extendedRow;
  const fieldPositions = new Float64Array(extendedCount * XYZ_COUNT);
  for (let vi = 0; vi < extendedRow; vi += 1) {
    const v = bounds.minV + (vi - 1) * stepV;
    for (let ui = 0; ui < extendedRow; ui += 1) {
      const u = bounds.minU + (ui - 1) * stepU;
      setVector(
        fieldPositions,
        vi * extendedRow + ui,
        domain.getFieldPosition(address, u, v),
      );
    }
  }
  const elevations = field.sampleBatch(fieldPositions);
  const points = new Float64Array(fieldPositions.length);
  for (let vi = 0; vi < extendedRow; vi += 1) {
    const v = bounds.minV + (vi - 1) * stepV;
    for (let ui = 0; ui < extendedRow; ui += 1) {
      const u = bounds.minU + (ui - 1) * stepU;
      const index = vi * extendedRow + ui;
      setVector(
        points,
        index,
        domain.getSurfacePosition(address, u, v, elevations[index]),
      );
    }
  }

  const centerU = (bounds.minU + bounds.maxU) / 2;
  const centerV = (bounds.minV + bounds.maxV) / 2;
  const centerField = domain.getFieldPosition(address, centerU, centerV);
  const center = domain.getSurfacePosition(
    address,
    centerU,
    centerV,
    field.sample(centerField).elevationM,
  );
  const row = resolution + 1;
  const vertexCount = row * row;
  const positions = new Float32Array(vertexCount * XYZ_COUNT);
  const normals = new Float32Array(vertexCount * XYZ_COUNT);
  const uvs = new Float32Array(vertexCount * UV_COUNT);
  for (let vi = 0; vi <= resolution; vi += 1) {
    for (let ui = 0; ui <= resolution; ui += 1) {
      const vertex = vi * row + ui;
      const extended = (vi + 1) * extendedRow + ui + 1;
      setVector(positions, vertex, subtract(point(points, extended), center));
      setVector(
        normals,
        vertex,
        domain.getSurfaceNormal
          ? domain.getSurfaceNormal(
              field,
              address,
              bounds.minU + ui * stepU,
              bounds.minV + vi * stepV,
              stepU,
              stepV,
            )
          : normal(
              subtract(
                point(points, extended + 1),
                point(points, extended - 1),
              ),
              subtract(
                point(points, extended + extendedRow),
                point(points, extended - extendedRow),
              ),
            ),
      );
      uvs[vertex * UV_COUNT] = ui / resolution;
      uvs[vertex * UV_COUNT + 1] = vi / resolution;
    }
  }
  conformPatchEdges(
    positions,
    normals,
    resolution,
    baseResolution,
    edgeRefinementLevels,
    edgeRefinementSegments,
  );
  const surface: ITerrainPatchGeometry = {
    positions,
    normals,
    uvs,
    indices: createIndices(resolution, vertexCount),
  };
  return {
    address,
    resolution,
    centerWorldM: center,
    surface,
    skirt:
      skirtDepthM > 0
        ? createSkirt(positions, normals, resolution, skirtDepthM)
        : undefined,
    geometricErrorM: domain.getGeometricErrorM(
      address,
      resolution,
      field.minElevationM,
      field.maxElevationM,
    ),
  };
}
