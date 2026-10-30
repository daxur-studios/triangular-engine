/* eslint-disable @typescript-eslint/no-explicit-any */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, Vector2, Vector4 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs, attribute, cross, dFdx, dFdy, dot, float, instanceIndex, instancedArray, int, normalize, positionView, select, uniform, vec2, vec3, vec4, Fn, If,
} from 'three/tsl';
import type { MorphFrame } from './morph-frame';
import { FAN_SPEC_STRIDE, SPEC, type FanSpecs } from './morph-fan';
import { p2FromAngles, type MorphAnchor, type MorphLib, type P2Result } from './morph-math';
import type { MorphVertex } from './morph-surface-mesh';

/**
 * Plan 059 morph spike, iteration 5: the vertex-stage pole fan. The CPU fan (`morph-fan.ts`, iteration 4) puts every fan vertex in
 * doubles and packs it relative to the camera, so it is rebuilt when the camera or the morph moves (12 to 40 ms at 1,024 rays). Here the
 * CPU builds only the fan's topology and per-vertex descriptions (`buildFanSpecs`: nothing in them depends on the camera, the morph
 * or the height), and the vertex stage evaluates the position, anchor-relative, in the spirit of P2:
 *
 * - A chord vertex (the leaf's boundary ring, the corner case's two meridian edges) is a point on the chord between two grid
 *   vertices of its leaf. Each end runs the lattice vertex stage (`MorphVertex.build`) with the same lattice input the neighbours use
 *   (same leaf origin, step, face, edge mask and pole corner; the longitude window is the end's own longitude), so a boundary sample is
 *   bit-identical to the vertex the instanced leaf would have drawn; the point between is `A + (B - A) w`, the polyline the neighbours draw.
 * - A polar vertex (a ring between the boundary and the pole, and the pole itself, at a ray's longitude) has no lattice direction. The CPU
 *   hands over its longitude lambda, its colatitude c from the leaf's pole and `e = 2 sin^2(c / 2)` (= 1 - cos c) as double-floats
 *   (a float32 high part and a float32 low part). The per-frame anchor values come from the CPU in doubles too: the anchor's longitude, its
 *   colatitude from each pole and `1 -+ sin(latA)`. The vertex stage forms the differences from the anchor, `dlam = lambda - lamA`,
 *   `dphi = +-(colatA - c)` and `ds = sin(lat) - sin(latA) = +-(Ps - e)`, each as `(hi - hi) + (lo - lo)` (the high parts are
 *   close, so the difference is exact), and hands them to the second half of P2 (`p2FromAngles`). Nothing large is formed, no
 *   large-angle trig runs, and a vertex 2 m from the anchor next to the pole keeps its centimetres.
 *
 * What rebuilds: the fan leaf set (face, level, origin, edge mask), the rays, the radius and the projection centre (the pole's
 * place in the basis fixes the longitudes and colatitudes). The camera, the morph, the height and the projection blend do not.
 */

/** The per-frame values of the polar vertices, in doubles. */
export interface FanFrameValues {
  /** `1 - sin(latA)` for the up pole and `1 + sin(latA)` for the down pole: the sine of the anchor's latitude measured from the pole's side. */
  readonly ps: readonly [number, number];
  /** The anchor's colatitude from the up pole and from the down pole. */
  readonly colat: readonly [number, number];
  /** The anchor's longitude, unwrapped to the camera's side. */
  readonly lamA: number;
}

/** The fan's per-frame values from a frame: `omsA` and `opsA` are the frame's exact `1 - sin` and `1 + sin` (no cancellation near a pole). */
export function fanFrameValues(frame: MorphFrame): FanFrameValues {
  const { sA, cA, omsA, opsA, lamA } = frame.values;
  return { ps: [omsA, opsA], colat: [Math.atan2(cA, sA), Math.atan2(cA, -sA)], lamA };
}

/** x as a float32 high part and the float32 remainder (the pair sums to x to about 1e-14 relative). */
export function splitDouble(x: number): [number, number] {
  const hi = Math.fround(x);
  return [hi, Math.fround(x - hi)];
}

