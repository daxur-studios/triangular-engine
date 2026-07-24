import type { ITerrainField } from './terrain-field';
import { TerrainVector3 } from './terrain-math';
import type { ITerrainSurfaceDomain } from '../domains/terrain-surface-domain';

/**
 * Canonical single-point terrain surface sample. Shared by meshing, ground
 * scatter, biome evaluation, and physics placement so every consumer reads
 * the same displaced surface — never the shader alone.
 */
export interface ITerrainSurfaceSample {
  readonly fieldPosition: TerrainVector3;
  readonly worldPositionM: TerrainVector3;
  /** worldPositionM relative to options.anchorWorldM, f32-safe at planetary radii. */
  readonly anchorRelativeM: TerrainVector3;
  readonly normal: TerrainVector3;
  /** Undisplaced "which way is up" reference (flat=+Y, sphere=outward radial, cylinder=inward radial). */
  readonly surfaceUp: TerrainVector3;
  readonly elevationM: number;
  /** 0 = flat relative to the undisplaced surface, 1 = vertical or steeper. */
  readonly slope01: number;
}

export interface ITerrainSurfaceSampleOptions {
  /** f64 world-space origin instance transforms are stored relative to. Defaults to worldPositionM (zero-relative). */
  readonly anchorWorldM?: TerrainVector3;
  /** Finite-difference UV step used for the normal/slope estimate. Defaults to 1/64th of the shorter patch span. */
  readonly epsilon?: number;
}

function subtract(a: TerrainVector3, b: TerrainVector3): TerrainVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: TerrainVector3, b: TerrainVector3): TerrainVector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: TerrainVector3): TerrainVector3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError(
      'Terrain surface sampler produced a degenerate normal.',
    );
  }
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: TerrainVector3, b: TerrainVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Central-difference normal identical in form to the mesher's generic fallback. */
function computeFiniteDifferenceNormal<TAddress>(
  field: ITerrainField,
  domain: ITerrainSurfaceDomain<TAddress>,
  address: TAddress,
  u: number,
  v: number,
  stepU: number,
  stepV: number,
): TerrainVector3 {
  const sampleWorld = (uu: number, vv: number): TerrainVector3 => {
    const fieldPosition = domain.getFieldPosition(address, uu, vv);
    return domain.getSurfacePosition(
      address,
      uu,
      vv,
      field.sample(fieldPosition).elevationM,
    );
  };
  const left = sampleWorld(u - stepU, v);
  const right = sampleWorld(u + stepU, v);
  const bottom = sampleWorld(u, v - stepV);
  const top = sampleWorld(u, v + stepV);
  return normalize(cross(subtract(right, left), subtract(top, bottom)));
}

/**
 * Normal of the same surface with elevation forced to zero everywhere — the
 * "which way is up" reference slope is measured against, independent of the
 * domain's shape (flat, sphere, cylinder).
 */
function computeBaseNormal<TAddress>(
  domain: ITerrainSurfaceDomain<TAddress>,
  address: TAddress,
  u: number,
  v: number,
  stepU: number,
  stepV: number,
): TerrainVector3 {
  const left = domain.getSurfacePosition(address, u - stepU, v, 0);
  const right = domain.getSurfacePosition(address, u + stepU, v, 0);
  const bottom = domain.getSurfacePosition(address, u, v - stepV, 0);
  const top = domain.getSurfacePosition(address, u, v + stepV, 0);
  return normalize(cross(subtract(right, left), subtract(top, bottom)));
}

/** Samples position, normal, elevation, and slope at one UV point on a terrain domain. */
export function sampleTerrainSurface<TAddress>(
  field: ITerrainField,
  domain: ITerrainSurfaceDomain<TAddress>,
  address: TAddress,
  u: number,
  v: number,
  options: ITerrainSurfaceSampleOptions = {},
): ITerrainSurfaceSample {
  const bounds = domain.getPatchBounds(address);
  const epsilon =
    options.epsilon ??
    Math.min(bounds.maxU - bounds.minU, bounds.maxV - bounds.minV) / 64;
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new RangeError(
      'Terrain surface sample epsilon must be positive and finite.',
    );
  }

  const fieldPosition = domain.getFieldPosition(address, u, v);
  const elevationM = field.sample(fieldPosition).elevationM;
  const worldPositionM = domain.getSurfacePosition(address, u, v, elevationM);

  const normalVector = domain.getSurfaceNormal
    ? domain.getSurfaceNormal(field, address, u, v, epsilon, epsilon)
    : computeFiniteDifferenceNormal(
        field,
        domain,
        address,
        u,
        v,
        epsilon,
        epsilon,
      );

  const baseNormal = computeBaseNormal(domain, address, u, v, epsilon, epsilon);
  const cosAngle = Math.min(1, Math.max(-1, dot(normalVector, baseNormal)));
  const slope01 = Math.min(1, Math.acos(cosAngle) / (Math.PI / 2));

  const anchorWorldM = options.anchorWorldM ?? worldPositionM;
  const anchorRelativeM = subtract(worldPositionM, anchorWorldM);

  return {
    fieldPosition,
    worldPositionM,
    anchorRelativeM,
    normal: normalVector,
    surfaceUp: baseNormal,
    elevationM,
    slope01,
  };
}
