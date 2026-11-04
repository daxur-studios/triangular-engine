import type { LodDomain, Vec3 } from './lod-domain';
import { anchorFor, cubeComponent, cubeLattice, newAnchor, type LatticeAnchor } from './lod-lattice';
import { MORPH_EE, OUTLINE_WRAP, type MorphAnchor, type MorphOutline } from './lod-morph-math';

/**
 * Plan 059, step G6b, the CPU half of the terrain's globe-to-map morph (all doubles): the map the globe flattens to, the bend,
 * the inverse of both for a camera, the per-frame anchor values the vertex stage takes as uniforms, and the reference position
 * of a vertex that the precision specs compare the float32 stage against.
 *
 * Conventions follow `planet-morph-nodes.ts`: the projection basis is (forward, up, right) from `setPlanetProjectionCentre`;
 * longitude and latitude are measured in it (lon = atan2(u . right, u . forward), lat = asin(u . up)); the map frame is x right,
 * y up, z forward, the bent ground is the sphere of radius 1 / k centred on (0, 0, -1 / k), and the map frame turns into the body
 * (= scene) frame by `right x + up y + forward z` with z shifted by `(1 - morph) R`, so morph 0 is the globe centred on the origin.
 *
 * The map is `planetMapXY` of `triangular-engine/planet-material`, copied here because that entry also holds Angular-bearing
 * code and this one is worker-safe; `lod-morph-math.spec.ts` checks the two against each other.
 */

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

// -- the map -------------------------------------------------------------------------------------------------------

/** The projection the globe flattens to. Same values as `PlanetMapProjection` in `triangular-engine/planet-material`. */
export type MorphProjection = 'equirectangular' | 'equal-earth';

/** The projection basis in the body frame: unit vectors. */
export interface MorphBasis {
  /** Towards the projection centre (longitude 0, latitude 0). */
  readonly forward: Vec3;
  /** Towards the map's north pole. */
  readonly up: Vec3;
  /** Towards the map's +x. */
  readonly right: Vec3;
}

/**
 * The morph state of a terrain, as {@link LodSurfaceMesh.setMorph} takes it: how far the globe has flattened, which map, and
 * where the map is centred. Either the projection centre in degrees (as `setPlanetProjectionCentre`) or the basis itself (as
 * `<planet>`'s `morphUniforms` hold it, see {@link morphSettingsFromUniforms}).
 */
export interface LodMorphSettings {
  /** 0 = globe, 1 = flat map. */
  readonly morph: number;
  /** The map: Equal Earth blends in with the morph; equirectangular is `(R lon, R lat)` at every morph. */
  readonly projection: MorphProjection;
  /** The projection centre, body frame (lon 0 = +Z, lat 0 = the equator). Ignored when `basis` is given. */
  readonly projectionCentre?: { readonly lonDeg: number; readonly latDeg: number };
  /** The projection basis, doubles. Takes precedence over `projectionCentre`. Without either the default centre (0, 0) is used. */
  readonly basis?: MorphBasis;
}

/**
 * The slice of `IPlanetMorphUniforms` (`triangular-engine/planet-material`) that carries the morph: structurally satisfied by it,
 * so `<planet>`'s `morphUniforms` can be passed as they are. Declared here so this entry needs no import of that one.
 */
export interface MorphUniformsLike {
  readonly uMorph: { readonly value: number };
  readonly uProjForward: { readonly value: { readonly x: number; readonly y: number; readonly z: number } };
  readonly uProjUp: { readonly value: { readonly x: number; readonly y: number; readonly z: number } };
  readonly uProjRight: { readonly value: { readonly x: number; readonly y: number; readonly z: number } };
  /** 0 = static baked projection (the default basis), 1 = dynamic basis. */
  readonly uProjMode: { readonly value: number };
  /** 0 = equirectangular, 1 = Equal Earth. */
  readonly uProjectionType: { readonly value: number };
}

/**
 * Reads the morph state out of `<planet>`'s uniforms: `uMorph`, `uProjectionType` and the projection basis (`uProjForward/Up/Right`,
 * which hold doubles on the CPU; only the GPU copy is float32). With `uProjMode` 0 the basis is the default one (centre 0, 0).
 * Call it when the uniforms change (or every frame: it allocates one small object).
 */
