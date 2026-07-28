import { BufferAttribute, BufferGeometry, Vector3, type Vector3Tuple } from 'three';

/** One control point along a trail — worldspace, plus the per-point tint the mesh carries. */
export interface ITrailRibbonPoint {
  readonly positionM: Vector3Tuple;
  readonly widthM: number;
  readonly alpha01: number;
  /**
   * Surface normal at this point — used for ribbon thickness direction and
   * `normalOffsetM`. Defaults to world-up, correct for a flat ground plane
   * but wrong for curved terrain (sphere/cylinder), where callers should
   * supply the real surface normal.
   */
  readonly normal?: Vector3Tuple;
}

export interface ITrailRibbonGeometryOptions {
  /** Lifts the ribbon slightly off the surface along each point's normal, avoiding z-fighting with the ground mesh underneath. */
  readonly normalOffsetM?: number;
  /** Reprojects a point onto the surface right before the offset is applied — e.g. re-sampling terrain height for points authored/loaded independently of the live mesh. */
  readonly projectToSurface?: (positionM: Vector3Tuple) => Vector3Tuple;
}

const DEFAULT_NORMAL: Vector3Tuple = [0, 1, 0];
const DEFAULT_NORMAL_OFFSET_M = 0.02;

/**
 * Builds an extruded ribbon strip conforming to a trail of points — rover
 * tracks, drag marks, ski trails. Two triangles per segment, UV.v runs 0..1
 * along the trail length, UV.u is 0/1 across width, and a per-vertex `alpha`
 * attribute carries each point's `alpha01` (e.g. for a fade-out shader —
 * decay policy itself is app concern, not this builder's).
 */
export function createTrailRibbonGeometry(
  points: readonly ITrailRibbonPoint[],
  options: ITrailRibbonGeometryOptions = {},
): BufferGeometry {
  if (points.length < 2) {
    throw new Error('createTrailRibbonGeometry needs at least 2 points.');
  }
  const { normalOffsetM = DEFAULT_NORMAL_OFFSET_M, projectToSurface } = options;

  const vertexCount = points.length * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const alphas = new Float32Array(vertexCount);

  const center = new Vector3();
  const normal = new Vector3();
  const tangent = new Vector3();
  const side = new Vector3();
  const previous = new Vector3();
  const next = new Vector3();
  const left = new Vector3();
  const right = new Vector3();

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const projectedM = projectToSurface
      ? projectToSurface(point.positionM)
      : point.positionM;
    center.set(projectedM[0], projectedM[1], projectedM[2]);
    const normalM = point.normal ?? DEFAULT_NORMAL;
    normal.set(normalM[0], normalM[1], normalM[2]).normalize();

    if (i === 0) {
      next.set(...points[i + 1].positionM);
      tangent.subVectors(next, center);
    } else if (i === points.length - 1) {
      previous.set(...points[i - 1].positionM);
      tangent.subVectors(center, previous);
    } else {
      previous.set(...points[i - 1].positionM);
      next.set(...points[i + 1].positionM);
      tangent.subVectors(next, previous);
    }
    if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
    tangent.normalize();

    side.crossVectors(tangent, normal);
    if (side.lengthSq() < 1e-10) side.set(0, 0, 1);
    side.normalize();

    const halfWidthM = point.widthM * 0.5;
    left
      .copy(center)
      .addScaledVector(side, halfWidthM)
      .addScaledVector(normal, normalOffsetM);
    right
      .copy(center)
      .addScaledVector(side, -halfWidthM)
      .addScaledVector(normal, normalOffsetM);

    const vBase = i * 2;
    positions[vBase * 3] = left.x;
    positions[vBase * 3 + 1] = left.y;
    positions[vBase * 3 + 2] = left.z;
    positions[(vBase + 1) * 3] = right.x;
    positions[(vBase + 1) * 3 + 1] = right.y;
    positions[(vBase + 1) * 3 + 2] = right.z;

    const v = i / (points.length - 1);
    uvs[vBase * 2] = 0;
    uvs[vBase * 2 + 1] = v;
    uvs[(vBase + 1) * 2] = 1;
    uvs[(vBase + 1) * 2 + 1] = v;

    alphas[vBase] = point.alpha01;
    alphas[vBase + 1] = point.alpha01;
  }

  const segmentCount = points.length - 1;
  const IndexArray = vertexCount <= 65_535 ? Uint16Array : Uint32Array;
  const indices = new IndexArray(segmentCount * 6);
  for (let i = 0; i < segmentCount; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    const offset = i * 6;
    indices[offset] = a;
    indices[offset + 1] = b;
    indices[offset + 2] = c;
    indices[offset + 3] = b;
    indices[offset + 4] = d;
    indices[offset + 5] = c;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('alpha', new BufferAttribute(alphas, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}
