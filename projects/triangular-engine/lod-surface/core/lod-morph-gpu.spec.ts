/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fn, uniform, vec4 } from 'three/tsl';
import { evaluateOnGpu, type GpuRow } from '../../planet-material/gpu-eval.testing';
import { referenceVertex, unwrapToSide } from './lod-morph-frame';
import { poleLattices } from './lod-morph-leaves';
import { ANCHOR_SCALAR_KEYS, ANCHOR_VECTOR_KEYS, FLOAT32_LIB, latticeOffset, p2Position, type MorphAnchor } from './lod-morph-math';
import { MORPH_TSL_LIB } from './lod-morph-stage';
import {
  TEST_STEPS, directionOfT, evaluateVertex, exactRel, latticeVector, liftFrame, sceneCameraAt, sideOf, sphereDomain, testFrame, testMap,
  unitMetres, verticesAround,
} from './lod-morph.testing';
import type { MorphFrame } from './lod-morph-frame';
import type { Vec3 } from './lod-domain';

/**
 * Plan 059, step G6b: the TSL vertex stage against doubles, on the real GPU backend of headless Chrome (WebGL2 through the engine's
 * `evaluateOnGpu`). The anchor values are uniforms, as in the mesh (constants would let the shader compiler fold `(T - hi) - lo`), and each row
 * is one vertex: its lattice vector, side, height and leaf longitude. The tolerance is the float32 floor of the emulation plus a margin
 * for the backend's `sin`/`cos`/`atan` (a GPU's are not correctly rounded; the headless backend is a software rasteriser).
 */

const L = MORPH_TSL_LIB;

function tslAnchor(frame: MorphFrame): MorphAnchor<any> {
  const a: Record<string, any> = {};
  for (const key of ANCHOR_SCALAR_KEYS) a[key] = uniform(frame.values[key]);
  for (const key of ANCHOR_VECTOR_KEYS) a[key] = frame.values[key].map((x) => uniform(x));
  return a as unknown as MorphAnchor<any>;
}

/** The morph vertex function as a graph: the lattice stage from the anchor and from the pole, then P2. Row slot 0 is T, slot 1 is (sigma, h, leafLon). */
function vertexGraph(frame: MorphFrame, at: (slot: number) => any): any {
  const A = tslAnchor(frame);
  const row = at(0);
  const info = at(1);
  const t = [row.x, row.y, row.z];
  const lattice = { steps: TEST_STEPS, equalAngle: true };
  const anchorT = frame.anchor.t;
  const dT = t.map((x, k) => x.sub(uniform(anchorT[k])));
  const dTp = t.map((x, k) => x.sub(A.poleHi[k]).sub(A.poleLo[k]));
  const origin = {
    cube: frame.anchor.cube.map((x) => uniform(x)), error: frame.anchor.error.map((x) => uniform(x)), cos: frame.anchor.cos.map((x) => uniform(x)),
  };
  const fromAnchor = latticeOffset(L, lattice, t as any, dT as any, origin as any);
  const fromPole = latticeOffset(L, lattice, t as any, dTp as any, { cube: A.poleCube, error: A.poleError, cos: A.poleCos });
  const p2 = p2Position(L, A, fromAnchor.du, fromPole.du, info.x, info.y, undefined, info.z);
  return vec4(p2.rel[0], p2.rel[1], p2.rel[2], p2.usedPole);
}

interface GpuCase {
  readonly frame: MorphFrame;
  readonly t: Vec3;
  readonly sigma: number;
  readonly leafLon: number;
  readonly exact: [number, number, number];
}

async function runOnGpu(frame: MorphFrame, cases: readonly GpuCase[]): Promise<Float32Array> {
  const rows: GpuRow[] = cases.map((c) => [[c.t[0], c.t[1], c.t[2], 0], [c.sigma, 2, c.leafLon, 0]]);
  return evaluateOnGpu(rows, (at) => Fn(() => vertexGraph(frame, at))());
}

function casesAround(radius: number, morph: number, centre: [number, number], metres: number[]): { frame: MorphFrame; cases: GpuCase[] } {
  const domain = sphereDomain(radius);
  const map = testMap(radius, morph, 'equal-earth', centre[0], centre[1]);
  const frame = testFrame(map, domain, sceneCameraAt(map, 0.3, 0.4, 2));
  const cases: GpuCase[] = [];
  for (const m of metres) {
    for (const t of verticesAround(frame, radius, m)) {
      const unit = directionOfT(t, domain);
      const sigma = sideOf(map, unit);
      const leafLon = referenceVertex(frame, unit, sigma, 2).lon;
      cases.push({ frame, t, sigma, leafLon, exact: exactRel(frame, domain, t, sigma, 2, leafLon) });
    }
  }
  return { frame, cases };
}