export function morphSettingsFromUniforms(uniforms: MorphUniformsLike): LodMorphSettings {
  const v = (u: { x: number; y: number; z: number }): Vec3 => [u.x, u.y, u.z];
  return {
    morph: uniforms.uMorph.value,
    projection: uniforms.uProjectionType.value >= 0.5 ? 'equal-earth' : 'equirectangular',
    ...(uniforms.uProjMode.value >= 0.5
      ? { basis: { forward: v(uniforms.uProjForward.value), up: v(uniforms.uProjUp.value), right: v(uniforms.uProjRight.value) } }
      : { projectionCentre: { lonDeg: 0, latDeg: 0 } }),
  };
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalised = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A projection basis with its own arrays (all zero but the default centre's), for {@link projectionBasisInto} to fill. */
export function newProjectionBasis(): MorphBasis {
  return { forward: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0] };
}

/**
 * {@link projectionBasis} written into `out` (its three vectors are overwritten; the same arithmetic, so the same numbers, and no
 * allocation). Returns `out`.
 */
export function projectionBasisInto(lonDeg: number, latDeg: number, out: MorphBasis): MorphBasis {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const f = out.forward;
  f[0] = Math.cos(lat) * Math.sin(lon);
  f[1] = Math.sin(lat);
  f[2] = Math.cos(lat) * Math.cos(lon);
  const u = out.up;
  u[0] = -f[1] * f[0];
  u[1] = 1 - f[1] * f[1];
  u[2] = -f[1] * f[2];
  if (u[0] * u[0] + u[1] * u[1] + u[2] * u[2] < 1e-8) {
    u[0] = 0;
    u[1] = 0;
    u[2] = f[1] > 0 ? -1 : 1;
  }
  const l = Math.hypot(u[0], u[1], u[2]);
  u[0] /= l;
  u[1] /= l;
  u[2] /= l;
  const r = out.right;
  r[0] = u[1] * f[2] - u[2] * f[1];
  r[1] = u[2] * f[0] - u[0] * f[2];
  r[2] = u[0] * f[1] - u[1] * f[0];
  return out;
}

/** `setPlanetProjectionCentre`'s basis, in doubles. */
export function projectionBasis(lonDeg: number, latDeg: number): MorphBasis {
  return projectionBasisInto(lonDeg, latDeg, newProjectionBasis());
}

/** A resolved morph: the settings with the planet radius, the basis and the map's weights, so that the functions below take one argument. */
export interface MorphMap {
  readonly radius: number;
  readonly morph: number;
  readonly projection: MorphProjection;
  readonly basis: MorphBasis;
  /** Weights of the map: `g = wLin + wEE c(lat)` and `y = R (wLin lat + wEE yEE(lat))`. Equirectangular: 1 and 0 at every morph. */
  readonly wLin: number;
  readonly wEE: number;
  /** The bend's curvature `(1 - morph) / R`. */
  readonly k: number;
  /** `(1 - morph) R`: the shift that puts the globe's centre back on the origin. */
  readonly shift: number;
}

/**
 * How much wider (and taller) the material's Equal Earth map is than the unit form of the projection: `pi / rawXMax`, about
 * 1.1607. The same constant as `PLANET_MAP_EQUAL_EARTH_SCALE` in `triangular-engine/planet-material`.
 */
export const MORPH_EQUAL_EARTH_SCALE = MORPH_EE.M * MORPH_EE.A1;

/** A {@link MorphMap} whose arrays are its own, for {@link setMorphWeights} and {@link MorphMapResolver} to write into. */
export function newMorphMap(): MorphMap {
  return { radius: 1, morph: 0, projection: 'equal-earth', basis: newProjectionBasis(), wLin: 1, wEE: 0, k: 0, shift: 0 };
}

/** A map with its numbers written: the scalars are the map's own fields, the basis is not touched. */
type WritableMorphMap = { -readonly [K in keyof MorphMap]: MorphMap[K] };

/**
 * Writes a map's morph, projection and radius, and the weights, curvature and shift that follow from them (the formulas of
 * {@link createMorphMap}). `morph` must already be clamped to 0..1. The basis is left as it is.
 */
export function setMorphWeights(out: MorphMap, morph: number, projection: MorphProjection, radius: number): void {
  const w = out as WritableMorphMap;
  const equalEarth = projection === 'equal-earth';
  w.radius = radius;
  w.morph = morph;
  w.projection = projection;
  w.wLin = equalEarth ? 1 - morph : 1;
  w.wEE = equalEarth ? morph * MORPH_EQUAL_EARTH_SCALE : 0;
  w.k = (1 - morph) / radius;
  w.shift = (1 - morph) * radius;
}

/** Resolves the settings for a planet of `radius` metres. `morph` is clamped to 0..1. */
export function createMorphMap(settings: LodMorphSettings, radius: number): MorphMap {
  const morph = Math.min(1, Math.max(0, settings.morph));
  const basis = settings.basis ?? projectionBasis(settings.projectionCentre?.lonDeg ?? 0, settings.projectionCentre?.latDeg ?? 0);
  const map: MorphMap = { radius, morph, projection: settings.projection, basis, wLin: 0, wEE: 0, k: 0, shift: 0 };
  setMorphWeights(map, morph, settings.projection, radius);
  return map;
}

/** Numbers that say which map a morph state is: the morph, equal-earth (1) or not, basis mode (1: the basis; 0: the centre), the centre, the basis. */
const MORPH_KEY_LENGTH = 14;

/** Writes the morph state of `source` as numbers into `out` (see {@link MORPH_KEY_LENGTH}); reads no object, allocates nothing. */
function readMorphKey(source: LodMorphSettings | MorphUniformsLike, out: Float64Array): void {
  if ('uMorph' in source) {
    // As `morphSettingsFromUniforms`: the basis when `uProjMode` is set, else the default centre (0, 0).
    out[0] = source.uMorph.value;
    out[1] = source.uProjectionType.value >= 0.5 ? 1 : 0;
    const basisMode = source.uProjMode.value >= 0.5;
    out[2] = basisMode ? 1 : 0;
    out[3] = 0;
    out[4] = 0;
    if (basisMode) {
      writeVec(out, 5, source.uProjForward.value);
      writeVec(out, 8, source.uProjUp.value);
      writeVec(out, 11, source.uProjRight.value);
    } else out.fill(0, 5, MORPH_KEY_LENGTH);
    return;
  }
  out[0] = source.morph;
  out[1] = source.projection === 'equal-earth' ? 1 : 0;
  if (source.basis) {
    out[2] = 1;
    out[3] = 0;
    out[4] = 0;
    writeVecArray(out, 5, source.basis.forward);
    writeVecArray(out, 8, source.basis.up);
    writeVecArray(out, 11, source.basis.right);
  } else {
    out[2] = 0;
    out[3] = source.projectionCentre?.lonDeg ?? 0;
    out[4] = source.projectionCentre?.latDeg ?? 0;
    out.fill(0, 5, MORPH_KEY_LENGTH);
  }
}

function writeVec(out: Float64Array, at: number, v: { readonly x: number; readonly y: number; readonly z: number }): void {
  out[at] = v.x;
  out[at + 1] = v.y;
  out[at + 2] = v.z;
}

function writeVecArray(out: Float64Array, at: number, v: readonly number[]): void {
  out[at] = v[0];
  out[at + 1] = v[1];
  out[at + 2] = v[2];
}

/** Writes the map that a key (from {@link readMorphKey}) and a radius describe into `out`, as {@link createMorphMap} would. */
function fillMorphMapFromKey(out: MorphMap, key: Float64Array, radius: number): void {
  const morph = Math.min(1, Math.max(0, key[0]));
  const projection: MorphProjection = key[1] >= 0.5 ? 'equal-earth' : 'equirectangular';
  const basis = out.basis;
  if (key[2] === 1) {
    for (let c = 0; c < 3; c++) {
      basis.forward[c] = key[5 + c];
      basis.up[c] = key[8 + c];
      basis.right[c] = key[11 + c];
    }
  } else projectionBasisInto(key[3], key[4], basis);
  setMorphWeights(out, morph, projection, radius);
}

/**
 * Resolves a morph state (the settings, or `<planet>`'s uniforms, read on each call) to a {@link MorphMap} without allocating per
 * call: the same map object is returned every time, and it is re-filled in place only when a number of the state (the morph, the
 * projection, the centre or basis, or the radius) differs from the last call's. A morph animation re-fills it every frame, at no
 * allocation cost. The map's contents are the ones {@link createMorphMap} gives for the same state; the object is the resolver's.
 */
export class MorphMapResolver {
  private readonly map = newMorphMap();
  private readonly last = new Float64Array(MORPH_KEY_LENGTH);
  private readonly next = new Float64Array(MORPH_KEY_LENGTH);
  private lastRadius = NaN;
  private filled = false;

  /** The map of `source` for a planet of `radius` metres: this resolver's own object, valid until the next call. */
  resolve(source: LodMorphSettings | MorphUniformsLike, radius: number): MorphMap {
    const next = this.next;
    const last = this.last;
    readMorphKey(source, next);
    let same = this.filled && radius === this.lastRadius;
    for (let k = 0; same && k < MORPH_KEY_LENGTH; k++) if (next[k] !== last[k]) same = false;
    if (same) return this.map;
    last.set(next);
    this.lastRadius = radius;
    this.filled = true;
    fillMorphMapFromKey(this.map, last, radius);
    return this.map;
  }
}

/** Scratch of {@link equalEarthRow}: every caller reads it at once, so it is not allocated per call. */
const EE_ROW = { c: 0, y: 0 };

/** Equal Earth on the unit sphere: `x = lon c(lat)` and `y`, the same as `planetEqualEarthRow`. The result is a shared object: read it before the next call. */
function equalEarthRow(lat: number): { c: number; y: number } {
  const E = MORPH_EE;
  const theta = Math.asin(Math.max(-1, Math.min(1, E.M * Math.sin(lat))));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  EE_ROW.c = Math.cos(theta) / (E.M * (E.A1 + 3 * E.A2 * t2 + t6 * (7 * E.A3 + 9 * E.A4 * t2)));
  EE_ROW.y = theta * (E.A1 + E.A2 * t2 + t6 * (E.A3 + E.A4 * t2));
  return EE_ROW;
}

/** The row factor `g = wLin + wEE c(lat)`: the map's x is `R lon g` and the row's half-width `pi R g`. */
export function morphRowFactor(lat: number, map: MorphMap): number {
  return map.wEE === 0 ? map.wLin : map.wLin + map.wEE * equalEarthRow(lat).c;
}

/**
 * Where the map puts the point at projected `lon`/`lat` (radians), metres from the map centre: `planetMapXY`. The operations and
 * their order are the same as `planetMapXY`'s, so the two agree bit for bit (`lod-morph-metric.spec.ts` checks it).
 */
export function morphMapXY(lon: number, lat: number, map: MorphMap, out: [number, number] = [0, 0]): [number, number] {
  if (map.wEE === 0) {
    // Equirectangular, or Equal Earth at morph 0: no row factor.
    out[0] = map.radius * lon * map.wLin;
    out[1] = map.radius * (map.wLin * lat);
    return out;
  }
  const row = equalEarthRow(lat);
  const scale = MORPH_EQUAL_EARTH_SCALE * map.radius;
  out[0] = map.radius * lon * map.wLin + lon * row.c * scale * map.morph;
  out[1] = map.radius * lat * map.wLin + row.y * scale * map.morph;
  return out;
}

/** The map point's longitude and latitude, the inverse of {@link morphMapXY}; a `y` past the poles gives the pole, an `x` past the row's edge a longitude past pi. */
export function morphMapInverse(x: number, y: number, map: MorphMap, out: { lon: number; lat: number } = { lon: 0, lat: 0 }): { lon: number; lat: number } {
  let lat: number;
  if (map.wEE === 0) lat = Math.min(HALF_PI, Math.max(-HALF_PI, y / (map.radius * map.wLin)));
  else {
    let lo = -HALF_PI;
    let hi = HALF_PI;
    for (let it = 0; it < 64; it++) {
      const mid = 0.5 * (lo + hi);
      if (map.radius * (map.wLin * mid + map.wEE * equalEarthRow(mid).y) < y) lo = mid;
      else hi = mid;
    }
    lat = 0.5 * (lo + hi);
  }
  out.lat = lat;
  out.lon = x / (map.radius * morphRowFactor(lat, map));
  return out;
}

/** Half the map's width at latitude `lat`, metres: `planetMapRowHalfWidth`. */
export function morphRowHalfWidth(lat: number, map: MorphMap): number {
  return Math.PI * map.radius * morphRowFactor(lat, map);
}

/** The map's outline extents: the equator's half-width and the poles' `y`, `planetMapExtents`. */
export function morphExtents(map: MorphMap): { halfWidth: number; halfHeight: number } {
  return { halfWidth: Math.PI * map.radius, halfHeight: halfHeightOf(map) };
}

/** The pole's `y` on the map (`morphExtents().halfHeight`), without the object. */
function halfHeightOf(map: MorphMap): number {
  return map.radius * (map.wLin * HALF_PI + (map.wEE === 0 ? 0 : map.wEE * equalEarthRow(HALF_PI).y));
}

// -- the bend ------------------------------------------------------------------------------------------------------

const sinc = (x: number): number => (Math.abs(x) < 1e-4 ? 1 - (x * x) / 6 : Math.sin(x) / x);

/** A point of the bent ground in the map frame and its unit normal. */
export interface MorphBentPoint {
  readonly position: Vec3;
  readonly normal: Vec3;
}

/**
 * Where the map point `(x, y)` sits on the bent ground (curvature `k`), with `height` along the normal: `bend` of
 * `triangular-engine/atmosphere`. `k = 0` gives `(x, y, height)`.
 */
export function bendPoint(x: number, y: number, k: number, height = 0): MorphBentPoint {
  return bendPointInto(x, y, k, height, { position: [0, 0, 0], normal: [0, 0, 0] });
}

/** {@link bendPoint} written into `out` (its `position` and `normal`), without allocating: for loops over many points. */
export function bendPointInto(x: number, y: number, k: number, height: number, out: { position: Vec3; normal: Vec3 }): MorphBentPoint {
  const kx = k * x;
  const ky = k * y;
  const cx = Math.cos(kx);
  const cy = Math.cos(ky);
  const normal = out.normal;
  normal[0] = cy * Math.sin(kx);
  normal[1] = Math.sin(ky);
  normal[2] = cx * cy;
  const sx = sinc(kx / 2);
  const sy = sinc(ky / 2);
  const z = -(0.5 * k * x * x * sx * sx + cx * 0.5 * k * y * y * sy * sy);
  const position = out.position;
  position[0] = cy * x * sinc(kx) + height * normal[0];
  position[1] = y * sinc(ky) + height * normal[1];
  position[2] = z + height * normal[2];
  return out;
}

/** The inverse of {@link bendPoint}: the map point and the height of a point of the map frame. */
export function unbendPoint(p: Vec3, k: number): { x: number; y: number; height: number } {
  return unbendPointInto(p, k, { x: 0, y: 0, height: 0 }, [0, 0, 0]);
}

/**
 * {@link unbendPoint} written into `out`, with the bent normal written into `normalOut` as scratch: no allocation. Returns `out`.
 */
export function unbendPointInto(p: Vec3, k: number, out: { x: number; y: number; height: number }, normalOut: Vec3): { x: number; y: number; height: number } {
  if (k === 0) {
    out.x = p[0];
    out.y = p[1];
    out.height = p[2];
    return out;
  }
  const q = k * dot(p, p) + 2 * p[2];
  const root = Math.sqrt(1 + k * q);
  const normal = normalOut;
  normal[0] = (k * p[0]) / root;
  normal[1] = (k * p[1]) / root;
  normal[2] = (k * p[2] + 1) / root;
  out.x = Math.atan2(normal[0], normal[2]) / k;
  out.y = Math.asin(Math.max(-1, Math.min(1, normal[1]))) / k;
  out.height = q / (1 + root);
  return out;
}

// -- frames ---------------------------------------------------------------------------------------------------------

/** A map-frame vector in the body frame (no shift): `right x + up y + forward z`. */
export function mapVectorToBody(basis: MorphBasis, v: readonly number[]): Vec3 {
  return [0, 1, 2].map((i) => basis.right[i] * v[0] + basis.up[i] * v[1] + basis.forward[i] * v[2]) as Vec3;
}

/** A body-frame position in the map frame: the inverse of the bend's frame change, including the shift. */
export function bodyToMap(map: MorphMap, p: readonly number[], out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = dot(p, map.basis.right);
  out[1] = dot(p, map.basis.up);
  out[2] = dot(p, map.basis.forward) - map.shift;
  return out;
}

/** Unit direction (body frame) of a longitude and latitude in the projection basis. */
export function directionOf(basis: MorphBasis, lon: number, lat: number): Vec3 {
  return directionInto(basis, lon, lat, [0, 0, 0]);
}

/** {@link directionOf} written into `out`, without allocating. Returns `out`. */
export function directionInto(basis: MorphBasis, lon: number, lat: number, out: Vec3): Vec3 {
  const cl = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const sinLat = Math.sin(lat);
  for (let i = 0; i < 3; i++) out[i] = basis.right[i] * cl * sinLon + basis.up[i] * sinLat + basis.forward[i] * cl * cosLon;
  return out;
}

/** The unit direction of a face lattice point, in doubles, from the exact integer cube-lattice vector. */
export function latticeDirection(face: number, u: number, v: number, steps: number, domain: LodDomain): Vec3 {
  const t = cubeLattice(face, u, v, steps);
  return normalised([cubeComponent(t[0], steps, domain.warp), cubeComponent(t[1], steps, domain.warp), cubeComponent(t[2], steps, domain.warp)]);
}

/** The window of a leaf side `sigma` (+-1): longitudes in (sigma pi / 2 - pi, sigma pi / 2 + pi]; returns lon + 2 pi n. */
export function unwrapToSide(lon: number, sigma: number): { lon: number; n: number } {
  const lo = sigma * HALF_PI - Math.PI;
  const n = Math.floor((lo - lon) / TWO_PI) + 1;
  return { lon: lon + TWO_PI * n, n };
}

/** The side (+-1) a leaf takes from the longitude of its centre in the projection basis. */
export function leafSide(basis: MorphBasis, unitCentre: Vec3): 1 | -1 {
  return Math.atan2(dot(unitCentre, basis.right), dot(unitCentre, basis.forward)) >= 0 ? 1 : -1;
}

/** Scratch of {@link unbendPosition} (it is synchronous, so one set per module is enough). */
const UNBEND_MAP_POINT: Vec3 = [0, 0, 0];
const UNBEND_NORMAL: Vec3 = [0, 0, 0];
const UNBEND_BENT = { x: 0, y: 0, height: 0 };
const UNBEND_AT = { lon: 0, lat: 0 };
const UNBEND_UNIT: Vec3 = [0, 0, 0];

/**
 * Where a camera at body (= scene) position `scene` stands on the unbent globe: its longitude and latitude in the projection
 * basis, its height above the base sphere, and the unbent position `unit * (R + height)` that the selector and the lattice
 * anchor see. A camera past a pole or beyond the map's edge gets the nearest pole's latitude or a longitude past pi.
 * Pass `out` to allocate nothing (the per-frame callers do).
 */
export function unbendPosition(map: MorphMap, scene: readonly number[], out?: { lon: number; lat: number; height: number; position: Vec3 }): {
  lon: number;
  lat: number;
  height: number;
  position: Vec3;
} {
  const result = out ?? { lon: 0, lat: 0, height: 0, position: [0, 0, 0] as Vec3 };
  // Scratch of this function (synchronous, so one set per module is enough): with `out` given, no allocation.
  const p = bodyToMap(map, scene, UNBEND_MAP_POINT);
  const bent = unbendPointInto(p, map.k, UNBEND_BENT, UNBEND_NORMAL);
  const at = morphMapInverse(bent.x, bent.y, map, UNBEND_AT);
  result.lon = at.lon;
  result.lat = at.lat;
  result.height = bent.height;
  const unit = directionInto(map.basis, at.lon, at.lat, UNBEND_UNIT);
  const r = map.radius + bent.height;
  result.position[0] = unit[0] * r;
  result.position[1] = unit[1] * r;
  result.position[2] = unit[2] * r;
  return result;
}

// -- the per-frame anchor ---------------------------------------------------------------------------------------------

/** Everything the vertex stage needs for one frame, in doubles. */
export interface MorphFrame {
  readonly map: MorphMap;
  /** The camera's scene position (the bent camera) the frame was computed for. */
  readonly camBody: Vec3;
  /** The bent camera in the map frame. */
  readonly camMap: Vec3;
  /** The camera's longitude and latitude in the projection basis and its height above the base sphere. */
  readonly lambdaC: number;
  readonly phiC: number;
  readonly heightC: number;
  /** The camera's unbent position (sphere, body frame): what the selector and the lattice anchor see. */
  readonly selectorCamera: Vec3;
  /** The lattice anchor (`anchorFor` of the unbent camera). */
  readonly anchor: LatticeAnchor;
  /** The anchor's unit direction: the float cube point of the anchor, normalised, in doubles. */
  readonly anchorDir: Vec3;
  /** The P2 anchor values. */
  readonly values: MorphAnchor<number>;
  /** The anchor's distances to the map's edges (doubles), see {@link outlineOf}. */
  readonly outline: MorphOutline<number>;
  /** The lattice vectors T of the basis' two poles (up, down) when they are lattice vertices, else undefined: the vertices that take their leaf's own longitude. */
  readonly poles: readonly [Vec3 | undefined, Vec3 | undefined];
}

/** The pole (`sign` +1 up, -1 down) as the lattice stage's origin: its continuous lattice vector and the cube point values. */
export interface PoleOrigin {
  /** The pole's cube-lattice vector T (not an integer unless the pole is a lattice vertex). */
  readonly t: Vec3;
  /** Cube point as float32, exact minus float32, and cos(pi/4 T_k / L). */
  readonly cube: Vec3;
  readonly error: Vec3;
  readonly cos: Vec3;
  /** The float32 origin direction (cube normalised) minus the exact pole direction, doubles. */
  readonly bias: Vec3;
  /** True when every component of `t` is an integer, so a vertex of the mesh sits on the pole. */
  readonly isVertex: boolean;
}

/** A pole origin with its own arrays, for {@link poleOriginInto} to fill. */
export function newPoleOrigin(): PoleOrigin {
  return { t: [0, 0, 0], cube: [0, 0, 0], error: [0, 0, 0], cos: [0, 0, 0], bias: [0, 0, 0], isVertex: false };
}

/** The lattice coordinate of a cube component `x` (the pole's direction in its face's frame): `pi/4`-warped for an equal-angle cube. */
function poleLatticeCoord(x: number, warped: boolean, steps: number): number {
  return Math.abs(x) >= 1 ? Math.sign(x) * steps : warped ? (Math.atan(x) / (Math.PI / 4)) * steps : x * steps;
}

/**
 * {@link poleOrigin} written into `out` (all its arrays overwritten; the same arithmetic). Returns `out`.
 */
export function poleOriginInto(basis: MorphBasis, sign: 1 | -1, domain: LodDomain, steps: number, out: PoleOrigin): PoleOrigin {
  const d0 = basis.up[0] * sign;
  const d1 = basis.up[1] * sign;
  const d2 = basis.up[2] * sign;
  const m = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));
  const c0 = d0 / m;
  const c1 = d1 / m;
  const c2 = d2 / m;
  const warped = domain.warp !== 'none';
  const t0 = poleLatticeCoord(c0, warped, steps);
  const t1 = poleLatticeCoord(c1, warped, steps);
  const t2 = poleLatticeCoord(c2, warped, steps);
  const cube0 = Math.fround(c0);
  const cube1 = Math.fround(c1);
  const cube2 = Math.fround(c2);
  const t = out.t;
  t[0] = t0;
  t[1] = t1;
  t[2] = t2;
  const cube = out.cube;
  cube[0] = cube0;
  cube[1] = cube1;
  cube[2] = cube2;
  const error = out.error;
  error[0] = c0 - cube0;
  error[1] = c1 - cube1;
  error[2] = c2 - cube2;
  const cos = out.cos;
  cos[0] = warped ? Math.cos(((Math.PI / 4) * t0) / steps) : 1;
  cos[1] = warped ? Math.cos(((Math.PI / 4) * t1) / steps) : 1;
  cos[2] = warped ? Math.cos(((Math.PI / 4) * t2) / steps) : 1;
  (out as { isVertex: boolean }).isVertex = Math.abs(t0 - Math.round(t0)) < 1e-6 && Math.abs(t1 - Math.round(t1)) < 1e-6 && Math.abs(t2 - Math.round(t2)) < 1e-6;
  const l = Math.hypot(cube0, cube1, cube2);
  const bias = out.bias;
  bias[0] = cube0 / l - d0;
  bias[1] = cube1 / l - d1;
  bias[2] = cube2 / l - d2;
  return out;
}

