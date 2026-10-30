import { equalEarthRow } from 'triangular-engine/atmosphere';
import type { MorphFrame, MorphPose, MorphPoseId } from './morph-frame';
import type { FanMode } from './morph-fan';
import type { MorphPack } from './morph-leaves';
import type { LodMetric } from './morph-stretch';

/**
 * Plan 059 morph spike, part 2: the crack probe. The lab's probe (`pages/lod-surface-lab/lod-crack-probe.ts`) draws a backstop
 * that lies inside the surface, then the surface, and counts the backstop pixels left on screen: holes. A bent map has no such
 * backstop (its outline is a clipped, curved shape, and the surface under it is the map itself), so the backstop is the
 * outline: for every pixel the exact ray against the bent ground, in doubles, says whether the map covers it (`expectedCoverage`).
 * A pixel the map covers whose fragment the probe material (same vertex stage, same clip, writes 1) did not draw is the lab's
 * backstop pixel; the lab's counting (`countCracks`: no background pixel among the eight neighbours) is kept, with "background"
 * = a pixel outside the outline that was not drawn.
 *
 * Holes are reported by where they are: within a few pixels of the cut edge (x = +-W), of the pole edges (|y| = half-height), and
 * elsewhere. Pixels beyond the outline that were drawn (the clip failing) are counted as leaks.
 */

/** Values in the red channel of the lab's probe: 0 background, {@link BACKSTOP_VALUE} backstop, 255 surface. */
export const BACKSTOP_VALUE = 128;

/** The counts of the lab's probe. */
export interface CrackCount {
  /** Backstop pixels with no background pixel among their eight neighbours. */
  readonly cracks: number;
  /** Backstop pixels next to the background (not counted). */
  readonly masked: number;
  readonly surface: number;
  readonly background: number;
}

type Kind = 0 | 1 | 2;

function kindOf(red: number): Kind {
  if (red < BACKSTOP_VALUE / 2) return 0;
  return red < (BACKSTOP_VALUE + 255) / 2 ? 1 : 2;
}

/** The lab's count from RGBA8 pixels (any row order; neighbours are symmetric). Kept as the reference for {@link crackPixels}. */
export function countCracks(rgba: ArrayLike<number>, width: number, height: number): CrackCount {
  const kinds = new Uint8Array(width * height);
  let surface = 0;
  let background = 0;
  for (let p = 0; p < width * height; p++) {
    const kind = kindOf(rgba[p * 4]);
    kinds[p] = kind;
    if (kind === 2) surface++;
    else if (kind === 0) background++;
  }
  const { cracks, masked } = crackPixels(kinds, width, height);
  return { cracks: cracks.length, masked, surface, background };
}

/**
 * The lab's rule on a kinds image (0 background, 1 backstop, 2 surface): the indices of backstop pixels with no background pixel
 * among their eight neighbours, and the number of backstop pixels that have one (masked).
 */
export function crackPixels(kinds: Uint8Array, width: number, height: number): { cracks: number[]; masked: number } {
  const cracks: number[] = [];
  let masked = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (kinds[y * width + x] !== 1) continue;
      let nearBackground = false;
      for (let dy = -1; dy <= 1 && !nearBackground; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < width && kinds[ny * width + nx] === 0) {
            nearBackground = true;
            break;
          }
        }
      }
      if (nearBackground) masked++;
      else cracks.push(y * width + x);
    }
  }
  return { cracks, masked };
}

// -- the map outline in doubles -------------------------------------------------------------------------------------

const HALF_PI = Math.PI / 2;
const TABLE = 4096;

/** The map of one (radius, morph): the blended projection's outline and the bend, in doubles. */
export interface OutlineModel {
  readonly p: number;
  readonly radius: number;
  /** Curvature (1 - morph) / R. */
  readonly k: number;
  readonly halfHeight: number;
  /** y of a latitude. */
  yOfLat(lat: number): number;
  /** The row half-width pi R (1 - p + p c) at a latitude. */
  halfWidthAtLat(lat: number): number;
  /** The latitude whose y is `y` (clamped to the poles). */
  latOfY(y: number): number;
}

