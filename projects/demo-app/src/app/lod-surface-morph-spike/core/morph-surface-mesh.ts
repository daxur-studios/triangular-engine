/* eslint-disable @typescript-eslint/no-explicit-any */
import { BufferAttribute, BufferGeometry, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs, asin, atan, attribute, cos, cross, dFdx, dFdy, dot, float, floor, fract, fwidth, max, min, mix, mod, normalize,
  positionGeometry, positionView, select, sin, smoothstep, sqrt, step, uniform, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
  FACE_FRAMES,
  LEAF_STRIDE,
  SIN_DENOMINATORS,
  maxLevelFor,
  latticeSteps,
  type LodDomain,
  type LodSelector,
  type PatchCells,
} from 'triangular-engine/lod-surface/core';
import type { MorphFrame } from './morph-frame';
import {
  FAN_DEFAULT_RAYS, buildFanSpecs, buildPoleFan, fanContext, fanLeafSignature, fanLeavesOf, type FanBuild, type FanMode, type FanStats,
} from './morph-fan';
import { createVertexFanStage, packVertexFan, type VertexFanStage } from './morph-fan-vertex';
import { packMorphLeaves, type MorphPack } from './morph-leaves';
import {
  ANCHOR_SCALAR_KEYS,
  ANCHOR_VECTOR_KEYS,
  OUTLINE_WRAP,
  atan2R,
  naivePosition,
  outlineDistances,
  p2Position,
  type MorphAnchor,
  type MorphLib,
  type MorphOutline,
  type NaiveFrame,
} from './morph-math';

/**
 * Plan 059 morph spike: a copy of `lod-surface-mesh.ts` (library, unchanged) whose vertex stage is split into the lattice
 * part and a position part. The lattice part is the library's: the cube-lattice vector T of the vertex (after edge folding),
 * the exact difference from the anchor, and the unit-direction difference `du` = u - uA (the library's `dc / |c| - ...`
 * without the radius). The position part takes `du` and gives three candidates:
 *
 * - "today": the library's `anchorRel + R du` (the sphere, unbent), chosen whenever morph is 0, so morph 0 is bit-for-bit the
 *   current terrain;
 * - P2: the anchor-relative bent position (`p2Position` in `morph-math.ts`);
 * - N: the naive absolute-float bend (`naivePosition`), the control that P2 has to beat.
 *
 * Geometry, instancing and seams are the library's: one N x N grid drawn per leaf, the leaf's lattice origin and step in
 * `aLeaf`, the level and edge mask in `aInfo`, with the leaf's side (+-1) added in `aInfo.z` and the longitude its pole vertex
 * takes in `aInfo.w` (`packMorphLeaves`). Part 2 adds, for morph above 0: the signed distances to the map's four edges as a
 * varying (`outlineDistances`) and the fragment clip that discards what lies outside the outline, the exact pole vertex's
 * own-leaf longitude, and the lab's two known-bad controls (edge folding off, an injected gap) for the crack probe.
 */

/** Which position drives the drawn surface (morph 0 always draws "today"). */
export type MorphMethod = 'p2' | 'naive';

/** The vertex nodes the position part produces; all camera-relative in the body frame (the scene frame). */
export interface MorphVertexNodes {
  /** What is drawn: N when the method is naive, else today at morph 0 and P2 above. */
  readonly selected: any;
  readonly today: any;
  readonly p2: any;
  readonly naive: any;
  /** The unwrap integer of `selected` (0 for today). */
  readonly wrapN: any;
  /** Signed distances (metres, inside positive) of the drawn vertex to the map's right, left, top and bottom edges; huge when nothing is clipped (morph 0, the naive control). */
  readonly edges: any;
  /** Unit direction of the vertex's base point, body frame. */
  readonly direction: any;
  /** The vertex's longitude difference from the anchor as placed (dlam0 + 2 pi wrapN), and its unit-direction difference `du`: what the fragment's longitude check interpolates. */
  readonly dlam: any;
  readonly du: any;
  /** 1 for a vertex of a torn leaf (a pole strictly inside it), else 0. */
  readonly torn: any;
  /** The leaf's centre longitude (the vertices are placed within pi of it). */
  readonly leafLon: any;
}

