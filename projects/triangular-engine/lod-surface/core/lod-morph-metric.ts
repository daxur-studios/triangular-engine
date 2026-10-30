import { domainPoint, faceOfDirection, type LodDomain, type Vec3 } from './lod-domain';
import { cubeComponent, cubeLattice, latticeSteps } from './lod-lattice';
import { PIXEL_FLOOR, maxLevelFor, type LodSelector, type NodeGeometry, type NodeGeometryHook } from './lod-selector';

/**
 * Plan 059, step G6c: the stretch-aware LOD metric for the globe-to-map morph.
 *
 * The selector measures a leaf's cell size and its distance to the camera on the sphere. Between globe and map the ground is
 * bent, and the map stretches a leaf (near a pole the pole is a whole edge of the map), so the sphere's numbers say "far and
 * small" about leaves that are near and large on the screen. {@link StretchMetric} is a {@link NodeGeometryHook}: it measures
 * each node at its MORPHED position, with the corners, edge midpoints and centre going through the planet material's map
 * ({@link stretchMapXY}, the double-precision twin of `planetMapXY`) and the bend (curvature `(1 - morph) / R`), and hands the
 * selector the bent centre, normal, bounds and a cell length that is the larger of the morphed cell edge and the morphed chord
 * sag turned into pixels. The camera in the selector's view must be the bent camera of the measured frame ({@link StretchMetric.selectionPoint}).
 *
 * Pure doubles, no three, no Angular, nothing allocated per node: the worker-safe core entry may hold it.
 *
 * Staleness (refresh policy). Re-measuring a node costs about twenty map evaluations, and a morph animation changes the
 * morph every frame, so node geometry is measured at a morph that is allowed to lag the live one by up to {@link StretchMetricOptions.morphStep}.
 * Two things keep the lag from under-refining. The camera for the selector is placed in the frame the geometry was measured in
 * ({@link StretchMetric.selectionPoint}), so the camera and the nodes agree on where the ground is and the lag moves the
 * selection by a fraction of a step, not by the whole drift of the surface (kilometres at planet scale). And what is left, the
 * leaf growing or shifting by a step's worth, is padded: the cell length by `1 + stalePad` and the bounds by `stalePad` of the
 * leaf's own size, which makes a stale node ask for at least as much refinement as a fresh one (the spec measures it).
 */

/** The map the globe flattens to. Same values as `PlanetMapProjection` in `triangular-engine/planet-material`. */
export type StretchProjection = 'equirectangular' | 'equal-earth';

/** The projection basis in the body frame: three orthonormal vectors (`setPlanetProjectionCentre`'s forward, up and right). */
export interface StretchBasis {
  /** Towards the projection centre (longitude 0, latitude 0). */
  readonly forward: readonly [number, number, number];
  /** Towards the map's north pole. */
  readonly up: readonly [number, number, number];
  /** Towards the map's +x. */
  readonly right: readonly [number, number, number];
}

/** The chord sag of a cell that counts as one pixel of error: the sag becomes an equivalent cell length (`sag * cellPixels / STRETCH_SAG_PX`). */
export const STRETCH_SAG_PX = 1;

/** Default for {@link StretchMetricOptions.morphStep}: node geometry is re-measured once the morph has moved this far. */
export const DEFAULT_STRETCH_MORPH_STEP = 0.01;

/**
 * Default growth, per unit of morph lag, of the measured cell length (and of the bounds, by the leaf's size), so that a
 * measurement taken `step` of morph ago over-states the split ratio (the safe side: the node splits no later than a fresh one
 * would). With the default step of 0.01 the pad is 3 percent. The spec `lod-morph-metric.spec.ts` logs the measured growth of
 * the fresh split ratio over a one-step-old one: the median is about 0 and the 90th percentile about 40 percent per unit
 * morph, but the tail is heavy (nodes at a box edge near a pole or the cut), so the pad covers all but about 0.02 percent of
 * the nodes near the split threshold and the rest are corrected at the next refresh, within one step of morph.
 */
export const DEFAULT_STRETCH_STALE_PAD_PER_MORPH = 3;

const TWO_PI = 2 * Math.PI;
/** A leaf with a pole strictly inside it is bounded by this many planet radii: more than any two points of the map are apart. */
const TORN_REACH_RADII = 8;
/** How many chord sags of a leaf pad its bounds beyond the nine measured samples. */
const BOUND_SAG_MARGIN = 2;
const DEG = Math.PI / 180;