describe('lod-morph-gpu: the TSL vertex stage against doubles (headless WebGL2)', () => {
  for (const radius of [600_000, 6_371_000]) {
    for (const morph of [0.5, 1]) {
      it(`matches the definition near the camera: ${radius / 1000} km, morph ${morph}`, async () => {
        const { frame, cases } = casesAround(radius, morph, [20, 35], [1, 10, 100, 10_000, 400_000]);
        const out = await runOnGpu(frame, cases);
        const lifted = liftFrame(FLOAT32_LIB, frame);
        const domain = sphereDomain(radius);
        let worst = 0;
        let worstEmulation = 0;
        cases.forEach((c, k) => {
          const got = [out[k * 4], out[k * 4 + 1], out[k * 4 + 2]];
          const distance = Math.max(2, Math.hypot(...c.exact));
          const error = Math.hypot(got[0] - c.exact[0], got[1] - c.exact[1], got[2] - c.exact[2]);
          const emulated = evaluateVertex(FLOAT32_LIB, frame, lifted, domain, c.t, c.sigma, 2, c.leafLon).rel;
          const emulationError = Math.hypot(emulated[0] - c.exact[0], emulated[1] - c.exact[1], emulated[2] - c.exact[2]);
          worst = Math.max(worst, error / distance);
          worstEmulation = Math.max(worstEmulation, emulationError / distance);
        });
        console.log(`[lod-morph-gpu] ${radius / 1000} km morph ${morph}: worst relative error ${worst.toExponential(2)} on the GPU, ${worstEmulation.toExponential(2)} in the float32 emulation`);
        expect(cases.length).toBeGreaterThan(10);
        expect(worst).toBeLessThan(1e-4);
      });
    }
  }

  it('places a vertex 10 m from the pole within a pixel of doubles when the camera is 1 km away (6,371 km, tilted centre)', async () => {
    const radius = 6_371_000;
    const domain = sphereDomain(radius);
    const map = testMap(radius, 1, 'equal-earth', 20, 35);
    const pole = (() => {
      for (let face = 0; face < 6; face++) {
        const found = poleLattices(map.basis, TEST_STEPS, face, 'equal-angle').find((p) => p.sign === 1);
        if (found) return { face, u: found.u, v: found.v };
      }
      throw new Error('no pole');
    })();
    const place = (rho: number, angle: number): Vec3 => {
      const k = rho / unitMetres(radius);
      return latticeVector(pole.face, Math.round(pole.u + k * Math.cos(angle)), Math.round(pole.v + k * Math.sin(angle)));
    };
    const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const camera = directionOfT(place(1000, 1.3), domain);
    const cameraLon = Math.atan2(dot(camera, map.basis.right), dot(camera, map.basis.forward));
    const frame = testFrame(map, domain, sceneCameraAt(map, cameraLon, Math.asin(dot(camera, map.basis.up)), 2));
    const cases: GpuCase[] = [];
    for (const angle of [0.2, 1.7, 3.1, 4.4]) {
      const t = place(10, angle);
      const unit = directionOfT(t, domain);
      const lon = Math.atan2(dot(unit, map.basis.right), dot(unit, map.basis.forward));
      const sigma = lon >= 0 ? 1 : -1;
      const leafLon = unwrapToSide(lon, sigma).lon;
      cases.push({ frame, t, sigma, leafLon, exact: exactRel(frame, domain, t, sigma, 2, leafLon) });
    }
    const out = await runOnGpu(frame, cases);
    const pixel = (2 * Math.tan(Math.PI / 6)) / 1080;
    cases.forEach((c, k) => {
      const error = Math.hypot(out[k * 4] - c.exact[0], out[k * 4 + 1] - c.exact[1], out[k * 4 + 2] - c.exact[2]);
      const distance = Math.hypot(...c.exact);
      console.log(`[lod-morph-gpu] pole zone vertex ${k}: ${error.toFixed(4)} m at ${distance.toFixed(0)} m (${(error / (distance * pixel)).toFixed(2)} px), pole stage ${out[k * 4 + 3]}`);
      expect(error).toBeLessThan(distance * pixel);
    });
  });
});