/** The per-frame state of a vertex builder and the nodes it builds. */
export interface MorphVertex {
  /** The planet radius as a uniform node, metres. */
  readonly radius: any;
  /** Builds the nodes for grid vertex `grid` (vec2) of leaf `leaf` (vec4: U0, V0, step, face) with `info` (vec4: level, mask, side (+-1, +-2 for a torn leaf), leaf longitude). */
  build(grid: any, leaf: any, info: any, cap?: any, flag?: any): MorphVertexNodes;
  /**
   * The fragment check of a torn leaf: the longitude difference of the interpolated direction difference `du` placed within pi of
   * `leafLon` (the true one) against the interpolated vertex value `dlam`; true where they differ by more than `TORN_LON_MISMATCH`.
   */
  lonMismatch(dlam: any, du: any, leafLon: any): any;
  /** Writes the frame's uniforms: anchor, projection, bent camera. */
  setFrame(frame: MorphFrame): void;
  setMethod(method: MorphMethod): void;
  /** The anchor as nodes (what `p2Position` reads) and the height uniform: what the vertex-stage pole fan (`morph-fan-vertex.ts`) builds on. */
  readonly anchor: MorphAnchor<any>;
  readonly height: any;
  /** Height above the base surface, metres, the same for every vertex (the spike has no relief). */
  setHeight(metres: number): void;
  /** Edge folding on (default) or off: the crack probe's first known-bad control. */
  setFolding(on: boolean): void;
  /** Shrinks every vertex toward its leaf's centre by this share of the distance (lattice units): the second known-bad control; 0 adds exactly 0. */
  setGap(share: number): void;
  /**
   * A synthetic relief for the crack probe's folding control: vertex height gains octaves of sine waves of the exact lattice vector
   * (wavelengths 4, 8, ... lattice units, amplitude `kappa` times the wavelength, up to `maxLambdaUnits`), so that a vertex on a
   * coarser neighbour's edge that is not folded onto it lifts off the edge. 0 (the default) adds exactly 0.
   */
  setRelief(kappa: number, maxLambdaUnits: number): void;
}

/** Longitude difference (radians) between a torn leaf's interpolated and true fragment longitude beyond which the fragment is discarded. */
export const TORN_LON_MISMATCH = 0.25;
/** Octaves of the synthetic relief: wavelengths 2^(i + 2) lattice units for i = 0 .. RELIEF_OCTAVES - 1. */
const RELIEF_OCTAVES = 20;

/**
 * Segments of the pole cap along the map's top (or bottom) edge: a corner has `CAP_SEGMENTS + 1` copies, `position.z` 1 .. CAP_SEGMENTS + 1
 * (0 is a grid vertex), copy z taking the longitude lonX + (lonY - lonX) (z - 1) / CAP_SEGMENTS between the leaf's two edge meridians.
 * The edge of the map is a curve (an arc of a small circle of the bent ground) and the cap's chords of it sag by 1 / CAP_SEGMENTS^2.
 */
export const CAP_SEGMENTS = 4;

/** A distance to the top or bottom edge below zero by more than this share of the radius is outside (the y clip is a safety net; y never passes the half-height in exact arithmetic). */
const TOP_BOTTOM_TOLERANCE_REL = 1e-6;
/** Distance reported when nothing is clipped. */
const FAR = 1e30;

/** Sine polynomial of the library (see `lod-surface-mesh.ts` `smallSin`): |x| up to pi / 2. */
const smallSin = (x: any): any => {
  const x2 = x.mul(x);
  let inner: any = float(1);
  for (let k = SIN_DENOMINATORS.length - 1; k >= 0; k--) inner = float(1).sub(x2.div(SIN_DENOMINATORS[k]).mul(inner));
  return x.mul(inner);
};

/** The math library over TSL nodes. */
export const TSL_LIB: MorphLib = {
  c: (x) => float(x),
  sqrt: (a) => sqrt(a),
  abs: (a) => abs(a),
  sin: (a) => sin(a),
  cos: (a) => cos(a),
  asin: (a) => asin(a),
  atan2: (y, x) => atan(y, x),
  floor: (a) => floor(a),
  min: (a, b) => min(a, b),
  max: (a, b) => max(a, b),
  lt: (a, b) => a.lessThan(b),
  select: (c, a, b) => select(c, a, b),
};

/** Bit e of a 0..15 mask held in a float, as 0 or 1. */
const bit = (mask: any, e: number) => mod(floor(mask.div(2 ** e)), 2);

const asVec = (u: any): [any, any, any] => [u.x, u.y, u.z];
const toVec3 = (v: readonly [any, any, any]) => vec3(v[0], v[1], v[2]);

/**
 * The vertex stage as a builder: call `build` once per shader (the mesh's vertex stage, the probe's compute kernel), set
 * the frame's uniforms with `setFrame`. `domain.sizeM` is only the initial radius; the radius is a uniform.
 */