/** The outline model of a (radius, morph = projection blend p). */
export function createOutlineModel(p: number, radius: number): OutlineModel {
  const yOfLat = (lat: number): number => radius * ((1 - p) * lat + p * equalEarthRow(lat).y);
  const halfHeight = yOfLat(HALF_PI);
  const lats = new Float64Array(TABLE + 1);
  const ys = new Float64Array(TABLE + 1);
  for (let i = 0; i <= TABLE; i++) {
    lats[i] = -HALF_PI + (Math.PI * i) / TABLE;
    ys[i] = yOfLat(lats[i]);
  }
  const halfWidthAtLat = (lat: number): number => Math.PI * radius * (1 - p + p * equalEarthRow(lat).c);
  const latOfY = (y: number): number => {
    if (y <= -halfHeight) return -HALF_PI;
    if (y >= halfHeight) return HALF_PI;
    let lo = 0;
    let hi = TABLE;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ys[mid] <= y) lo = mid;
      else hi = mid;
    }
    let a = lats[lo];
    let b = lats[hi];
    const span = ys[hi] - ys[lo];
    let lat = span > 0 ? a + ((b - a) * (y - ys[lo])) / span : a;
    // Safeguarded Newton inside the bracket: dy/dlat = R ((1 - p) + p cos(lat) / c), flat at the poles.
    for (let it = 0; it < 8; it++) {
      const row = equalEarthRow(lat);
      const f = radius * ((1 - p) * lat + p * row.y) - y;
      if (f > 0) b = lat;
      else a = lat;
      const slope = radius * ((1 - p) + (p * Math.cos(lat)) / row.c);
      let next = slope > 1e-9 * radius ? lat - f / slope : 0.5 * (a + b);
      if (!(next >= a && next <= b)) next = 0.5 * (a + b);
      if (Math.abs(next - lat) < 1e-15) {
        lat = next;
        break;
      }
      lat = next;
    }
    return lat;
  };
  return { p, radius, k: (1 - p) / radius, halfHeight, yOfLat, halfWidthAtLat, latOfY };
}

/** Whether the map point (x, y) is inside the outline: |y| within the half-height and |x| within the row's half-width. */
export function insideOutline(model: OutlineModel, x: number, y: number): boolean {
  if (Math.abs(y) > model.halfHeight) return false;
  return Math.abs(x) <= model.halfWidthAtLat(model.latOfY(y));
}

/** The camera as the probe sees it: map frame, position and axes, vertical field of view and aspect. */
export interface CameraRig {
  readonly position: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly tanHalfFov: number;
  readonly aspect: number;
}

/** The rig of a frame (the camera is at the bent camera with the frame's axes). The frame's axes are in the body frame; the map frame is the basis' components. */
export function cameraRig(frame: MorphFrame, fovDeg: number, aspect: number): CameraRig {
  const { basis, axes } = frame;
  const inMap = (v: readonly number[]): [number, number, number] => [
    v[0] * basis.right[0] + v[1] * basis.right[1] + v[2] * basis.right[2],
    v[0] * basis.up[0] + v[1] * basis.up[1] + v[2] * basis.up[2],
    v[0] * basis.forward[0] + v[1] * basis.forward[1] + v[2] * basis.forward[2],
  ];
  return {
    position: [frame.camMap[0], frame.camMap[1], frame.camMap[2]],
    right: inMap(axes.right), up: inMap(axes.up), forward: inMap(axes.forward),
    tanHalfFov: Math.tan((fovDeg * Math.PI) / 360), aspect,
  };
}

/** Where a ray meets the bent ground (height 0): the map point, the distance along the ray and the cosine of the incidence. */
export interface MapHit {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly cosIncidence: number;
}

/**
 * The hits (up to two, nearest first) of the ray `position + t direction` (t > 0) with the bent ground at height 0: the sphere
 * of radius 1 / k centred on (0, 0, -1 / k) (the bend: G = (cos b sin a, sin b, cos a cos b - 1) / k with a = k x, b = k y), or
 * the plane z = 0 when k is 0. The map point is (a / k, b / k).
 */
