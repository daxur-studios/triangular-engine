import { MIN_EDGE_M, type TerrainEdit } from '../planet-shape-field';

/**
 * Plan 055 Phase 1b: shape ops, the bounded shapes that turn a procedural field into a planet's landforms and carry
 * the player's edits. Positions are body-relative metres (doubles); a shader twin packs them camera-relative.
 *
 * - **Height ops** (2.5D) change the ground along the vertical: a disc, a cone, a crater, a path (ridge, road, river).
 *   Horizontal distances are arcs on the body sphere, so the shapes stay round on a small body and over long paths.
 * - **Volume ops** (3D) combine a signed-distance shape with the field: a sphere, a tube along a path.
 *
 * Ops apply in order to the field value (signed, metres, negative inside rock). The shader twin and the op index
 * (`op-index.ts`) rely on two contracts, both checked by specs:
 * - outside an op's caps (`shapeOpBounds`), the op leaves the value exactly as it was, so a sample may apply only the
 *   ops whose caps hold it and get the same value;
 * - inside the caps but outside the altitude range, the op never changes whether a point is solid.
 */

export type V3 = readonly [number, number, number];

/** How much accuracy an op must keep at every level of detail (plan §Fidelity classes). */
export type FidelityClass = 'silhouette' | 'contact' | 'topology' | 'relaxed';

/** A level disc: `heightM` (default 0) within `radiusM`, fading out over `edgeM`. */
export interface DiscShape {
  readonly kind: 'disc';
  readonly centre: V3;
  readonly radiusM: number;
  readonly edgeM?: number;
  readonly heightM?: number;
}

/** A peak of `heightM` (negative for a pit) at the centre, reaching 0 at `radiusM`; `sharpness` > 1 hollows the flanks. */
export interface ConeShape {
  readonly kind: 'cone';
  readonly centre: V3;
  readonly radiusM: number;
  readonly heightM: number;
  readonly edgeM?: number;
  readonly sharpness?: number;
}

/** A bowl `depthM` deep at the centre rising to a rim `rimHeightM` high at `radiusM`, which falls away over `rimWidthM`. */
export interface CraterShape {
  readonly kind: 'crater';
  readonly centre: V3;
  readonly radiusM: number;
  readonly depthM: number;
  readonly rimHeightM: number;
  readonly rimWidthM: number;
  readonly edgeM?: number;
}

/**
 * A band `widthM` wide along great-circle segments between `points`, at `heightsM` (one per point, default 0)
 * interpolated along each segment. `flat` keeps that height across the band (roads, river beds); `round` falls from it
 * at the centre line to 0 at the band's edge (ridges). Segments must be shorter than a quarter turn.
 */
export interface PathShape {
  readonly kind: 'path';
  readonly points: readonly V3[];
  readonly heightsM?: readonly number[];
  readonly widthM: number;
  readonly edgeM?: number;
  readonly profile?: 'flat' | 'round';
}

export type HeightShape = DiscShape | ConeShape | CraterShape | PathShape;

/** A ball of `radiusM` at `centre`. */
export interface SphereShape {
  readonly kind: 'sphere';
  readonly centre: V3;
  readonly radiusM: number;
}

/** Capsules of `radiusM` along straight segments between `points` (tunnels, arches made of a bent tube). */
export interface TubeShape {
  readonly kind: 'tube';
  readonly points: readonly V3[];
  readonly radiusM: number;
}

export type VolumeShape = SphereShape | TubeShape;

/**
 * How a height op's profile meets the ground. `target` is the surface at the profile's height, weighted by its edge:
 * - `add`: raises the ground by the profile (a cone or ridge on top of whatever is there);
 * - `set`: replaces the ground with the profile (a pad, a road);
 * - `raise`: lifts the ground to at least the profile, `lower`: cuts it to at most the profile (smoothed over `smoothM`);
 * - `scale`: keeps `factor` of the relief (0.25 softens to rounded hills);
 * - `grade`: the profile inside the shape, and outside it banks that rise and fall from the profile's height by `slope`
 *   (rise over run, default 1) until they meet the ground: a cutting where the ground is higher, a fill where it is
 *   lower. Unlike `set`, whose edge squeezes any drop into `edgeM` (a cliff the march cannot trust across a canyon),
 *   the field stays as steep as the banks. The edge is unused; the banks reach as far as the ground band needs.
 */