// Equal Earth (Savric et al.), the constants of `planet-map.ts`.
const EE_A1 = 1.340264;
const EE_A2 = -0.081106;
const EE_A3 = 0.000893;
const EE_A4 = 0.003796;
const EE_M = Math.sqrt(3) / 2;
const EE_RAW_X_MAX = Math.PI / (EE_M * EE_A1);
/** How much wider the material's Equal Earth map is than the unit-sphere form: `pi / rawXMax`, about 1.1607. */
const EE_SCALE = Math.PI / EE_RAW_X_MAX;

/**
 * Where the planet material puts the point at projected `lon`/`lat` (radians, in the projection's own frame) on its map,
 * metres from the map centre: a copy of `planetMapXY` (`triangular-engine/planet-material`) so this worker-safe entry does not
 * import the material's entry (which pulls three and TSL). The spec proves the two equal.
 *
 * @param out Receives x and y; pass one to avoid an allocation.
 */
export function stretchMapXY(lon: number, lat: number, morph: number, projection: StretchProjection, radius: number, out: [number, number] = [0, 0]): [number, number] {
  if (projection === 'equirectangular') {
    out[0] = radius * lon;
    out[1] = radius * lat;
    return out;
  }
  const m = Math.min(1, Math.max(0, morph));
  const theta = Math.asin(Math.max(-1, Math.min(1, EE_M * Math.sin(lat))));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const c = Math.cos(theta) / (EE_M * (EE_A1 + 3 * EE_A2 * t2 + t6 * (7 * EE_A3 + 9 * EE_A4 * t2)));
  const y = theta * (EE_A1 + EE_A2 * t2 + t6 * (EE_A3 + EE_A4 * t2));
  const scale = EE_SCALE * radius;
  out[0] = radius * lon * (1 - m) + lon * c * scale * m;
  out[1] = radius * lat * (1 - m) + y * scale * m;
  return out;
}

/** `sin(a) / a`, by its series for tiny `a` (as `atmosphere/bent-planet.ts`). */
function sinc(a: number): number {
  const a2 = a * a;
  if (a2 < 1e-6) return 1 - a2 / 6 + (a2 * a2) / 120;
  return Math.sin(a) / a;
}

/**
 * The projection basis for a centre at `lonDeg` east and `latDeg` north on the body (lon 0 = +Z, lat 0 = the equator), as
 * `setPlanetProjectionCentre` builds it.
 */
export function stretchProjectionBasis(lonDeg: number, latDeg: number): StretchBasis {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const f: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  let u: Vec3 = [-f[1] * f[0], 1 - f[1] * f[1], -f[1] * f[2]];
  if (u[0] * u[0] + u[1] * u[1] + u[2] * u[2] < 1e-8) u = [0, 0, f[1] > 0 ? -1 : 1];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  return { forward: f, up: u, right: [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]] };
}

/** The knobs of a {@link StretchMetric}. */
export interface StretchMetricOptions {
  /** Planet radius, metres: the sphere radius of the selector's domain, which is also the map's scale. */
  readonly radiusM: number;
  /** The map the globe flattens to. Default `'equal-earth'`. */
  readonly projection?: StretchProjection;
  /** The projection basis. Default: the centre at longitude 0, latitude 0 ({@link stretchProjectionBasis}). */
  readonly basis?: StretchBasis;
  /** Starting morph, 0 (globe) to 1 (map). Default 0. */
  readonly morph?: number;
  /** Re-measure node geometry once the morph has moved this far from the morph it was measured at. Default {@link DEFAULT_STRETCH_MORPH_STEP}. */
  readonly morphStep?: number;
  /**
   * Growth of the measured cell length per unit of morph lag; the pad is `1 + stalePadPerMorph * morphStep`. Default
   * {@link DEFAULT_STRETCH_STALE_PAD_PER_MORPH}. 0 turns the pad off (then a lagging measurement can under-refine by up to the lag).
   */
  readonly stalePadPerMorph?: number;
}

/** The part of a {@link StretchMetric}'s state a frame changes; fields left out keep their value. */
export interface StretchState {
  /** 0 (globe) to 1 (map); clamped. */
  readonly morph?: number;
  readonly projection?: StretchProjection;
  readonly radiusM?: number;
  readonly basis?: StretchBasis;
}

