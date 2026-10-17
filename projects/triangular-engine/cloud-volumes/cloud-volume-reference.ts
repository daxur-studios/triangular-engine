/**
 * CPU references for the cloud-volume bakes (Plan 051): analytic densities and the optical depth through them
 * toward the sun. Specs compare the GPU-baked textures with these. Pure TypeScript, no three import.
 *
 * All positions are in the volume's unit frame `[0, 1]^3`; `size` converts to metres for path lengths.
 */

export type CloudAnalyticShape = 'box' | 'blob';

/** Standard deviation of the `blob` shape, as a fraction of the box. */
export const CLOUD_BLOB_SIGMA = 0.15;

export type Vec3Tuple = readonly [number, number, number];

/** Density of an analytic shape at a unit-frame point: `box` is 1 everywhere, `blob` a centred Gaussian. */
export function analyticDensity(shape: CloudAnalyticShape, p: Vec3Tuple): number {
  if (shape === 'box') return 1;
  const dx = p[0] - 0.5;
  const dy = p[1] - 0.5;
  const dz = p[2] - 0.5;
  return Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * CLOUD_BLOB_SIGMA * CLOUD_BLOB_SIGMA));
}

/** Distance in metres from a unit-frame point to the box exit along a unit direction given in the metres frame. */
export function distanceToBoxExit(p: Vec3Tuple, dir: Vec3Tuple, size: Vec3Tuple): number {
  let exit = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = dir[i];
    if (Math.abs(d) < 1e-9) continue;
    const bound = d > 0 ? 1 : 0;
    exit = Math.min(exit, ((bound - p[i]) * size[i]) / d);
  }
  return Math.max(exit, 0);
}

/**
 * Optical depth from a unit-frame point toward the sun, by midpoint integration with `steps` samples:
 * `extinction * integral(density)` over the path to the box exit. `sunDir` is a unit vector in the
 * volume's metres frame.
 */
export function referenceOpticalDepth(
  shape: CloudAnalyticShape,
  p: Vec3Tuple,
  sunDir: Vec3Tuple,
  size: Vec3Tuple,
  extinction: number,
  steps = 512,
): number {
  const length = distanceToBoxExit(p, sunDir, size);
  const dt = length / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const q: Vec3Tuple = [
      p[0] + (sunDir[0] * t) / size[0],
      p[1] + (sunDir[1] * t) / size[1],
      p[2] + (sunDir[2] * t) / size[2],
    ];
    sum += analyticDensity(shape, q);
  }
  return sum * dt * extinction;
}
