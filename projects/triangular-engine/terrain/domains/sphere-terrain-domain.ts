import type { ITerrainField } from '../core/terrain-field';
import type { TerrainVector3 } from '../core/terrain-math';
import type {
  ITerrainPatchBounds,
  ITerrainSurfaceDomain,
} from './terrain-surface-domain';

export type SphereTerrainFace =
  | 'positive-x'
  | 'negative-x'
  | 'positive-y'
  | 'negative-y'
  | 'positive-z'
  | 'negative-z';

export const SPHERE_TERRAIN_FACES: readonly SphereTerrainFace[] = [
  'positive-x',
  'negative-x',
  'positive-y',
  'negative-y',
  'positive-z',
  'negative-z',
];

export interface ISphereTerrainPatchAddress {
  readonly face: SphereTerrainFace;
  readonly level: number;
  readonly x: number;
  readonly y: number;
}

/** Maximum quadtree level that keeps exact integer tile counts in JS numbers. */
export const MAX_SPHERE_TERRAIN_LEVEL = 30;

export type SphereTerrainPatchEdge = 'left' | 'right' | 'bottom' | 'top';

export interface ISphereTerrainFaceUv {
  readonly face: SphereTerrainFace;
  readonly u: number;
  readonly v: number;
}

function normalize([x, y, z]: TerrainVector3): TerrainVector3 {
  const inverseLength = 1 / Math.hypot(x, y, z);
  return [x * inverseLength, y * inverseLength, z * inverseLength];
}

function cross(a: TerrainVector3, b: TerrainVector3): TerrainVector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Canonical cube-face coordinates projected onto a unit sphere. */
export function sphereFaceUvToDirection(
  face: SphereTerrainFace,
  u: number,
  v: number,
): TerrainVector3 {
  let cube: TerrainVector3;
  switch (face) {
    case 'positive-x':
      cube = [1, v, -u];
      break;
    case 'negative-x':
      cube = [-1, v, u];
      break;
    case 'positive-y':
      cube = [u, 1, -v];
      break;
    case 'negative-y':
      cube = [u, -1, v];
      break;
    case 'positive-z':
      cube = [u, v, 1];
      break;
    case 'negative-z':
      cube = [-u, v, -1];
      break;
  }
  return normalize(cube);
}

/** Resolves a finite non-zero direction to this domain's canonical cube face. */
export function sphereDirectionToFaceUv(
  direction: TerrainVector3,
): ISphereTerrainFaceUv {
  const [x, y, z] = direction;
  if (![x, y, z].every(Number.isFinite) || (x === 0 && y === 0 && z === 0)) {
    throw new RangeError(
      'Sphere terrain direction must be finite and non-zero.',
    );
  }
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const absZ = Math.abs(z);
  if (absX >= absY && absX >= absZ) {
    return x >= 0
      ? { face: 'positive-x', u: -z / absX, v: y / absX }
      : { face: 'negative-x', u: z / absX, v: y / absX };
  }
  if (absY >= absZ) {
    return y >= 0
      ? { face: 'positive-y', u: x / absY, v: -z / absY }
      : { face: 'negative-y', u: x / absY, v: z / absY };
  }
  return z >= 0
    ? { face: 'positive-z', u: x / absZ, v: y / absZ }
    : { face: 'negative-z', u: -x / absZ, v: y / absZ };
}

/** Finds a same-level neighbor, including transitions across cube faces. */
export function sphereTerrainPatchNeighbor(
  domain: SphereTerrainDomain,
  address: ISphereTerrainPatchAddress,
  edge: SphereTerrainPatchEdge,
): ISphereTerrainPatchAddress {
  const bounds = domain.getPatchBounds(address);
  const outsideOffset = Number.EPSILON * 16;
  let u = (bounds.minU + bounds.maxU) / 2;
  let v = (bounds.minV + bounds.maxV) / 2;
  switch (edge) {
    case 'left':
      u = bounds.minU - outsideOffset;
      break;
    case 'right':
      u = bounds.maxU + outsideOffset;
      break;
    case 'bottom':
      v = bounds.minV - outsideOffset;
      break;
    case 'top':
      v = bounds.maxV + outsideOffset;
      break;
  }
  const neighbor = sphereDirectionToFaceUv(
    sphereFaceUvToDirection(address.face, u, v),
  );
  const tileCount = 2 ** address.level;
  return {
    face: neighbor.face,
    level: address.level,
    x: Math.min(
      tileCount - 1,
      Math.max(0, Math.floor((neighbor.u + 1) * 0.5 * tileCount)),
    ),
    y: Math.min(
      tileCount - 1,
      Math.max(0, Math.floor((neighbor.v + 1) * 0.5 * tileCount)),
    ),
  };
}

