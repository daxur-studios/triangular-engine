/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Plan 059, step G6b: the anchor-relative bent position of a terrain vertex ("P2"), written once over a tiny math library
 * so the same formulas run as TSL nodes (`lod-surface-mesh.ts`, on the GPU in float32) and as plain numbers
 * ({@link makeNumLib}: doubles for checking the algebra, or doubles rounded to float32 after every operation, which shows
 * cancellation without a GPU).
 *
 * The map is the planet material's (`planetMapXY` in `triangular-engine/planet-material`): `x = R lon g(lat)`,
 * `y = R (wLin lat + wEE yEE(lat))`, with `g = wLin + wEE c(lat)`. Equal Earth has `wLin = 1 - morph` and
 * `wEE = morph * PLANET_MAP_EQUAL_EARTH_SCALE` (the material fits the equator to `2 pi R`, so Equal Earth is 1.1607 times the unit
 * form in x and y); equirectangular is `wLin = 1`, `wEE = 0` at every morph, so it never blends. The bend has curvature
 * `k = (1 - morph) / R`: ground point `G = (cos b sin a, sin b, cos a cos b - 1) / k` with `a = k x`, `b = k y`, up `n = k G + z`.
 *
 * P2 never forms a large angle or a large position on the GPU. Every quantity is the difference from the per-frame anchor,
 * written so that nothing large cancels (sin of a difference, `vers`/`sinc` forms, factored polynomial differences). The
 * anchor's own values come from the CPU in doubles (`lod-morph-frame.ts`) and arrive as uniforms.
 *
 * Near the projection's pole the longitude is ill-conditioned in a difference from the anchor (the bend's x is `R g lon`, so
 * a longitude error is amplified by the map's whole stretch there). A vertex nearer to the pole than to the anchor therefore
 * takes the same offsets from the pole instead: its lattice offset from the pole is `(T - hi) - lo`, with the pole's lattice vector
 * split into a float32 `hi` and `lo` by the CPU in doubles (forming `T - T_anchor` first would round when the anchor is far away),
 * and the longitude comes from the accurate small horizontal vector
 * ({@link poleAngles}). Both stages are functions of the vertex's lattice vector `T` and the frame's uniforms only, so a seam
 * vertex still gets the same bits from every leaf that draws it.
 *
 * Pure TypeScript, no three, no Angular: the worker-safe core entry may hold it.
 */

/** Three scalars of the math library's value type. */
export type V3<T = any> = readonly [T, T, T];
/** Four scalars. */
export type V4<T = any> = readonly [T, T, T, T];

/** What the formulas need: constants, a few built-ins and a comparison. Arithmetic is the chained `add/sub/mul/div/negate`. */
export interface MorphLib {
  /** A constant. */
  c(x: number): any;
  sqrt(a: any): any;
  abs(a: any): any;
  sin(a: any): any;
  cos(a: any): any;
  asin(a: any): any;
  /** atan2(y, x). */
  atan2(y: any, x: any): any;
  floor(a: any): any;
  min(a: any, b: any): any;
  max(a: any, b: any): any;
  /** `a < b` as a condition for {@link MorphLib.select}. */
  lt(a: any, b: number | any): any;
  select(cond: any, whenTrue: any, whenFalse: any): any;
}

/** Equal Earth coefficients, the same as `planet-map.ts` and `planet-morph-nodes`. */
export const MORPH_EE = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796, M: Math.sqrt(3) / 2 } as const;

const PI = Math.PI;
const HALF_PI = Math.PI / 2;
const TWO_PI = 2 * Math.PI;
/** Denominators of the nested Taylor form of sin: x (1 - x^2/6 (1 - x^2/20 (...))), the same as `lod-lattice.ts` `SIN_DENOMINATORS`. */
const SIN_DENOMINATORS: readonly number[] = [6, 20, 42, 72, 110, 156, 210];

// -- small-safe trig -----------------------------------------------------------------------------------------------