export function rayHits(model: OutlineModel, position: readonly number[], d: readonly number[]): MapHit[] {
  const k = model.k;
  const hits: MapHit[] = [];
  const dLen = Math.hypot(d[0], d[1], d[2]);
  const push = (t: number): void => {
    if (!(t > 0)) return;
    const px = position[0] + t * d[0];
    const py = position[1] + t * d[1];
    const pz = position[2] + t * d[2];
    if (k * model.radius < 1e-9) {
      hits.push({ x: px, y: py, t: t * dLen, cosIncidence: Math.abs(d[2]) / dLen });
      return;
    }
    const a = Math.atan2(k * px, k * pz + 1);
    const b = Math.asin(Math.max(-1, Math.min(1, k * py)));
    // The ground's up at the hit is k G + z.
    const nx = k * px;
    const ny = k * py;
    const nz = k * pz + 1;
    const nl = Math.hypot(nx, ny, nz) || 1;
    hits.push({ x: a / k, y: b / k, t: t * dLen, cosIncidence: Math.abs(nx * d[0] + ny * d[1] + nz * d[2]) / (nl * dLen) });
  };
  if (k * model.radius < 1e-9) {
    if (d[2] !== 0) push(-position[2] / d[2]);
    return hits;
  }
  const rho = 1 / k;
  const qz = position[2] + rho;
  const b = position[0] * d[0] + position[1] * d[1] + qz * d[2];
  const c0 = position[0] * position[0] + position[1] * position[1] + position[2] * position[2] + 2 * position[2] * rho;
  const a2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const disc = b * b - a2 * c0;
  if (disc < 0) return hits;
  const root = Math.sqrt(disc);
  const s = b >= 0 ? -b - root : -b + root;
  const t1 = s / a2;
  const t2 = s !== 0 ? c0 / s : -b / a2;
  push(Math.min(t1, t2));
  push(Math.max(t1, t2));
  return hits;
}

/** The ray through the centre of pixel (x, y) of a `width` x `height` image whose row 0 is the top (`flipY` reads it from the bottom). */
export function pixelRay(rig: CameraRig, width: number, height: number, x: number, y: number, flipY: boolean): [number, number, number] {
  const row = flipY ? height - 1 - y : y;
  const nx = ((x + 0.5) / width) * 2 - 1;
  const ny = 1 - ((row + 0.5) / height) * 2;
  const sx = nx * rig.tanHalfFov * rig.aspect;
  const sy = ny * rig.tanHalfFov;
  return [
    rig.forward[0] + sx * rig.right[0] + sy * rig.up[0],
    rig.forward[1] + sx * rig.right[1] + sy * rig.up[1],
    rig.forward[2] + sx * rig.right[2] + sy * rig.up[2],
  ];
}

/** The nearest hit of a ray that lies inside the outline, if any. */
export function insideHit(model: OutlineModel, rig: CameraRig, d: readonly number[]): MapHit | undefined {
  for (const hit of rayHits(model, rig.position, d)) if (insideOutline(model, hit.x, hit.y)) return hit;
  return undefined;
}

/** 1 for each pixel the map covers (row 0 = top), from exact rays. */
export function expectedCoverage(model: OutlineModel, rig: CameraRig, width: number, height: number): Uint8Array {
  const covered = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (insideHit(model, rig, pixelRay(rig, width, height, x, y, false))) covered[y * width + x] = 1;
    }
  }
  return covered;
}

/** Chessboard distance (in pixels) of every pixel to the nearest pixel where `covered` is 0; large where there is none. */
export function distanceToOutside(covered: Uint8Array, width: number, height: number): Uint16Array {
  const INF = 65_535;
  const dist = new Uint16Array(width * height);
  for (let p = 0; p < dist.length; p++) dist[p] = covered[p] ? INF : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let d = dist[p];
      if (d === 0) continue;
      if (x > 0) d = Math.min(d, dist[p - 1] + 1);
      if (y > 0) {
        d = Math.min(d, dist[p - width] + 1);
        if (x > 0) d = Math.min(d, dist[p - width - 1] + 1);
        if (x < width - 1) d = Math.min(d, dist[p - width + 1] + 1);
      }
      dist[p] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      let d = dist[p];
      if (d === 0) continue;
      if (x < width - 1) d = Math.min(d, dist[p + 1] + 1);
      if (y < height - 1) {
        d = Math.min(d, dist[p + width] + 1);
        if (x < width - 1) d = Math.min(d, dist[p + width + 1] + 1);
        if (x > 0) d = Math.min(d, dist[p + width - 1] + 1);
      }
      dist[p] = d;
    }
  }
  return dist;
}

// -- classification --------------------------------------------------------------------------------------------------