/** Counters of a {@link StretchMetric}. */
export interface StretchMetricStats {
  /** Times the metric invalidated the selector's node geometry (the refresh policy fired). */
  invalidations: number;
  /** Nodes measured: the work the invalidations caused. */
  measured: number;
}

/** A map state the placement functions read: either the live one (the camera's) or the one node geometry was measured at. */
interface MapState {
  morph: number;
  projection: StretchProjection;
  radius: number;
  /** Curvature `(1 - morph) / radius`. */
  k: number;
  /** Shift of the map frame's z into the body frame, `(1 - morph) * radius`. */
  shift: number;
  /** forward (0..2), up (3..5), right (6..8). */
  basis: Float64Array;
}

const newMapState = (): MapState => ({ morph: 0, projection: 'equal-earth', radius: 1, k: 0, shift: 0, basis: new Float64Array(9) });

function setMapState(state: MapState, morph: number, projection: StretchProjection, radius: number, basis: Float64Array): void {
  state.morph = morph;
  state.projection = projection;
  state.radius = radius;
  state.k = (1 - morph) / radius;
  state.shift = (1 - morph) * radius;
  state.basis.set(basis);
}

/** Scratch slots for the samples of one node. */
const SLOTS = 12;
const CENTRE = 0;
/** Slots 1 to 4: the corners in chain order [0,0], [1,0], [1,1], [0,1]. */
const CORNER = 1;
/** Slots 5 to 8: the midpoint of the edge from corner e to corner e+1. */
const MID = 5;
/** The pole corner as the end of its x edge, of its y edge, and at the leaf's own longitude. */
const POLE_X = 9;
const POLE_Y = 10;
const POLE_OWN = 11;
const CORNER_COORD: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * Measures nodes of a cube-sphere selector on the bent surface between globe and map and feeds the result to the selector as
 * its geometry ({@link NodeGeometryHook}).
 *
 * ```ts
 * const metric = new StretchMetric(selector, { radiusM, projection: 'equal-earth' });
 * // each frame, before select():
 * metric.update({ morph });                       // true when node geometry was refreshed
 * metric.selectionPoint(cameraUnit, altitudeM, cameraBody);   // the camera, bent in the frame node geometry is measured in
 * selector.select({ camera: cameraBody, pixelAngle, frustum });  // frustum from the bent camera's axes
 * ```
 *
 * At morph 0 no hook is installed: the selector's own sphere metric runs and the selection is exactly the default one.
 * Above 0 the hook is installed; changing the morph, the projection, the radius or the basis does not need a new selector.
 *
 * Preview: wired into the terrain in step G6e.
 */
export class StretchMetric implements NodeGeometryHook {
  readonly stats: StretchMetricStats = { invalidations: 0, measured: 0 };
  private readonly selector: LodSelector;
  private readonly domain: LodDomain;
  private readonly patchCells: number;
  private readonly cellPixels: number;
  private readonly steps: number;
  private readonly morphStep: number;
  private readonly stalePad: number;
  /** The state of the camera and the mesh: the latest {@link update}. */
  private readonly live = newMapState();
  /** The state node geometry was last measured at. */
  private readonly measuredAt = newMapState();
  private readonly pos = new Float64Array(SLOTS * 3);
  private readonly nrm = new Float64Array(SLOTS * 3);
  private readonly unit = new Float64Array(SLOTS * 3);
  private readonly xy: [number, number] = [0, 0];
  private readonly unitPos: Vec3 = [0, 0, 0];
  private readonly unitNormal: Vec3 = [0, 0, 0];
  private readonly lattice: Vec3 = [0, 0, 0];
  /** The basis' poles that lie on a lattice vertex of some face: face, lattice u and v, three numbers each. */
  private readonly poles = new Float64Array(6);
  private poleCount = 0;
  private readonly edgeLon: [number, number] = [0, 0];
  private readonly scratchBasis = new Float64Array(9);