/** The lattice origin of the basis' pole `sign * up`. */
export function poleOrigin(basis: MorphBasis, sign: 1 | -1, domain: LodDomain, steps: number): PoleOrigin {
  return poleOriginInto(basis, sign, domain, steps, newPoleOrigin());
}

/**
 * The anchor's distances to the map's edges in doubles, written into `out`: `right[n]` = pi - lamA - 2 pi n and `left[n]` = pi + lamA + 2 pi n
 * for the unwrap integers n = -OUTLINE_WRAP ... OUTLINE_WRAP (at index `n + OUTLINE_WRAP`), and halfHeight -+ yA. The whole turns are
 * subtracted here, where a double keeps the small remainder. Returns `out`.
 */
export function outlineOfInto(lamA: number, yA: number, map: MorphMap, out: MorphOutline<number>): MorphOutline<number> {
  const halfHeight = halfHeightOf(map);
  for (let n = -OUTLINE_WRAP; n <= OUTLINE_WRAP; n++) {
    out.right[n + OUTLINE_WRAP] = Math.PI - lamA - TWO_PI * n;
    out.left[n + OUTLINE_WRAP] = Math.PI + lamA + TWO_PI * n;
  }
  out.top = halfHeight - yA;
  out.bottom = halfHeight + yA;
  return out;
}