/** Where a hole is. */
export type CrackRegion = 'cut' | 'pole' | 'elsewhere';

/** Options of the classification. */
export interface CrackClassifyOptions {
  /** Holes within this many pixels of the outline are attributed to the cut or a pole edge (default 6). */
  readonly nearEdgePx?: number;
  /** true: the result lists the hole pixels (row-major indices in the drawn image's order). */
  readonly keepHoles?: boolean;
}

/** What one image gave. */
export interface CrackImageResult {
  /** Holes (the lab's count) in total and by region. */
  readonly holes: number;
  readonly cut: number;
  readonly pole: number;
  readonly elsewhere: number;
  /** Holes beside the outline (the lab's masked pixels): not counted. */
  readonly masked: number;
  /**
   * The holes split by where they are: `holesRim` are hole pixels in a run of missing surface that reaches the exact outline where
   * the outside is space (the drawn rim of the world lies short of the exact rim: a silhouette error), `holesInterior` the others
   * (space seen through the ground). They add up to `holes`.
   */
  readonly holesInterior: number;
  readonly holesRim: number;
  /**
   * For every image column where the exact outline has a boundary next to space (top or bottom edge of the map), the pixels between
   * that boundary and the first drawn pixel into the map; the largest and the 95th percentile over those columns, and how many columns.
   */
  readonly rimOffsetMaxPx: number;
  readonly rimOffsetP95Px: number;
  readonly rimColumns: number;
  /** Pixels the probe material drew, pixels the exact rays say the map covers, and drawn pixels with all eight neighbours outside the outline. */
  readonly drawnPx: number;
  readonly coveredPx: number;
  readonly leakPx: number;
  /** Intersection over union of drawn and covered pixels, after the row order was chosen. */
  readonly agreement: number;
  /** The image's row order was found to be bottom-up. */
  readonly flipY: boolean;
  /** The hole pixels (indices y * width + x), only with `keepHoles`. */
  readonly holePixels?: readonly number[];
}

/** Rim offset of each column and the split of the holes, see {@link CrackImageResult.holesRim}. */
export function rimAnalysis(
  mask: Uint8Array, drawn: Uint8Array, cracks: readonly number[], width: number, height: number,
): { holesInterior: number; holesRim: number; rimOffsetMaxPx: number; rimOffsetP95Px: number; rimColumns: number } {
  // Runs of missing surface (covered, not drawn; eight-connected) that touch the outside: a missing pixel with an uncovered neighbour.
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const touches: boolean[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || drawn[start] || label[start] >= 0) continue;
    const id = touches.length;
    touches.push(false);
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
          const q = ny * width + nx;
          if (!mask[q]) touches[id] = true;
          else if (!drawn[q] && label[q] < 0) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
    }
  }
  let holesRim = 0;
  for (const p of cracks) if (label[p] >= 0 && touches[label[p]]) holesRim++;
  const offsets: number[] = [];
  for (let x = 0; x < width; x++) {
    let worst = 0;
    let boundary = false;
    for (let y = 0; y < height; y++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      if (y > 0 && !mask[p - width]) {
        boundary = true;
        let run = 0;
        for (let yy = y; yy < height && mask[yy * width + x] && !drawn[yy * width + x]; yy++) run++;
        worst = Math.max(worst, run);
      }
      if (y < height - 1 && !mask[p + width]) {
        boundary = true;
        let run = 0;
        for (let yy = y; yy >= 0 && mask[yy * width + x] && !drawn[yy * width + x]; yy--) run++;
        worst = Math.max(worst, run);
      }
    }
    if (boundary) offsets.push(worst);
  }
  offsets.sort((a, b) => a - b);
  const p95 = offsets.length ? offsets[Math.min(offsets.length - 1, Math.ceil(0.95 * offsets.length) - 1)] : 0;
  return {
    holesInterior: cracks.length - holesRim, holesRim, rimOffsetMaxPx: offsets.length ? offsets[offsets.length - 1] : 0, rimOffsetP95Px: p95, rimColumns: offsets.length,
  };
}

/**
 * Counts the holes of one probe image. `rgba` is the probe material's output (255 where drawn) over a cleared background.
 * The covered mask comes from exact rays; the row order of the readback is found by whichever of the two orders agrees better
 * with the drawn pixels.
 */
