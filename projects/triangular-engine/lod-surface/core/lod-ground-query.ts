import { detailTexelMetres } from './lod-detail-noise';
import type { LodDomain, Vec3 } from './lod-domain';
import { DEFAULT_BAKE_K } from './lod-height-bake';
import type { HeightSource } from './lod-height';

/**
 * Gameplay ground query (Plan 059 G4): height, normal and up of the terrain under a point, from the CPU twin of the
 * heights. Pure functions on doubles with no Three.js and no Angular, so they run in a worker as well.
 */

/** The ground under one query point; see {@link groundAt}. */
export interface GroundSample {
  /** Height of the ground above the base surface (plane: above y = 0; sphere: above the radius), metres. */
  heightM: number;
  /** The ground point under the query: the base point moved up by {@link heightM}. Stand a character's feet here. */
  point: Vec3;
  /** Unit normal of the ground surface, pointing out (up) from it. Align a character or vehicle to this. */
  normal: Vec3;
  /** Unit vector straight up from the base surface at this point: +Y on a plane, away from the centre on a sphere. */
  up: Vec3;
  /** Signed height of the query point above {@link point} along {@link up}, metres; negative means it is underground. */
  altitudeM: number;
}

/** A sample to pass as `out` to {@link groundAt}, so a game loop allocates nothing per call. */
export function createGroundSample(): GroundSample {
  return { heightM: 0, point: [0, 0, 0], normal: [0, 1, 0], up: [0, 1, 0], altitudeM: 0 };
}

/**
 * The default step of the normal's central difference for a domain: half a texel of a `cells`-texel-per-side height
 * texture (default the default bake, `2^DEFAULT_BAKE_K`). See {@link groundAt} for why.
 */
export function defaultGroundStepM(domain: LodDomain, cells: number = 2 ** DEFAULT_BAKE_K): number {
  return detailTexelMetres(domain, cells) / 2;
}

/** The sphere's widest half-angle of the difference, radians: keeps the two sample points sensible on a tiny body. */
const MAX_HALF_ANGLE = 0.5;

/**
 * The ground under `position`: its height, the point on it, its normal and the query point's height above it. Take
 * `source` and `domain` from `LodTerrainBody.source` and `LodTerrainBody.settings.domain` (or call
 * `LodTerrainBody.groundAt`, `<planetTerrain>.groundAt`, `<flatTerrain>.groundAt`) so the detail noise is included.
 *
 * `position` is any point in the terrain frame (the scene frame, body at the origin), for example a character's feet,
 * above or below the ground.
 *
 * - Sphere: `up` is `position` normalised, the base point lies on the sphere along it, and `altitudeM` is
 *   `|position| - (R + heightM)`. The exact centre has no direction; `up` is then +Y (no NaN).
 * - Plane: `up` is +Y and the base point is `position` projected onto y = 0. The terrain ends at its square: outside it the
 *   query is clamped to the nearest edge point (the height there, as the baked sources read it), and `point` lies on that
 *   edge. `altitudeM` is then the height above that edge point.
 *
 * `normal` is the normal of the whole CPU surface, detail noise included, from central differences of `heightAt` in two
 * tangent directions (east and north of the local frame; the frame switches its reference near the poles, so there is
 * no singularity). On a sphere the radial lift is accounted for (the ground widens with height). `stepM` is the
 * difference's half-width, metres along the surface: the default is half a texel of the default 1,024-texel bake
 * ({@link defaultGroundStepM}). A baked height is a bilinear facet per texel, so a step below the texel measures the
 * facet, not the relief; half a texel smooths over the facet edges and the finest noise octaves, which wiggle at under
 * a tenth of a texel with tiny amplitude. `LodTerrainBody.groundAt` passes the step of its own texture. Pass a smaller
 * `stepM` for an analytic source with fine features. On the plane the step shrinks at the edge instead of leaving the
 * square.
 *
 * What it is: the full-detail CPU surface, the one the selector and camera use. What is drawn can differ from it by the
 * LOD error (coarser cells away from the camera), which is smallest near the camera, so use it for characters and
 * vehicles near the camera. For baked sources it reads the same texels as the vertex stage, in float32. It is not a ray
 * cast: it answers "what is under this point", so on a cliff or an overhang it returns the surface along `up`.
 *
 * Cost: five `heightAt` calls (one for the height, four for the normal) and no allocation when `out` is passed.
 *
 * @param out Reused and returned when given; its arrays are overwritten.
 * @param stepM Half-width of the central difference, metres; default {@link defaultGroundStepM} of the domain.
 */