export function createMorphVertex(domain: LodDomain, patchCells: PatchCells): MorphVertex {
  const steps = latticeSteps(patchCells, maxLevelFor(patchCells));
  const cells = float(patchCells);
  const frames = uniformArray(FACE_FRAMES.flatMap(({ u, v }) => [new Vector3(...u), new Vector3(...v)]), 'vec3') as any;

  // The lattice anchor (library): T, cube point, rounding error, cosines, and the anchor's base point minus the camera.
  const uAnchorT = uniform(new Vector3()) as any;
  const uAnchorCube = uniform(new Vector3()) as any;
  const uAnchorError = uniform(new Vector3()) as any;
  const uAnchorCos = uniform(new Vector3(1, 1, 1)) as any;
  const uAnchorRel = uniform(new Vector3()) as any;
  const uHeight = uniform(0) as any;
  const uMethod = uniform(0) as any;
  const uMorphZero = uniform(1) as any;
  const uFolding = uniform(1) as any;
  const uGap = uniform(0) as any;
  const uReliefKappa = uniform(0) as any;
  const uReliefMaxLambda = uniform(0) as any;
  // The basis' poles as lattice vectors T (far away when a pole is not a lattice vertex), see `polarLatticeVectors`.
  const uPoleUp = uniform(new Vector3(FAR, FAR, FAR)) as any;
  const uPoleDown = uniform(new Vector3(FAR, FAR, FAR)) as any;
  // The anchor's distances to the map's edges, doubles from the CPU (`outlineOf`).
  const outlineUniforms: { right: any[]; left: any[]; top: any; bottom: any } = {
    right: Array.from({ length: 2 * OUTLINE_WRAP + 1 }, () => uniform(0)),
    left: Array.from({ length: 2 * OUTLINE_WRAP + 1 }, () => uniform(0)),
    top: uniform(0),
    bottom: uniform(0),
  };
  const uZShift = uniform(0) as any;
  const uCamBody = uniform(new Vector3()) as any;

  // The P2 anchor: scalar and vector uniforms in the shape `p2Position` reads.
  const scalarUniforms: Record<string, any> = {};
  const vectorUniforms: Record<string, any> = {};
  const A: Record<string, any> = {};
  for (const key of ANCHOR_SCALAR_KEYS) A[key] = scalarUniforms[key] = uniform(0);
  for (const key of ANCHOR_VECTOR_KEYS) {
    const node = (vectorUniforms[key] = uniform(new Vector3()));
    A[key] = asVec(node);
  }
  scalarUniforms['radius'].value = domain.sizeM;
  const anchor = A as unknown as MorphAnchor<any>;
  const naiveFrame: NaiveFrame<any> = {
    bRight: anchor.bRight, bUp: anchor.bUp, bForward: anchor.bForward, p: anchor.p, radius: anchor.radius, k: anchor.k,
    zShift: uZShift, camBody: asVec(uCamBody),
  };

  return {
    radius: anchor.radius,
    anchor,
    height: uHeight,
    build(grid, leaf, info, cap, flag) {
      const mask = info.y;
      // The longitude the exact pole vertex takes: with a pole corner (`cap.z` >= 0) the corner's copies take the longitude of their edge
      // (the edges that meet at the pole run along meridians) and a vertex that folds onto the pole along an edge takes that edge's;
      // without one, or for a pole inside the leaf, the leaf's own centre longitude.
      let poleLon: any = info.w;
      if (cap && flag) {
        const onXEdge = abs(grid.y.sub(cap.w.mul(cells))).lessThan(0.5);
        const onYEdge = abs(grid.x.sub(cap.z.mul(cells))).lessThan(0.5);
        const copyLon = cap.x.add(cap.y.sub(cap.x).mul(flag.sub(1).div(CAP_SEGMENTS)));
        const edgeLon = select(flag.greaterThan(0.5), copyLon, select(onXEdge, cap.x, select(onYEdge, cap.y, info.w)));
        poleLon = select(cap.z.greaterThan(-0.5), edgeLon, info.w);
      }
      const sigma = select(info.z.lessThan(0), float(-1), float(1));
      const torn = select(abs(info.z).greaterThan(1.5), float(1), float(0));
      const face = leaf.w.toInt();
      const axisU = frames.element(face.mul(2));
      const axisV = frames.element(face.mul(2).add(1));
      const axisN = axisU.cross(axisV);

      // Folding (library): an odd vertex on a coarser edge snaps one grid cell back along that edge.
      const oddX = mod(grid.x, 2);
      const oddY = mod(grid.y, 2);
      const south = float(1).sub(step(0.5, grid.y));
      const north = step(cells.sub(0.5), grid.y);
      const west = float(1).sub(step(0.5, grid.x));
      const east = step(cells.sub(0.5), grid.x);
      const alongX = min(1, south.mul(bit(mask, 0)).add(north.mul(bit(mask, 2)))).mul(oddX).mul(uFolding);
      const alongY = min(1, east.mul(bit(mask, 1)).add(west.mul(bit(mask, 3)))).mul(oddY).mul(uFolding);
      const g = grid.sub(vec2(alongX as any, alongY as any));

      // The vertex's lattice point, its cube-lattice vector T, and the exact unit-direction difference from the anchor.
      const lattice = leaf.xy.add(g.mul(leaf.z));
      const t = axisN.mul(steps).add(axisU.mul(lattice.x.mul(2).sub(steps))).add(axisV.mul(lattice.y.mul(2).sub(steps)));
      // The injected gap (library): toward the leaf's centre, in cube-lattice units; it adds exactly 0 when 0.
      const toCentre = leaf.xy.add(leaf.z.mul(cells.mul(0.5))).sub(lattice);
      const dT = t.sub(uAnchorT).add(axisU.mul(toCentre.x.mul(2)).add(axisV.mul(toCentre.y.mul(2))).mul(uGap));
      const angle = Math.PI / 4 / steps;
      const dc = smallSin(dT.mul(angle)).div(cos(t.mul(angle)).mul(uAnchorCos)).add(uAnchorError);
      const cA = uAnchorCube;
      const c = cA.add(dc);
      const lc = c.length();
      const lC = cA.length();
      const du = dc.div(lc).sub(cA.mul(dot(dc, cA.mul(2).add(dc)).div(lc.mul(lC).mul(lc.add(lC)))));
      const direction = c.div(lc);

      // The synthetic relief (metres): octaves of sines of the exact lattice vector, wavelength a power of two so that the mod is exact on
      // the integer-valued components, amplitude kappa * lambda; an octave counts while its wavelength is within the cap. 0 adds exactly 0.
      const unitM = anchor.radius.mul(Math.PI / 4 / steps);
      let relief: any = float(0);
      for (let i = 0; i < RELIEF_OCTAVES; i++) {
        const lambda = 2 ** (i + 2);
        const phase = (mod(t, lambda) as any).mul((2 * Math.PI) / lambda);
        const wave = sin(phase.x.add(0.7 + 1.3 * i)).add(sin(phase.y.add(2.1 + 0.9 * i))).add(sin(phase.z.add(4.0 + 1.7 * i)));
        relief = relief.add(wave.mul(step(lambda, uReliefMaxLambda)).mul(lambda / 3));
      }
      const height = uHeight.add(relief.mul(uReliefKappa).mul(unitM));
      const today = uAnchorRel.add(du.mul(anchor.radius)).add(direction.mul(height));
      // The exact pole vertex (a lattice vertex that is a pole of the basis) takes its leaf's own longitude, `info.w`.
      const onPole = (pole: any) => abs(t.x.sub(pole.x)).add(abs(t.y.sub(pole.y))).add(abs(t.z.sub(pole.z))).lessThan(0.5);
      const p2 = p2Position(TSL_LIB, anchor, asVec(du), sigma, height, { is: onPole(uPoleUp).or(onPole(uPoleDown)), lon: poleLon }, info.w);
      const naive = naivePosition(TSL_LIB, naiveFrame, asVec(direction), sigma, height);
      const p2Rel = toVec3(p2.rel);
      const naiveRel = toVec3(naive.rel);
      const useNaive = uMethod.greaterThan(0.5);
      const atGlobe = uMorphZero.greaterThan(0.5);
      const selected = select(useNaive, naiveRel, select(atGlobe, today, p2Rel));
      const wrapN = select(useNaive, naive.wrapN, select(atGlobe, float(0), p2.wrapN));
      const outline: MorphOutline<any> = outlineUniforms;
      const distances = outlineDistances(TSL_LIB, anchor, outline, p2);
      const edges = select(useNaive.or(atGlobe), vec4(FAR, FAR, FAR, FAR), vec4(distances[0], distances[1], distances[2], distances[3]));
      return { selected, today, p2: p2Rel, naive: naiveRel, wrapN, edges, direction, dlam: p2.dlam, du, torn: select(useNaive.or(atGlobe), float(0), torn), leafLon: info.w };
    },
    lonMismatch(dlam, du, leafLon) {
      // The same longitude formulas as p2Position, on the fragment's interpolated direction difference.
      const dv1 = dot(du, toVec3(anchor.bForward));
      const dv2 = dot(du, toVec3(anchor.bRight));
      const cross2 = anchor.vA1.mul(dv2).sub(anchor.vA2.mul(dv1));
      const dotv = anchor.nA2.add(anchor.vA1.mul(dv1)).add(anchor.vA2.mul(dv2));
      const raw = atan2R(TSL_LIB, cross2, dotv);
      const n = floor(leafLon.sub(Math.PI).sub(anchor.lamA.add(raw)).div(2 * Math.PI)).add(1);
      return abs(dlam.sub(raw.add(n.mul(2 * Math.PI)))).greaterThan(TORN_LON_MISMATCH);
    },
    setFrame(frame) {
      const { anchor: a, values: v, naive: n } = frame;
      (uAnchorT.value as Vector3).set(...a.t);
      (uAnchorCube.value as Vector3).set(...a.cube);
      (uAnchorError.value as Vector3).set(...a.error);
      (uAnchorCos.value as Vector3).set(...a.cos);
      (uAnchorRel.value as Vector3).set(...a.rel);
      for (const key of ANCHOR_SCALAR_KEYS) scalarUniforms[key].value = v[key];
      for (const key of ANCHOR_VECTOR_KEYS) (vectorUniforms[key].value as Vector3).set(...v[key]);
      uZShift.value = n.zShift;
      (uCamBody.value as Vector3).set(...n.camBody);
      uMorphZero.value = frame.view.morph === 0 ? 1 : 0;
      const o = frame.outline;
      for (let i = 0; i < 2 * OUTLINE_WRAP + 1; i++) {
        outlineUniforms.right[i].value = o.right[i];
        outlineUniforms.left[i].value = o.left[i];
      }
      outlineUniforms.top.value = o.top;
      outlineUniforms.bottom.value = o.bottom;
      (uPoleUp.value as Vector3).set(...(frame.poles[0] ?? [FAR, FAR, FAR]));
      (uPoleDown.value as Vector3).set(...(frame.poles[1] ?? [FAR, FAR, FAR]));
    },
    setMethod(method) {
      uMethod.value = method === 'naive' ? 1 : 0;
    },
    setHeight(metres) {
      uHeight.value = metres;
    },
    setFolding(on) {
      uFolding.value = on ? 1 : 0;
    },
    setGap(share) {
      uGap.value = share;
    },
    setRelief(kappa, maxLambdaUnits) {
      uReliefKappa.value = kappa;
      uReliefMaxLambda.value = maxLambdaUnits;
    },
  };
}