/** `sin(x) / x` as a polynomial, for |x| up to pi / 2 (error below 1e-10); exactly 1 at 0. */
export function sincPoly(L: MorphLib, x: any): any {
  const x2 = x.mul(x);
  let inner: any = L.c(1);
  for (let k = SIN_DENOMINATORS.length - 1; k >= 0; k--) inner = L.c(1).sub(x2.div(SIN_DENOMINATORS[k]).mul(inner));
  return inner;
}

/** `sin(x)` as a polynomial for |x| up to pi / 2; relative accuracy for tiny x (the built-in's error is only absolute). */
export function sinPoly(L: MorphLib, x: any): any {
  return x.mul(sincPoly(L, x));
}

/** x = r + q pi with |r| <= pi / 2, and the sign (-1)^q: range reduction without the built-in trig. */
function reduceHalfTurn(L: MorphLib, x: any): { r: any; sign: any } {
  const q = L.floor(x.div(PI).add(0.5));
  const r = x.sub(q.mul(PI));
  const parity = q.sub(L.floor(q.mul(0.5)).mul(2));
  return { r, sign: L.c(1).sub(parity.mul(2)) };
}

/** sin(x) for any x (up to a few turns) with relative accuracy near 0 and no built-in trig. */
export function sinW(L: MorphLib, x: any): any {
  const { r, sign } = reduceHalfTurn(L, x);
  return sign.mul(sinPoly(L, r));
}

/** cos(x) for any x, as 1 - 2 sin^2(r / 2) so it keeps its digits near 0. */
export function cosW(L: MorphLib, x: any): any {
  const { r, sign } = reduceHalfTurn(L, x);
  const half = sinPoly(L, r.mul(0.5));
  return sign.mul(L.c(1).sub(half.mul(half).mul(2)));
}

/** sin(x) / x for any x, exactly 1 at 0. */
export function sincW(L: MorphLib, x: any): any {
  return L.select(L.lt(L.abs(x), HALF_PI), sincPoly(L, x), sinW(L, x).div(x));
}

/**
 * atan2(y, x) for a vector that is not necessarily unit, accurate relative to the result for tiny angles. The built-in only
 * seeds it (WGSL bounds its error by ULPs of the result, an absolute 1e-7 for a tiny angle is not enough); one Newton step
 * with the exact identity tan(d - d0) = (y cos d0 - x sin d0) / (x cos d0 + y sin d0) and polynomial sin and cos of the seed
 * corrects it. Returns 0 for a zero vector.
 */
export function atan2R(L: MorphLib, y: any, x: any): any {
  const d0 = L.atan2(y, x);
  const s0 = sinW(L, d0);
  const c0 = cosW(L, d0);
  const ratio = y.mul(c0).sub(x.mul(s0)).div(x.mul(c0).add(y.mul(s0)));
  const r2 = ratio.mul(ratio);
  const refined = d0.add(ratio.mul(L.c(1).sub(r2.div(3)).add(r2.mul(r2).div(5))));
  return L.select(L.lt(L.abs(x).add(L.abs(y)), 1e-30), L.c(0), refined);
}

// -- the lattice stage as a function over the library ----------------------------------------------------------------

/** What the lattice stage needs about the lattice: its size and warp (`lod-lattice.ts`). */
export interface MorphLattice {
  /** Lattice steps per face side (`latticeSteps`). */
  readonly steps: number;
  /** True for the equal-angle cube warp, false for the plain cube. */
  readonly equalAngle: boolean;
}

/** The point a lattice stage measures from: the camera's anchor, or a pole of the projection. */
export interface LatticeOrigin<T = any> {
  /** The origin's cube point as float32 (the shader's value). */
  cube: V3<T>;
  /** The exact cube point minus `cube`. */
  error: V3<T>;
  /** `cos(pi/4 T_k / L)` of the origin's lattice vector (1 for the plain cube). */
  cos: V3<T>;
}

/** What the lattice stage produces. */
export interface LatticeOffset {
  /** The vertex's unit direction minus the origin's (body frame), by the library's difference form. */
  du: V3<any>;
  /** The vertex's unit direction. */
  direction: V3<any>;
}

