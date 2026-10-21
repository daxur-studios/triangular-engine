/**
 * Plan 055 Phase 0 quality metrics. The GPU draws the planet into an offscreen float target (red = distance from the
 * camera in metres, green/blue = the surface coordinates u/v, alpha = 1 where drawn, cleared to 0) and this module
 * compares it, pixel for pixel, against the
 * reference: the true sphere, ray-traced on the CPU in doubles at the same pose. Contender C becomes the reference
 * renderer once it exists; for the plain sphere the exact answer is cheaper and has no error of its own.
 *
 * Pure functions only, so the spec can feed them synthetic frames.
 */

type Vec3 = readonly [number, number, number];

/** Offscreen size of the probe: half the reference drawing buffer (2560 x 1440), same aspect. Width is a multiple of 16 so a
 * float RGBA row is 256-byte aligned and the readback has no padding. */
export const QUALITY_PROBE_SIZE = { width: 1280, height: 720 } as const;

/** Every this many pixels in x and y, one depth sample: keeps the saved result small and the distribution intact. */
export const DEPTH_SAMPLE_STRIDE = 16;

/** Pinhole camera of the probe, in the body frame. */
export interface QualityProbeCamera {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly fovDeg: number;
  readonly near: number;
  readonly far: number;
}

/** One probe frame: row 0 is the top of the image (WebGPU texture origin). */
export interface QualityFrame {
  readonly width: number;
  readonly height: number;
  /** Distance in metres per pixel; `NaN` where nothing is drawn. */
  readonly distance: Float64Array | Float32Array;
  /** Surface coordinates (the geometry's `uv`) as the GPU interpolated them; absent for a reference frame. */
  readonly u?: Float32Array;
  readonly v?: Float32Array;
}

/**
 * Turns the probe readback (RGBA float, red = distance, green/blue = u/v, alpha = drawn flag) into a frame. A pixel
 * counts as drawn only with alpha exactly 1, so the cleared background (all zero) and stray values cannot pass as surface.
 */
export function frameFromProbeRgba(rgba: Float32Array, width: number, height: number): QualityFrame {
  const distance = new Float32Array(width * height);
  const u = new Float32Array(width * height);
  const v = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const drawn = rgba[i * 4 + 3] === 1;
    distance[i] = drawn ? rgba[i * 4] : NaN;
    u[i] = drawn ? rgba[i * 4 + 1] : NaN;
    v[i] = drawn ? rgba[i * 4 + 2] : NaN;
  }
  return { width, height, distance, u, v };
}

/** Unit direction (and its pre-normalisation length, for view depth) of the ray through a pixel centre. */
function pixelRay(camera: QualityProbeCamera, width: number, height: number, column: number, row: number): [number, number, number, number] {
  const [fx, fy, fz] = camera.forward;
  const [ux, uy, uz] = camera.up;
  // right = forward x up, matching the page's camera basis (right, up, -forward).
  const rx = fy * uz - fz * uy;
  const ry = fz * ux - fx * uz;
  const rz = fx * uy - fy * ux;
  const tanY = Math.tan((camera.fovDeg * Math.PI) / 360);
  const sy = (1 - ((row + 0.5) / height) * 2) * tanY;
  const sx = (((column + 0.5) / width) * 2 - 1) * tanY * (width / height);
  const dx = fx + rx * sx + ux * sy;
  const dy = fy + ry * sx + uy * sy;
  const dz = fz + rz * sx + uz * sy;
  const length = Math.hypot(dx, dy, dz);
  return [dx / length, dy / length, dz / length, length];
}

/**
 * The true sphere of `radiusM` around the body origin, seen by `camera` at pixel centres. Doubles throughout, with the
 * stable form of the near root, so a camera 2 m above a 6,371 km body is exact to well under a millimetre. A hit outside
 * the near/far planes (view depth, as the GPU clips) counts as not drawn.
 */
export function referenceSphereFrame(camera: QualityProbeCamera, radiusM: number, width: number, height: number): QualityFrame {
  const [px, py, pz] = camera.position;
  const centre = Math.hypot(px, py, pz);
  // |P|^2 - R^2 as a product, so the camera's height above the surface survives at 6,371 km.
  const c = (centre - radiusM) * (centre + radiusM);
  const distance = new Float64Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const [dx, dy, dz, length] = pixelRay(camera, width, height, column, row);
      const b = px * dx + py * dy + pz * dz;
      const disc = b * b - c;
      let t = NaN;
      // Near root t = -b - sqrt(disc), written as c / (-b + sqrt(disc)) to avoid cancellation; camera outside the sphere.
      if (disc >= 0 && c > 0 && b < 0) t = c / (-b + Math.sqrt(disc));
      if (Number.isFinite(t)) {
        const viewDepth = t / length;
        if (viewDepth < camera.near || viewDepth > camera.far) t = NaN;
      }
      distance[row * width + column] = t;
    }
  }
  return { width, height, distance };
}