/**
 * Grid vertices (gx, gy, 0) in `position`, two triangles per cell, plus a pole cap at each of the four corners: the pole of the
 * projection is a point on the sphere but the whole top (or bottom) edge of the map, so the triangles of a corner cell that has the
 * pole at its corner would leave a wedge of the edge uncovered if they shared one pole vertex. Each corner has `CAP_SEGMENTS + 1`
 * copies (`position.z` 1 .. CAP_SEGMENTS + 1: the first above the corner's neighbour along x, the last above its neighbour along y,
 * the others between, all on the edge); the triangles that hold the corner use the end copy of their edge neighbour, and a fan from
 * the cell's diagonal vertex joins the copies (the triangle of a cell that holds the corner by both its edge neighbours is split
 * to reach them). A corner that is not a pole has copies at its own position: the replaced triangles are unchanged and the
 * extras have no area.
 */
export function gridGeometry(cells: number, capacity: number): InstancedBufferGeometry {
  const side = cells + 1;
  const regular = side * side;
  const copies = CAP_SEGMENTS + 1;
  const positions = new Float32Array((regular + 4 * copies) * 3);
  for (let y = 0; y <= cells; y++) {
    for (let x = 0; x <= cells; x++) {
      const k = (y * side + x) * 3;
      positions[k] = x;
      positions[k + 1] = y;
    }
  }
  const corners: [number, number][] = [[0, 0], [cells, 0], [0, cells], [cells, cells]];
  const copy = (c: number, j: number): number => regular + copies * c + j;
  corners.forEach(([cx, cy], c) => {
    for (let j = 0; j < copies; j++) {
      const k = copy(c, j) * 3;
      positions[k] = cx;
      positions[k + 1] = cy;
      positions[k + 2] = j + 1;
    }
  });
  const triangles: number[] = [];
  const idx = (p: readonly number[]): number => p[1] * side + p[0];
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const cell: [number, number][][] = [
        [[x, y], [x + 1, y], [x + 1, y + 1]],
        [[x, y], [x + 1, y + 1], [x, y + 1]],
      ];
      let held = 0;
      let diagonal = -1;
      let heldCorner = -1;
      for (const tri of cell) {
        const at = tri.findIndex(([vx, vy]) => corners.some(([cx, cy]) => cx === vx && cy === vy));
        if (at < 0) {
          triangles.push(idx(tri[0]), idx(tri[1]), idx(tri[2]));
          continue;
        }
        const c = corners.findIndex(([cx, cy]) => cx === tri[at][0] && cy === tri[at][1]);
        const [cx, cy] = corners[c];
        const others = tri.filter((_, i) => i !== at);
        const kinds = others.map(([vx, vy]) => (vy === cy ? 'x' : vx === cx ? 'y' : 'd'));
        const xn = others[kinds.indexOf('x')];
        const yn = others[kinds.indexOf('y')];
        const d = others[kinds.indexOf('d')];
        if (xn && d) triangles.push(copy(c, 0), idx(xn), idx(d));
        else if (yn && d) triangles.push(copy(c, copies - 1), idx(yn), idx(d));
        else if (xn && yn) {
          // The triangle that holds the corner by both neighbours: the quad under the cap's polyline, fanned from the x neighbour.
          triangles.push(idx(xn), idx(yn), copy(c, copies - 1));
          for (let j = copies - 2; j >= 0; j--) triangles.push(idx(xn), copy(c, j + 1), copy(c, j));
        }
        if (d) {
          held++;
          diagonal = idx(d);
          heldCorner = c;
        }
      }
      if (held === 2) for (let j = 0; j < copies - 1; j++) triangles.push(copy(heldCorner, j), copy(heldCorner, j + 1), diagonal);
    }
  }
  const index = new Uint32Array(triangles);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  for (const name of ['aLeaf', 'aInfo', 'aCap']) {
    geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(capacity * LEAF_STRIDE), LEAF_STRIDE));
  }
  geometry.instanceCount = 0;
  return geometry;
}