/** The per-frame values as float32 double-floats, in the shape of the uniforms: `[psHi+, psHi-, psLo+, psLo-]`, `[colHi+, colHi-, colLo+, colLo-]`, `[lamHi, lamLo]`. */
export function fanFrameUniforms(values: FanFrameValues): { ps: [number, number, number, number]; colat: [number, number, number, number]; lam: [number, number] } {
  const [psPh, psPl] = splitDouble(values.ps[0]);
  const [psMh, psMl] = splitDouble(values.ps[1]);
  const [cPh, cPl] = splitDouble(values.colat[0]);
  const [cMh, cMl] = splitDouble(values.colat[1]);
  return { ps: [psPh, psMh, psPl, psMl], colat: [cPh, cMh, cPl, cMl], lam: splitDouble(values.lamA) };
}

/** A polar vertex's description as the vertex stage reads it: double-floats of longitude, colatitude and `e = 2 sin^2(c / 2)`, and the pole's sign. */
export interface FanPolarParams<T = any> {
  lonHi: T; lonLo: T; cHi: T; cLo: T; eHi: T; eLo: T; sgn: T;
}

/** The per-frame uniforms in the shape the polar formulas read (numbers on the CPU, nodes on the GPU). */
export interface FanFrameNodes<T = any> {
  psHiP: T; psHiM: T; psLoP: T; psLoM: T;
  colHiP: T; colHiM: T; colLoP: T; colLoM: T;
  lamHi: T; lamLo: T;
}

/** The second half of P2's inputs for a polar vertex: `ds`, `dphi` and `dlam0` as differences from the anchor of double-float values. */
export function fanPolarOffsets(L: MorphLib, F: FanFrameNodes<any>, v: FanPolarParams<any>): { ds: any; dphi: any; dlam0: any } {
  const plus = L.lt(L.c(0), v.sgn);
  const psHi = L.select(plus, F.psHiP, F.psHiM);
  const psLo = L.select(plus, F.psLoP, F.psLoM);
  const colHi = L.select(plus, F.colHiP, F.colHiM);
  const colLo = L.select(plus, F.colLoP, F.colLoM);
  return {
    ds: v.sgn.mul(psHi.sub(v.eHi).add(psLo.sub(v.eLo))),
    dphi: v.sgn.mul(colHi.sub(v.cHi).add(colLo.sub(v.cLo))),
    dlam0: v.lonHi.sub(F.lamHi).add(v.lonLo.sub(F.lamLo)),
  };
}

/** A polar vertex of the fan through P2, in any math library: the CPU twin of the vertex stage's polar path (the unwrap integer is 0: the vertex is placed at its own longitude). */
export function fanPolarPosition(L: MorphLib, A: MorphAnchor<any>, F: FanFrameNodes<any>, v: FanPolarParams<any>, h: any): P2Result {
  const o = fanPolarOffsets(L, F, v);
  return p2FromAngles(L, A, o.ds, o.dphi, o.dlam0, L.c(0), h);
}

/** `e = 2 sin^2(c / 2)` = `1 - cos c` without the cancellation. */
export const colatitudeE = (c: number): number => 2 * Math.sin(c / 2) ** 2;

/** The double-float parameters of a polar description (longitude, colatitude, sign) as plain numbers. */
export function polarParamsOf(lon: number, c: number, sgn: number): FanPolarParams<number> {
  const [lonHi, lonLo] = splitDouble(lon);
  const [cHi, cLo] = splitDouble(c);
  const [eHi, eLo] = splitDouble(colatitudeE(c));
  return { lonHi, lonLo, cHi, cLo, eHi, eLo, sgn };
}

// -- the packed fan -------------------------------------------------------------------------------------------------------------