/**
 * The library's sphere lattice stage (`lod-surface-mesh.ts` `basePoint`) over {@link MorphLib}: from the vertex's cube-lattice
 * vector `t` and its exact lattice difference from the origin `dT` (integer-valued for the anchor), the unit-direction
 * difference `du = c / |c| - cO / |cO|` with `c = cO + dc` and `dc = tan(a) - tan(b) = sin(a - b) / (cos a cos b)`. The GPU mesh
 * builds this with vector nodes for the anchor (so the morph-0 shader is exactly today's) and with this function for the pole
 * stage; the specs run it for both.
 */
export function latticeOffset(L: MorphLib, lattice: MorphLattice, t: V3<any>, dT: V3<any>, origin: LatticeOrigin<any>): LatticeOffset {
  const angle = Math.PI / 4 / lattice.steps;
  const dc = [0, 1, 2].map((k) => {
    const raw = lattice.equalAngle ? sinPoly(L, dT[k].mul(angle)).div(L.cos(t[k].mul(angle)).mul(origin.cos[k])) : dT[k].div(lattice.steps);
    return raw.add(origin.error[k]);
  }) as unknown as V3<any>;
  const cO = origin.cube;
  const c = [0, 1, 2].map((k) => cO[k].add(dc[k]));
  const lc = L.sqrt(c[0].mul(c[0]).add(c[1].mul(c[1])).add(c[2].mul(c[2])));
  const lO = L.sqrt(cO[0].mul(cO[0]).add(cO[1].mul(cO[1])).add(cO[2].mul(cO[2])));
  const dot = dc[0].mul(cO[0].mul(2).add(dc[0])).add(dc[1].mul(cO[1].mul(2).add(dc[1]))).add(dc[2].mul(cO[2].mul(2).add(dc[2])));
  const shared = dot.div(lc.mul(lO).mul(lc.add(lO)));
  const du = [0, 1, 2].map((k) => dc[k].div(lc).sub(cO[k].mul(shared))) as unknown as V3<any>;
  const direction = [0, 1, 2].map((k) => c[k].div(lc)) as unknown as V3<any>;
  return { du, direction };
}

// -- the anchor ----------------------------------------------------------------------------------------------------

/**
 * Everything P2 takes from the per-frame anchor, all computed in doubles on the CPU (`lod-morph-frame.ts`). The type parameter
 * is the value type: numbers on the CPU, uniform nodes on the GPU.
 */
export interface MorphAnchor<T = any> {
  /** The projection basis (map frame to body): x of the map is `bRight`, y is `bUp`, z is `bForward`. */
  bRight: V3<T>;
  bUp: V3<T>;
  bForward: V3<T>;
  /** Weights of the map: `g = wLin + wEE c`, `y = R (wLin lat + wEE yEE)` (see the file comment). */
  wLin: T;
  wEE: T;
  /** Planet radius, metres, and the curvature k = (1 - morph) / R. */
  radius: T;
  k: T;
  /** Anchor direction in the basis: sin(lat), cos(lat), 1 - sin(lat), 1 + sin(lat). */
  sA: T;
  cA: T;
  omsA: T;
  opsA: T;
  /** (u . forward, u . right) of the anchor direction, and |.|^2. */
  vA1: T;
  vA2: T;
  nA2: T;
  /** The anchor's longitude, unwrapped to the camera's side (within pi of it). */
  lamA: T;
  /** Equal Earth at the anchor: theta, theta^2, sin(theta), cos(theta), Q(theta^2), M P(theta^2), and g = wLin + wEE c. */
  thA: T;
  tA: T;
  uA: T;
  cosThA: T;
  QA: T;
  BA: T;
  gA: T;
  /** sin and cos of a_A = k x_A and b_A = k y_A. */
  sinAA: T;
  cosAA: T;
  sinBA: T;
  cosBA: T;
  /** The bend's up at the anchor, and the anchor's ground point minus the bent camera, both in the map frame. */
  upA: V3<T>;
  garel: V3<T>;
  /** 1 when the pole stage may be used (morph above 0), else 0. */
  poleOn: T;
  /** `sign - sA` for the pole nearer the anchor (sign +1 for the basis' up pole, -1 for the down pole), exact: `1 - sA` or `-(1 + sA)`. */
  poleDs: T;
  /** The pole's lattice vector (doubles, not an integer unless the pole is a vertex) as a float32 `hi` and the remainder `lo`: the vertex stage forms `(T - hi) - lo`. */
  poleHi: V3<T>;
  poleLo: V3<T>;
  /** The pole's lattice origin: cube point (float32), the exact cube point minus it, and `cos(pi/4 T_k / L)`. */
  poleCube: V3<T>;
  poleError: V3<T>;
  poleCos: V3<T>;
  /**
   * The pole stage's float32 origin direction (`poleCube` normalised) minus the exact pole `sign * up`, doubles, about 3e-8 and
   * float32-exact in relative terms: added to the lattice stage's offset so that the offset is from the exact pole.
   */
  poleBias: V3<T>;
}