export type HeightBlend =
  | { readonly mode: 'add' }
  | { readonly mode: 'set' }
  | { readonly mode: 'grade'; readonly slope?: number }
  | { readonly mode: 'raise'; readonly smoothM?: number }
  | { readonly mode: 'lower'; readonly smoothM?: number }
  | { readonly mode: 'scale'; readonly factor: number };

/** How a volume op meets the field: `union` adds rock, `subtract` removes it, rounded over `smoothM`. */
export type VolumeBlend = { readonly mode: 'union'; readonly smoothM?: number } | { readonly mode: 'subtract'; readonly smoothM?: number };

interface ShapeOpBase {
  /** Unique within an op log; edits refer to it to replace or remove the op. */
  readonly id: string;
  /** Default `relaxed`. */
  readonly fidelity?: FidelityClass;
  /**
   * Below this size on screen (a sample footprint larger than it, metres) a `relaxed` or `silhouette` op is skipped.
   * Default: the op's own size (`shapeOpSizeM`). `contact` and `topology` ops are never skipped.
   */
  readonly minVisibleSizeM?: number;
}

export interface HeightOp extends ShapeOpBase {
  readonly shape: HeightShape;
  readonly blend: HeightBlend;
}

export interface VolumeOp extends ShapeOpBase {
  readonly shape: VolumeShape;
  readonly blend: VolumeBlend;
}

export type ShapeOp = HeightOp | VolumeOp;

export function isVolumeOp(op: ShapeOp): op is VolumeOp {
  return op.shape.kind === 'sphere' || op.shape.kind === 'tube';
}

/** Altitudes (metres above the body sphere) between which the field may be solid or air; below solid, above air. */
export interface AltitudeBand {
  readonly bottomM: number;
  readonly topM: number;
}

/**
 * A column over a cap of the body sphere: unit `direction`, `angle` radians wide, between two altitudes. A shape op's
 * bounds are one or more of these (one per path segment), and outside all of them the op changes no point's solidity.
 */
export interface ShapeBounds {
  readonly direction: V3;
  readonly angle: number;
  readonly bottomM: number;
  readonly topM: number;
}

// ---------- small maths ----------

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Polynomial smooth maximum over `k` (as the carve edit always used); never below `max(a, b)`, at most `k/4` above. */
export function smoothMax(a: number, b: number, k: number): number {
  const h = Math.min(1, Math.max(0, 0.5 + ((b - a) * 0.5) / k));
  return a + (b - a) * h + k * h * (1 - h);
}

export function smoothMin(a: number, b: number, k: number): number {
  return -smoothMax(-a, -b, k);
}

function normalize(v: V3): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: V3, b: V3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Angle between two unit vectors, precise at small angles. */
export function angleBetween(a: V3, b: V3): number {
  const c = cross(a, b);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b));
}

/** A great-circle segment between unit directions, prepared for distance queries. */
interface ArcSegment {
  readonly a: V3;
  readonly b: V3;
  /** Unit normal of the great circle through `a` and `b`. */
  readonly normal: V3;
  readonly angle: number;
}

function arcSegment(a: V3, b: V3): ArcSegment {
  return { a, b, normal: normalize(cross(a, b)), angle: angleBetween(a, b) };
}

/** Angular distance from unit direction `d` to the segment, and how far along it (0..1) the nearest point lies. */
function arcDistance(segment: ArcSegment, d: V3): { angle: number; t: number } {
  const offPlane = dot(d, segment.normal);
  const q: V3 = [d[0] - segment.normal[0] * offPlane, d[1] - segment.normal[1] * offPlane, d[2] - segment.normal[2] * offPlane];
  // The foot lies on the segment when it is on the a→b side of both ends (and in front of them, not antipodal).
  if (dot(cross(segment.a, q), segment.normal) >= 0 && dot(cross(q, segment.b), segment.normal) >= 0 && dot(q, segment.a) + dot(q, segment.b) > 0) {
    const along = angleBetween(segment.a, normalize(q));
    return { angle: Math.asin(Math.min(1, Math.abs(offPlane))), t: segment.angle > 0 ? Math.min(1, along / segment.angle) : 0 };
  }
  const toA = angleBetween(d, segment.a);
  const toB = angleBetween(d, segment.b);
  return toA <= toB ? { angle: toA, t: 0 } : { angle: toB, t: 1 };
}