/** The vertex stage's inputs of a fan: six vec4 per vertex (`leaf`, `grid`, `ref`, `polar1`, `polar2`, `misc`) and the triangles. */
export interface VertexFanData {
  readonly vertexCount: number;
  /** (U0, V0, lattice step, face) of the vertex's leaf. */
  readonly leaf: Float32Array;
  /** (gxA, gyA, gxB, gyB): the chord's grid vertices (unfolded). */
  readonly grid: Float32Array;
  /** (refA, refB, w, poleLon): the longitudes the ends are placed near, the share from A to B, the longitude of the exact pole where the chord runs along a meridian edge. */
  readonly ref: Float32Array;
  /** (lonHi, lonLo, cHi, cLo) of a polar vertex. */
  readonly polar1: Float32Array;
  /** (eHi, eLo, sgn, kind): kind 1 for a polar vertex, 0 for a chord vertex. */
  readonly polar2: Float32Array;
  /** (edge mask, corner x, corner y, 0): the corner is -1 for a leaf whose pole is strictly inside it. */
  readonly misc: Float32Array;
  readonly index: Uint32Array;
}

/**
 * Packs the fan's descriptions as the float32 attributes of the vertex stage. A chord whose share reaches 1 is stored as its end B
 * (share 0), so that a vertex that is a grid vertex is the lattice stage's output exactly.
 */
export function packVertexFan(specs: FanSpecs): VertexFanData {
  const n = specs.vertexCount;
  const leaf = new Float32Array(n * 4);
  const grid = new Float32Array(n * 4);
  const ref = new Float32Array(n * 4);
  const polar1 = new Float32Array(n * 4);
  const polar2 = new Float32Array(n * 4);
  const misc = new Float32Array(n * 4);
  const d = specs.data;
  for (let v = 0; v < n; v++) {
    const o = v * FAN_SPEC_STRIDE;
    const l = specs.leaves[d[o + SPEC.LEAF]];
    const q = v * 4;
    leaf[q] = l.u0;
    leaf[q + 1] = l.v0;
    leaf[q + 2] = l.step;
    leaf[q + 3] = l.face;
    misc[q] = l.mask;
    misc[q + 1] = l.cap ? l.cap[2] : -1;
    misc[q + 2] = l.cap ? l.cap[3] : -1;
    if (d[o + SPEC.KIND] === 0) {
      const toB = d[o + SPEC.W] >= 1;
      const w = toB ? 0 : d[o + SPEC.W];
      grid[q] = d[o + (toB ? SPEC.GXB : SPEC.GXA)];
      grid[q + 1] = d[o + (toB ? SPEC.GYB : SPEC.GYA)];
      grid[q + 2] = d[o + SPEC.GXB];
      grid[q + 3] = d[o + SPEC.GYB];
      ref[q] = d[o + (toB ? SPEC.REFB : SPEC.REFA)];
      ref[q + 1] = d[o + SPEC.REFB];
      ref[q + 2] = w;
      const poleLon = d[o + SPEC.POLE_LON];
      ref[q + 3] = Number.isNaN(poleLon) ? 0 : poleLon;
    } else {
      const p = polarParamsOf(d[o + SPEC.LON], d[o + SPEC.C], d[o + SPEC.SGN]);
      polar1[q] = p.lonHi;
      polar1[q + 1] = p.lonLo;
      polar1[q + 2] = p.cHi;
      polar1[q + 3] = p.cLo;
      polar2[q] = p.eHi;
      polar2[q + 1] = p.eLo;
      polar2[q + 2] = p.sgn;
      polar2[q + 3] = 1;
    }
  }
  return { vertexCount: n, leaf, grid, ref, polar1, polar2, misc, index: specs.index };
}

/** The attribute names of the vertex stage's inputs. */
export const FAN_ATTRIBUTES = ['aFanLeaf', 'aFanGrid', 'aFanRef', 'aFanPolar1', 'aFanPolar2', 'aFanMisc'] as const;

/** The vertex stage's inputs as nodes: attributes in the draw, buffer reads in the precision kernel. */
export interface FanInputs {
  readonly leaf: any;
  readonly grid: any;
  readonly ref: any;
  readonly polar1: any;
  readonly polar2: any;
  readonly misc: any;
}

/** The vertex-stage fan: the position node, the per-frame uniforms, the meshes and the upload of a packed fan. */
export interface VertexFanStage {
  /** The camera-relative position (vec3, body frame, the scene frame) of the fan vertex with these inputs. */
  position(inputs: FanInputs): any;
  /** Writes the frame's fan uniforms (the anchor and the rest of the frame are the vertex builder's `setFrame`). */
  setFrame(frame: MorphFrame): void;
  /** Replaces the fan's vertices and triangles (a rebuild). */
  upload(data: VertexFanData | undefined): void;
  readonly mesh: Mesh;
  readonly probeMesh: Mesh;
  readonly material: MeshBasicNodeMaterial;
  readonly probeMaterial: MeshBasicNodeMaterial;
  dispose(): void;
}