/** Scalar fields of {@link MorphAnchor}, in the order the uniform table uses. */
export const ANCHOR_SCALAR_KEYS = [
  'wLin', 'wEE', 'radius', 'k', 'sA', 'cA', 'omsA', 'opsA', 'vA1', 'vA2', 'nA2', 'lamA', 'thA', 'tA', 'uA', 'cosThA', 'QA', 'BA', 'gA',
  'sinAA', 'cosAA', 'sinBA', 'cosBA', 'poleOn', 'poleDs',
] as const;
/** Vector fields of {@link MorphAnchor}. */
export const ANCHOR_VECTOR_KEYS = [
  'bRight', 'bUp', 'bForward', 'upA', 'garel', 'poleHi', 'poleLo', 'poleCube', 'poleError', 'poleCos', 'poleBias',
] as const;

const dot3 = (a: V3<any>, b: V3<any>): any => a[0].mul(b[0]).add(a[1].mul(b[1])).add(a[2].mul(b[2]));

/** The offsets of a vertex from the anchor that the bend needs. */
export interface VertexAngles {
  /** sin(lat) - sin(latA). */
  ds: any;
  /** lat - latA. */
  dphi: any;
  /** lon - lonA before the unwrap, in (-pi, pi]. */
  dlam0: any;
}

/**
 * The offsets from the anchor of a vertex whose unit direction differs from the anchor's by `du` (body frame, from the lattice
 * stage): latitude from the cosine's difference form, longitude from the angle between the anchor's horizontal vector and the
 * vertex's. Accurate in proportion to `|du|`, so good for a vertex near the anchor; ill-conditioned for one much nearer the pole
 * than the anchor (use {@link poleAngles} there).
 */
export function anchorAngles(L: MorphLib, A: MorphAnchor<any>, du: V3<any>): VertexAngles {
  const dv1 = dot3(du, A.bForward);
  const dv2 = dot3(du, A.bRight);
  // The vertex's horizontal vector is the anchor's plus (dv1, dv2): its length and the cosine's difference come from sums of squares
  // and a dot product with the anchor's horizontal vector, so nothing cancels near a pole, where `ds` (second order there) would.
  const hdot = A.vA1.mul(dv1).add(A.vA2.mul(dv2));
  const hh = dv1.mul(dv1).add(dv2.mul(dv2));
  const cphi = L.sqrt(L.max(A.nA2.add(hdot.mul(2)).add(hh), L.c(0)));
  const dcos = hdot.mul(2).add(hh).div(L.max(cphi.add(A.cA), L.c(1e-30)));
  const ds = dot3(du, A.bUp);
  const s = A.sA.add(ds);
  const dphi = atan2R(L, ds.mul(A.cA).sub(dcos.mul(A.sA)), cphi.mul(A.cA).add(s.mul(A.sA)));
  const cross = A.vA1.mul(dv2).sub(A.vA2.mul(dv1));
  const dotv = A.nA2.add(hdot);
  return { ds, dphi, dlam0: atan2R(L, cross, dotv) };
}

/**
 * The same offsets for a vertex whose unit direction differs from the pole's by `dup` (the lattice stage run with the pole as
 * its origin). The pole is `sign * up`, so `dup . forward` and `dup . right` are the vertex's horizontal vector itself, relative
 * to the vertex's own size, and `dup . up` is its (small) drop from the pole. The anchor's horizontal vector (`vA1`, `vA2`, doubles
 * from the CPU) then gives the angle between them. The error is a few float32 ulps of the angle whatever the vertex's distance
 * from the anchor, where {@link anchorAngles} scales with `|du| / |v|`.
 */
