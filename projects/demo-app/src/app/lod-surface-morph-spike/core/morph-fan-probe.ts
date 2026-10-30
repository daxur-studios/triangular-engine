import { FAN_DEFAULT_RAYS, FAN_SPEC_STRIDE, SPEC, buildFanSpecs, placeFanSpecs, type FanLeaf, type FanSpecs } from './morph-fan';
import { packVertexFan, type VertexFanData } from './morph-fan-vertex';
import { latticeDirection, type MorphFrame, type MorphPoseId } from './morph-frame';
import type { StretchContext } from './morph-stretch';

/**
 * Plan 059 morph spike, iteration 5: the fan precision probe. For each case (radius, morph, projection centre, camera pose) it takes the
 * pole leaves the selector picks, builds the fan's descriptions (`buildFanSpecs`), has the GPU vertex stage evaluate every vertex
 * (`createFanKernel`: the same position node the drawn fan uses, float32) and compares the camera-relative result with the double-precision
 * placement of the same descriptions (`placeFanSpecs`, the CPU fan's own numbers) in pixels: error / distance to the vertex x focal length.
 *
 * The reference is given the same float32 lattice input the vertex stage is (the pole's longitude and the window longitudes reach the GPU as
 * float32 attributes, like those of the instanced leaves), so what is measured is the vertex stage's arithmetic. The roundings of those
 * attributes are the same in the leaves the fan sits next to.
 */

/** A pose of the probe: a preset, optionally at another altitude (for example the pole view at 2 m). */
export interface FanProbePose {
  readonly view: MorphPoseId;
  /** Metres above the ground, replacing the preset's. */
  readonly altitudeM?: number;
}

/** One case of the matrix. */
export interface FanProbeCase extends FanProbePose {
  readonly radiusM: number;
  readonly morph: number;
  readonly centreLonDeg: number;
  readonly centreLatDeg: number;
  readonly rays: number;
}

/** What the probe needs from the page: one case's frame and fan leaves, and the vertex stage's evaluation of a packed fan. */
export interface FanProbeHost {
  /** Puts the case in place (frame, selection of the pole leaves) and returns them with the stretch context of the placement. */
  prepare(c: FanProbeCase): { frame: MorphFrame; leaves: readonly FanLeaf[]; ctx: StretchContext };
  /** Runs the packed fan on the GPU at the case's frame; returns xyz and a 0 per vertex. */
  run(data: VertexFanData, frame: MorphFrame): Promise<Float32Array>;
}

/** Error statistics of a set of vertices. */
export interface FanErrorStats {
  readonly vertices: number;
  readonly maxErrPx: number;
  readonly p99ErrPx: number;
  readonly maxErrM: number;
}

/** One row of the result. */
export interface FanProbeRow extends FanProbeCase {
  readonly label: string;
  readonly leaves: number;
  readonly corner: number;
  readonly interior: number;
  readonly vertices: number;
  /** All vertices, the polar ones (rings and the pole), the boundary (chord) ones and those on the camera's own sheet of the map. */
  readonly all: FanErrorStats;
  readonly polar: FanErrorStats;
  readonly chord: FanErrorStats;
  readonly own: FanErrorStats;
  /**
   * The boundary vertices by their angular distance from the pole ({@link FAN_POLE_BANDS}, the lower edges in radians): within `poleZoneRad` of the
   * pole the lattice stage the boundary shares with its neighbours cannot place the longitude (see {@link FAN_POLE_ZONE_RAD}).
   */
  readonly chordBands: readonly { readonly fromRad: number; readonly toRad: number; readonly stats: FanErrorStats }[];
  /** The boundary vertices inside the pole zone, and the polar and boundary vertices outside it together (the ones the check judges). */
  readonly poleZone: FanErrorStats;
  readonly judged: FanErrorStats;
  /** Vertices whose position the GPU returned as NaN or infinity. */
  readonly nonFinite: number;
  /** The worst vertex (by pixels): its kind, distance from the camera, error in metres and pixels. */
  readonly worst: { readonly kind: 'polar' | 'chord'; readonly distM: number; readonly errM: number; readonly errPx: number; readonly where?: string };
  /** Distance from the camera to the nearest fan vertex, metres. */
  readonly nearestM: number;
  /** CPU milliseconds of the descriptions and of the pack. */
  readonly buildMs: number;
  readonly ms: number;
}

/** Options of {@link runFanProbe}. */
export interface FanProbeOptions {
  readonly radii?: readonly number[];
  readonly morphs?: readonly number[];
  readonly poses?: readonly FanProbePose[];
  /** Projection centres, degrees. */
  readonly centres?: readonly { readonly lonDeg: number; readonly latDeg: number }[];
  readonly rays?: number;
  /** Viewport height and field of view that define a pixel. */
  readonly viewportHeightPx?: number;
  readonly fovDeg?: number;
  readonly onProgress?: (done: number, total: number, row: FanProbeRow) => void;
}