/** Builds the fan's vertex stage over a lattice vertex builder (`vertex`) and the node math library (`lib`, passed in so this file does not import the mesh module's values). */
export function createVertexFanStage(vertex: MorphVertex, lib: MorphLib): VertexFanStage {
  const uPs = uniform(new Vector4()) as any;
  const uCol = uniform(new Vector4()) as any;
  const uLam = uniform(new Vector2()) as any;
  const F: FanFrameNodes<any> = {
    psHiP: uPs.x, psHiM: uPs.y, psLoP: uPs.z, psLoM: uPs.w,
    colHiP: uCol.x, colHiM: uCol.y, colLoP: uCol.z, colLoM: uCol.w,
    lamHi: uLam.x, lamLo: uLam.y,
  };
  const anchor = vertex.anchor;

  const position = (inputs: FanInputs): any => {
    const { leaf, grid, ref, polar1, polar2, misc } = inputs;
    const poleLon = ref.w;
    const info = (r: any) => vec4(float(0), misc.x, float(1), r);
    const cap = vec4(poleLon, poleLon, misc.y, misc.z);
    const end = (gx: any, gy: any, r: any): any => vertex.build(vec2(gx, gy), leaf, info(r), cap, float(0)).p2;
    const a = end(grid.x, grid.y, ref.x);
    const b = end(grid.z, grid.w, ref.y);
    const chord = a.add(b.sub(a).mul(ref.z));
    const params: FanPolarParams<any> = {
      lonHi: polar1.x, lonLo: polar1.y, cHi: polar1.z, cLo: polar1.w, eHi: polar2.x, eLo: polar2.y, sgn: polar2.z,
    };
    const p = fanPolarPosition(lib, anchor, F, params, vertex.height);
    const polar = vec3(p.rel[0], p.rel[1], p.rel[2]);
    return select(polar2.w.greaterThan(0.5), polar, chord);
  };

  const attributes = (): FanInputs => ({
    leaf: attribute(FAN_ATTRIBUTES[0], 'vec4'),
    grid: attribute(FAN_ATTRIBUTES[1], 'vec4'),
    ref: attribute(FAN_ATTRIBUTES[2], 'vec4'),
    polar1: attribute(FAN_ATTRIBUTES[3], 'vec4'),
    polar2: attribute(FAN_ATTRIBUTES[4], 'vec4'),
    misc: attribute(FAN_ATTRIBUTES[5], 'vec4'),
  });
  const rel = position(attributes());
  const light = abs(dot(normalize(cross(dFdx(positionView), dFdy(positionView))), normalize(vec3(0.3, 0.6, 0.75)))).mul(0.75).add(0.25);
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.positionNode = rel;
  material.colorNode = vec4(vec3(0.3, 0.8, 0.9).mul(light), 1);
  const probeMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  probeMaterial.positionNode = rel;
  probeMaterial.colorNode = vec4(1, 1, 1, 1);
  probeMaterial.toneMapped = false;

  const empty = (): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const zero = new BufferAttribute(new Float32Array(4), 4);
    for (const name of FAN_ATTRIBUTES) g.setAttribute(name, zero);
    g.setIndex(new BufferAttribute(new Uint32Array(3), 1));
    g.setDrawRange(0, 0);
    return g;
  };
  let geometry = empty();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'Morph spike vertex-stage pole fan';
  mesh.visible = false;
  const probeMesh = new Mesh(geometry, probeMaterial);
  probeMesh.frustumCulled = false;
  probeMesh.visible = false;

  return {
    position,
    setFrame(frame) {
      const u = fanFrameUniforms(fanFrameValues(frame));
      (uPs.value as Vector4).set(...u.ps);
      (uCol.value as Vector4).set(...u.colat);
      (uLam.value as Vector2).set(...u.lam);
    },
    upload(data) {
      const next = new BufferGeometry();
      if (!data || data.index.length === 0) {
        next.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
        const zero = new BufferAttribute(new Float32Array(4), 4);
        for (const name of FAN_ATTRIBUTES) next.setAttribute(name, zero);
        next.setIndex(new BufferAttribute(new Uint32Array(3), 1));
        next.setDrawRange(0, 0);
      } else {
        // `position` is a placeholder the draw needs to exist; the vertex stage's `positionNode` replaces it.
        next.setAttribute('position', new BufferAttribute(new Float32Array(data.vertexCount * 3), 3));
        FAN_ATTRIBUTES.forEach((name, k) => {
          const source = [data.leaf, data.grid, data.ref, data.polar1, data.polar2, data.misc][k];
          next.setAttribute(name, new BufferAttribute(source, 4));
        });
        next.setIndex(new BufferAttribute(data.index, 1));
      }
      mesh.geometry = next;
      probeMesh.geometry = next;
      geometry.dispose();
      geometry = next;
    },
    mesh,
    probeMesh,
    material,
    probeMaterial,
    dispose() {
      geometry.dispose();
      material.dispose();
      probeMaterial.dispose();
    },
  };
}