export function poleAngles(L: MorphLib, A: MorphAnchor<any>, dup: V3<any>): VertexAngles {
  const w: V3<any> = [dup[0].add(A.poleBias[0]), dup[1].add(A.poleBias[1]), dup[2].add(A.poleBias[2])];
  const v1 = dot3(w, A.bForward);
  const v2 = dot3(w, A.bRight);
  const ds = A.poleDs.add(dot3(w, A.bUp));
  const s = A.sA.add(ds);
  const cphi = L.sqrt(v1.mul(v1).add(v2.mul(v2)));
  const dcos = cphi.sub(A.cA);
  const dphi = atan2R(L, ds.mul(A.cA).sub(dcos.mul(A.sA)), cphi.mul(A.cA).add(s.mul(A.sA)));
  const cross = A.vA1.mul(v2).sub(A.vA2.mul(v1));
  const dotv = A.vA1.mul(v1).add(A.vA2.mul(v2));
  return { ds, dphi, dlam0: atan2R(L, cross, dotv) };
}

/** The result of the P2 position function; the extra fields are for the specs. */
export interface P2Result {
  /** Camera-relative position in the body frame. */
  rel: V3<any>;
  /** Camera-relative position in the map frame (before the basis turns it). */
  relMap: V3<any>;
  /** The unwrap's integer n (0 for a vertex on the anchor's own side of the map). */
  wrapN: any;
  dphi: any;
  /** The longitude difference after the unwrap (dlam0 + 2 pi wrapN) and before it. */
  dlam: any;
  dlam0: any;
  dx: any;
  dy: any;
  /** g = wLin + wEE c of the vertex's row: x = R lambda g, and the row's half-width is pi R g. */
  g: any;
  /** G - G_A of the bend, map frame. */
  dG: V3<any>;
  /** The bend's up, map frame. */
  up: V3<any>;
  /** The bend's up in the body frame. */
  upBody: V3<any>;
  /** 1 where the pole stage placed the vertex, else 0. */
  usedPole: any;
}

/** The exact pole vertex of a leaf: `is` is a condition for {@link MorphLib.select}, `lon` the longitude it takes (rad, inside the side's window). */
export interface PoleVertex {
  is: any;
  lon: any;
}

/**
 * P2: the camera-relative bent position of a vertex from its exact offset `du` = unit direction minus anchor direction (body
 * frame, from the lattice stage), its offset `dup` from the pole nearer to the anchor (the lattice stage run with that pole as its
 * origin), its side `sigma` (+-1) and its height `h` above the base surface. `pole` replaces the longitude of the exact pole vertex;
 * `leafLon` places the vertex around the leaf's own centre longitude (see below).
 *
 * The vertex takes the pole's offsets when it is nearer to the pole than to the anchor (`|dup| < |du|`) and the pole stage is on
 * (`poleOn`); the choice depends only on the vertex's lattice vector and the frame's uniforms.
 */
export function p2Position(
  L: MorphLib, A: MorphAnchor<any>, du: V3<any>, dup: V3<any>, sigma: any, h: any, pole?: PoleVertex, leafLon?: any,
): P2Result {
  const fromAnchor = anchorAngles(L, A, du);
  const fromPole = poleAngles(L, A, dup);
  const nearer = L.select(L.lt(dot3(dup, dup), dot3(du, du)), L.c(1), L.c(0)).mul(A.poleOn);
  const usedPole = L.select(L.lt(L.c(0.5), nearer), L.c(1), L.c(0));
  const pick = (a: any, b: any): any => L.select(L.lt(L.c(0.5), usedPole), b, a);
  const ds = pick(fromAnchor.ds, fromPole.ds);
  const dphi = pick(fromAnchor.dphi, fromPole.dphi);
  const dlamRaw = pick(fromAnchor.dlam0, fromPole.dlam0);
  // The exact pole vertex has no longitude (its horizontal part cancels to rounding noise): it takes the leaf's own, already
  // inside the side's window (`poleVertexLongitude`), so it lands on the map's top or bottom edge.
  const dlam0 = pole ? L.select(pole.is, pole.lon.sub(A.lamA), dlamRaw) : dlamRaw;
  const lam0 = A.lamA.add(dlam0);
  // The window (side sigma) holds the longitude; with `leafLon` (the leaf's centre longitude, already inside its window) the vertex is
  // placed within pi of it instead: the same for every leaf that lies inside its window, and continuous for one whose edge runs
  // along the window's seam (the quarter-map leaves around a pole that sit on the +-90 degree meridians), which the window tears.
  const lo = leafLon ? leafLon.sub(PI) : sigma.mul(HALF_PI).sub(PI);
  const wrapN = L.floor(lo.sub(lam0).div(TWO_PI)).add(1);
  const out = p2FromAngles(L, A, ds, dphi, dlam0, wrapN, h);
  return { ...out, usedPole };
}

