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
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalised = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** `setPlanetProjectionCentre`'s basis, in doubles. */
export function projectionBasis(lonDeg: number, latDeg: number): MorphBasis {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const forward: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  let up: Vec3 = [-forward[1] * forward[0], 1 - forward[1] * forward[1], -forward[1] * forward[2]];
  if (up[0] * up[0] + up[1] * up[1] + up[2] * up[2] < 1e-8) up = [0, 0, forward[1] > 0 ? -1 : 1];
  up = normalised(up);
  return { forward, up, right: cross(up, forward) };
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

/** Resolves the settings for a planet of `radius` metres. `morph` is clamped to 0..1. */
export function createMorphMap(settings: LodMorphSettings, radius: number): MorphMap {
  const morph = Math.min(1, Math.max(0, settings.morph));
  const basis = settings.basis ?? projectionBasis(settings.projectionCentre?.lonDeg ?? 0, settings.projectionCentre?.latDeg ?? 0);
  const equalEarth = settings.projection === 'equal-earth';
  return {
    radius,
    morph,
    projection: settings.projection,
    basis,
    wLin: equalEarth ? 1 - morph : 1,
    wEE: equalEarth ? morph * MORPH_EQUAL_EARTH_SCALE : 0,
    k: (1 - morph) / radius,
    shift: (1 - morph) * radius,
  };
}

/** Equal Earth on the unit sphere: `x = lon c(lat)` and `y`, the same as `planetEqualEarthRow`. */
function equalEarthRow(lat: number): { c: number; y: number } {
  const E = MORPH_EE;
  const theta = Math.asin(Math.max(-1, Math.min(1, E.M * Math.sin(lat))));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return {
    c: Math.cos(theta) / (E.M * (E.A1 + 3 * E.A2 * t2 + t6 * (7 * E.A3 + 9 * E.A4 * t2))),
    y: theta * (E.A1 + E.A2 * t2 + t6 * (E.A3 + E.A4 * t2)),
  };
}

/** The row factor `g = wLin + wEE c(lat)`: the map's x is `R lon g` and the row's half-width `pi R g`. */
export function morphRowFactor(lat: number, map: MorphMap): number {
  return map.wEE === 0 ? map.wLin : map.wLin + map.wEE * equalEarthRow(lat).c;
}

/** Where the map puts the point at projected `lon`/`lat` (radians), metres from the map centre: `planetMapXY`. */
export function morphMapXY(lon: number, lat: number, map: MorphMap, out: [number, number] = [0, 0]): [number, number] {
  const row = map.wEE === 0 ? { c: 0, y: 0 } : equalEarthRow(lat);
  out[0] = map.radius * lon * (map.wLin + map.wEE * row.c);
  out[1] = map.radius * (map.wLin * lat + map.wEE * row.y);
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
  return {
    halfWidth: Math.PI * map.radius,
    halfHeight: map.radius * (map.wLin * HALF_PI + (map.wEE === 0 ? 0 : map.wEE * equalEarthRow(HALF_PI).y)),
  };
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
  const kx = k * x;
  const ky = k * y;
  const cx = Math.cos(kx);
  const cy = Math.cos(ky);
  const normal: Vec3 = [cy * Math.sin(kx), Math.sin(ky), cx * cy];
  const sx = sinc(kx / 2);
  const sy = sinc(ky / 2);
  const z = -(0.5 * k * x * x * sx * sx + cx * 0.5 * k * y * y * sy * sy);
  return {
    position: [cy * x * sinc(kx) + height * normal[0], y * sinc(ky) + height * normal[1], z + height * normal[2]],
    normal,
  };
}

/** The inverse of {@link bendPoint}: the map point and the height of a point of the map frame. */
export function unbendPoint(p: Vec3, k: number): { x: number; y: number; height: number } {
  if (k === 0) return { x: p[0], y: p[1], height: p[2] };
  const q = k * dot(p, p) + 2 * p[2];
  const root = Math.sqrt(1 + k * q);
  const normal: Vec3 = [(k * p[0]) / root, (k * p[1]) / root, (k * p[2] + 1) / root];
  return { x: Math.atan2(normal[0], normal[2]) / k, y: Math.asin(Math.max(-1, Math.min(1, normal[1]))) / k, height: q / (1 + root) };
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
  const cl = Math.cos(lat);
  return [0, 1, 2].map((i) => basis.right[i] * cl * Math.sin(lon) + basis.up[i] * Math.sin(lat) + basis.forward[i] * cl * Math.cos(lon)) as Vec3;
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

/**
 * Where a camera at body (= scene) position `scene` stands on the unbent globe: its longitude and latitude in the projection
 * basis, its height above the base sphere, and the unbent position `unit * (R + height)` that the selector and the lattice
 * anchor see. A camera past a pole or beyond the map's edge gets the nearest pole's latitude or a longitude past pi.
 */
export function unbendPosition(map: MorphMap, scene: readonly number[], out?: { lon: number; lat: number; height: number; position: Vec3 }): {
  lon: number;
  lat: number;
  height: number;
  position: Vec3;
} {
  const result = out ?? { lon: 0, lat: 0, height: 0, position: [0, 0, 0] as Vec3 };
  const p = bodyToMap(map, scene);
  const bent = unbendPoint(p, map.k);
  const at = morphMapInverse(bent.x, bent.y, map);
  result.lon = at.lon;
  result.lat = at.lat;
  result.height = bent.height;
  const unit = directionOf(map.basis, at.lon, at.lat);
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

/** The lattice origin of the basis' pole `sign * up`. */
export function poleOrigin(basis: MorphBasis, sign: 1 | -1, domain: LodDomain, steps: number): PoleOrigin {
  const dir: Vec3 = [basis.up[0] * sign, basis.up[1] * sign, basis.up[2] * sign];
  const m = Math.max(Math.abs(dir[0]), Math.abs(dir[1]), Math.abs(dir[2]));
  const c: Vec3 = [dir[0] / m, dir[1] / m, dir[2] / m];
  const warped = domain.warp !== 'none';
  const t = c.map((x) => (Math.abs(x) >= 1 ? Math.sign(x) * steps : warped ? (Math.atan(x) / (Math.PI / 4)) * steps : x * steps)) as Vec3;
  const cube = c.map(Math.fround) as Vec3;
  const error = c.map((x, k) => x - cube[k]) as Vec3;
  const cos = t.map((x) => (warped ? Math.cos(((Math.PI / 4) * x) / steps) : 1)) as Vec3;
  const isVertex = t.every((x) => Math.abs(x - Math.round(x)) < 1e-6);
  const unitCube = normalised(cube);
  const bias: Vec3 = [unitCube[0] - dir[0], unitCube[1] - dir[1], unitCube[2] - dir[2]];
  return { t, cube, error, cos, bias, isVertex };
}

/** The anchor's distances to the map's edges in doubles: `right[n]` = pi - lamA - 2 pi n and `left[n]` = pi + lamA + 2 pi n for the unwrap integers n = -OUTLINE_WRAP ... OUTLINE_WRAP, and halfHeight -+ yA. The whole turns are subtracted here, where a double keeps the small remainder. */
export function outlineOf(lamA: number, yA: number, map: MorphMap): MorphOutline<number> {
  const halfHeight = morphExtents(map).halfHeight;
  const right: number[] = [];
  const left: number[] = [];
  for (let n = -OUTLINE_WRAP; n <= OUTLINE_WRAP; n++) {
    right.push(Math.PI - lamA - TWO_PI * n);
    left.push(Math.PI + lamA + TWO_PI * n);
  }
  return { right, left, top: halfHeight - yA, bottom: halfHeight + yA };
}

/** Signed distances (metres, inside positive) of a map point to the edges right, left, top, bottom, in doubles: the reference of the vertex stage's `outlineDistances`. */
export function outlineDistancesAt(lon: number, lat: number, map: MorphMap): [number, number, number, number] {
  const [x, y] = morphMapXY(lon, lat, map);
  const halfWidth = morphRowHalfWidth(lat, map);
  const halfHeight = morphExtents(map).halfHeight;
  return [halfWidth - x, halfWidth + x, halfHeight - y, halfHeight + y];
}

/**
 * One frame: the lattice anchor of the camera's unbent position, and every anchor value of P2 in doubles. `scene` is the camera's
 * body (= scene) position, the bent camera; `steps` is the lattice size of the selector's patch cells; `anchorOut` is reused when given.
 */
export function computeMorphFrame(map: MorphMap, domain: LodDomain, steps: number, scene: readonly number[], anchorOut: LatticeAnchor = newAnchor()): MorphFrame {
  const { radius: R, basis, k } = map;
  const camBody: Vec3 = [scene[0], scene[1], scene[2]];
  const camMap = bodyToMap(map, camBody);
  const unbent = unbendPosition(map, camBody);
  const lambdaC = unbent.lon;
  const selectorCamera: Vec3 = unbent.position;
  const anchor = anchorFor(domain, selectorCamera, steps, anchorOut);

  // The anchor direction: the lattice anchor's float cube point, normalised (the shader's own anchor).
  const anchorDir = normalised(anchor.cube);
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
  const [xA, yA] = morphMapXY(lamA, phiA, map);
  const aA = k * xA;
  const bA = k * yA;
  const groundA = bendPoint(xA, yA, k, 0);
  const garel: Vec3 = [groundA.position[0] - camMap[0], groundA.position[1] - camMap[1], groundA.position[2] - camMap[2]];

  // The pole nearer the anchor, as a second lattice origin: its lattice vector as hi + lo (the vertex stage forms (T - hi) - lo, which is exact near the pole).
  const sign: 1 | -1 = sA >= 0 ? 1 : -1;
  const pole = poleOrigin(basis, sign, domain, steps);
  const poleHi = pole.t.map(Math.fround) as Vec3;
  const poleLo = pole.t.map((x, i) => Math.fround(x - poleHi[i])) as Vec3;

  const values: MorphAnchor<number> = {
    bRight: basis.right, bUp: basis.up, bForward: basis.forward,
    wLin: map.wLin, wEE: map.wEE, radius: R, k,
    sA, cA, omsA, opsA, vA1: v1, vA2: v2, nA2: v1 * v1 + v2 * v2, lamA,
    thA, tA, uA, cosThA, QA, BA, gA,
    sinAA: Math.sin(aA), cosAA: Math.cos(aA), sinBA: Math.sin(bA), cosBA: Math.cos(bA),
    upA: [groundA.normal[0], groundA.normal[1], groundA.normal[2]],
    garel,
    poleOn: map.morph > 0 ? 1 : 0,
    poleDs: sign === 1 ? omsA : -opsA,
    poleHi, poleLo, poleCube: pole.cube, poleError: pole.error, poleCos: pole.cos, poleBias: pole.bias,
  };
  const outline = outlineOf(lamA, yA, map);
  const poles = [poleOrigin(basis, 1, domain, steps), poleOrigin(basis, -1, domain, steps)].map((p) => (p.isVertex ? (p.t.map(Math.round) as Vec3) : undefined)) as [Vec3 | undefined, Vec3 | undefined];
  return { map, camBody, camMap, lambdaC, phiC: unbent.lat, heightC: unbent.height, selectorCamera, anchor, anchorDir, values, outline, poles };
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