/** Six-face cubesphere terrain with outward positive elevation. */
export class SphereTerrainDomain implements ITerrainSurfaceDomain<ISphereTerrainPatchAddress> {
  readonly kind = 'sphere';

  constructor(readonly radiusM: number) {
    if (!Number.isFinite(radiusM) || radiusM <= 0) {
      throw new RangeError(
        'Sphere terrain radius must be positive and finite.',
      );
    }
  }

  getPatchBounds(address: ISphereTerrainPatchAddress): ITerrainPatchBounds {
    this.validateAddress(address);
    const tileCount = 2 ** address.level;
    const span = 2 / tileCount;
    return {
      minU: -1 + address.x * span,
      maxU: -1 + (address.x + 1) * span,
      minV: -1 + address.y * span,
      maxV: -1 + (address.y + 1) * span,
    };
  }

  getFieldPosition(
    address: ISphereTerrainPatchAddress,
    u: number,
    v: number,
  ): TerrainVector3 {
    this.validateAddress(address);
    return sphereFaceUvToDirection(address.face, u, v);
  }

  getSurfacePosition(
    address: ISphereTerrainPatchAddress,
    u: number,
    v: number,
    elevationM: number,
  ): TerrainVector3 {
    const direction = this.getFieldPosition(address, u, v);
    const radius = this.radiusM + elevationM;
    return [
      direction[0] * radius,
      direction[1] * radius,
      direction[2] * radius,
    ];
  }

  getSurfaceNormal(
    field: ITerrainField,
    address: ISphereTerrainPatchAddress,
    u: number,
    v: number,
    stepU: number,
    stepV: number,
  ): TerrainVector3 {
    const direction = this.getFieldPosition(address, u, v);
    const reference: TerrainVector3 =
      Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const tangentU = normalize(cross(reference, direction));
    const tangentV = cross(direction, tangentU);
    const epsilon = Math.min(0.25, Math.hypot(stepU, stepV) / 2);
    const sampleDirection = (
      tangent: TerrainVector3,
      sign: number,
    ): TerrainVector3 =>
      normalize([
        direction[0] + tangent[0] * epsilon * sign,
        direction[1] + tangent[1] * epsilon * sign,
        direction[2] + tangent[2] * epsilon * sign,
      ]);
    const surfacePoint = (sample: TerrainVector3): TerrainVector3 => {
      const radius = this.radiusM + field.sample(sample).elevationM;
      return [sample[0] * radius, sample[1] * radius, sample[2] * radius];
    };
    const left = surfacePoint(sampleDirection(tangentU, -1));
    const right = surfacePoint(sampleDirection(tangentU, 1));
    const bottom = surfacePoint(sampleDirection(tangentV, -1));
    const top = surfacePoint(sampleDirection(tangentV, 1));
    return normalize(
      cross(
        [right[0] - left[0], right[1] - left[1], right[2] - left[2]],
        [top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]],
      ),
    );
  }

  getGeometricErrorM(
    address: ISphereTerrainPatchAddress,
    resolution: number,
    minElevationM: number,
    maxElevationM: number,
  ): number {
    const bounds = this.getPatchBounds(address);
    const faceSpan = bounds.maxU - bounds.minU;
    const cellAngle = Math.min(Math.PI, (faceSpan * Math.PI) / resolution);
    const curvatureError =
      (this.radiusM + maxElevationM) * (1 - Math.cos(cellAngle / 2));
    return maxElevationM - minElevationM + curvatureError;
  }

  getChildren(
    address: ISphereTerrainPatchAddress,
  ): readonly ISphereTerrainPatchAddress[] {
    this.validateAddress(address);
    const level = address.level + 1;
    if (level > MAX_SPHERE_TERRAIN_LEVEL) {
      throw new RangeError('Sphere terrain patch has reached maximum level.');
    }
    const x = address.x * 2;
    const y = address.y * 2;
    return [
      { face: address.face, level, x, y },
      { face: address.face, level, x: x + 1, y },
      { face: address.face, level, x, y: y + 1 },
      { face: address.face, level, x: x + 1, y: y + 1 },
    ];
  }

  private validateAddress(address: ISphereTerrainPatchAddress): void {
    const tileCount = 2 ** address.level;
    if (
      !SPHERE_TERRAIN_FACES.includes(address.face) ||
      !Number.isInteger(address.level) ||
      address.level < 0 ||
      address.level > MAX_SPHERE_TERRAIN_LEVEL ||
      !Number.isInteger(address.x) ||
      !Number.isInteger(address.y) ||
      address.x < 0 ||
      address.y < 0 ||
      address.x >= tileCount ||
      address.y >= tileCount
    ) {
      throw new RangeError(
        'Sphere terrain address must identify a valid face quadtree tile.',
      );
    }
  }
}