/**
 * The second half of P2: the position from the vertex's exact offsets from the anchor. `ds` = sin(lat) - sin(latA), `dphi` = lat - latA,
 * `dlam0` = lon - lonA before the unwrap and `wrapN` the unwrap's integer (the vertex's longitude is `lamA + dlam0 + 2 pi wrapN`).
 * A pole fan (G6d) that has no lattice direction builds these from double-float differences of the polar coordinates the CPU hands over.
 */
export function p2FromAngles(L: MorphLib, A: MorphAnchor<any>, ds: any, dphi: any, dlam0: any, wrapN: any, h: any): P2Result {
  const dlam = dlam0.add(wrapN.mul(TWO_PI));
  const E = MORPH_EE;

  // Equal Earth: theta = asin(M sin(lat)), by differences of sin(theta) = M sin(lat).
  const dS = ds.mul(E.M);
  const uTh = A.uA.add(dS);
  const cth = L.sqrt(L.max(L.c(1).sub(uTh.mul(uTh)), L.c(0)));
  const dcth = dS.mul(A.uA.mul(2).add(dS)).negate().div(A.cosThA.add(cth));
  const dth = atan2R(L, dS.mul(A.cosThA).sub(dcth.mul(A.uA)), cth.mul(A.cosThA).add(uTh.mul(A.uA)));
  const th = A.thA.add(dth);
  const t = th.mul(th);
  const d2 = dth.mul(th.add(A.thA)); // t - tA
  const s3 = t.mul(t).add(t.mul(A.tA)).add(A.tA.mul(A.tA)); // (t^3 - tA^3) / (t - tA)
  const s4 = t.add(A.tA).mul(t.mul(t).add(A.tA.mul(A.tA))); // (t^4 - tA^4) / (t - tA)
  const dQ = d2.mul(s3.mul(E.A3).add(s4.mul(E.A4)).add(E.A2)); // Q = A1 + A2 t + A3 t^3 + A4 t^4
  const Q = A.QA.add(dQ);
  const dyEE = dth.mul(Q).add(A.thA.mul(dQ));
  const dB = d2.mul(s3.mul(7 * E.A3).add(s4.mul(9 * E.A4)).add(3 * E.A2)).mul(E.M); // B = M (A1 + 3 A2 t + 7 A3 t^3 + 9 A4 t^4)
  const B = A.BA.add(dB);
  // c = cos(theta) / B: a / b - aA / bA = (da bA - aA db) / (b bA)
  const dcEE = dcth.mul(A.BA).sub(A.cosThA.mul(dB)).div(B.mul(A.BA));
  const dg = A.wEE.mul(dcEE);
  const g = A.gA.add(dg);

  // The material's map by differences: x = R lam g, y = R (wLin lat + wEE yEE). Equirectangular has wEE = 0: g = 1, y = R lat.
  const dx = A.radius.mul(dlam.mul(g).add(A.lamA.mul(dg)));
  const dy = A.radius.mul(A.wLin.mul(dphi).add(A.wEE.mul(dyEE)));

  // The bend's G - G_A. a = k x, b = k y; the half-angle forms keep the digits of the small difference.
  const ha = A.k.mul(dx).mul(0.5);
  const hb = A.k.mul(dy).mul(0.5);
  const sha = sinW(L, ha);
  const cha = cosW(L, ha);
  const shb = sinW(L, hb);
  const chb = cosW(L, hb);
  const incA = sincW(L, ha);
  const incB = sincW(L, hb);
  const cmA = A.cosAA.mul(cha).sub(A.sinAA.mul(sha)); // cos(aA + da/2)
  const smA = A.sinAA.mul(cha).add(A.cosAA.mul(sha)); // sin(aA + da/2)
  const cmB = A.cosBA.mul(chb).sub(A.sinBA.mul(shb));
  const smB = A.sinBA.mul(chb).add(A.cosBA.mul(shb));
  const cosB = cmB.mul(chb).sub(smB.mul(shb)); // cos b
  const cosA = cmA.mul(cha).sub(smA.mul(sha)); // cos a
  const dSinA = dx.mul(cmA).mul(incA); // (sin a - sin aA) / k
  const dCosA = dx.mul(smA).mul(incA).negate(); // (cos a - cos aA) / k
  const dSinB = dy.mul(cmB).mul(incB);
  const dCosB = dy.mul(smB).mul(incB).negate();
  const dG: V3<any> = [cosB.mul(dSinA).add(A.sinAA.mul(dCosB)), dSinB, cosA.mul(dCosB).add(A.cosBA.mul(dCosA))];

  // Height along the bend's up: n = k G + z = nA + k (G - GA).
  const up: V3<any> = [A.upA[0].add(A.k.mul(dG[0])), A.upA[1].add(A.k.mul(dG[1])), A.upA[2].add(A.k.mul(dG[2]))];
  const relMap: V3<any> = [
    dG[0].add(h.mul(up[0])).add(A.garel[0]),
    dG[1].add(h.mul(up[1])).add(A.garel[1]),
    dG[2].add(h.mul(up[2])).add(A.garel[2]),
  ];
  const rel = mapToBody(A.bRight, A.bUp, A.bForward, relMap);
  const upBody = mapToBody(A.bRight, A.bUp, A.bForward, up);
  return { rel, relMap, wrapN, dphi, dlam, dlam0, dx, dy, g, dG, up, upBody, usedPole: L.c(0) };
}