  /**
   * @param selector A selector over a sphere domain. Its patch size and cell pixels are read from its settings.
   * @throws if the selector's domain is not a sphere.
   */
  constructor(selector: LodSelector, options: StretchMetricOptions) {
    const domain = selector.settings.domain;
    if (domain.kind !== 'sphere') throw new Error('StretchMetric needs a sphere domain');
    this.selector = selector;
    this.domain = domain;
    this.patchCells = selector.settings.patchCells;
    this.cellPixels = Math.max(selector.settings.cellPixels, PIXEL_FLOOR);
    this.steps = latticeSteps(this.patchCells, maxLevelFor(selector.settings.patchCells));
    this.morphStep = Math.max(1e-6, options.morphStep ?? DEFAULT_STRETCH_MORPH_STEP);
    this.stalePad = (options.stalePadPerMorph ?? DEFAULT_STRETCH_STALE_PAD_PER_MORPH) * this.morphStep;
    const basis = options.basis ?? stretchProjectionBasis(0, 0);
    this.packBasis(basis, this.scratchBasis);
    const morph = clamp01(options.morph ?? 0);
    setMapState(this.live, morph, options.projection ?? 'equal-earth', options.radiusM, this.scratchBasis);
    this.takeSnapshot();
    if (morph > 0) selector.setGeometryHook(this);
  }

  /** The live morph, as last given to {@link update}. */
  get morph(): number {
    return this.live.morph;
  }

  /** The morph node geometry was last measured at: within the morph step of {@link morph} (or exactly 0 when the metric is off). */
  get measuredMorph(): number {
    return this.measuredAt.morph;
  }

  /** The measured cell length is multiplied by `1 + pad`: see {@link DEFAULT_STRETCH_STALE_PAD_PER_MORPH}. */
  get pad(): number {
    return this.stalePad;
  }

  /**
   * Sets the live state and refreshes node geometry when the policy says so; returns true when it did.
   *
   * Policy: the geometry is measured at a morph that lags the live one by less than the morph step. It is refreshed
   * (`selector.invalidateGeometry()`: nodes are measured as they join the next tree) when
   * - the morph has moved by the step or more from the morph it was measured at,
   * - the morph crosses 0 (leaving 0 installs the hook; arriving at exactly 0 removes it and the default metric returns), or
   * - the projection, the radius or the basis changes while the morph is above 0.
   * Below the step nothing happens and the next `select` is not forced to rebuild. At morph 0 the projection, radius and basis
   * are irrelevant to the sphere metric, so changing them costs nothing.
   */
  update(state: StretchState): boolean {
    const live = this.live;
    const morph = state.morph === undefined ? live.morph : clamp01(state.morph);
    const projection = state.projection ?? live.projection;
    const radius = state.radiusM ?? live.radius;
    let basisChanged = false;
    if (state.basis) {
      this.packBasis(state.basis, this.scratchBasis);
      for (let k = 0; k < 9; k++) if (this.scratchBasis[k] !== live.basis[k]) basisChanged = true;
    }
    const others = projection !== live.projection || radius !== live.radius || basisChanged;
    setMapState(live, morph, projection, radius, basisChanged ? this.scratchBasis : live.basis);
    const wasOn = this.measuredAt.morph > 0;
    const nowOn = morph > 0;
    let refresh: boolean;
    if (wasOn !== nowOn) refresh = true;
    else if (!nowOn) refresh = false;
    else refresh = Math.abs(morph - this.measuredAt.morph) >= this.morphStep - 1e-12 || others;
    if (!refresh) return false;
    this.takeSnapshot();
    this.stats.invalidations++;
    if (!nowOn) this.selector.setGeometryHook(undefined);
    else if (this.selector.hook === this) this.selector.invalidateGeometry();
    else this.selector.setGeometryHook(this);
    return true;
  }

  /** Detaches from the selector: its geometry returns to the default on the next selection. */
  dispose(): void {
    if (this.selector.hook === this) this.selector.setGeometryHook(undefined);
  }

  /**
   * The bent body-frame position of the sphere direction `unit` at `heightM` above the surface, at the LIVE morph: where the
   * mesh draws it, so the render camera or a marker. The direction is not normalised for you. The longitude is the principal
   * one of the projection basis (the camera's side of the cut); `refLon`, when given, places it within pi of that.
   * For the selector's view use {@link selectionPoint} instead.
   */
  bentPoint(unit: readonly number[], heightM: number, out: Vec3 = [0, 0, 0], refLon?: number): Vec3 {
    return this.pointIn(this.live, unit, heightM, out, refLon);
  }

  /** The bent up (unit normal) at sphere direction `unit`, at the LIVE morph. */
  bentNormal(unit: readonly number[], out: Vec3 = [0, 0, 0], refLon?: number): Vec3 {
    return this.normalIn(this.live, unit, out, refLon);
  }

