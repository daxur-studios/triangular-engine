/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fn, If, float, instanceIndex, instancedArray, int, floor, uniform, vec2, vec4 } from 'three/tsl';
import {
  CAP_SLACK,
  LodSelector,
  foldedGrid,
  latticeSteps,
  maxLevelFor,
  newAnchor,
  type LodDomain,
  type PatchCells,
  type Vec3,
} from 'triangular-engine/lod-surface/core';
import {
  MORPH_POSES,
  computeMorphFrame,
  latticeDirection,
  projectionBasis,
  referenceVertex,
  type MorphPoseId,
  type MorphView,
} from './morph-frame';
import { packMorphLeaves } from './morph-leaves';
import { createMorphVertex, type MorphMethod } from './morph-surface-mesh';

/**
 * Plan 059 morph spike, the precision probe. For each case (radius, morph, camera pose, method) it takes the leaves the
 * selector picks for the unbent camera, evaluates every vertex of every leaf in a compute kernel that runs the same vertex
 * builder as the drawn mesh (`createMorphVertex`, float32 on the GPU), and compares the camera-relative position with the
 * reference of `referenceVertex` (doubles). The camera is `pose.altitudeM` above the ground, in the projection basis
 * (centre lon 0, lat 0), at the bent position.
 *
 * What is reported per case:
 * - error in metres and in pixels (error / distance to the vertex * focal length in pixels), maximum and 99th percentile,
 *   over the vertices on the camera's own sheet of the map (|lon - camera lon| <= pi) and over all vertices. Vertices on the
 *   other sheet at morph below 1 keep an error of the size of the map's width by construction (the part 2 duplicates are
 *   meant to cover them), so they are kept apart;
 * - the worst vertex' distance and latitude;
 * - at morph 0 (method P2): whether the drawn position is bit-for-bit the unbent "today" position;
 * - at morph 1e-4: the largest jump from the morph-0 draw of the same case, in metres and pixels, next to the jump the
 *   reference itself has (the map really moves a little).
 */

/** The renderer calls the probe uses (three's `WebGPURenderer`). */
export interface ProbeRenderer {
  computeAsync(node: unknown): Promise<void>;
  getArrayBufferAsync(attribute: unknown): Promise<ArrayBuffer>;
}

/** Error statistics of the own-sheet vertices in one band of angular distance q from the nearest pole of the projection basis. */
export interface PoleBand {
  label: string;
  /** Band limits in degrees: fromDeg <= q < toDeg (q = 0 exactly for the first band). */
  fromDeg: number;
  toDeg: number;
  vertices: number;
  maxErrPx: number;
  maxErrM: number;
  p99ErrPx: number;
  /** Distance from the camera of the band's worst vertex (by pixels). */
  worstDistM: number;
}

/** The worst own-sheet vertex outside the pole cap (by pixels). */
export interface WorstVertex {
  distM: number;
  latDeg: number;
  lonDeg: number;
  errM: number;
  errPx: number;
}

/** Pole bands: q = angular distance from the nearest pole, degrees. */
export const POLE_BANDS: readonly { label: string; fromDeg: number; toDeg: number }[] = [
  { label: 'q=0', fromDeg: 0, toDeg: 0 },
  { label: '<0.01', fromDeg: 0, toDeg: 0.01 },
  { label: '0.01-0.1', fromDeg: 0.01, toDeg: 0.1 },
  { label: '0.1-1', fromDeg: 0.1, toDeg: 1 },
  { label: '1-5', fromDeg: 1, toDeg: 5 },
  { label: '>5', fromDeg: 5, toDeg: 90.0001 },
];

