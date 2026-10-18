/**
 * The bent planet (Plan 049, Morph, redesigned 2026-10-18): every in-between shape of the morph is a piece of a sphere
 * whose radius grows from `R` to infinity, so the globe's atmosphere maths stays exact the whole way.
 *
 * This file is pure TypeScript (no three). It holds the CPU `bend()` and the curvature-form helpers: altitude, up and
 * the ray against the air's top. They never form `1/k`, so `k = 0` (the flat map) is exact and tiny `k` loses nothing.
 * The shader twin is `BentAtmosphere`.
 *
 * Frame: the **map frame** has x to the projection's right, y up, z forward (out of the map), origin at the map
 * centre. At curvature `k` the ground is the sphere of radius `1/k` around `(0, 0, -1/k)`.
 */

export type Vec3 = readonly [number, number, number];

/** `sin(a) / a`, by its series for tiny `a` so `a = 0` is exactly 1. */
export function sinc(a: number): number {
  const a2 = a * a;
  if (a2 < 1e-6) return 1 - a2 / 6 + (a2 * a2) / 120;
  return Math.sin(a) / a;
}

/** `asin(a) / a`, by its series for tiny `a`. */
export function asinc(a: number): number {
  const a2 = a * a;
  if (a2 < 1e-6) return 1 + a2 / 6 + (3 * a2 * a2) / 40;
  return Math.asin(a) / a;
}

/** `atan(a) / a`, by its series for tiny `a`. */
export function atanc(a: number): number {
  const a2 = a * a;
  if (a2 < 1e-6) return 1 - a2 / 3 + (a2 * a2) / 5;
  return Math.atan(a) / a;
}

/** `1 - cos(a)` written as `2 sin^2(a / 2)`, so it keeps its digits for small `a`. */
export function vers(a: number): number {
  const s = Math.sin(a / 2);
  return 2 * s * s;
}

/** How far the planet has bent, 1 at the globe and 0 at the flat map. Start with `1 - morph`; tune by eye. */
export function bendCurve(morph: number): number {
  return 1 - Math.min(1, Math.max(0, morph));
}

/** Curvature `k` (1 / metre) at `morph` for a planet of radius `radius`. 0 is exactly the flat map. */
export function bendCurvature(morph: number, radius: number): number {
  return bendCurve(morph) / radius;
}

export interface BentPoint {
  /** Position in the map frame. The map centre is `(0, 0, 0)`. */
  readonly position: Vec3;
  /** Unit normal of the bent ground (the local up). */
  readonly normal: Vec3;
}

/**
 * Where the map point `(x, y)` (metres in the map's own plane) sits on the bent ground, with terrain `height` along the
 * normal. `k = 0` gives `(x, y, height)`; `k = 1 / R` with `(x, y) = R (lon, lat)` gives the sphere of radius `R`
 * centred on `(0, 0, -R)`.
 */
export function bend(x: number, y: number, k: number, height = 0): BentPoint {
  const kx = k * x;
  const ky = k * y;
  const cx = Math.cos(kx);
  const cy = Math.cos(ky);
  const normal: Vec3 = [cy * Math.sin(kx), Math.sin(ky), cx * cy];
  // (1 - cos(kx) cos(ky)) / k = (vers(kx) + cos(kx) vers(ky)) / k, and vers(a) / k = k x^2 sinc^2(a / 2) / 2.
  const sx = sinc(kx / 2);
  const sy = sinc(ky / 2);
  const z = -(0.5 * k * x * x * sx * sx + cx * 0.5 * k * y * y * sy * sy);
  return {
    position: [
      cy * x * sinc(kx) + height * normal[0],
      y * sinc(ky) + height * normal[1],
      z + height * normal[2],
    ],
    normal,
  };
}

export interface BentFrame {
  /** The ground point, in the map frame. */
  readonly origin: Vec3;
  /** Unit vectors, in the map frame: along the map's x, along its y, and the ground normal. */
  readonly east: Vec3;
  readonly north: Vec3;
  readonly up: Vec3;
}

/** The local frame at the map point `(x, y)`: the ground point and its east, north and up. */
export function bendFrame(x: number, y: number, k: number): BentFrame {
  const kx = k * x;
  const ky = k * y;
  const cx = Math.cos(kx);
  const sx = Math.sin(kx);
  const cy = Math.cos(ky);
  const sy = Math.sin(ky);
  return {
    origin: bend(x, y, k).position,
    east: [cx, 0, -sx],
    north: [-sy * sx, cy, -sy * cx],
    up: [cy * sx, sy, cx * cy],
  };
}

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Height above the bent ground of the point `p` (map frame), in the curvature form: with `q = k|p|^2 + 2 p.z`,
 * `h = q / (1 + sqrt(1 + k q))`. Exact for `k = 0` (`h = p.z`).
 */