  /**
   * Like {@link bentPoint}, but in the frame node geometry was measured in (the morph it was last refreshed at, which lags the
   * live one by less than the morph step). The selector's camera belongs there: the camera and the node bounds then agree on
   * where the ground is, so a lagging morph shifts the selection by a fraction of a step and not by the whole drift of the
   * surface (kilometres at planet scale, which is the whole view at 2 m altitude).
   */
  selectionPoint(unit: readonly number[], heightM: number, out: Vec3 = [0, 0, 0], refLon?: number): Vec3 {
    return this.pointIn(this.measuredAt, unit, heightM, out, refLon);
  }

  /** The bent up at sphere direction `unit` in the frame of {@link selectionPoint} (for the frustum of the selector's view). */
  selectionNormal(unit: readonly number[], out: Vec3 = [0, 0, 0], refLon?: number): Vec3 {
    return this.normalIn(this.measuredAt, unit, out, refLon);
  }

  private pointIn(state: MapState, unit: readonly number[], heightM: number, out: Vec3, refLon?: number): Vec3 {
    const b = state.basis;
    const principal = Math.atan2(unit[0] * b[6] + unit[1] * b[7] + unit[2] * b[8], unit[0] * b[0] + unit[1] * b[1] + unit[2] * b[2]);
    this.place(state, unit[0], unit[1], unit[2], refLon ?? principal, NaN, POLE_OWN);
    const o = POLE_OWN * 3;
    for (let k = 0; k < 3; k++) out[k] = this.pos[o + k] + heightM * this.nrm[o + k];
    return out;
  }

  private normalIn(state: MapState, unit: readonly number[], out: Vec3, refLon?: number): Vec3 {
    this.pointIn(state, unit, 0, out, refLon);
    const o = POLE_OWN * 3;
    for (let k = 0; k < 3; k++) out[k] = this.nrm[o + k];
    return out;
  }