/** The anchor's distances to the map's edges in doubles (see {@link outlineOfInto}). */
export function outlineOf(lamA: number, yA: number, map: MorphMap): MorphOutline<number> {
  const n = 2 * OUTLINE_WRAP + 1;
  return outlineOfInto(lamA, yA, map, { right: new Array<number>(n).fill(0), left: new Array<number>(n).fill(0), top: 0, bottom: 0 });
}

/** Signed distances (metres, inside positive) of a map point to the edges right, left, top, bottom, in doubles: the reference of the vertex stage's `outlineDistances`. */
export function outlineDistancesAt(lon: number, lat: number, map: MorphMap): [number, number, number, number] {
  const [x, y] = morphMapXY(lon, lat, map);
  const halfWidth = morphRowHalfWidth(lat, map);
  const halfHeight = morphExtents(map).halfHeight;
  return [halfWidth - x, halfWidth + x, halfHeight - y, halfHeight + y];
}

/** The arrays and objects of a frame, for the typed writes of {@link computeMorphFrame} (the interfaces are read-only). */
type MutableFrame = { -readonly [K in keyof MorphFrame]: MorphFrame[K] };
type MutableAnchor = { -readonly [K in keyof MorphAnchor<number>]: MorphAnchor<number>[K] };

/** Scratch of {@link computeMorphFrame}: it runs synchronously, so one set per module is enough. */
/** {@link computeMorphFrame} keeps the scene position as the unbent camera when the unbend-and-bend round trip moves it by more than this share of its distance from the centre. */
const MORPH_FRAME_ROUND_TRIP_TOLERANCE = 1e-3;
const FRAME_UNBENT ={ lon: 0, lat: 0, height: 0, position: [0, 0, 0] as Vec3 };
const FRAME_XY: [number, number] = [0, 0];
const FRAME_GROUND = { position: [0, 0, 0] as Vec3, normal: [0, 0, 0] as Vec3 };
const FRAME_POLE_UP = newPoleOrigin();
const FRAME_POLE_DOWN = newPoleOrigin();