export function curvatureAltitude(p: Vec3, k: number): number {
  const q = k * dot3(p, p) + 2 * p[2];
  return q / (1 + Math.sqrt(1 + k * q));
}

/** Unit up (away from the sphere's centre) at `p`: `(k p + (0, 0, 1)) / sqrt(1 + k q)`. */
export function curvatureUp(p: Vec3, k: number): Vec3 {
  const q = k * dot3(p, p) + 2 * p[2];
  const inv = 1 / Math.sqrt(1 + k * q);
  return [k * p[0] * inv, k * p[1] * inv, (k * p[2] + 1) * inv];
}

export interface RayHit {
  /** The two parameters where the ray crosses the sphere, `near <= far`. `Infinity`/`-Infinity` for the plane (`k = 0`). */
  readonly near: number;
  readonly far: number;
}

/**
 * Where the ray `o + t d` (map frame, unit `d`) meets the sphere at altitude `altitude` above the bent ground
 * (`0` is the ground, the air's top is its thickness), or null when it misses. At `k = 0` the sphere is the plane
 * `z = altitude`: the one finite crossing, and `Infinity` on the far side.
 *
 * Solves `k t^2 + 2 (k o.d + d.z) t + (k|o|^2 + 2 o.z - 2H - kH^2) = 0` in its stable form, so nothing cancels as
 * `k -> 0`.
 */
export function rayAtAltitude(o: Vec3, d: Vec3, k: number, altitude: number): RayHit | null {
  const b = k * dot3(o, d) + d[2];
  const c = k * dot3(o, o) + 2 * o[2] - 2 * altitude - k * altitude * altitude;
  const disc = b * b - k * c;
  if (disc < 0) return null;
  const q = b + (b < 0 ? -1 : 1) * Math.sqrt(disc);
  const small = q === 0 ? 0 : -c / q;
  const big = k === 0 ? (q >= 0 ? -Infinity : Infinity) : -q / k;
  return small <= big ? { near: small, far: big } : { near: big, far: small };
}

/** Map coordinates `(x, y)` of the ground point directly below `p` (the inverse of {@link bend} for the ground). */
export function bentMapCoords(p: Vec3, k: number): readonly [number, number] {
  const nx = k * p[0];
  const ny = k * p[1];
  const nz = 1 + k * p[2];
  const len = Math.hypot(nx, ny, nz);
  if (nz > 0.1) {
    const u = nx / nz;
    return [(p[0] / nz) * atanc(u), (p[1] / len) * asinc(ny / len)];
  }
  const kk = Math.max(k, 1e-9);
  return [Math.atan2(nx, nz) / kk, Math.asin(Math.max(-1, Math.min(1, ny / len))) / kk];
}

/**
 * The map mask: 1 inside the map's outline, 0 outside, falling off over `softness` metres at the edges. The map is
 * `2 halfWidth` by `2 halfHeight` (equirect: `pi R` by `pi R / 2`). A wrap-around edge that is still closed (the
 * globe's seam at `k = 1 / R`, and its poles) has no edge to soften, so the falloff shrinks to the width of the gap
 * that has opened, and an axis whose gap is under {@link MASK_GAP_RAMP} of the map is not masked at all. That keeps the
 * mask from cutting a line through the closed globe (in float32 the position along the seam is only good to metres).
 */
export function mapMaskFactor(mx: number, my: number, k: number, halfWidth: number, halfHeight: number, softness: number): number {
  const gapX = k > 0 ? (2 * Math.PI) / k - 2 * halfWidth : Infinity;
  const gapY = k > 0 ? Math.PI / k - 2 * halfHeight : Infinity;
  const softX = Math.max(Math.min(softness, 0.5 * gapX), 1e-9 * halfWidth);
  const softY = Math.max(Math.min(softness, 0.5 * gapY), 1e-9 * halfHeight);
  const openX = smoothstep(0, MASK_GAP_RAMP * halfWidth, gapX);
  const openY = smoothstep(0, MASK_GAP_RAMP * halfHeight, gapY);
  const maskX = smoothstep(0, softX, halfWidth - Math.abs(mx));
  const maskY = smoothstep(0, softY, halfHeight - Math.abs(my));
  return (1 + openX * (maskX - 1)) * (1 + openY * (maskY - 1));
}

/** A wrap-around gap narrower than this fraction of the map's half-size is treated as closed (no mask on that axis). */
export const MASK_GAP_RAMP = 1e-5;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