  /**
   * {@link NodeGeometryHook}: measures node (`root`, `level`, `i`, `j`) at the morph the geometry is measured at. The corners,
   * four edge midpoints and the centre go through the map. A pole of the basis at one of the leaf's corners is the map's whole
   * edge: it is sampled at the longitudes of the leaf's two meridian edges (as the mesh's pole-cap copies are), so the bounds
   * hold the 90 degrees of edge the leaf spans.
   */
  measure(root: number, level: number, i: number, j: number, heightLo: number, heightHi: number, out: NodeGeometry): void {
    this.stats.measured++;
    const state = this.measuredAt;
    const { unit, pos, nrm, unitPos, unitNormal } = this;
    const domain = this.domain;
    const size = 1 / 2 ** level;
    // Unit directions of the nine sample points.
    for (let s = 0; s < 9; s++) {
      let a: number;
      let b: number;
      if (s === CENTRE) a = b = 0.5;
      else if (s < MID) {
        a = CORNER_COORD[s - CORNER][0];
        b = CORNER_COORD[s - CORNER][1];
      } else {
        const p = CORNER_COORD[s - MID];
        const q = CORNER_COORD[(s - MID + 1) % 4];
        a = (p[0] + q[0]) / 2;
        b = (p[1] + q[1]) / 2;
      }
      domainPoint(domain, root, (i + a) * size, (j + b) * size, unitPos, unitNormal);
      unit[s * 3] = unitNormal[0];
      unit[s * 3 + 1] = unitNormal[1];
      unit[s * 3 + 2] = unitNormal[2];
    }
    const bs = state.basis;
    const refLon = Math.atan2(unit[0] * bs[6] + unit[1] * bs[7] + unit[2] * bs[8], unit[0] * bs[0] + unit[1] * bs[1] + unit[2] * bs[2]);
    const span = this.steps / 2 ** level;
    const u0 = i * span;
    const v0 = j * span;
    if (this.poleInside(root, u0, v0, span)) {
      // A pole of the basis strictly inside the leaf: its longitudes run through everything, so no sample set bounds it. The
      // leaf is the map's whole width (the mesh draws it with its pole fan): bounds as big as the map, so it always splits
      // (down to the deepest level, a chain of a few leaves) and is never culled.
      this.place(state, unit[0], unit[1], unit[2], refLon, NaN, CENTRE);
      const reach = TORN_REACH_RADII * state.radius;
      const halfRange = (heightHi - heightLo) / 2;
      const mid = (heightHi + heightLo) / 2;
      for (let c = 0; c < 3; c++) {
        out.ground[c] = pos[c];
        out.normal[c] = nrm[c];
        out.centre[c] = pos[c] + nrm[c] * mid;
      }
      out.boundRadius = reach + halfRange;
      out.across = reach;
      out.alongHalf = reach + halfRange;
      out.leafEdge = reach;
      out.cellEdge = (reach / this.patchCells) * (1 + this.stalePad);
      return;
    }
    const poleCorner = this.poleCornerOf(root, u0, v0, span);
    let poleSlot = -1;
    if (poleCorner >= 0) {
      poleSlot = CORNER + (poleCorner & 1 ? (poleCorner >> 1 ? 2 : 1) : poleCorner >> 1 ? 3 : 0);
      this.edgeLongitudes(root, u0, v0, span, poleCorner & 1, poleCorner >> 1, refLon);
    }
    for (let s = 0; s < 9; s++) {
      if (s === poleSlot) continue;
      this.place(state, unit[s * 3], unit[s * 3 + 1], unit[s * 3 + 2], refLon, NaN, s);
    }
    if (poleSlot >= 0) {
      const o = poleSlot * 3;
      this.place(state, unit[o], unit[o + 1], unit[o + 2], refLon, this.edgeLon[0], POLE_X);
      this.place(state, unit[o], unit[o + 1], unit[o + 2], refLon, this.edgeLon[1], POLE_Y);
      this.place(state, unit[o], unit[o + 1], unit[o + 2], refLon, refLon, POLE_OWN);
    }
    // Longest morphed edge and the largest sag of a morphed edge midpoint (or of the centre) from the chord (or the corner mean).
    let leafEdge = 0;
    let sag = 0;
    let meanX = 0;
    let meanY = 0;
    let meanZ = 0;
    for (let e = 0; e < 4; e++) {
      const ca = e;
      const cb = (e + 1) % 4;
      const pa = this.edgeEnd(ca, cb, poleSlot);
      const pb = this.edgeEnd(cb, ca, poleSlot);
      const dx = pos[pa] - pos[pb];
      const dy = pos[pa + 1] - pos[pb + 1];
      const dz = pos[pa + 2] - pos[pb + 2];
      leafEdge = Math.max(leafEdge, Math.hypot(dx, dy, dz));
      const m = (MID + e) * 3;
      sag = Math.max(sag, Math.hypot(pos[m] - (pos[pa] + pos[pb]) / 2, pos[m + 1] - (pos[pa + 1] + pos[pb + 1]) / 2, pos[m + 2] - (pos[pa + 2] + pos[pb + 2]) / 2));
      const own = (CORNER + ca === poleSlot ? POLE_OWN : CORNER + ca) * 3;
      meanX += pos[own] / 4;
      meanY += pos[own + 1] / 4;
      meanZ += pos[own + 2] / 4;
    }
    sag = Math.max(sag, Math.hypot(pos[0] - meanX, pos[1] - meanY, pos[2] - meanZ));
    if (poleSlot >= 0) {
      // The pole corner is a whole edge of the map: the leaf is that wide there, and the chain above never walks it.
      const a = POLE_X * 3;
      const b = POLE_Y * 3;
      leafEdge = Math.max(leafEdge, Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]));
    }
    // Bounds, from the centre outwards: the largest distance, the largest distance along and across the normal, and the largest tilt of a sample normal.
    const cx = pos[0];
    const cy = pos[1];
    const cz = pos[2];
    const nx = nrm[0];
    const ny = nrm[1];
    const nz = nrm[2];
    let reach = 0;
    let along = 0;
    let across = 0;
    let tilt = 0;
    for (let s = 1; s < SLOTS; s++) {
      if (s === poleSlot) continue;
      if (poleSlot < 0 && s >= POLE_X) break;
      const o = s * 3;
      const dx = pos[o] - cx;
      const dy = pos[o + 1] - cy;
      const dz = pos[o + 2] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const a = dx * nx + dy * ny + dz * nz;
      reach = Math.max(reach, d2);
      along = Math.max(along, Math.abs(a));
      across = Math.max(across, d2 - a * a);
      tilt = Math.max(tilt, Math.hypot(nrm[o] - nx, nrm[o + 1] - ny, nrm[o + 2] - nz));
    }
    reach = Math.sqrt(reach);
    across = Math.sqrt(Math.max(across, 0));
    const halfRange = (heightHi - heightLo) / 2;
    const mid = (heightHi + heightLo) / 2;
    const maxAbs = Math.max(Math.abs(heightLo), Math.abs(heightHi));
    out.ground[0] = cx;
    out.ground[1] = cy;
    out.ground[2] = cz;
    out.normal[0] = nx;
    out.normal[1] = ny;
    out.normal[2] = nz;
    out.centre[0] = cx + nx * mid;
    out.centre[1] = cy + ny * mid;
    out.centre[2] = cz + nz * mid;
    // A sample at height h along its own normal n_s: from the box centre it is d + h n_s - mid n_c, and
    // h n_s - mid n_c = (h - mid) n_s + mid (n_s - n_c), so the sphere holds it at reach + halfRange + |mid| tilt.
    // Nine samples bound a leaf only up to the curvature between them (the map is not flat inside the leaf): the sag, which is the
    // second-order size of that, pads each bound. The spec samples 81 points of each leaf, at three heights, against it.
    // The same bounds are also padded for the morph lag (see the staleness paragraph above): by the leaf's own size times the pad,
    // so a node that moved or grew by a step's worth since it was measured still holds the camera where it now is.
    const margin = BOUND_SAG_MARGIN * sag + this.stalePad * reach;
    out.boundRadius = reach + halfRange + Math.abs(mid) * tilt + margin;
    // Across the normal only h n_s - mid n_c matters via h perp(n_s) (|perp(n_s)| <= tilt); along it, h (n_s . n_c) is within h tilt^2 / 2 of h.
    out.across = across + maxAbs * tilt + margin;
    out.alongHalf = halfRange + along + (maxAbs * tilt * tilt) / 2 + margin;
    out.leafEdge = leafEdge;
    const cellEdge = leafEdge / this.patchCells;
    const cellSag = sag / (this.patchCells * this.patchCells);
    out.cellEdge = Math.max(cellEdge, (cellSag * this.cellPixels) / STRETCH_SAG_PX) * (1 + this.stalePad);
  }

  /** The `pos` offset of corner `c` as one end of the edge towards corner `other`: the pole corner takes the longitude of that meridian edge. */
  private edgeEnd(c: number, other: number, poleSlot: number): number {
    if (CORNER + c !== poleSlot) return (CORNER + c) * 3;
    // Same y index as the other end: the edge runs along the grid's x axis.
    return (CORNER_COORD[other][1] === CORNER_COORD[c][1] ? POLE_X : POLE_Y) * 3;
  }

  /** Snapshots the live state as the one node geometry is measured at, and finds the basis' poles on the lattice. */
  private takeSnapshot(): void {
    const live = this.live;
    const state = this.measuredAt;
    setMapState(state, live.morph, live.projection, live.radius, live.basis);
    this.poleCount = 0;
    const b = state.basis;
    for (let sign = 1; sign >= -1; sign -= 2) {
      const pole = faceOfDirection(b[3] * sign, b[4] * sign, b[5] * sign);
      const steps = this.steps;
      const lattice = (c: number): number => (this.domain.warp === 'none' ? c * steps : (Math.atan(c) / (Math.PI / 4)) * steps);
      const o = this.poleCount * 3;
      this.poles[o] = pole.face;
      this.poles[o + 1] = (lattice(pole.s) + steps) / 2;
      this.poles[o + 2] = (lattice(pole.t) + steps) / 2;
      this.poleCount++;
    }
  }

  /** Whether a pole of the basis lies strictly inside the leaf (further than 1e-6 of the span from every side). */
  private poleInside(face: number, u0: number, v0: number, span: number): boolean {
    const eps = 1e-6 * span;
    for (let p = 0; p < this.poleCount; p++) {
      if (this.poles[p * 3] !== face) continue;
      const u = this.poles[p * 3 + 1];
      const v = this.poles[p * 3 + 2];
      if (u > u0 + eps && u < u0 + span - eps && v > v0 + eps && v < v0 + span - eps) return true;
    }
    return false;
  }

  /** The corner (cx + 2 cy) of the leaf at which a pole of the basis sits, within 1e-6 of the span, or -1. */
  private poleCornerOf(face: number, u0: number, v0: number, span: number): number {
    const eps = 1e-6 * span;
    for (let p = 0; p < this.poleCount; p++) {
      if (this.poles[p * 3] !== face) continue;
      const u = this.poles[p * 3 + 1];
      const v = this.poles[p * 3 + 2];
      const cx = Math.abs(u - u0) <= eps ? 0 : Math.abs(u - (u0 + span)) <= eps ? 1 : -1;
      const cy = Math.abs(v - v0) <= eps ? 0 : Math.abs(v - (v0 + span)) <= eps ? 1 : -1;
      if (cx >= 0 && cy >= 0) return cx + 2 * cy;
    }
    return -1;
  }

  /**
   * The longitudes of the two meridian edges that meet at the leaf's pole corner, within pi of `leafLon`: `edgeLon[0]` for the
   * edge along the grid's x axis, `edgeLon[1]` for the one along y.
   */
  private edgeLongitudes(face: number, u0: number, v0: number, span: number, cx: number, cy: number, leafLon: number): void {
    const vEdge = v0 + cy * span;
    const uEdge = u0 + cx * span;
    this.edgeLon[0] = this.nearLon(this.latticeLongitude(face, u0 + span / 2, vEdge), leafLon);
    this.edgeLon[1] = this.nearLon(this.latticeLongitude(face, uEdge, v0 + span / 2), leafLon);
  }

  private nearLon(lon: number, ref: number): number {
    return lon + TWO_PI * Math.round((ref - lon) / TWO_PI);
  }

  /** Longitude, in the measured basis, of the exact lattice point (u, v) of `face`. */
  private latticeLongitude(face: number, u: number, v: number): number {
    const t = cubeLattice(face, u, v, this.steps, this.lattice);
    const warp = this.domain.warp;
    const x = cubeComponent(t[0], this.steps, warp);
    const y = cubeComponent(t[1], this.steps, warp);
    const z = cubeComponent(t[2], this.steps, warp);
    const l = Math.hypot(x, y, z);
    const b = this.measuredAt.basis;
    return Math.atan2((x * b[6] + y * b[7] + z * b[8]) / l, (x * b[0] + y * b[1] + z * b[2]) / l);
  }

  /**
   * Puts the sphere direction (ux, uy, uz) on the bent surface of `state` and writes the body-frame position and normal into the
   * scratch `slot`. The longitude is `poleLon` when given (the exact pole has none of its own), else the principal one placed
   * within pi of `refLon`.
   */
  private place(state: MapState, ux: number, uy: number, uz: number, refLon: number, poleLon: number, slot: number): void {
    const b = state.basis;
    const v1 = ux * b[0] + uy * b[1] + uz * b[2];
    const v2 = ux * b[6] + uy * b[7] + uz * b[8];
    const lat = Math.atan2(ux * b[3] + uy * b[4] + uz * b[5], Math.hypot(v1, v2));
    let lon: number;
    if (poleLon === poleLon) lon = poleLon;
    else {
      const principal = Math.atan2(v2, v1);
      lon = principal + TWO_PI * Math.round((refLon - principal) / TWO_PI);
    }
    const xy = stretchMapXY(lon, lat, state.morph, state.projection, state.radius, this.xy);
    const x = xy[0];
    const y = xy[1];
    // The bend (`bend()` of atmosphere/bent-planet.ts) of the map point at height 0, in the map frame.
    const k = state.k;
    const kx = k * x;
    const ky = k * y;
    const cx = Math.cos(kx);
    const sx = Math.sin(kx);
    const cy = Math.cos(ky);
    const sy = Math.sin(ky);
    const hx = sinc(kx / 2);
    const hy = sinc(ky / 2);
    const mx = cy * x * sinc(kx);
    const my = y * sinc(ky);
    const mz = -(0.5 * k * x * x * hx * hx + cx * 0.5 * k * y * y * hy * hy) + state.shift;
    const o = slot * 3;
    const nxm = cy * sx;
    const nym = sy;
    const nzm = cx * cy;
    // Map frame to body frame: right x + up y + forward z.
    for (let c = 0; c < 3; c++) {
      this.pos[o + c] = b[6 + c] * mx + b[3 + c] * my + b[c] * mz;
      this.nrm[o + c] = b[6 + c] * nxm + b[3 + c] * nym + b[c] * nzm;
    }
  }

  private packBasis(basis: StretchBasis, out: Float64Array): void {
    for (let c = 0; c < 3; c++) {
      out[c] = basis.forward[c];
      out[3 + c] = basis.up[c];
      out[6 + c] = basis.right[c];
    }
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