// -- the outline ---------------------------------------------------------------------------------------------------

/** The unwrap integers the outline tables cover are -OUTLINE_WRAP ... OUTLINE_WRAP. */
export const OUTLINE_WRAP = 2;

/**
 * The map outline from the anchor, all in doubles on the CPU (`outlineOf` in `lod-morph-frame.ts`): the distances of the
 * anchor to the edges as the vertex stage needs them. `right[i]` and `left[i]` belong to the unwrap integer
 * `i - OUTLINE_WRAP` and fold in the whole turns, so the vertex stage never forms a number near 2 pi and subtracts another.
 */
export interface MorphOutline<T = any> {
  /** pi - lamA - 2 pi n, for n = -OUTLINE_WRAP ... OUTLINE_WRAP. */
  right: T[];
  /** pi + lamA + 2 pi n. */
  left: T[];
  /** halfHeight - yA and halfHeight + yA. */
  top: T;
  bottom: T;
}

/** Picks `values[n + OUTLINE_WRAP]` for an integer-valued `n` held in the library's value type (the last entry when out of range). */
export function pickWrap(L: MorphLib, n: any, values: readonly any[]): any {
  let out = values[values.length - 1];
  for (let i = values.length - 2; i >= 0; i--) out = L.select(L.lt(L.abs(n.sub(i - OUTLINE_WRAP)), 0.5), values[i], out);
  return out;
}

/**
 * Signed distances (metres, positive inside) of the vertex to the four edges of the map, in the order right, left, top,
 * bottom. The row half-width is `pi R g` and the vertex's x is `R lambda g`, so the right edge's distance is `R g (pi -
 * lambda)` and the left's `R g (pi + lambda)`. With lambda = lamA + dlam0 + 2 pi n the anchor's part (`right[n]`, a double
 * minus whole turns on the CPU) is exact and only the difference `dlam0` comes from the GPU, so a vertex 1 m from the cut keeps
 * its centimetres where `|xA + dx|` in float32 loses metres.
 */