export interface QualityComparison {
  /** Per image column where either frame draws: |drawn pixels in the probe - drawn pixels in the reference|, in px. */
  readonly silhouetteErrorPx: number[];
  /** |probe - reference| distance in metres, on a `DEPTH_SAMPLE_STRIDE` grid where both draw. */
  readonly depthErrorM: number[];
  /** Same grid, relative to the reference distance. */
  readonly depthErrorRelative: number[];
  /** Undrawn probe pixels cut off from the image border by drawn ones: holes in the surface. */
  readonly cracks: number;
  readonly drawnProbe: number;
  readonly drawnReference: number;
}

export function compareQuality(probe: QualityFrame, reference: QualityFrame): QualityComparison {
  const { width, height } = probe;
  if (reference.width !== width || reference.height !== height) throw new Error('Probe and reference frames differ in size');
  const silhouetteErrorPx: number[] = [];
  let drawnProbe = 0;
  let drawnReference = 0;
  for (let column = 0; column < width; column++) {
    let inProbe = 0;
    let inReference = 0;
    for (let row = 0; row < height; row++) {
      const i = row * width + column;
      if (!Number.isNaN(probe.distance[i])) inProbe++;
      if (!Number.isNaN(reference.distance[i])) inReference++;
    }
    drawnProbe += inProbe;
    drawnReference += inReference;
    if (inProbe > 0 || inReference > 0) silhouetteErrorPx.push(Math.abs(inProbe - inReference));
  }
  const depthErrorM: number[] = [];
  const depthErrorRelative: number[] = [];
  const half = DEPTH_SAMPLE_STRIDE >> 1;
  for (let row = half; row < height; row += DEPTH_SAMPLE_STRIDE) {
    for (let column = half; column < width; column += DEPTH_SAMPLE_STRIDE) {
      const i = row * width + column;
      const p = probe.distance[i];
      const r = reference.distance[i];
      if (Number.isNaN(p) || Number.isNaN(r)) continue;
      depthErrorM.push(Math.abs(p - r));
      depthErrorRelative.push(Math.abs(p - r) / r);
    }
  }
  return { silhouetteErrorPx, depthErrorM, depthErrorRelative, cracks: countHoles(probe), drawnProbe, drawnReference };
}

/**
 * Undrawn pixels not connected (4-neighbour) to the image border through other undrawn pixels. Plan 055 counts magenta
 * pixels inside the planet's outline; with an outline that is the drawn region itself, a hole is exactly that. A crack
 * that reaches the silhouette opens onto the background and is not counted here; the silhouette error sees it instead.
 */
export function countHoles(frame: QualityFrame): number {
  const { width, height, distance } = frame;
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!outside[i] && Number.isNaN(distance[i])) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let column = 0; column < width; column++) {
    push(column);
    push((height - 1) * width + column);
  }
  for (let row = 0; row < height; row++) {
    push(row * width);
    push(row * width + width - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const column = i % width;
    if (column > 0) push(i - 1);
    if (column < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < width * (height - 1)) push(i + width);
  }
  let holes = 0;
  for (let i = 0; i < width * height; i++) if (!outside[i] && Number.isNaN(distance[i])) holes++;
  return holes;
}

/** Vertex (ix, iy) of three's `SphereGeometry(1, w, h, -PI/2)` as the lab's geometry stores it, and its uv. */
function sphereVertex(ix: number, iy: number, w: number, h: number, radiusM: number): { p: Vec3; u: number; v: number } {
  const phi = -Math.PI / 2 + (ix / w) * Math.PI * 2;
  const theta = (iy / h) * Math.PI;
  // three stores the unit vertex in float32; the lab renormalises that in double (createCameraRelativeSphereGeometry).
  const x = Math.fround(-Math.cos(phi) * Math.sin(theta));
  const y = Math.fround(Math.cos(theta));
  const z = Math.fround(Math.sin(phi) * Math.sin(theta));
  const scale = radiusM / Math.hypot(x, y, z);
  // three shifts the pole rows' u by half a segment.
  const uOffset = iy === 0 ? 0.5 / w : iy === h ? -0.5 / w : 0;
  return { p: [x * scale, y * scale, z * scale], u: ix / w + uOffset, v: 1 - iy / h };
}

type SphereVertex = ReturnType<typeof sphereVertex>;

/** Ray-triangle (Moller-Trumbore) in doubles: distance and barycentrics, or undefined on a miss. */
function hitTriangle(o: Vec3, d: Vec3, a: SphereVertex, b: SphereVertex, c: SphereVertex): { t: number; wb: number; wc: number } | undefined {
  const e1 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
  const e2 = [c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]];
  const q = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * q[0] + e1[1] * q[1] + e1[2] * q[2];
  if (Math.abs(det) < 1e-30) return undefined;
  const s = [o[0] - a.p[0], o[1] - a.p[1], o[2] - a.p[2]];
  const wb = (s[0] * q[0] + s[1] * q[1] + s[2] * q[2]) / det;
  const r = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const wc = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / det;
  const t = (e2[0] * r[0] + e2[1] * r[1] + e2[2] * r[2]) / det;
  const eps = 1e-9;
  if (wb < -eps || wc < -eps || wb + wc > 1 + eps || t <= 0) return undefined;
  return { t, wb, wc };
}