/** The fan's Float32 positions are relative to the camera of its build: it is rebuilt when the camera moved this share of the distance to the nearest fan vertex. */
const FAN_REBUILD_SHARE = 0.02;

/** Fan builds counted by a surface mesh. */
export interface FanCounters {
  /** Builds (CPU fan builds, or vertex-stage fan topology builds) since the last reset. */
  readonly rebuilds: number;
  /** CPU milliseconds of all those builds, and of the last one. */
  readonly buildMsTotal: number;
  readonly lastBuildMs: number;
}

/** The morph spike's drawn surface. */
export interface MorphSurfaceMesh {
  /** Add to the scene; `upload` puts it at the bent camera. */
  readonly mesh: Mesh;
  readonly material: MeshBasicNodeMaterial;
  /** The crack probe's material: the same vertex stage and the same clip, writes 1 (the red channel reads 255). */
  readonly probeMaterial: MeshBasicNodeMaterial;
  /** Packs the leaves when the selection, the projection centre or whether morph is 0 changed, sets the frame's uniforms and moves the mesh to the bent camera. Returns the pack's counts. */
  upload(selector: LodSelector, frame: MorphFrame): MorphPack;
  setMethod(method: MorphMethod): void;
  setHeight(metres: number): void;
  setFolding(on: boolean): void;
  setGap(share: number): void;
  setRelief(kappa: number, maxLambdaUnits: number): void;
  setWireframe(on: boolean): void;
  /**
   * The pole fan (iteration 4, `morph-fan.ts`): on, the leaves that hold a pole of the projection are left out of the instanced
   * draw above morph 0 and drawn as `fan.mesh` (a CPU-built polar mesh, `rays` meridians per full turn). Morph 0 never uses it.
   */
  setPoleFan(on: boolean, rays?: number): void;
  /**
   * Which fan the pole leaves are drawn as: 'cpu' (iteration 4: positions built on the CPU in doubles, rebuilt when the camera or the
   * morph moves) or 'vertex' (iteration 5: only topology and per-vertex descriptions are built, and only when the pole leaf set, the
   * projection centre, the radius or the rays change; the vertex stage evaluates the positions, `morph-fan-vertex.ts`).
   */
  setFanMode(mode: FanMode): void;
  /** Builds of the fan (either mode) since the last reset and what they cost on the CPU: the vertex-stage fan must stay at 0 through a camera move and a morph change. */
  fanCounters(): FanCounters;
  resetFanCounters(): void;
  /** The vertex-stage fan's stage, meshes and materials: add `vertexFan.mesh` to the page's scene and `vertexFan.probeMesh` to the crack probe's. */
  readonly vertexFan: VertexFanStage;
  /** The fan's meshes: add `mesh` to the page's scene (it is placed at the bent camera of its build); `probeMesh` is the same geometry with the probe material, for the crack probe's scene. */
  readonly fan: { readonly mesh: Mesh; readonly probeMesh: Mesh; readonly material: MeshBasicNodeMaterial; readonly probeMaterial: MeshBasicNodeMaterial };
  dispose(): void;
}