export function classifyCracks(
  rgba: ArrayLike<number>, width: number, height: number, model: OutlineModel, rig: CameraRig, options: CrackClassifyOptions = {},
  covered: Uint8Array = expectedCoverage(model, rig, width, height),
): CrackImageResult {
  const nearEdgePx = options.nearEdgePx ?? 6;
  const n = width * height;
  const drawn = new Uint8Array(n);
  let drawnPx = 0;
  for (let p = 0; p < n; p++) {
    if (rgba[p * 4] >= (BACKSTOP_VALUE + 255) / 2) {
      drawn[p] = 1;
      drawnPx++;
    }
  }
  const flipped = new Uint8Array(n);
  for (let y = 0; y < height; y++) flipped.set(covered.subarray((height - 1 - y) * width, (height - y) * width), y * width);
  const iou = (mask: Uint8Array): number => {
    let both = 0;
    let either = 0;
    for (let p = 0; p < n; p++) {
      if (mask[p] && drawn[p]) both++;
      if (mask[p] || drawn[p]) either++;
    }
    return either === 0 ? 1 : both / either;
  };
  const upright = iou(covered);
  const reversed = iou(flipped);
  const flipY = reversed > upright;
  const mask = flipY ? flipped : covered;
  let coveredPx = 0;
  const kinds = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (mask[p]) coveredPx++;
    kinds[p] = drawn[p] ? 2 : mask[p] ? 1 : 0;
  }
  const { cracks, masked } = crackPixels(kinds, width, height);
  const dist = distanceToOutside(mask, width, height);
  let cut = 0;
  let pole = 0;
  let elsewhere = 0;
  for (const p of cracks) {
    const x = p % width;
    const y = (p - x) / width;
    const region = dist[p] <= nearEdgePx ? regionOf(model, rig, width, height, x, y, flipY, nearEdgePx) : 'elsewhere';
    if (region === 'cut') cut++;
    else if (region === 'pole') pole++;
    else elsewhere++;
  }
  // Leaks: drawn pixels beyond the outline by more than a pixel (all eight neighbours also uncovered).
  let leakPx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!drawn[p] || mask[p]) continue;
      let beside = false;
      for (let dy = -1; dy <= 1 && !beside; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < width && mask[ny * width + nx]) {
            beside = true;
            break;
          }
        }
      }
      if (!beside) leakPx++;
    }
  }
  const rim = rimAnalysis(mask, drawn, cracks, width, height);
  return {
    holes: cracks.length, cut, pole, elsewhere, masked, ...rim, drawnPx, coveredPx, leakPx,
    agreement: Math.max(upright, reversed), flipY, holePixels: options.keepHoles ? cracks : undefined,
  };
}

/**
 * Which edge of the map a hole near the outline belongs to: the hit's distances in metres to the cut (the row's half-width less
 * |x|) and to the pole edge (the half-height less |y|); the nearer one counts if it lies within the pixels' footprint on the
 * ground, else the outline there is neither (the globe's horizon at morph 0).
 */
export function regionOf(
  model: OutlineModel, rig: CameraRig, width: number, height: number, x: number, y: number, flipY: boolean, nearEdgePx: number,
): CrackRegion {
  const d = pixelRay(rig, width, height, x, y, flipY);
  const hit = insideHit(model, rig, d);
  if (!hit) return 'elsewhere';
  const pixelAngle = (2 * rig.tanHalfFov) / height;
  const footprint = (hit.t * pixelAngle) / Math.max(hit.cosIncidence, 0.1);
  const reach = (nearEdgePx + 2) * footprint * 1.5;
  const toCut = model.halfWidthAtLat(model.latOfY(hit.y)) - Math.abs(hit.x);
  const toPole = model.halfHeight - Math.abs(hit.y);
  if (toCut <= toPole) return toCut <= reach ? 'cut' : 'elsewhere';
  return toPole <= reach ? 'pole' : 'elsewhere';
}

// -- the matrix -------------------------------------------------------------------------------------------------------

/**
 * The controls. 'gap' (the lab's injected gap) and 'folding-off' must find holes so that a zero elsewhere means something;
 * 'folding-off' runs over a synthetic relief, because on flat ground a T-junction opens almost nothing. 'relief' is its twin: the
 * same relief with edge folding on, which must find none (that is the claim: folding closes the cracks that 'folding-off' opens).
 */