/**
 * The uv a perfect GPU would show at a pixel: the ray through the pixel centre meets the lab sphere's own triangles
 * (built as `createCameraRelativeSphereGeometry` builds them), intersected and interpolated in doubles. `distance` (the
 * probe's) only picks the grid cell to search; the answer does not depend on its precision. Undefined if no triangle
 * of the cell or its eight neighbours is hit.
 */
export function referenceFacetUv(
  camera: QualityProbeCamera, radiusM: number, segments: { width: number; height: number },
  width: number, height: number, column: number, row: number, distance: number,
): { u: number; v: number; sinTheta: number } | undefined {
  const [dx, dy, dz] = pixelRay(camera, width, height, column, row);
  const o = camera.position;
  const hit: Vec3 = [o[0] + dx * distance, o[1] + dy * distance, o[2] + dz * distance];
  const theta = Math.acos(Math.max(-1, Math.min(1, hit[1] / Math.hypot(...hit))));
  const phi = Math.atan2(hit[2], -hit[0]);
  const w = segments.width;
  const h = segments.height;
  const turn = (phi + Math.PI / 2) / (Math.PI * 2);
  const cellX = Math.min(w - 1, Math.floor((turn - Math.floor(turn)) * w));
  const cellY = Math.min(h - 1, Math.floor((theta / Math.PI) * h));
  let best: { t: number; u: number; v: number } | undefined;
  for (let oy = -1; oy <= 1; oy++) {
    const iy = cellY + oy;
    if (iy < 0 || iy >= h) continue;
    for (let ox = -1; ox <= 1; ox++) {
      const ix = (cellX + ox + w) % w;
      const a = sphereVertex(ix + 1, iy, w, h, radiusM);
      const b = sphereVertex(ix, iy, w, h, radiusM);
      const c = sphereVertex(ix, iy + 1, w, h, radiusM);
      const d = sphereVertex(ix + 1, iy + 1, w, h, radiusM);
      // three's index order: (a, b, d) except at the top row, (b, c, d) except at the bottom row.
      const triangles: [SphereVertex, SphereVertex, SphereVertex][] = [];
      if (iy !== 0) triangles.push([a, b, d]);
      if (iy !== h - 1) triangles.push([b, c, d]);
      for (const [p0, p1, p2] of triangles) {
        const found = hitTriangle(o, [dx, dy, dz], p0, p1, p2);
        if (!found || (best && best.t <= found.t)) continue;
        const w0 = 1 - found.wb - found.wc;
        best = { t: found.t, u: p0.u * w0 + p1.u * found.wb + p2.u * found.wc, v: p0.v * w0 + p1.v * found.wb + p2.v * found.wc };
      }
    }
  }
  return best && { u: best.u, v: best.v, sinTheta: Math.sin(theta) };
}

/**
 * Surface-coordinate error of the probe, in metres of ground: |GPU uv - exact uv on the same triangle|, with u scaled by
 * the circumference at that latitude and v by half the meridian. This isolates the float32 interpolation of `uv` (what
 * any texture or material lookup by surface position inherits) from the facets' own shape. Sampled on the
 * `DEPTH_SAMPLE_STRIDE` grid where the probe draws; `unmatched` counts samples with no triangle found.
 */
export function surfaceCoordinateErrors(
  probe: QualityFrame, camera: QualityProbeCamera, radiusM: number, segments: { width: number; height: number },
): { errorsM: number[]; unmatched: number } {
  const errorsM: number[] = [];
  let unmatched = 0;
  if (!probe.u || !probe.v) return { errorsM, unmatched };
  const half = DEPTH_SAMPLE_STRIDE >> 1;
  for (let row = half; row < probe.height; row += DEPTH_SAMPLE_STRIDE) {
    for (let column = half; column < probe.width; column += DEPTH_SAMPLE_STRIDE) {
      const i = row * probe.width + column;
      if (Number.isNaN(probe.distance[i])) continue;
      const exact = referenceFacetUv(camera, radiusM, segments, probe.width, probe.height, column, row, probe.distance[i]);
      if (!exact) {
        unmatched++;
        continue;
      }
      const east = (probe.u[i] - exact.u) * 2 * Math.PI * radiusM * exact.sinTheta;
      const north = (probe.v[i] - exact.v) * Math.PI * radiusM;
      errorsM.push(Math.hypot(east, north));
    }
  }
  return { errorsM, unmatched };
}

/** Pixels whose drawn flag or distance bits differ between two frames of a still pose. */
export function changedPixels(a: QualityFrame, b: QualityFrame): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('Frames differ in size');
  let changed = 0;
  for (let i = 0; i < a.distance.length; i++) {
    const x = a.distance[i];
    const y = b.distance[i];
    if (Number.isNaN(x) !== Number.isNaN(y) || (!Number.isNaN(x) && x !== y)) changed++;
  }
  return changed;
}