/** Builds the surface mesh: one shared grid drawn instanced, one instance per drawn leaf, one draw call. */
export function createMorphSurfaceMesh(options: { domain: LodDomain; patchCells: PatchCells; capacity: number }): MorphSurfaceMesh {
  const { domain, patchCells, capacity } = options;
  const geometry = gridGeometry(patchCells, capacity);
  const vertex = createMorphVertex(domain, patchCells);
  const leaf = attribute('aLeaf', 'vec4') as any;
  const info = attribute('aInfo', 'vec4') as any;
  const cap = attribute('aCap', 'vec4') as any;
  const grid = positionGeometry.xy as any;
  const nodes = vertex.build(grid, leaf, info, cap, positionGeometry.z);

  // Colour: one hue per level, patch outlines, and a screen-space flat normal for the light (the spike draws no relief).
  const level = varying(info.x, 'vMorphLevel') as any;
  const patchUv = varying(grid.mul(1 / patchCells), 'vMorphPatchUv') as any;
  const hue = fract(level.mul(0.137).add(0.05));
  const palette = vec3(0.5).add(vec3(0.5).mul(cos(vec3(hue, hue.add(1 / 3), hue.add(2 / 3)).mul(2 * Math.PI))));
  const flat = normalize(cross(dFdx(positionView), dFdy(positionView)));
  const light = abs(dot(flat, normalize(vec3(0.3, 0.6, 0.75)))).mul(0.75).add(0.25);
  const border = min(min(patchUv.x, float(1).sub(patchUv.x)), min(patchUv.y, float(1).sub(patchUv.y)));
  const line = float(1).sub(smoothstep(0, fwidth(border).mul(1.5), border));
  // The outline clip (morph above 0): a fragment is kept while it is inside all four edges. The distances are varyings, linear
  // across a triangle; right and left are exact to the cut's centimetres (`outlineDistances`).
  const edge = varying(nodes.edges, 'vMorphEdge') as any;
  const tolerance = vertex.radius.mul(TOP_BOTTOM_TOLERANCE_REL);
  // A torn leaf (a pole strictly inside it) has triangles that cross its antipodal meridian: their interpolated longitude is a map
  // wide off the true one, and the fragment is discarded (the duplicate on the other side and the clip cover the area).
  const vDlam = varying(nodes.dlam, 'vMorphDlam') as any;
  const vDu = varying(nodes.du, 'vMorphDu') as any;
  const vTorn = varying(nodes.torn, 'vMorphTorn') as any;
  const vLeafLon = varying(nodes.leafLon, 'vMorphLeafLon') as any;
  const tornCrossing = vTorn.greaterThan(0.5).and(vertex.lonMismatch(vDlam, vDu, vLeafLon));
  const insideOutline = edge.x.greaterThanEqual(0).and(edge.y.greaterThanEqual(0))
    .and(edge.z.greaterThanEqual(tolerance.negate())).and(edge.w.greaterThanEqual(tolerance.negate()))
    .and(tornCrossing.not());
  const probeMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  probeMaterial.positionNode = nodes.selected;
  probeMaterial.maskNode = insideOutline;
  probeMaterial.colorNode = vec4(1, 1, 1, 1);
  probeMaterial.toneMapped = false;
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.positionNode = nodes.selected;
  material.maskNode = insideOutline;
  material.colorNode = vec4(mix(mix(vec3(0.62, 0.64, 0.6), palette, 0.8).mul(light), vec3(0.05, 0.05, 0.08), line.mul(0.7)), 1);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'Morph spike surface';

  // The pole fan: a plain mesh whose positions are already camera-relative Float32 (relative to the camera of the build; the mesh
  // sits at that camera). It has no outline clip: the fan is built inside the map (longitude -pi .. pi, or the leaf's own range).
  const fanLight = abs(dot(normalize(cross(dFdx(positionView), dFdy(positionView))), normalize(vec3(0.3, 0.6, 0.75)))).mul(0.75).add(0.25);
  const fanMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  fanMaterial.colorNode = vec4(vec3(0.95, 0.55, 0.2).mul(fanLight), 1);
  const fanProbeMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  fanProbeMaterial.colorNode = vec4(1, 1, 1, 1);
  fanProbeMaterial.toneMapped = false;
  const emptyFan = (): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(3), 1));
    g.setDrawRange(0, 0);
    return g;
  };
  let fanGeometry = emptyFan();
  const fanMesh = new Mesh(fanGeometry, fanMaterial);
  fanMesh.frustumCulled = false;
  fanMesh.name = 'Morph spike pole fan';
  fanMesh.visible = false;
  const fanProbeMesh = new Mesh(fanGeometry, fanProbeMaterial);
  fanProbeMesh.frustumCulled = false;
  fanProbeMesh.visible = false;
  let poleFan = false;
  let fanRays = FAN_DEFAULT_RAYS;
  let fanBuild: FanBuild | undefined;
  let fanKey = '';
  let fanFrom: LodSelector | undefined;
  let fanVersion = -1;
  let heightOfFan = 0;
  let fanMode: FanMode = 'cpu';
  const vertexFan = createVertexFanStage(vertex, TSL_LIB);
  let vfFrom: LodSelector | undefined;
  let vfVersion = -1;
  let vfSignature = '';
  let vfStats: FanStats | undefined;
  let counters: FanCounters = { rebuilds: 0, buildMsTotal: 0, lastBuildMs: 0 };
  const count = (ms: number): void => {
    counters = { rebuilds: counters.rebuilds + 1, buildMsTotal: counters.buildMsTotal + ms, lastBuildMs: ms };
  };

  const attributes = ['aLeaf', 'aInfo', 'aCap'].map((name) => geometry.getAttribute(name) as InstancedBufferAttribute);
  const [leafData, infoData, capData] = attributes.map((attr) => attr.array as Float32Array);
  let packedFrom: LodSelector | undefined;
  let packedVersion = -1;
  let packedKey = '';
  let pack: MorphPack = { instances: 0, leaves: 0, duplicates: 0, poleLeaves: 0, torn: 0, dropped: 0 };
  let packWithFan: MorphPack = pack;

  return {
    mesh,
    material,
    probeMaterial,
    upload(selector, frame) {
      const fanOn = poleFan && frame.view.morph > 0;
      const key = `${frame.view.centreLonDeg}|${frame.view.centreLatDeg}|${frame.view.radiusM}|${frame.view.morph > 0}|${fanOn}`;
      if (selector !== packedFrom || selector.version !== packedVersion || key !== packedKey) {
        packedFrom = selector;
        packedVersion = selector.version;
        packedKey = key;
        pack = packMorphLeaves(selector, domain, patchCells, capacity, frame.basis, frame.view.morph, leafData, infoData, true, capData, fanOn);
        packWithFan = pack;
        for (const attr of attributes) {
          attr.updateRanges.length = 0;
          attr.updateRanges.push({ start: 0, count: Math.max(1, pack.instances) * LEAF_STRIDE });
          attr.needsUpdate = true;
        }
        geometry.instanceCount = pack.instances;
      }
      // The CPU fan is rebuilt when the selection, the projection (centre, radius, morph, height), its rays or the camera moved far enough
      // (a few percent of its distance to the nearest vertex: the Float32 positions are relative to the camera of the build) changed.
      // The vertex-stage fan is rebuilt only when the pole leaves, the projection centre, the radius or the rays change.
      if (fanOn && fanMode === 'cpu') {
        const k = `${frame.view.centreLonDeg}|${frame.view.centreLatDeg}|${frame.view.radiusM}|${frame.view.morph}|${fanRays}|${heightOfFan}`;
        const moved = fanBuild ? Math.hypot(frame.camBody[0] - fanBuild.origin[0], frame.camBody[1] - fanBuild.origin[1], frame.camBody[2] - fanBuild.origin[2]) : Infinity;
        if (!fanBuild || selector !== fanFrom || selector.version !== fanVersion || k !== fanKey || moved > FAN_REBUILD_SHARE * fanBuild.nearestM) {
          fanFrom = selector;
          fanVersion = selector.version;
          fanKey = k;
          fanBuild = buildPoleFan(selector, domain, patchCells, capacity, frame, fanRays, heightOfFan);
          count(fanBuild.stats.buildMs);
          const next = new BufferGeometry();
          next.setAttribute('position', new BufferAttribute(fanBuild.positions.length ? fanBuild.positions : new Float32Array(9), 3));
          next.setIndex(new BufferAttribute(fanBuild.index.length ? fanBuild.index : new Uint32Array(3), 1));
          if (!fanBuild.index.length) next.setDrawRange(0, 0);
          fanMesh.geometry = next;
          fanProbeMesh.geometry = next;
          fanGeometry.dispose();
          fanGeometry = next;
          packWithFan = { ...pack, fan: { ...fanBuild.stats, rebuilds: counters.rebuilds } };
        } else if (packWithFan.instances !== pack.instances || packWithFan.leaves !== pack.leaves) {
          packWithFan = { ...pack, fan: { ...fanBuild.stats, rebuilds: counters.rebuilds } };
        }
        fanMesh.position.set(fanBuild.origin[0], fanBuild.origin[1], fanBuild.origin[2]);
        fanProbeMesh.position.copy(fanMesh.position);
        fanMesh.visible = fanProbeMesh.visible = fanBuild.stats.triangles > 0;
        vertexFan.mesh.visible = vertexFan.probeMesh.visible = false;
      } else if (fanOn) {
        fanMesh.visible = fanProbeMesh.visible = false;
        fanBuild = undefined;
        const centreKey = `${frame.view.centreLonDeg}|${frame.view.centreLatDeg}|${frame.view.radiusM}|${fanRays}`;
        if (selector !== vfFrom || selector.version !== vfVersion || !vfStats || !vfSignature.startsWith(centreKey + '|')) {
          vfFrom = selector;
          vfVersion = selector.version;
          const leaves = fanLeavesOf(selector, domain, patchCells, capacity, frame.basis);
          const signature = `${centreKey}|${fanLeafSignature(leaves)}`;
          if (signature !== vfSignature || !vfStats) {
            vfSignature = signature;
            const began = performance.now();
            const specs = buildFanSpecs(fanContext(domain, patchCells, frame.basis, frame.view.radiusM, frame.view.morph), leaves, fanRays);
            const data = packVertexFan(specs);
            vertexFan.upload(data);
            const ms = performance.now() - began;
            count(ms);
            vfStats = {
              leaves: specs.corner + specs.interior, corner: specs.corner, interior: specs.interior, rays: fanRays, vertices: specs.vertexCount,
              triangles: specs.index.length / 3, buildMs: ms, mode: 'vertex',
            };
          }
        }
        packWithFan = { ...pack, fan: { ...vfStats!, rebuilds: counters.rebuilds } };
        vertexFan.mesh.position.set(frame.camBody[0], frame.camBody[1], frame.camBody[2]);
        vertexFan.probeMesh.position.copy(vertexFan.mesh.position);
        vertexFan.mesh.visible = vertexFan.probeMesh.visible = vfStats!.triangles > 0;
      } else {
        fanMesh.visible = fanProbeMesh.visible = false;
        vertexFan.mesh.visible = vertexFan.probeMesh.visible = false;
        fanBuild = undefined;
        packWithFan = pack;
      }
      vertexFan.setFrame(frame);
      vertex.setFrame(frame);
      mesh.position.set(frame.camBody[0], frame.camBody[1], frame.camBody[2]);
      return packWithFan;
    },
    setPoleFan(on, rays) {
      poleFan = on;
      if (rays !== undefined) fanRays = rays;
    },
    setFanMode(mode) {
      fanMode = mode;
    },
    fanCounters: () => counters,
    resetFanCounters() {
      counters = { rebuilds: 0, buildMsTotal: 0, lastBuildMs: 0 };
    },
    vertexFan,
    fan: { mesh: fanMesh, probeMesh: fanProbeMesh, material: fanMaterial, probeMaterial: fanProbeMaterial },
    setMethod: (method) => vertex.setMethod(method),
    setHeight: (metres) => {
      heightOfFan = metres;
      vertex.setHeight(metres);
    },
    setFolding: (on) => vertex.setFolding(on),
    setGap: (share) => vertex.setGap(share),
    setRelief: (kappa, maxLambdaUnits) => vertex.setRelief(kappa, maxLambdaUnits),
    setWireframe(on) {
      material.wireframe = on;
      material.needsUpdate = true;
      fanMaterial.wireframe = on;
      fanMaterial.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      fanGeometry.dispose();
      material.dispose();
      probeMaterial.dispose();
      fanMaterial.dispose();
      fanProbeMaterial.dispose();
      vertexFan.dispose();
    },
  };
}