export type CrackControl = 'folding-off' | 'gap' | 'relief';

/** Relief amplitude per metre of wavelength (see `MorphSurfaceMesh.setRelief`): the relief of the folding control and its twin. */
export const RELIEF_KAPPA = 0.15;

/**
 * The longest relief wavelength (lattice units) that keeps the camera above the ground: the octave sum is below
 * `2 kappa lambda unitM` metres, held to `share` of the camera's altitude. `unitM` is the metres of one lattice unit.
 */
export function reliefLambdaCap(altitudeM: number, unitM: number, kappa = RELIEF_KAPPA, share = 0.4): number {
  return (share * altitudeM) / (2 * kappa * unitM);
}

/** Whether a control makes the case pass with holes (true) or without (false); undefined for a case without a control. */
export function controlExpectsHoles(control: CrackControl | undefined): boolean | undefined {
  return control === undefined ? undefined : control !== 'relief';
}

/** One case of the matrix. */
export interface CrackCase {
  readonly radiusM: number;
  readonly morph: number;
  readonly view: MorphPoseId;
  readonly control?: CrackControl;
  /** The projection centre, degrees (default 0, 0: the pole is then a lattice vertex). */
  readonly centreLonDeg?: number;
  readonly centreLatDeg?: number;
  /** Fields of the view's pose to replace (for a probe of a pose that is not a preset). */
  readonly poseOverride?: Partial<MorphPose>;
  /** The LOD metric of the case's selector (default 'sphere'). */
  readonly lodMetric?: LodMetric;
  /** The selector's leaf cap (default the terrain default, 4,096). */
  readonly leafCap?: number;
  /** The pole fan (iteration 4): the pole leaves are drawn as a CPU-built polar mesh with `fanRays` rays per full turn (default off). */
  readonly poleFan?: boolean;
  readonly fanRays?: number;
  /** Which fan draws the pole leaves (default 'cpu', iteration 4; 'vertex': the vertex-stage fan of iteration 5). */
  readonly fanMode?: FanMode;
}

/** One row of the result. */
export interface CrackRow extends CrackImageResult {
  readonly radiusM: number;
  readonly morph: number;
  readonly view: MorphPoseId;
  readonly control?: CrackControl;
  /** The case's projection centre and LOD metric, as run (absent: the defaults, centre 0, 0 and 'sphere'). */
  readonly centreLonDeg?: number;
  readonly centreLatDeg?: number;
  readonly lodMetric?: LodMetric;
  readonly leafCap?: number;
  /** The pole fan as run (absent: off) and its rays per full turn. */
  readonly poleFan?: boolean;
  readonly fanRays?: number;
  readonly fanMode?: FanMode;
  /** With the fan: builds of the fan since the page's counters were reset at the start of the case (a fresh case builds once). */
  readonly fanRebuilds?: number;
  /** With the fan: pole leaves replaced, its vertices and triangles, and the CPU milliseconds of its build. */
  readonly fanLeaves?: number;
  readonly fanVertices?: number;
  readonly fanTriangles?: number;
  readonly fanBuildMs?: number;
  /** With `diagnosePole`: why the case has pole holes, and how many remain at `DIAGNOSE_LEAF_CAP` leaves. */
  readonly poleCause?: PoleCause;
  readonly poleHolesAtBigCap?: number;
  /** Leaves the selector drew, instances drawn (leaves plus duplicates), duplicates, leaves with a pole in their cap, torn instances, instances dropped for capacity. */
  readonly leaves: number;
  readonly instances: number;
  readonly duplicates: number;
  readonly poleLeaves: number;
  readonly torn: number;
  readonly dropped: number;
  readonly widthPx: number;
  readonly heightPx: number;
  /**
   * true: the case passed its own criterion; false: it failed; undefined: no criterion, report only. Morph 0 passes with 0 holes
   * (the control for the probe itself); 'folding-off' and 'gap' pass with more than 0 holes, 'relief' (folding on) with 0.
   */
  readonly ok?: boolean;
  readonly ms: number;
}

/** What the probe needs from the page: one case prepared and drawn. */
export interface CrackHost {
  /** Applies a case (state, selection, camera), returns its pack counts and the frame, ready to draw. */
  prepare(c: CrackCase): { frame: MorphFrame; pack: MorphPack; aspect: number; fovDeg: number };
  /** Draws the prepared case with the probe material into a `width` x `height` RGBA8 target over a black clear and reads it back. */
  draw(width: number, height: number): Promise<ArrayLike<number>>;
  /** Puts the page back as it was. */
  restore(): void;
}