/** The probe's matrix: both radii, morph 0.5 and 1, the centred (corner pole) and tilted (interior pole) centre, the pole view at 200 m and at 2 m and the 2 m pole preset. */
export const FAN_PROBE_DEFAULTS = {
  radii: [600_000, 6_371_000] as readonly number[],
  morphs: [0.5, 1] as readonly number[],
  poses: [{ view: 'pole-200m' }, { view: 'pole-200m', altitudeM: 2 }, { view: 'pole-2m' }] as readonly FanProbePose[],
  centres: [{ lonDeg: 0, latDeg: 0 }, { lonDeg: 20, latDeg: 35 }] as readonly { lonDeg: number; latDeg: number }[],
  rays: FAN_DEFAULT_RAYS,
  viewportHeightPx: 1080,
  fovDeg: 60,
};

const PI = Math.PI;

/**
 * The angular distance from the pole (radians) inside which the boundary vertices are reported but not judged: 0.01 degrees, the band the P2
 * precision probe also separates (`poleBands`). A lattice vertex there is a few metres (600 km radius: 100 m) from the pole, and the longitude
 * the lattice stage derives for it from the float32 direction is ill-conditioned (an error of 6e-8 in a direction component is 6e-8 / colatitude
 * of longitude, and near the pole the map's x is that longitude times the radius), exactly as in the instanced leaves the boundary is drawn by.
 */
export const FAN_POLE_ZONE_RAD = (0.01 * Math.PI) / 180;

/** The bands the boundary vertices are binned into, lower edges in radians; the last is open. */
export const FAN_POLE_BANDS: readonly number[] = [0, 1e-5, FAN_POLE_ZONE_RAD, 10 * FAN_POLE_ZONE_RAD];

/** The label of a case: `radius km view[ at altitude] m<morph> centre`. */
export function fanProbeLabel(c: FanProbeCase): string {
  return `${c.radiusM / 1000} km ${c.view}${c.altitudeM !== undefined ? ` @${c.altitudeM} m` : ''} m${c.morph} centre ${c.centreLonDeg},${c.centreLatDeg} ${c.rays} rays`;
}

/** The cases of a matrix, in the order they run. */
export function fanProbeCases(options: FanProbeOptions = {}): FanProbeCase[] {
  const cases: FanProbeCase[] = [];
  const rays = options.rays ?? FAN_PROBE_DEFAULTS.rays;
  for (const radiusM of options.radii ?? FAN_PROBE_DEFAULTS.radii) {
    for (const centre of options.centres ?? FAN_PROBE_DEFAULTS.centres) {
      for (const pose of options.poses ?? FAN_PROBE_DEFAULTS.poses) {
        for (const morph of options.morphs ?? FAN_PROBE_DEFAULTS.morphs) {
          cases.push({ radiusM, morph, view: pose.view, altitudeM: pose.altitudeM, centreLonDeg: centre.lonDeg, centreLatDeg: centre.latDeg, rays });
        }
      }
    }
  }
  return cases;
}

