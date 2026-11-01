/**
 * Screen-bounds maths for a space-mode atmosphere backdrop (Plan 078, `bounded-backdrop`). Pure functions on numbers, so
 * they are tested without a renderer. `AtmosphereBackdrop` uses them to draw only the part of the screen an atmosphere
 * shell can cover.
 *
 * Camera space is three.js's: the camera looks down -z, +x is right, +y is up.
 */

/**
 * Default for {@link AtmosphereBackdropOptions.minAngularRadius}: 0.25 degrees, in radians. At a 50 degree field of view
 * on a 1080 pixel high frame that is about 4.6 pixels, and the air itself (about 1% of a planet's radius for Earth-like air)
 * is well under a pixel, so a body smaller than this gains nothing visible from its atmosphere. In the multi-atmosphere
 * lab a moon-sized shell (0.28 planet radii) crosses it at about 63 planet radii, far beyond the lab's closest-far view
 * (about 2 degrees).
 */
export const DEFAULT_MIN_ANGULAR_RADIUS = (0.25 * Math.PI) / 180;

/** How far past the shell's bounds the backdrop quad extends, as a fraction of the screen's half-extent (NDC units). */
export const BACKDROP_BOUNDS_MARGIN = 0.02;

/** A rectangle in normalised device coordinates: -1..1 on both axes, y up. */
export interface ScreenRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The angle a sphere of `radius` subtends, seen from `distance` away from its centre (radians, half-angle). A camera
 * on or inside the sphere sees it all around: a quarter turn.
 */
export function apparentAngularRadius(distance: number, radius: number): number {
  if (!(radius > 0)) return 0;
  if (!(distance > radius)) return Math.PI / 2;
  return Math.asin(radius / distance);
}

/**
 * Smooth 0..1 weight for a backdrop at `angularRadius`: 0 at `minAngularRadius` (where it is dropped), 1 from twice that.
 * A backdrop that fades in over this range appears without a pop. A non-positive `minAngularRadius` always gives 1.
 */
export function angularRadiusFade(angularRadius: number, minAngularRadius: number): number {
  if (!(minAngularRadius > 0)) return 1;
  const t = Math.min(1, Math.max(0, (angularRadius - minAngularRadius) / minAngularRadius));
  return t * t * (3 - 2 * t);
}

/** One axis of the tangent-plane bounds: the NDC interval, or null when the sphere is wholly off to that side or behind. */
function axisInterval(across: number, forward: number, radius: number, scale: number): [number, number] | null {
  const quarter = Math.PI / 2;
  // Angle of the centre from the view axis in this plane, and the half-angle of the sphere's tangent planes through the camera.
  const theta = Math.atan2(across, forward);
  const planar = Math.hypot(across, forward);
  const alpha = planar > radius ? Math.asin(radius / planar) : quarter;
  const lo = theta - alpha;
  const hi = theta + alpha;
  if (hi <= -quarter || lo >= quarter) return null;
  const a = lo <= -quarter ? -1 : Math.tan(lo) * scale;
  const b = hi >= quarter ? 1 : Math.tan(hi) * scale;
  if (a >= 1 || b <= -1) return null;
  return [Math.max(-1, a), Math.min(1, b)];
}

/**
 * The screen rectangle a sphere can cover, from the two tangent planes per axis (exact for a symmetric perspective
 * frustum; an off-centre frustum needs a larger `margin`). Returns null when the sphere is wholly off screen or behind the
 * camera, and the whole screen when the camera is inside it.
 *
 * @param centreView The sphere's centre in camera space.
 * @param radius The sphere's radius, in the same units.
 * @param projectionX `projectionMatrix.elements[0]` (cot of half the horizontal field of view).
 * @param projectionY `projectionMatrix.elements[5]` (cot of half the vertical field of view).
 * @param margin Padding added on every side, in NDC units (clamped to the screen). Default {@link BACKDROP_BOUNDS_MARGIN}.
 */
export function shellScreenBounds(
  centreView: readonly [number, number, number],
  radius: number,
  projectionX: number,
  projectionY: number,
  margin = BACKDROP_BOUNDS_MARGIN,
): ScreenRect | null {
  const [x, y, z] = centreView;
  if (Math.hypot(x, y, z) <= radius) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  const horizontal = axisInterval(x, -z, radius, projectionX);
  const vertical = axisInterval(y, -z, radius, projectionY);
  if (!horizontal || !vertical) return null;
  return {
    minX: Math.max(-1, horizontal[0] - margin),
    maxX: Math.min(1, horizontal[1] + margin),
    minY: Math.max(-1, vertical[0] - margin),
    maxY: Math.min(1, vertical[1] + margin),
  };
}

/** Fraction of the screen's area a rectangle covers, 0..1. */
export function screenRectCoverage(rect: ScreenRect): number {
  return (Math.max(0, rect.maxX - rect.minX) * Math.max(0, rect.maxY - rect.minY)) / 4;
}

/**
 * An NDC rectangle as a pixel rectangle `[x, y, width, height]` in a target `width` x `height` (origin at the bottom left,
 * like a scissor), widened by `pad` pixels on every side and clamped to the target.
 */
export function screenRectToPixels(rect: ScreenRect, width: number, height: number, pad = 0): [number, number, number, number] {
  const x0 = Math.max(0, Math.floor((rect.minX * 0.5 + 0.5) * width) - pad);
  const y0 = Math.max(0, Math.floor((rect.minY * 0.5 + 0.5) * height) - pad);
  const x1 = Math.min(width, Math.ceil((rect.maxX * 0.5 + 0.5) * width) + pad);
  const y1 = Math.min(height, Math.ceil((rect.maxY * 0.5 + 0.5) * height) + pad);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}