/**
 * A frame with arrays of its own, all zero (or the default basis), for {@link computeMorphFrame} to fill. Reuse one per mesh: a frame
 * written in place keeps its arrays, so a frame a morph animation fills each frame allocates nothing.
 */
export function newMorphFrame(): MorphFrame {
  const basis = newProjectionBasis();
  const values: MutableAnchor = {
    bRight: basis.right, bUp: basis.up, bForward: basis.forward,
    wLin: 1, wEE: 0, radius: 1, k: 0,
    sA: 0, cA: 0, omsA: 0, opsA: 0, vA1: 0, vA2: 0, nA2: 0, lamA: 0,
    thA: 0, tA: 0, uA: 0, cosThA: 0, QA: 0, BA: 0, gA: 0,
    sinAA: 0, cosAA: 0, sinBA: 0, cosBA: 0,
    upA: [0, 0, 0], garel: [0, 0, 0],
    poleOn: 0, poleDs: 0,
    poleHi: [0, 0, 0], poleLo: [0, 0, 0], poleCube: [0, 0, 0], poleError: [0, 0, 0], poleCos: [1, 1, 1], poleBias: [0, 0, 0],
  };
  return {
    map: newMorphMap(),
    camBody: [0, 0, 0],
    camMap: [0, 0, 0],
    lambdaC: 0,
    phiC: 0,
    heightC: 0,
    selectorCamera: [0, 0, 0],
    anchor: newAnchor(),
    anchorDir: [0, 0, 0],
    values,
    outline: { right: new Array<number>(2 * OUTLINE_WRAP + 1).fill(0), left: new Array<number>(2 * OUTLINE_WRAP + 1).fill(0), top: 0, bottom: 0 },
    poles: [undefined, undefined],
  };
}