/** Distance from `p` to the straight segment `a`..`b` (body-relative metres). */
function segmentDistance(p: V3, a: V3, b: V3): number {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.min(1, Math.max(0, dot(ap, ab) / Math.max(dot(ab, ab), 1e-300)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

// ---------- sizes, ranges, validation ----------

function edgeOf(shape: { readonly edgeM?: number }): number {
  return Math.max(shape.edgeM ?? 0, MIN_EDGE_M);
}

function smoothOf(blend: { readonly smoothM?: number }): number {
  return Math.max(blend.smoothM ?? 0, MIN_EDGE_M);
}

/** The op's characteristic size in metres: what `minVisibleSizeM` defaults to. */
export function shapeOpSizeM(op: ShapeOp): number {
  const shape = op.shape;
  switch (shape.kind) {
    case 'disc':
    case 'cone':
    case 'sphere':
      return shape.radiusM;
    case 'crater':
      return shape.radiusM + shape.rimWidthM;
    case 'path':
      return shape.widthM;
    case 'tube':
      return shape.radiusM;
  }
}

/** Whether a sample with this footprint (metres) skips the op. */
export function skipsOp(op: ShapeOp, footprintM: number): boolean {
  const fidelity = op.fidelity ?? 'relaxed';
  if (fidelity === 'contact' || fidelity === 'topology') return false;
  return footprintM > (op.minVisibleSizeM ?? shapeOpSizeM(op));
}

/** Lowest and highest value a height profile takes (the ground it describes), including 0 where it fades out. */
function profileRange(shape: HeightShape): [number, number] {
  switch (shape.kind) {
    case 'disc':
      return [shape.heightM ?? 0, shape.heightM ?? 0];
    case 'cone':
      return [Math.min(0, shape.heightM), Math.max(0, shape.heightM)];
    case 'crater':
      return [Math.min(0, -shape.depthM, shape.rimHeightM), Math.max(0, -shape.depthM, shape.rimHeightM)];
    case 'path': {
      const heights = shape.heightsM ?? [0];
      const low = Math.min(...heights);
      const high = Math.max(...heights);
      return shape.profile === 'round' ? [Math.min(0, low), Math.max(0, high)] : [low, high];
    }
  }
}

function assertFinite(value: unknown, what: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Shape op: ${what} must be a finite number`);
}

function assertPositive(value: unknown, what: string): void {
  assertFinite(value, what);
  if ((value as number) <= 0) throw new Error(`Shape op: ${what} must be positive`);
}

function assertPoint(p: unknown, what: string): void {
  if (!Array.isArray(p) || p.length !== 3) throw new Error(`Shape op: ${what} must be [x, y, z]`);
  p.forEach((c, i) => assertFinite(c, `${what}[${i}]`));
  if (Math.hypot(p[0], p[1], p[2]) === 0) throw new Error(`Shape op: ${what} must not be the body centre`);
}

function assertPoints(points: unknown, what: string, maxAngle: number | undefined): void {
  if (!Array.isArray(points) || points.length < 2) throw new Error(`Shape op: ${what} needs at least two points`);
  points.forEach((p, i) => assertPoint(p, `${what}[${i}]`));
  if (maxAngle === undefined) return;
  for (let i = 1; i < points.length; i++) {
    const angle = angleBetween(normalize(points[i - 1]), normalize(points[i]));
    if (!(angle > 0 && angle < maxAngle)) throw new Error(`Shape op: ${what} segment ${i} must be longer than 0 and under a quarter turn`);
  }
}

const FIDELITY = new Set<FidelityClass>(['silhouette', 'contact', 'topology', 'relaxed']);
const HEIGHT_BLENDS = new Set(['add', 'set', 'grade', 'raise', 'lower', 'scale']);
const VOLUME_BLENDS = new Set(['union', 'subtract']);

/** Throws a readable error unless `op` is a well-formed shape op (ops arrive from save files and game code). */
export function validateShapeOp(op: ShapeOp): void {
  if (typeof op?.id !== 'string' || op.id.length === 0) throw new Error('Shape op: id must be a non-empty string');
  if (op.fidelity !== undefined && !FIDELITY.has(op.fidelity)) throw new Error(`Shape op ${op.id}: unknown fidelity ${op.fidelity}`);
  if (op.minVisibleSizeM !== undefined) assertFinite(op.minVisibleSizeM, 'minVisibleSizeM');
  const shape = op.shape as HeightShape | VolumeShape;
  const optionalEdge = (s: { edgeM?: number }) => {
    if (s.edgeM !== undefined) assertFinite(s.edgeM, 'edgeM');
  };
  switch (shape?.kind) {
    case 'disc':
      assertPoint(shape.centre, 'centre');
      assertPositive(shape.radiusM, 'radiusM');
      optionalEdge(shape);
      if (shape.heightM !== undefined) assertFinite(shape.heightM, 'heightM');
      break;
    case 'cone':
      assertPoint(shape.centre, 'centre');
      assertPositive(shape.radiusM, 'radiusM');
      assertFinite(shape.heightM, 'heightM');
      optionalEdge(shape);
      if (shape.sharpness !== undefined) assertPositive(shape.sharpness, 'sharpness');
      break;
    case 'crater':
      assertPoint(shape.centre, 'centre');
      assertPositive(shape.radiusM, 'radiusM');
      assertFinite(shape.depthM, 'depthM');
      assertFinite(shape.rimHeightM, 'rimHeightM');
      assertPositive(shape.rimWidthM, 'rimWidthM');
      optionalEdge(shape);
      break;
    case 'path':
      assertPoints(shape.points, 'points', Math.PI / 2);
      if (shape.heightsM !== undefined) {
        if (!Array.isArray(shape.heightsM) || shape.heightsM.length !== shape.points.length) {
          throw new Error(`Shape op ${op.id}: heightsM needs one height per point`);
        }
        shape.heightsM.forEach((h, i) => assertFinite(h, `heightsM[${i}]`));
      }
      assertPositive(shape.widthM, 'widthM');
      optionalEdge(shape);
      if (shape.profile !== undefined && shape.profile !== 'flat' && shape.profile !== 'round') {
        throw new Error(`Shape op ${op.id}: unknown path profile ${shape.profile}`);
      }
      break;
    case 'sphere':
      assertPoint(shape.centre, 'centre');
      assertPositive(shape.radiusM, 'radiusM');
      break;
    case 'tube':
      assertPoints(shape.points, 'points', undefined);
      assertPositive(shape.radiusM, 'radiusM');
      break;
    default:
      throw new Error(`Shape op ${op.id}: unknown shape ${(shape as { kind?: string })?.kind}`);
  }
  const mode = (op.blend as { mode?: string })?.mode ?? '';
  if (!(isVolumeOp(op) ? VOLUME_BLENDS : HEIGHT_BLENDS).has(mode)) throw new Error(`Shape op ${op.id}: blend ${mode} does not fit a ${shape.kind}`);
  if ('smoothM' in op.blend && op.blend.smoothM !== undefined) assertFinite(op.blend.smoothM, 'smoothM');
  if (op.blend.mode === 'scale') assertFinite(op.blend.factor, 'factor');
  if (op.blend.mode === 'grade' && op.blend.slope !== undefined) assertPositive(op.blend.slope, 'slope');
}

/**
 * Distance (metres, along the body sphere) from the shape's centre or centre line at which its profile ends: the disc
 * or cone radius, the crater's outer rim, half the path's width. A `grade` op's banks start there.
 */
function coreOf(shape: HeightShape): number {
  switch (shape.kind) {
    case 'disc':
    case 'cone':
      return shape.radiusM;
    case 'crater':
      return shape.radiusM + shape.rimWidthM;
    case 'path':
      return shape.widthM / 2;
  }
}

// ---------- bounds ----------

function union(a: AltitudeBand, b: AltitudeBand): AltitudeBand {
  return { bottomM: Math.min(a.bottomM, b.bottomM), topM: Math.max(a.topM, b.topM) };
}

/**
 * The op's bounds on a body of `radiusM`, given the band the field already spans where the op sits (`band`, with
 * `bottomM <= 0 <= topM`). The altitude range is what solidity can change over:
 * - `add` shifts the band by the profile's range; `set`, `grade`, `raise` and `lower` widen it to the profile (plus the
 *   smoothing);
 * - `scale` stretches it by the factor;
 * - a volume op's range is its shape grown by twice the smoothing (it fades out over the second width).
 * A `grade` op's caps reach as far as its banks can still meet ground inside the band: beyond that the ground lies
 * between the banks and the op leaves the value as it was.
 */
export function shapeOpBounds(op: ShapeOp, radiusM: number, band: AltitudeBand): ShapeBounds[] {
  if (isVolumeOp(op)) {
    const reach = op.shape.radiusM + 2 * smoothOf(op.blend);
    const balls: { centre: V3; radius: number }[] = op.shape.kind === 'sphere'
      ? [{ centre: op.shape.centre, radius: reach }]
      : op.shape.points.slice(1).map((b, i) => {
        const a = (op.shape as TubeShape).points[i];
        const centre: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        return { centre, radius: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + reach };
      });
    return balls.map(({ centre, radius }) => {
      const length = Math.hypot(centre[0], centre[1], centre[2]);
      return {
        direction: normalize(centre),
        angle: radius >= length ? Math.PI : Math.asin(radius / length),
        bottomM: length - radius - radiusM,
        topM: length + radius - radiusM,
      };
    });
  }
  const [low, high] = profileRange(op.shape);
  let range: AltitudeBand;
  switch (op.blend.mode) {
    case 'add':
      range = { bottomM: band.bottomM + Math.min(0, low), topM: band.topM + Math.max(0, high) };
      break;
    case 'set':
    case 'grade':
      range = union(band, { bottomM: low, topM: high });
      break;
    case 'raise':
    case 'lower': {
      const k = smoothOf(op.blend);
      range = union(band, { bottomM: low - k, topM: high + k });
      break;
    }
    case 'scale': {
      const f = op.blend.factor;
      const scaled = [band.bottomM * f, band.topM * f];
      range = union(band, { bottomM: Math.min(...scaled), topM: Math.max(...scaled) });
      break;
    }
  }
  const shape = op.shape;
  // The banks clamp the value to within slope x distance of the profile's level; the ground in the band is never
  // further from that level than this, so past it (with a margin for rounding) the clamp passes the value through.
  const beyond = op.blend.mode === 'grade'
    ? (Math.max(high - band.bottomM, band.topM - low) / (op.blend.slope ?? 1)) * 1.01 + MIN_EDGE_M
    : edgeOf(shape);
  const cap = (centre: V3, reachM: number, extraAngle = 0): ShapeBounds => ({
    direction: normalize(centre), angle: Math.min(Math.PI, reachM / radiusM + extraAngle), ...range,
  });
  if (shape.kind !== 'path') return [cap(shape.centre, coreOf(shape) + beyond)];
  return shape.points.slice(1).map((b, i) => {
    const a = normalize(shape.points[i]);
    const bn = normalize(b);
    return cap([a[0] + bn[0], a[1] + bn[1], a[2] + bn[2]], coreOf(shape) + beyond, angleBetween(a, bn) / 2);
  });
}

/** Whether two caps overlap. */
export function capsOverlap(a: ShapeBounds, b: ShapeBounds): boolean {
  return angleBetween(a.direction, b.direction) <= a.angle + b.angle;
}

/**
 * Bounds of every op in order. Each op's input band is the base band widened by the ranges of the earlier ops whose
 * caps meet its own, because only those can have moved the ground under it. O(n²); the op index makes it local when
 * logs grow past a few thousand ops.
 */
export function shapeOpsBounds(ops: readonly ShapeOp[], radiusM: number, base: AltitudeBand): ShapeBounds[][] {
  const all: ShapeBounds[][] = [];
  ops.forEach((op) => {
    let band = base;
    const probe = shapeOpBounds(op, radiusM, base);
    for (const earlier of all) {
      for (const piece of earlier) {
        if (probe.some((p) => capsOverlap(p, piece))) band = union(band, piece);
      }
    }
    all.push(shapeOpBounds(op, radiusM, band));
  });
  return all;
}

// ---------- evaluation ----------

/** An op prepared for evaluation: `apply` takes the value, the point, its unit direction and altitude. */
type Apply = (value: number, p: V3, direction: V3, altitude: number) => number;

/** The profile at a direction: its height, its weight (1 inside, fading over the edge) and the metres beyond its core. */
type Profile = { height: number; weight: number; beyond: number };

function heightProfile(shape: HeightShape, radiusM: number): (direction: V3) => Profile {
  switch (shape.kind) {
    case 'disc': {
      const centre = normalize(shape.centre);
      const edge = edgeOf(shape);
      const height = shape.heightM ?? 0;
      return (d) => {
        const r = angleBetween(d, centre) * radiusM;
        return { height, weight: 1 - smoothstep(shape.radiusM, shape.radiusM + edge, r), beyond: Math.max(0, r - shape.radiusM) };
      };
    }
    case 'cone': {
      const centre = normalize(shape.centre);
      const edge = edgeOf(shape);
      const sharpness = shape.sharpness ?? 1;
      return (d) => {
        const r = angleBetween(d, centre) * radiusM;
        return {
          height: shape.heightM * (1 - smoothstep(0, shape.radiusM, r)) ** sharpness, weight: 1 - smoothstep(shape.radiusM, shape.radiusM + edge, r),
          beyond: Math.max(0, r - shape.radiusM),
        };
      };
    }
    case 'crater': {
      const centre = normalize(shape.centre);
      const edge = edgeOf(shape);
      const outer = shape.radiusM + shape.rimWidthM;
      return (d) => {
        const r = angleBetween(d, centre) * radiusM;
        const s = r / shape.radiusM;
        const height = r < shape.radiusM
          ? -shape.depthM + (shape.depthM + shape.rimHeightM) * s * s
          : shape.rimHeightM * (1 - smoothstep(shape.radiusM, outer, r));
        return { height, weight: 1 - smoothstep(outer, outer + edge, r), beyond: Math.max(0, r - outer) };
      };
    }
    case 'path': {
      const directions = shape.points.map(normalize);
      const segments = directions.slice(1).map((b, i) => arcSegment(directions[i], b));
      const heights = shape.heightsM ?? shape.points.map(() => 0);
      const half = shape.widthM / 2;
      const edge = edgeOf(shape);
      const round = shape.profile === 'round';
      return (d) => {
        let best = Infinity;
        let height = 0;
        segments.forEach((segment, i) => {
          const { angle, t } = arcDistance(segment, d);
          if (angle < best) {
            best = angle;
            height = heights[i] + (heights[i + 1] - heights[i]) * t;
          }
        });
        const r = best * radiusM;
        return { height: round ? height * (1 - smoothstep(0, half + edge, r)) : height, weight: 1 - smoothstep(half, half + edge, r), beyond: Math.max(0, r - half) };
      };
    }
  }
}

/** Signed distance (metres, negative inside) from body-relative `p` to a volume shape. */
function volumeSdf(shape: VolumeShape): (p: V3) => number {
  return shape.kind === 'sphere'
    ? (p) => Math.hypot(p[0] - shape.centre[0], p[1] - shape.centre[1], p[2] - shape.centre[2]) - shape.radiusM
    : (p) => {
      let best = Infinity;
      for (let i = 1; i < shape.points.length; i++) best = Math.min(best, segmentDistance(p, shape.points[i - 1], shape.points[i]));
      return best - shape.radiusM;
    };
}

function prepare(op: ShapeOp, radiusM: number): Apply {
  if (isVolumeOp(op)) {
    const k = smoothOf(op.blend);
    const sdf = volumeSdf(op.shape);
    // A smooth union also lowers a positive value far from the shape (it reads as a nearer surface). Fading the op out
    // between k and 2k from the shape keeps it exactly the identity outside its bounds, so skipping it there (the op
    // index does) changes nothing for later ops. Inside the fade both terms have the input's sign, so solidity holds.
    const union = op.blend.mode === 'union';
    return (value, p) => {
      const distance = sdf(p);
      if (distance >= 2 * k) return value;
      const combined = union ? smoothMin(value, distance, k) : smoothMax(value, -distance, k);
      return distance <= k ? combined : combined + (value - combined) * smoothstep(k, 2 * k, distance);
    };
  }
  const profile = heightProfile(op.shape, radiusM);
  const blend = op.blend;
  switch (blend.mode) {
    case 'add':
      return (value, _p, d) => {
        const { height, weight } = profile(d);
        return weight <= 0 ? value : value - height * weight;
      };
    case 'set':
      return (value, _p, d, altitude) => {
        const { height, weight } = profile(d);
        return weight <= 0 ? value : value + (altitude - height - value) * weight;
      };
    case 'grade': {
      const slope = blend.slope ?? 1;
      return (value, _p, d, altitude) => {
        const { height, beyond } = profile(d);
        const level = altitude - height;
        return Math.max(Math.min(value, level + slope * beyond), level - slope * beyond);
      };
    }
    case 'raise':
    case 'lower': {
      const k = smoothOf(blend);
      const raise = blend.mode === 'raise';
      return (value, _p, d, altitude) => {
        const { height, weight } = profile(d);
        if (weight <= 0) return value;
        const target = altitude - height;
        const blended = raise ? smoothMin(value, target, k) : smoothMax(value, target, k);
        return value + (blended - value) * weight;
      };
    }
    case 'scale':
      return (value, _p, d, altitude) => {
        // Outside the cap the op must return the value bit for bit (the op index relies on it), not re-add the altitude.
        const { weight } = profile(d);
        return weight <= 0 ? value : altitude + (value - altitude) * (1 + (blend.factor - 1) * weight);
      };
  }
}

/** Ops ready to evaluate on the CPU (the reference; the shader twin must match it). */
export interface CompiledShapeOps {
  readonly ops: readonly ShapeOp[];
  /** The field value at body-relative `p` after the ops (or only those at `indices`, in order). */
  apply(value: number, p: V3, footprintM?: number, indices?: readonly number[]): number;
  /**
   * Distance (metres) from `p` to the nearest union shape not skipped at `footprintM`, `Infinity` if none: the march
   * never steps further, since beyond its fade a union leaves the field blind to the shape (the shader's `reach`).
   */
  reach(p: V3, footprintM?: number): number;
}

export function compileShapeOps(ops: readonly ShapeOp[], radiusM: number): CompiledShapeOps {
  ops.forEach(validateShapeOp);
  const applies = ops.map((op) => prepare(op, radiusM));
  const unions = ops.flatMap((op) => (isVolumeOp(op) && op.blend.mode === 'union' ? [{ op, sdf: volumeSdf(op.shape) }] : []));
  return {
    ops,
    reach(p, footprintM = 0) {
      let nearest = Infinity;
      for (const { op, sdf } of unions) if (!(footprintM > 0 && skipsOp(op, footprintM))) nearest = Math.min(nearest, sdf(p));
      return nearest;
    },
    apply(value, p, footprintM = 0, indices) {
      const length = Math.hypot(p[0], p[1], p[2]);
      const direction: V3 = [p[0] / length, p[1] / length, p[2] / length];
      const altitude = length - radiusM;
      const count = indices ? indices.length : ops.length;
      for (let n = 0; n < count; n++) {
        const i = indices ? indices[n] : n;
        if (footprintM > 0 && skipsOp(ops[i], footprintM)) continue;
        value = applies[i](value, p, direction, altitude);
      }
      return value;
    },
  };
}

/** A Phase 1 terrain edit as the shape op that replaces it (disc + set, disc + scale, sphere + subtract). */
export function shapeOpFromTerrainEdit(edit: TerrainEdit, id: string): ShapeOp {
  if (edit.kind === 'carve') {
    return { id, shape: { kind: 'sphere', centre: edit.centre, radiusM: edit.radiusM }, blend: { mode: 'subtract', smoothM: edit.edgeM }, fidelity: 'contact' };
  }
  const shape: DiscShape = { kind: 'disc', centre: edit.centre, radiusM: edit.radiusM, edgeM: edit.edgeM, heightM: edit.heightM ?? 0 };
  return edit.kind === 'flatten'
    ? { id, shape, blend: { mode: 'set' }, fidelity: 'contact' }
    : { id, shape, blend: { mode: 'scale', factor: edit.strength ?? 0.25 } };
}