/** One row of the probe's table. */
export interface ProbeResult {
  radiusM: number;
  morph: number;
  pose: MorphPoseId;
  method: MorphMethod;
  /** Height of every vertex above the base surface. */
  heightM: number;
  leaves: number;
  vertices: number;
  /** Vertices on the camera's own sheet. */
  nearVertices: number;
  /** Own-sheet error, metres and pixels: maximum and 99th percentile. */
  maxErrM: number;
  maxErrPx: number;
  p99ErrM: number;
  p99ErrPx: number;
  /** The worst own-sheet vertex (by metres): its distance from the camera and its latitude, longitude (degrees, projection basis). */
  worstDistM: number;
  worstLatDeg: number;
  worstLonDeg: number;
  /** All-vertices maximum, metres and pixels (includes the far sheet). */
  allMaxErrM: number;
  allMaxErrPx: number;
  /** Vertices whose unwrap integer disagrees with the reference's. */
  wrapMismatch: number;
  /** Morph 0 and P2 only: the drawn positions equal the unbent "today" bit for bit. */
  bitEqualToday?: boolean;
  /** Morph 1e-4 only. */
  jump?: { gpuMaxM: number; gpuMaxPx: number; refMaxM: number; refMaxPx: number; worstDistM: number };
  /** Own-sheet maximum error below one pixel. */
  underPixel: boolean;
  /** The pole cap (degrees from the nearest pole) the `...OutsideCap` fields leave out. */
  poleCapDeg: number;
  /** Own-sheet error of the vertices farther than `poleCapDeg` from both poles. */
  maxErrPxOutsideCap: number;
  maxErrMOutsideCap: number;
  p99ErrPxOutsideCap: number;
  /** The worst such vertex. */
  worstOutsideCap: WorstVertex;
  /** `maxErrPxOutsideCap` below one pixel. */
  underPixelOutsideCap: boolean;
  /**
   * Error by angular distance from the nearest pole of the projection basis ({@link POLE_BANDS}). Own-sheet vertices, plus
   * the vertices exactly at a pole (q = 0), which belong to every sheet.
   */
  poleBands: PoleBand[];
  /** Wall time of the case, ms. */
  ms: number;
}

/** What to run. Defaults are the plan's matrix. */
export interface ProbeOptions {
  radii?: readonly number[];
  morphs?: readonly number[];
  poses?: readonly MorphPoseId[];
  methods?: readonly MorphMethod[];
  /** Also the 500 m constant-offset height test (6,371 km, morph 0.5, mid-latitude pose). */
  heightTest?: boolean;
  /** Leaves selected at most (vertices per leaf: 289). */
  leafCap?: number;
  /** Viewport height and field of view that define a pixel. */
  viewportHeightPx?: number;
  fovDeg?: number;
  /** Degrees from the nearest pole that `maxErrPxOutsideCap` leaves out (default 1). */
  poleCapDeg?: number;
  onProgress?: (done: number, total: number, row: ProbeResult) => void;
}

/** The probe's matrix. */
export const PROBE_DEFAULTS = {
  radii: [600_000, 6_371_000],
  morphs: [0, 1e-4, 0.5, 1],
  poses: ['mid-2m', 'cut-2m', 'pole-2m', 'centre-2m'] as MorphPoseId[],
  methods: ['p2', 'naive'] as MorphMethod[],
  leafCap: 1024,
  viewportHeightPx: 1080,
  fovDeg: 60,
  heightM: 500,
};

const PATCH_CELLS: PatchCells = 16;
const SIDE = PATCH_CELLS + 1;
const VERTS = SIDE * SIDE;
const BATCH = 65_536;
const PI = Math.PI;