/** Options of {@link runCrackProbe}. */
export interface CrackProbeOptions {
  readonly radii?: readonly number[];
  readonly morphs?: readonly number[];
  readonly views?: readonly MorphPoseId[];
  /** Image width in pixels (the height follows the camera's aspect). */
  readonly widthPx?: number;
  readonly nearEdgePx?: number;
  /** false: skip the known-bad controls. */
  readonly controls?: boolean;
  /** The projection centre of the whole matrix, degrees (default 0, 0). A centre off the pole puts a pole strictly inside a leaf (a torn leaf). */
  readonly centreLonDeg?: number;
  readonly centreLatDeg?: number;
  /** Fields of every view's pose to replace (for example a latitude or pitch). */
  readonly poseOverride?: Partial<MorphPose>;
  /** The LOD metric of every case's selector (default 'sphere'; 'stretch' measures leaves at their morphed position). */
  readonly lodMetric?: LodMetric;
  /** The selector's leaf cap of every case (default 4,096; the spike's mesh holds up to 16,384). */
  readonly leafCap?: number;
  /** true: the pole leaves are drawn as the pole fan (see {@link CrackCase.poleFan}); `fanRays` rays per full turn (default 1,024). */
  readonly poleFan?: boolean;
  readonly fanRays?: number;
  /** Which fan draws the pole leaves: 'cpu' (default) or 'vertex' (the vertex-stage fan). */
  readonly fanMode?: FanMode;
  /** false: run only the controls, not the plain matrix (default true). */
  readonly matrix?: boolean;
  /** Called with each case's probe image (RGBA8, the probe material over black) before it is classified. */
  readonly onImage?: (c: CrackCase, rgba: ArrayLike<number>, width: number, height: number) => void;
  /** true: each row lists its hole pixels (`holePixels`). */
  readonly keepHoles?: boolean;
  /**
   * true: a matrix case that has pole holes is drawn again with a larger leaf cap (`DIAGNOSE_LEAF_CAP`), and its row says which of
   * the two causes it is (`poleCause`): the budget (the cap ran out) or the geometry (the pole edge of a pole leaf spans a fixed
   * longitude range at every level, so more leaves do not shorten the cells along it).
   */
  readonly diagnosePole?: boolean;
  /** Called after each row. */
  readonly onProgress?: (done: number, total: number, row: CrackRow) => void;
}

/** The leaf cap of the second draw of `diagnosePole` (the spike mesh's maximum). */
export const DIAGNOSE_LEAF_CAP = 16_384;

/** Which cause the pole holes of a case have: see {@link poleCauseOf}. */
export type PoleCause = 'none' | 'budget' | 'geometry' | 'both';

/**
 * Tells the cause of a case's pole holes from the count at its own cap (`base`) and at the larger cap (`big`): none without
 * holes; the budget if the larger cap closes them; the geometry if it leaves nearly all (at least 90 %); both if it closes some.
 */
export function poleCauseOf(base: number, big: number): PoleCause {
  if (base <= 0) return 'none';
  if (big <= 0) return 'budget';
  return big >= 0.9 * base ? 'geometry' : 'both';
}

/** The matrix of part 2: both radii, morph 0, 0.5 and 1, the six views. */
export const CRACK_DEFAULTS = {
  radii: [600_000, 6_371_000] as readonly number[],
  morphs: [0, 0.5, 1] as readonly number[],
  views: ['orbit-map', 'mid-200m', 'mid-2m', 'cut-east-2m', 'cut-west-2m', 'pole-200m'] as readonly MorphPoseId[],
  widthPx: 1024,
  /** The views the gap control runs on, at morph 0.5. */
  gapViews: ['orbit-map', 'mid-200m'] as readonly MorphPoseId[],
  /** The views the relief controls ('folding-off' and its twin 'relief') run on, at morph 0.5: the mid views, where levels meet within the picture. */
  reliefViews: ['mid-200m', 'mid-2m'] as readonly MorphPoseId[],
  /** The injected gap's share, like the lab's. */
  gapShare: 0.01,
};