/** Writes pole `origin`'s lattice vector, rounded, into `poles[index]` (or leaves it undefined when the pole is not a lattice vertex). */
function setPoleVertex(poles: [Vec3 | undefined, Vec3 | undefined], index: number, origin: PoleOrigin): void {
  if (!origin.isVertex) {
    poles[index] = undefined;
    return;
  }
  const v = poles[index] ?? (poles[index] = [0, 0, 0]);
  for (let c = 0; c < 3; c++) v[c] = Math.round(origin.t[c]);
}

/**
 * One frame: the lattice anchor of the camera's unbent position, and every anchor value of P2 in doubles. `scene` is the camera's
 * body (= scene) position, the bent camera; `steps` is the lattice size of the selector's patch cells; `anchorOut` is reused when given.
 * `out` is filled in place and returned (default: a new frame from {@link newMorphFrame}); pass the frame of the last call to allocate nothing.
 */
export function computeMorphFrame(
  map: MorphMap, domain: LodDomain, steps: number, scene: readonly number[], anchorOut: LatticeAnchor = newAnchor(), out: MorphFrame = newMorphFrame(),
): MorphFrame {
  const { radius: R, basis, k } = map;
  const f = out as MutableFrame;
  const camBody = f.camBody as Vec3;
  camBody[0] = scene[0];
  camBody[1] = scene[1];
  camBody[2] = scene[2];
  const camMap = bodyToMap(map, camBody, f.camMap as Vec3);
  const unbent = unbendPosition(map, camBody, FRAME_UNBENT);
  // The unbend is exact (unbend and bend use the same map) except where it clamps: a camera past the map's edge or over a pole gets
  // the nearest edge point or the pole itself. A pole has no longitude, so an anchor there collapses every vertex onto one meridian:
  // keep the scene position as the unbent camera then (the metric's `placeCamera` does the same for the selector).
  const [rx, ry] = morphMapXY(unbent.lon, unbent.lat, map, FRAME_XY);
  const back = bendPointInto(rx, ry, k, unbent.height, FRAME_GROUND).position;
  if (Math.hypot(back[0] - camMap[0], back[1] - camMap[1], back[2] - camMap[2]) > 1 + MORPH_FRAME_ROUND_TRIP_TOLERANCE * Math.hypot(camMap[0], camMap[1], camMap[2])) {
    const r = Math.hypot(camBody[0], camBody[1], camBody[2]) || 1;
    const ux = camBody[0] / r;
    const uy = camBody[1] / r;
    const uz = camBody[2] / r;
    unbent.lon = Math.atan2(ux * basis.right[0] + uy * basis.right[1] + uz * basis.right[2], ux * basis.forward[0] + uy * basis.forward[1] + uz * basis.forward[2]);
    unbent.lat = Math.asin(Math.max(-1, Math.min(1, ux * basis.up[0] + uy * basis.up[1] + uz * basis.up[2])));
    unbent.height = r - R;
    unbent.position[0] = camBody[0];
    unbent.position[1] = camBody[1];
    unbent.position[2] = camBody[2];
  }
  const lambdaC = unbent.lon;
  const selectorCamera = f.selectorCamera as Vec3;
  selectorCamera[0] = unbent.position[0];
  selectorCamera[1] = unbent.position[1];
  selectorCamera[2] = unbent.position[2];
  const anchor = anchorFor(domain, selectorCamera, steps, anchorOut);

  // The anchor direction: the lattice anchor's float cube point, normalised (the shader's own anchor).
  const anchorDir = f.anchorDir as Vec3;
  const cubeLength = Math.hypot(anchor.cube[0], anchor.cube[1], anchor.cube[2]);
  anchorDir[0] = anchor.cube[0] / cubeLength;
  anchorDir[1] = anchor.cube[1] / cubeLength;
  anchorDir[2] = anchor.cube[2] / cubeLength;
  const sA = dot(anchorDir, basis.up);
  const v1 = dot(anchorDir, basis.forward);
  const v2 = dot(anchorDir, basis.right);
  const cA = Math.hypot(v1, v2);
  const lam0 = Math.atan2(v2, v1);
  const lamA = lam0 + TWO_PI * Math.round((lambdaC - lam0) / TWO_PI);
  const phiA = Math.atan2(sA, cA);
  const omsA = sA >= 0 ? (cA * cA) / (1 + sA) : 1 - sA;
  const opsA = sA <= 0 ? (cA * cA) / (1 - sA) : 1 + sA;

  // Equal Earth at the anchor (also computed for equirectangular, where wEE = 0 switches it off).
  const E = MORPH_EE;
  const uA = E.M * sA;
  const thA = Math.asin(uA);
  const cosThA = Math.sqrt(1 - uA * uA);
  const tA = thA * thA;
  const t3 = tA * tA * tA;
  const t4 = t3 * tA;
  const QA = E.A1 + E.A2 * tA + E.A3 * t3 + E.A4 * t4;
  const BA = E.M * (E.A1 + 3 * E.A2 * tA + 7 * E.A3 * t3 + 9 * E.A4 * t4);
  const gA = map.wLin + (map.wEE * cosThA) / BA;

  // The anchor's map point and the bend there.
  const XY = FRAME_XY;
  morphMapXY(lamA, phiA, map, XY);
  const xA = XY[0];
  const yA = XY[1];
  const aA = k * xA;
  const bA = k * yA;
  const groundA = bendPointInto(xA, yA, k, 0, FRAME_GROUND);
  const values = f.values as MutableAnchor;
  const garel = values.garel as Vec3;
  for (let c = 0; c < 3; c++) garel[c] = groundA.position[c] - camMap[c];

  // The pole nearer the anchor, as a second lattice origin: its lattice vector as hi + lo (the vertex stage forms (T - hi) - lo, which is exact near the pole).
  const sign: 1 | -1 = sA >= 0 ? 1 : -1;
  const poleUp = poleOriginInto(basis, 1, domain, steps, FRAME_POLE_UP);
  const poleDown = poleOriginInto(basis, -1, domain, steps, FRAME_POLE_DOWN);
  const pole = sign === 1 ? poleUp : poleDown;
  const poleHi = values.poleHi as Vec3;
  const poleLo = values.poleLo as Vec3;
  for (let c = 0; c < 3; c++) poleHi[c] = Math.fround(pole.t[c]);
  for (let c = 0; c < 3; c++) poleLo[c] = Math.fround(pole.t[c] - poleHi[c]);
  const poleCube = values.poleCube as Vec3;
  const poleError = values.poleError as Vec3;
  const poleCos = values.poleCos as Vec3;
  const poleBias = values.poleBias as Vec3;
  const upA = values.upA as Vec3;
  for (let c = 0; c < 3; c++) {
    poleCube[c] = pole.cube[c];
    poleError[c] = pole.error[c];
    poleCos[c] = pole.cos[c];
    poleBias[c] = pole.bias[c];
    upA[c] = groundA.normal[c];
  }

  values.bRight = basis.right;
  values.bUp = basis.up;
  values.bForward = basis.forward;
  values.wLin = map.wLin;
  values.wEE = map.wEE;
  values.radius = R;
  values.k = k;
  values.sA = sA;
  values.cA = cA;
  values.omsA = omsA;
  values.opsA = opsA;
  values.vA1 = v1;
  values.vA2 = v2;
  values.nA2 = v1 * v1 + v2 * v2;
  values.lamA = lamA;
  values.thA = thA;
  values.tA = tA;
  values.uA = uA;
  values.cosThA = cosThA;
  values.QA = QA;
  values.BA = BA;
  values.gA = gA;
  values.sinAA = Math.sin(aA);
  values.cosAA = Math.cos(aA);
  values.sinBA = Math.sin(bA);
  values.cosBA = Math.cos(bA);
  values.poleOn = map.morph > 0 ? 1 : 0;
  values.poleDs = sign === 1 ? omsA : -opsA;

  outlineOfInto(lamA, yA, map, f.outline);
  const poles = f.poles as [Vec3 | undefined, Vec3 | undefined];
  setPoleVertex(poles, 0, poleUp);
  setPoleVertex(poles, 1, poleDown);
  f.map = map;
  f.lambdaC = lambdaC;
  f.phiC = unbent.lat;
  f.heightC = unbent.height;
  f.anchor = anchor;
  return out;
}