export function groundAt(source: HeightSource, domain: LodDomain, position: Vec3, out: GroundSample = createGroundSample(), stepM: number = defaultGroundStepM(domain)): GroundSample {
  const [px, py, pz] = position;
  const { up, point, normal } = out;
  if (domain.kind === 'plane') {
    const half = domain.sizeM / 2;
    const bx = Math.min(half, Math.max(-half, px));
    const bz = Math.min(half, Math.max(-half, pz));
    const h = source.heightAt(bx, 0, bz);
    const x1 = Math.min(half, bx + stepM);
    const x0 = Math.max(-half, bx - stepM);
    const z1 = Math.min(half, bz + stepM);
    const z0 = Math.max(-half, bz - stepM);
    const dhdx = x1 > x0 ? (source.heightAt(x1, 0, bz) - source.heightAt(x0, 0, bz)) / (x1 - x0) : 0;
    const dhdz = z1 > z0 ? (source.heightAt(bx, 0, z1) - source.heightAt(bx, 0, z0)) / (z1 - z0) : 0;
    // East is +X and north is -Z, so the slope to the north is -dh/dz.
    const length = Math.hypot(dhdx, dhdz, 1);
    out.heightM = h;
    out.altitudeM = py - h;
    up[0] = 0;
    up[1] = 1;
    up[2] = 0;
    point[0] = bx;
    point[1] = h;
    point[2] = bz;
    normal[0] = -dhdx / length;
    normal[1] = 1 / length;
    normal[2] = -dhdz / length;
    return out;
  }

  const radius = domain.sizeM;
  const distance = Math.hypot(px, py, pz);
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (distance > 0) {
    ux = px / distance;
    uy = py / distance;
    uz = pz / distance;
  }
  // East = reference x up, north = up x east (as `groundFrame`): the reference is +Y, or +Z within 0.999 of the Y axis.
  let ex: number;
  let ey: number;
  let ez: number;
  if (Math.abs(uy) > 0.999) {
    ex = -uy;
    ey = ux;
    ez = 0;
  } else {
    ex = uz;
    ey = 0;
    ez = -ux;
  }
  const eastLength = Math.hypot(ex, ey, ez);
  ex /= eastLength;
  ey /= eastLength;
  ez /= eastLength;
  const nx = uy * ez - uz * ey;
  const ny = uz * ex - ux * ez;
  const nz = ux * ey - uy * ex;

  const h = source.heightAt(ux * radius, uy * radius, uz * radius);
  const angle = Math.min(MAX_HALF_ANGLE, stepM / radius);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const span = 2 * radius * angle;
  const dhde = (source.heightAt(radius * (ux * c + ex * s), radius * (uy * c + ey * s), radius * (uz * c + ez * s))
    - source.heightAt(radius * (ux * c - ex * s), radius * (uy * c - ey * s), radius * (uz * c - ez * s))) / span;
  const dhdn = (source.heightAt(radius * (ux * c + nx * s), radius * (uy * c + ny * s), radius * (uz * c + nz * s))
    - source.heightAt(radius * (ux * c - nx * s), radius * (uy * c - ny * s), radius * (uz * c - nz * s))) / span;
  // Tangents of the surface (R + h) * up(east, north) are k * east + dh/de * up and k * north + dh/dn * up, k = 1 + h / R; their cross product over k is the normal.
  const k = Math.max(1e-6, 1 + h / radius);
  const a = dhde / k;
  const b = dhdn / k;
  const length = Math.hypot(a, b, 1);
  out.heightM = h;
  out.altitudeM = distance - (radius + h);
  up[0] = ux;
  up[1] = uy;
  up[2] = uz;
  point[0] = ux * (radius + h);
  point[1] = uy * (radius + h);
  point[2] = uz * (radius + h);
  normal[0] = (ux - a * ex - b * nx) / length;
  normal[1] = (uy - a * ey - b * ny) / length;
  normal[2] = (uz - a * ez - b * nz) / length;
  return out;
}