interface ProbeCaseData {
  readonly domain: LodDomain;
  readonly steps: number;
  readonly leaves: number;
  readonly vertices: number;
  readonly leafData: Float32Array;
  readonly infoData: Float32Array;
  /** Unit direction of every vertex (3 per vertex), after folding. */
  readonly directions: Float64Array;
  readonly sigma: Float32Array;
  /** The longitude the pole vertex of each vertex's leaf takes (`aInfo.w`). */
  readonly poleLon: Float32Array;
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

/** Builds the compute kernel and runs cases against it. */
export function createMorphProbe(renderer: ProbeRenderer, capacity: number, domainOfRadius: (radiusM: number) => LodDomain) {
  const domain0 = domainOfRadius(6_371_000);
  const vertex = createMorphVertex(domain0, PATCH_CELLS);
  const leafBuffer = instancedArray(capacity, 'vec4') as any;
  const infoBuffer = instancedArray(capacity, 'vec4') as any;
  const selectedBuffer = instancedArray(BATCH, 'vec4') as any;
  const todayBuffer = instancedArray(BATCH, 'vec4') as any;
  const uOffset = uniform(0, 'int') as any;
  const uCount = uniform(0, 'int') as any;

  const kernel = Fn(() => {
    const i = int(instanceIndex).toVar();
    If(i.lessThan(uCount), () => {
      const v = float(i.add(uOffset)).toVar();
      const k = floor(v.add(0.5).div(VERTS)).toVar();
      const local = v.sub(k.mul(VERTS));
      const gy = floor(local.add(0.5).div(SIDE));
      const gx = local.sub(gy.mul(SIDE));
      const leafIndex = int(k);
      const nodes = vertex.build(vec2(gx, gy), leafBuffer.element(leafIndex), infoBuffer.element(leafIndex));
      selectedBuffer.element(i).assign(vec4(nodes.selected, nodes.wrapN));
      todayBuffer.element(i).assign(vec4(nodes.today, 0));
    });
  });
  const kernelNode = (kernel() as any).compute(BATCH, [64]);

  /** Runs the kernel over all vertices; returns the selected (xyz + unwrap n) and today (xyz) per vertex. */
  async function dispatch(data: ProbeCaseData): Promise<{ selected: Float32Array; today: Float32Array }> {
    const selected = new Float32Array(data.vertices * 4);
    const today = new Float32Array(data.vertices * 4);
    for (let start = 0; start < data.vertices; start += BATCH) {
      const count = Math.min(BATCH, data.vertices - start);
      uOffset.value = start;
      uCount.value = count;
      await renderer.computeAsync(kernelNode);
      const a = new Float32Array(await renderer.getArrayBufferAsync(selectedBuffer.value));
      const b = new Float32Array(await renderer.getArrayBufferAsync(todayBuffer.value));
      selected.set(a.subarray(0, count * 4), start * 4);
      today.set(b.subarray(0, count * 4), start * 4);
    }
    return { selected, today };
  }

  /** Selects and packs the leaves of a (radius, pose) and computes every vertex' direction in doubles. */
  function prepare(radiusM: number, pose: MorphPoseId, leafCap: number, viewport: number, fovDeg: number): { data: ProbeCaseData; selector: LodSelector } {
    const domain = domainOfRadius(radiusM);
    const steps = latticeSteps(PATCH_CELLS, maxLevelFor(PATCH_CELLS));
    const view = baseView(radiusM, pose, 0);
    const frame = computeMorphFrame(view, domain, steps, newAnchor());
    const selector = new LodSelector({
      domain, patchCells: PATCH_CELLS, mode: 'distance', fixedLevel: 5, cellPixels: 4, leafCap, heightBoundM: 0, cull: false, hysteresis: 0,
    });
    selector.select({ camera: frame.selectorCamera, pixelAngle: (2 * Math.tan((fovDeg * PI) / 360)) / viewport, frustum: new Float64Array(12) });
    const leafData = new Float32Array(capacity * 4);
    const infoData = new Float32Array(capacity * 4);
    // One instance per leaf (no duplicates at the cut), pole longitudes filled: the probe compares vertices, not coverage.
    const leaves = packMorphLeaves(selector, domain, PATCH_CELLS, capacity, frame.basis, 1, leafData, infoData, false).instances;
    const vertices = leaves * VERTS;
    const directions = new Float64Array(vertices * 3);
    const sigma = new Float32Array(vertices);
    const poleLon = new Float32Array(vertices);
    const gridOut: [number, number] = [0, 0];
    const unit: Vec3 = [0, 0, 0];
    for (let k = 0; k < leaves; k++) {
      const u0 = leafData[k * 4];
      const v0 = leafData[k * 4 + 1];
      const step = leafData[k * 4 + 2];
      const face = leafData[k * 4 + 3];
      const mask = infoData[k * 4 + 1];
      for (let gy = 0; gy <= PATCH_CELLS; gy++) {
        for (let gx = 0; gx <= PATCH_CELLS; gx++) {
          foldedGrid(gx, gy, PATCH_CELLS, mask, true, gridOut);
          const d = latticeDirection(face, u0 + gridOut[0] * step, v0 + gridOut[1] * step, steps, domain);
          unit[0] = d[0];
          unit[1] = d[1];
          unit[2] = d[2];
          const o = k * VERTS + gy * SIDE + gx;
          directions.set(unit, o * 3);
          sigma[o] = Math.sign(infoData[k * 4 + 2]);
          poleLon[o] = infoData[k * 4 + 3];
        }
      }
    }
    leafBuffer.value.array.set(leafData);
    leafBuffer.value.needsUpdate = true;
    infoBuffer.value.array.set(infoData);
    infoBuffer.value.needsUpdate = true;
    return { data: { domain, steps, leaves, vertices, leafData, infoData, directions, sigma, poleLon }, selector };
  }

  return { vertex, dispatch, prepare };
}

/** The view of a probe case: projection centre (0, 0), ground at height 0. */
function baseView(radiusM: number, pose: MorphPoseId, morph: number): MorphView {
  return { radiusM, morph, centreLonDeg: 0, centreLatDeg: 0, pose: MORPH_POSES[pose], groundHeightM: 0 };
}

/** The 99th percentile of a list (destroys the order of `values`). */
function percentile99(values: Float32Array): number {
  if (values.length === 0) return 0;
  values.sort();
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.99))];
}