// -- the precision kernel ---------------------------------------------------------------------------------------------------------

/** The renderer calls the kernel uses (three's `WebGPURenderer`). */
export interface FanKernelRenderer {
  computeAsync(node: unknown): Promise<void>;
  getArrayBufferAsync(attribute: unknown): Promise<ArrayBuffer>;
}

const KERNEL_BATCH = 65_536;

/** A compute kernel that runs the vertex stage's fan position over the packed vertices and reads the camera-relative positions back. */
export function createFanKernel(renderer: FanKernelRenderer, stage: VertexFanStage, capacity: number) {
  const buffers = {
    leaf: instancedArray(capacity, 'vec4') as any,
    grid: instancedArray(capacity, 'vec4') as any,
    ref: instancedArray(capacity, 'vec4') as any,
    polar1: instancedArray(capacity, 'vec4') as any,
    polar2: instancedArray(capacity, 'vec4') as any,
    misc: instancedArray(capacity, 'vec4') as any,
  };
  const out = instancedArray(KERNEL_BATCH, 'vec4') as any;
  const uOffset = uniform(0, 'int') as any;
  const uCount = uniform(0, 'int') as any;
  const kernel = Fn(() => {
    const i = int(instanceIndex).toVar();
    If(i.lessThan(uCount), () => {
      const at = i.add(uOffset);
      const rel = stage.position({
        leaf: buffers.leaf.element(at), grid: buffers.grid.element(at), ref: buffers.ref.element(at),
        polar1: buffers.polar1.element(at), polar2: buffers.polar2.element(at), misc: buffers.misc.element(at),
      });
      out.element(i).assign(vec4(rel, 0));
    });
  });
  const node = (kernel() as any).compute(KERNEL_BATCH, [64]);
  return {
    /** Runs the packed fan; returns xyz (the 4th float is 0) per vertex. */
    async run(data: VertexFanData): Promise<Float32Array> {
      if (data.vertexCount > capacity) throw new Error(`The fan kernel holds ${capacity} vertices, the fan has ${data.vertexCount}`);
      const set = (buffer: any, source: Float32Array): void => {
        (buffer.value.array as Float32Array).set(source);
        buffer.value.needsUpdate = true;
      };
      set(buffers.leaf, data.leaf);
      set(buffers.grid, data.grid);
      set(buffers.ref, data.ref);
      set(buffers.polar1, data.polar1);
      set(buffers.polar2, data.polar2);
      set(buffers.misc, data.misc);
      const result = new Float32Array(data.vertexCount * 4);
      for (let start = 0; start < data.vertexCount; start += KERNEL_BATCH) {
        const count = Math.min(KERNEL_BATCH, data.vertexCount - start);
        uOffset.value = start;
        uCount.value = count;
        await renderer.computeAsync(node);
        const part = new Float32Array(await renderer.getArrayBufferAsync(out.value));
        result.set(part.subarray(0, count * 4), start * 4);
      }
      return result;
    },
  };
}