/** An accumulator of pixel errors: the maximum, the worst vertex and the sorted samples of the 99th percentile. */
class Stats {
  private readonly px: number[] = [];
  private maxPx = 0;
  private maxM = 0;
  add(px: number, m: number): void {
    this.px.push(px);
    if (px > this.maxPx) this.maxPx = px;
    if (m > this.maxM) this.maxM = m;
  }
  result(): FanErrorStats {
    const sorted = Float64Array.from(this.px).sort();
    return {
      vertices: sorted.length, maxErrPx: this.maxPx, maxErrM: this.maxM,
      p99ErrPx: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0,
    };
  }
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

/** Runs the fan precision probe over the matrix with the given host. */
export async function runFanProbe(host: FanProbeHost, options: FanProbeOptions = {}): Promise<FanProbeRow[]> {
  const cases = fanProbeCases(options);
  const viewport = options.viewportHeightPx ?? FAN_PROBE_DEFAULTS.viewportHeightPx;
  const fovDeg = options.fovDeg ?? FAN_PROBE_DEFAULTS.fovDeg;
  const focalPx = viewport / (2 * Math.tan((fovDeg * PI) / 360));
  const rows: FanProbeRow[] = [];
  for (const c of cases) {
    const began = performance.now();
    const { frame, leaves, ctx } = host.prepare(c);
    const specs = buildFanSpecs(ctx, leaves, c.rays);
    const data = packVertexFan(specs);
    const buildMs = performance.now() - began;
    const gpu = specs.vertexCount > 0 ? await host.run(data, frame) : new Float32Array(0);
    const reference = placeFanSpecs(ctx, specs, 0, { float32Lattice: true });
    const cam = frame.camBody;
    const all = new Stats();
    const polar = new Stats();
    const chord = new Stats();
    const own = new Stats();
    const bands = FAN_POLE_BANDS.map(() => new Stats());
    const zone = new Stats();
    const judged = new Stats();
    const cell = (l: FanLeaf): number => l.span / ctx.patchCells;
    const colatOfEnd = (l: FanLeaf, gx: number, gy: number): number => {
      const unit = latticeDirection(l.face, l.u0 + gx * cell(l), l.v0 + gy * cell(l), ctx.steps, ctx.domain);
      const up = ctx.basis.up;
      return Math.acos(Math.min(1, Math.max(-1, unit[0] * up[0] + unit[1] * up[1] + unit[2] * up[2])));
    };
    let nonFinite = 0;
    let nearest = Infinity;
    let worst: FanProbeRow['worst'] = { kind: 'chord', distM: 0, errM: 0, errPx: -1 };
    for (let v = 0; v < specs.vertexCount; v++) {
      const rx = reference[v * 3] - cam[0];
      const ry = reference[v * 3 + 1] - cam[1];
      const rz = reference[v * 3 + 2] - cam[2];
      const dist = Math.max(0.01, Math.hypot(rx, ry, rz));
      if (dist < nearest) nearest = dist;
      const gx = gpu[v * 4];
      const gy = gpu[v * 4 + 1];
      const gz = gpu[v * 4 + 2];
      if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz)) {
        nonFinite++;
        continue;
      }
      const errM = Math.hypot(gx - rx, gy - ry, gz - rz);
      const errPx = (errM / dist) * focalPx;
      const o = v * FAN_SPEC_STRIDE;
      const isPolar = specs.data[o + SPEC.KIND] === 1;
      const lon = isPolar ? specs.data[o + SPEC.LON] : specs.data[o + SPEC.REFA];
      all.add(errPx, errM);
      (isPolar ? polar : chord).add(errPx, errM);
      let colat: number;
      if (isPolar) colat = specs.data[o + SPEC.C];
      else {
        const l = specs.leaves[specs.data[o + SPEC.LEAF]];
        const w = specs.data[o + SPEC.W];
        const ca = colatOfEnd(l, specs.data[o + SPEC.GXA], specs.data[o + SPEC.GYA]);
        colat = w === 0 ? ca : ca + (colatOfEnd(l, specs.data[o + SPEC.GXB], specs.data[o + SPEC.GYB]) - ca) * w;
      }
      if (!isPolar) {
        let band = 0;
        while (band + 1 < FAN_POLE_BANDS.length && colat >= FAN_POLE_BANDS[band + 1]) band++;
        bands[band].add(errPx, errM);
      }
      (!isPolar && colat < FAN_POLE_ZONE_RAD ? zone : judged).add(errPx, errM);
      if (Math.abs(lon - frame.lambdaC) <= PI) own.add(errPx, errM);
      if (errPx > worst.errPx) {
        const at = (k: number): number => specs.data[o + k];
        const where = isPolar
          ? 'polar leaf ' + at(SPEC.LEAF) + ' lon ' + at(SPEC.LON).toFixed(6) + ' c ' + at(SPEC.C).toExponential(3)
          : 'chord leaf ' + at(SPEC.LEAF) + ' A ' + at(SPEC.GXA) + ',' + at(SPEC.GYA) + ' ref ' + at(SPEC.REFA).toFixed(6) + ' B ' + at(SPEC.GXB) + ',' + at(SPEC.GYB) + ' w ' + at(SPEC.W).toFixed(4)
            + ' poleLon ' + at(SPEC.POLE_LON) + ' gpu ' + [gx, gy, gz].map((x) => x.toFixed(3)).join(',') + ' ref ' + [rx, ry, rz].map((x) => x.toFixed(3)).join(',');
        worst = { kind: isPolar ? 'polar' : 'chord', distM: dist, errM, errPx, where };
      }
    }
    const row: FanProbeRow = {
      ...c, label: fanProbeLabel(c), leaves: leaves.length, corner: specs.corner, interior: specs.interior, vertices: specs.vertexCount,
      all: all.result(), polar: polar.result(), chord: chord.result(), own: own.result(),
      chordBands: FAN_POLE_BANDS.map((from, k) => ({ fromRad: from, toRad: FAN_POLE_BANDS[k + 1] ?? PI, stats: bands[k].result() })),
      poleZone: zone.result(), judged: judged.result(), nonFinite, worst: worst.errPx < 0 ? { ...worst, errPx: 0 } : worst,
      nearestM: Number.isFinite(nearest) ? nearest : 0, buildMs, ms: performance.now() - began,
    };
    rows.push(row);
    options.onProgress?.(rows.length, cases.length, row);
    await yieldToUi();
  }
  return rows;
}