/** Runs the probe's matrix. Takes tens of seconds: the reference is computed in doubles on the CPU for every vertex. */
export async function runMorphProbe(renderer: ProbeRenderer, options: ProbeOptions = {}): Promise<ProbeResult[]> {
  const radii = options.radii ?? PROBE_DEFAULTS.radii;
  const morphs = options.morphs ?? PROBE_DEFAULTS.morphs;
  const poses = options.poses ?? PROBE_DEFAULTS.poses;
  const methods = options.methods ?? PROBE_DEFAULTS.methods;
  const leafCap = options.leafCap ?? PROBE_DEFAULTS.leafCap;
  const viewport = options.viewportHeightPx ?? PROBE_DEFAULTS.viewportHeightPx;
  const fovDeg = options.fovDeg ?? PROBE_DEFAULTS.fovDeg;
  const poleCapDeg = options.poleCapDeg ?? 1;
  const focalPx = viewport / (2 * Math.tan((fovDeg * PI) / 360));
  const capacity = leafCap + CAP_SLACK + 6;
  const probe = createMorphProbe(renderer, capacity, (radiusM) => ({ kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' }));
  const results: ProbeResult[] = [];

  type Task = { radiusM: number; pose: MorphPoseId; heightM: number; morphs: readonly number[] };
  const tasks: Task[] = [];
  for (const radiusM of radii) for (const pose of poses) tasks.push({ radiusM, pose, heightM: 0, morphs });
  if (options.heightTest !== false && radii.includes(6_371_000) && poses.includes('mid-2m')) {
    tasks.push({ radiusM: 6_371_000, pose: 'mid-2m', heightM: PROBE_DEFAULTS.heightM, morphs: [0.5] });
  }
  const total = tasks.reduce((n, task) => n + task.morphs.length * methods.length, 0);

  for (const task of tasks) {
    const { data } = probe.prepare(task.radiusM, task.pose, leafCap, viewport, fovDeg);
    probe.vertex.setHeight(task.heightM);
    // Angular distance of every vertex from the nearest pole of the projection basis (centre lon 0, lat 0), in doubles.
    const basis = projectionBasis(0, 0);
    const qDeg = new Float64Array(data.vertices);
    const band = new Uint8Array(data.vertices);
    for (let v = 0; v < data.vertices; v++) {
      const x = data.directions[v * 3];
      const y = data.directions[v * 3 + 1];
      const z = data.directions[v * 3 + 2];
      const sUp = x * basis.up[0] + y * basis.up[1] + z * basis.up[2];
      const horizontal = Math.hypot(x * basis.forward[0] + y * basis.forward[1] + z * basis.forward[2], x * basis.right[0] + y * basis.right[1] + z * basis.right[2]);
      const q = (Math.atan2(horizontal, Math.abs(sUp)) * 180) / PI;
      qDeg[v] = q;
      band[v] = horizontal < 1e-12 ? 0 : q < 0.01 ? 1 : q < 0.1 ? 2 : q < 1 ? 3 : q < 5 ? 4 : 5;
    }
    let baselineToday: Float32Array | undefined;
    let baselineRef: Float64Array | undefined;
    for (const morph of task.morphs) {
      const began = performance.now();
      const view = baseView(task.radiusM, task.pose, morph);
      const frame = computeMorphFrame(view, data.domain, data.steps, newAnchor());
      probe.vertex.setFrame(frame);
      // The reference, once per (radius, pose, morph, height): shared by both methods.
      const ref = new Float64Array(data.vertices * 3);
      const refLon = new Float64Array(data.vertices);
      const refLat = new Float64Array(data.vertices);
      const refN = new Int8Array(data.vertices);
      const unit: Vec3 = [0, 0, 0];
      for (let v = 0; v < data.vertices; v++) {
        unit[0] = data.directions[v * 3];
        unit[1] = data.directions[v * 3 + 1];
        unit[2] = data.directions[v * 3 + 2];
        const r = referenceVertex(frame, unit, data.sigma[v], task.heightM, band[v] === 0 ? data.poleLon[v] : undefined, data.poleLon[v]);
        ref[v * 3] = r.rel[0];
        ref[v * 3 + 1] = r.rel[1];
        ref[v * 3 + 2] = r.rel[2];
        refLon[v] = r.lon;
        refLat[v] = r.lat;
        refN[v] = r.n;
      }
      const near = new Uint8Array(data.vertices);
      let nearVertices = 0;
      for (let v = 0; v < data.vertices; v++) {
        if (Math.abs(refLon[v] - frame.lambdaC) <= PI) {
          near[v] = 1;
          nearVertices++;
        }
      }
      await yieldToUi();

      for (const method of methods) {
        probe.vertex.setMethod(method);
        const { selected, today } = await probe.dispatch(data);
        const errM = new Float32Array(data.vertices);
        const errPx = new Float32Array(data.vertices);
        const nearM = new Float32Array(nearVertices);
        const nearPx = new Float32Array(nearVertices);
        let wrapMismatch = 0;
        let worst = -1;
        let worstErr = -1;
        let maxAll = 0;
        let maxAllPx = 0;
        let maxNear = 0;
        let maxNearPx = 0;
        let n = 0;
        const capPx: number[] = [];
        let capMaxM = 0;
        let capMaxPx = 0;
        let capWorst = -1;
        const bandPx: number[][] = POLE_BANDS.map(() => []);
        const bandMaxM = POLE_BANDS.map(() => 0);
        const bandWorst = POLE_BANDS.map(() => -1);
        for (let v = 0; v < data.vertices; v++) {
          const dx = selected[v * 4] - ref[v * 3];
          const dy = selected[v * 4 + 1] - ref[v * 3 + 1];
          const dz = selected[v * 4 + 2] - ref[v * 3 + 2];
          const e = Math.hypot(dx, dy, dz);
          const dist = Math.max(0.01, Math.hypot(ref[v * 3], ref[v * 3 + 1], ref[v * 3 + 2]));
          const px = (e / dist) * focalPx;
          errM[v] = e;
          errPx[v] = px;
          if (e > maxAll) maxAll = e;
          if (px > maxAllPx) maxAllPx = px;
          if (Math.round(selected[v * 4 + 3]) !== refN[v]) wrapMismatch++;
          if (near[v]) {
            nearM[n] = e;
            nearPx[n] = px;
            n++;
            if (e > maxNear) maxNear = e;
            if (px > maxNearPx) maxNearPx = px;
            if (e > worstErr) {
              worstErr = e;
              worst = v;
            }
            if (qDeg[v] > poleCapDeg) {
              capPx.push(px);
              if (e > capMaxM) capMaxM = e;
              if (px > capMaxPx) {
                capMaxPx = px;
                capWorst = v;
              }
            }
          }
          if (near[v] || band[v] === 0) {
            const b = band[v];
            bandPx[b].push(px);
            if (e > bandMaxM[b]) bandMaxM[b] = e;
            if (bandWorst[b] < 0 || px > errPx[bandWorst[b]]) bandWorst[b] = v;
          }
        }
        const row: ProbeResult = {
          radiusM: task.radiusM,
          morph,
          pose: task.pose,
          method,
          heightM: task.heightM,
          leaves: data.leaves,
          vertices: data.vertices,
          nearVertices,
          maxErrM: maxNear,
          maxErrPx: maxNearPx,
          p99ErrM: percentile99(nearM),
          p99ErrPx: percentile99(nearPx),
          worstDistM: worst >= 0 ? Math.hypot(ref[worst * 3], ref[worst * 3 + 1], ref[worst * 3 + 2]) : 0,
          worstLatDeg: worst >= 0 ? (refLat[worst] * 180) / PI : 0,
          worstLonDeg: worst >= 0 ? (refLon[worst] * 180) / PI : 0,
          allMaxErrM: maxAll,
          allMaxErrPx: maxAllPx,
          wrapMismatch,
          underPixel: maxNearPx < 1,
          poleCapDeg,
          maxErrPxOutsideCap: capMaxPx,
          maxErrMOutsideCap: capMaxM,
          p99ErrPxOutsideCap: percentile99(Float32Array.from(capPx)),
          worstOutsideCap: capWorst >= 0
            ? {
                distM: Math.hypot(ref[capWorst * 3], ref[capWorst * 3 + 1], ref[capWorst * 3 + 2]),
                latDeg: (refLat[capWorst] * 180) / PI,
                lonDeg: (refLon[capWorst] * 180) / PI,
                errM: errM[capWorst],
                errPx: errPx[capWorst],
              }
            : { distM: 0, latDeg: 0, lonDeg: 0, errM: 0, errPx: 0 },
          underPixelOutsideCap: capMaxPx < 1,
          poleBands: POLE_BANDS.map((def, b) => {
            const w = bandWorst[b];
            const px = bandPx[b];
            return {
              label: def.label,
              fromDeg: def.fromDeg,
              toDeg: def.toDeg,
              vertices: px.length,
              maxErrPx: w >= 0 ? errPx[w] : 0,
              maxErrM: bandMaxM[b],
              p99ErrPx: percentile99(Float32Array.from(px)),
              worstDistM: w >= 0 ? Math.hypot(ref[w * 3], ref[w * 3 + 1], ref[w * 3 + 2]) : 0,
            };
          }),
          ms: 0,
        };
        if (morph === 0 && method === 'p2') {
          let equal = true;
          for (let v = 0; v < data.vertices && equal; v++) {
            for (let c = 0; c < 3; c++) if (selected[v * 4 + c] !== today[v * 4 + c]) equal = false;
          }
          row.bitEqualToday = equal;
        }
        if (morph === 0 && method === (methods[0] ?? 'p2')) {
          baselineToday = today;
          baselineRef = ref;
        }
        if (morph === 1e-4 && baselineToday && baselineRef) {
          let gpuMax = 0;
          let gpuMaxPx = 0;
          let refMax = 0;
          let refMaxPx = 0;
          let worstDist = 0;
          for (let v = 0; v < data.vertices; v++) {
            const dist = Math.max(0.01, Math.hypot(ref[v * 3], ref[v * 3 + 1], ref[v * 3 + 2]));
            const j = Math.hypot(selected[v * 4] - baselineToday[v * 4], selected[v * 4 + 1] - baselineToday[v * 4 + 1], selected[v * 4 + 2] - baselineToday[v * 4 + 2]);
            const rj = Math.hypot(ref[v * 3] - baselineRef[v * 3], ref[v * 3 + 1] - baselineRef[v * 3 + 1], ref[v * 3 + 2] - baselineRef[v * 3 + 2]);
            if (j > gpuMax) {
              gpuMax = j;
              worstDist = dist;
            }
            gpuMaxPx = Math.max(gpuMaxPx, (j / dist) * focalPx);
            refMax = Math.max(refMax, rj);
            refMaxPx = Math.max(refMaxPx, (rj / dist) * focalPx);
          }
          row.jump = { gpuMaxM: gpuMax, gpuMaxPx, refMaxM: refMax, refMaxPx, worstDistM: worstDist };
        }
        row.ms = performance.now() - began;
        results.push(row);
        options.onProgress?.(results.length, total, row);
        await yieldToUi();
      }
    }
  }
  return results;
}