/** Runs the crack probe over the matrix (and the controls) with the given host. */
export async function runCrackProbe(host: CrackHost, options: CrackProbeOptions = {}): Promise<CrackRow[]> {
  const radii = options.radii ?? CRACK_DEFAULTS.radii;
  const morphs = options.morphs ?? CRACK_DEFAULTS.morphs;
  const views = options.views ?? CRACK_DEFAULTS.views;
  const widthPx = options.widthPx ?? CRACK_DEFAULTS.widthPx;
  const cases: CrackCase[] = [];
  const centre = { centreLonDeg: options.centreLonDeg ?? 0, centreLatDeg: options.centreLatDeg ?? 0, poseOverride: options.poseOverride, lodMetric: options.lodMetric, leafCap: options.leafCap, poleFan: options.poleFan, fanRays: options.fanRays, fanMode: options.fanMode };
  if (options.matrix !== false) for (const radiusM of radii) for (const view of views) for (const morph of morphs) cases.push({ radiusM, morph, view, ...centre });
  if (options.controls !== false) {
    for (const radiusM of radii) {
      for (const view of CRACK_DEFAULTS.gapViews) {
        if (views.includes(view)) cases.push({ radiusM, morph: 0.5, view, control: 'gap', ...centre });
      }
      for (const view of CRACK_DEFAULTS.reliefViews) {
        if (!views.includes(view)) continue;
        cases.push({ radiusM, morph: 0.5, view, control: 'folding-off', ...centre });
        cases.push({ radiusM, morph: 0.5, view, control: 'relief', ...centre });
      }
    }
  }
  const rows: CrackRow[] = [];
  try {
    for (const c of cases) {
      const began = performance.now();
      const { frame, pack, aspect, fovDeg } = host.prepare(c);
      const heightPx = Math.max(1, Math.round(widthPx / aspect));
      const rgba = await host.draw(widthPx, heightPx);
      options.onImage?.(c, rgba, widthPx, heightPx);
      const model = createOutlineModel(c.morph, c.radiusM);
      const rig = cameraRig(frame, fovDeg, widthPx / heightPx);
      const image = classifyCracks(rgba, widthPx, heightPx, model, rig, { nearEdgePx: options.nearEdgePx, keepHoles: options.keepHoles });
      const expectsHoles = controlExpectsHoles(c.control);
      const ok = expectsHoles === undefined ? (c.morph === 0 ? image.holes === 0 : undefined) : expectsHoles ? image.holes > 0 : image.holes === 0;
      let poleExtra: Pick<CrackRow, 'poleCause' | 'poleHolesAtBigCap'> = {};
      if (options.diagnosePole && !c.control && image.pole > 0 && (c.leafCap ?? 0) < DIAGNOSE_LEAF_CAP) {
        const bigCase: CrackCase = { ...c, leafCap: DIAGNOSE_LEAF_CAP };
        const big = host.prepare(bigCase);
        const bigRgba = await host.draw(widthPx, Math.max(1, Math.round(widthPx / big.aspect)));
        const bigImage = classifyCracks(bigRgba, widthPx, Math.max(1, Math.round(widthPx / big.aspect)), model, cameraRig(big.frame, big.fovDeg, widthPx / Math.max(1, Math.round(widthPx / big.aspect))), { nearEdgePx: options.nearEdgePx });
        poleExtra = { poleCause: poleCauseOf(image.pole, bigImage.pole), poleHolesAtBigCap: bigImage.pole };
      } else if (options.diagnosePole && !c.control) poleExtra = { poleCause: 'none' };
      const row: CrackRow = {
        ...c, ...image, ...poleExtra, leaves: pack.leaves, instances: pack.instances, duplicates: pack.duplicates, poleLeaves: pack.poleLeaves,
        torn: pack.torn, dropped: pack.dropped, widthPx, heightPx, ok, ms: performance.now() - began,
        ...(pack.fan ? { fanLeaves: pack.fan.leaves, fanVertices: pack.fan.vertices, fanTriangles: pack.fan.triangles, fanBuildMs: pack.fan.buildMs, fanRebuilds: pack.fan.rebuilds } : {}),
      };
      rows.push(row);
      options.onProgress?.(rows.length, cases.length, row);
      await new Promise<void>((resolve) => setTimeout(resolve));
    }
  } finally {
    host.restore();
  }
  return rows;
}