// -- the reference vertex ---------------------------------------------------------------------------------------------

/** A vertex's reference position (doubles) and where it sits in the projection. */
export interface ReferenceVertex {
  /** Camera-relative position, body frame. */
  readonly rel: Vec3;
  /** Longitude (in the leaf's side window) and latitude in the projection basis, radians. */
  readonly lon: number;
  readonly lat: number;
  /** The vertex stage's unwrap integer: turns added to the longitude continued from the anchor's. */
  readonly n: number;
}

/**
 * The reference position of the vertex at unit direction `unit` (doubles), on the side `sigma`, at `height` above the base
 * surface: lon, lat in the basis, the map, the bend of the map point with the given height, minus the bent camera.
 * `poleLon` is given for the exact pole vertex, which has no longitude of its own: the vertex stage places it at its leaf's centre
 * longitude (`poleVertexLongitude`), already inside the side's window, and the reference does the same. `leafLon` is the leaf's centre
 * longitude: the other vertices are placed within pi of it.
 */
export function referenceVertex(frame: MorphFrame, unit: Vec3, sigma: number, height: number, poleLon?: number, leafLon?: number): ReferenceVertex {
  const { map } = frame;
  const { basis } = map;
  const v1 = dot(unit, basis.forward);
  const v2 = dot(unit, basis.right);
  const lat = Math.atan2(dot(unit, basis.up), Math.hypot(v1, v2));
  const principal = Math.atan2(v2, v1);
  // `leafLon` places the vertex within pi of the leaf's own centre longitude (the vertex stage's placement); without it the side's window does.
  let side: { lon: number; n: number };
  if (poleLon !== undefined) side = { lon: poleLon, n: 0 };
  else if (leafLon !== undefined) {
    const turns = Math.round((leafLon - principal) / TWO_PI);
    side = { lon: principal + TWO_PI * turns, n: turns };
  } else side = unwrapToSide(principal, sigma);
  // The vertex stage continues the longitude from the anchor's (unwrapped near the camera), so its integer counts the turns
  // added on top of that continuation: the window's turns from the principal longitude, minus the continuation's.
  const continuation = poleLon === undefined ? Math.round((frame.values.lamA - principal) / TWO_PI) : 0;
  const [x, y] = morphMapXY(side.lon, lat, map);
  const bent = bendPoint(x, y, map.k, height).position;
  const relMap = [bent[0] - frame.camMap[0], bent[1] - frame.camMap[1], bent[2] - frame.camMap[2]];
  return { rel: mapVectorToBody(basis, relMap), lon: side.lon, lat, n: side.n - continuation };
}