export function outlineDistances(L: MorphLib, A: MorphAnchor<any>, O: MorphOutline<any>, p2: P2Result): V4<any> {
  const rg = A.radius.mul(p2.g);
  return [
    rg.mul(pickWrap(L, p2.wrapN, O.right).sub(p2.dlam0)),
    rg.mul(pickWrap(L, p2.wrapN, O.left).add(p2.dlam0)),
    O.top.sub(p2.dy),
    O.bottom.add(p2.dy),
  ];
}

/** Map frame to body frame: `right * x + up * y + forward * z`. */
export function mapToBody(right: V3<any>, up: V3<any>, forward: V3<any>, v: V3<any>): V3<any> {
  return [0, 1, 2].map((i) => right[i].mul(v[0]).add(up[i].mul(v[1])).add(forward[i].mul(v[2]))) as unknown as V3<any>;
}

// -- numbers as a library --------------------------------------------------------------------------------------------

/** A number with the chained arithmetic of a TSL node; every result passes through the library's rounding. */
export interface Num {
  readonly v: number;
  add(o: Num | number): Num;
  sub(o: Num | number): Num;
  mul(o: Num | number): Num;
  div(o: Num | number): Num;
  negate(): Num;
}

/** A {@link MorphLib} over numbers, with the constructor of its values. */
export type NumLib = MorphLib & { num(x: number): Num };

/**
 * The math library over plain numbers. `round` is applied after every operation: the identity gives doubles (for checking
 * the algebra), `Math.fround` gives float32 arithmetic with exactly-rounded operations (for seeing cancellation; the GPU's
 * built-ins are less accurate than the ones here, and the GPU may contract multiply-adds).
 */
export function makeNumLib(round: (x: number) => number): NumLib {
  class N implements Num {
    constructor(readonly v: number) {}
    add(o: Num | number): Num { return new N(round(this.v + val(o))); }
    sub(o: Num | number): Num { return new N(round(this.v - val(o))); }
    mul(o: Num | number): Num { return new N(round(this.v * val(o))); }
    div(o: Num | number): Num { return new N(round(this.v / val(o))); }
    negate(): Num { return new N(-this.v); }
  }
  const val = (o: Num | number): number => (typeof o === 'number' ? round(o) : o.v);
  const num = (x: number): Num => new N(round(x));
  return {
    num,
    c: num,
    sqrt: (a: Num) => new N(round(Math.sqrt(a.v))),
    abs: (a: Num) => new N(Math.abs(a.v)),
    sin: (a: Num) => new N(round(Math.sin(a.v))),
    cos: (a: Num) => new N(round(Math.cos(a.v))),
    asin: (a: Num) => new N(round(Math.asin(a.v))),
    atan2: (y: Num, x: Num) => new N(round(Math.atan2(y.v, x.v))),
    floor: (a: Num) => new N(Math.floor(a.v)),
    min: (a: Num, b: Num) => new N(Math.min(a.v, b.v)),
    max: (a: Num, b: Num) => new N(Math.max(a.v, b.v)),
    lt: (a: Num, b: Num | number) => a.v < val(b),
    select: (cond: boolean, a: Num, b: Num) => (cond ? a : b),
  };
}

/** Doubles: the algebra of the formulas, without rounding. */
export const DOUBLE_LIB: NumLib = makeNumLib((x) => x);
/** Float32 after every operation. */
export const FLOAT32_LIB: NumLib = makeNumLib(Math.fround);

/** Maps the number fields of an anchor (or any record of numbers and number triples) into a library's values. */
export function liftAnchor(lib: NumLib, values: MorphAnchor<number>): MorphAnchor<Num> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = Array.isArray(value) ? value.map((x: number) => lib.num(x)) : lib.num(value as number);
  }
  return out as unknown as MorphAnchor<Num>;
}

/** Lifts three numbers into a library's values. */
export function liftVector(lib: NumLib, v: readonly number[]): V3<Num> {
  return [lib.num(v[0]), lib.num(v[1]), lib.num(v[2])];
}
