import { FACE_FRAMES, PLANE_FRAME, faceOfDirection, type CubeWarp, type LodDomain, type Vec3 } from './lod-domain';

/**
 * Plan 059 shared-seam lattice (pure math; `lod-surface-mesh.ts` builds the same arithmetic as TSL nodes).
 *
 * Every vertex of every leaf sits on ONE integer lattice of L = patchCells * 2^maxLevel steps per face side (2^24 for
 * all supported patch sizes, see `maxLevelFor`). A leaf of level l has lattice step s = 2^(maxLevel - l) per grid cell,
 * origin (i, j) * patchCells * s, and its grid vertex (gx, gy) is the lattice point (U, V) = origin + (gx, gy) * s. All of
 * these are integers up to 2^24, so they are exact in float32 as well as in i32: two leaves that draw the same vertex
 * compute the same (U, V) bit for bit, whatever their sizes. The folded vertex of a leaf next to a coarser one is
 * moved by whole grid cells onto an even grid index, which is a lattice point of the coarse leaf (its step is 2 s and
 * its origin a multiple of 2 s because patchCells is even).
 *
 * On the sphere the vertex is the cube-lattice integer vector T = n L + u (2U - L) + v (2V - L) (face frame n, u, v),
 * where one component is +-L. T is a property of the point, not of the face: the same seam vertex reached from either
 * face (or any of the three at a corner) has the same T. The cube point is c_k = tan(pi/4 T_k / L) (equal-angle) or
 * T_k / L, and the final position depends only on T and global per-frame uniforms (the anchor below).
 *
 * Camera-relative: the anchor is the lattice point nearest to the camera, chosen in doubles each frame, as the integer
 * vector `t`; its fraction (the double distance from that point on the base surface to the camera, height included) is
 * folded into `rel`, a float vector that is small near the camera. A vertex is rel + (offset from the anchor), where the
 * offset starts from the exact integer difference T - anchor.t. See the runbook for the precision argument.
 */

/** Largest lattice side that float32 holds exactly. */
export const MAX_LATTICE_STEPS = 2 ** 24;

/** Denominators of the nested Taylor form of sin used in the vertex stage: x (1 - x^2/6 (1 - x^2/20 (...))). */
export const SIN_DENOMINATORS: readonly number[] = [6, 20, 42, 72, 110, 156, 210];

/** Lattice steps per face side. */
export function latticeSteps(patchCells: number, maxLevel: number): number {
  const steps = patchCells * 2 ** maxLevel;
  if (steps > MAX_LATTICE_STEPS) throw new Error(`Lattice of ${steps} steps is not exact in float32`);
  return steps;
}

/** A leaf's place on its face's integer lattice, which all its vertices are exact functions of. */
export interface LeafLattice {
  root: number;
  /** Lattice coordinates of the leaf's (0, 0) vertex. */
  u0: number;
  v0: number;
  /** Lattice steps per grid cell. */
  step: number;
}

/** The lattice placement of leaf (root, level, i, j) for the given patch size and deepest level; writes into `out` when given. */
export function leafLattice(root: number, level: number, i: number, j: number, patchCells: number, maxLevel: number, out: LeafLattice = { root: 0, u0: 0, v0: 0, step: 1 }): LeafLattice {
  const step = 2 ** (maxLevel - level);
  out.root = root;
  out.step = step;
  out.u0 = i * patchCells * step;
  out.v0 = j * patchCells * step;
  return out;
}

/** Lattice point (U, V) of grid vertex (gx, gy) of a leaf. */
export function gridLattice(leaf: LeafLattice, gx: number, gy: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = leaf.u0 + gx * leaf.step;
  out[1] = leaf.v0 + gy * leaf.step;
  return out;
}

/**
 * Folding on the grid: an odd vertex on an edge whose neighbour is coarser (mask bit e: 0 south, 1 east, 2 north,
 * 3 west) moves one cell back along the edge, onto a vertex the coarse neighbour also has. The shader does the same
 * with step functions.
 */
export function foldedGrid(gx: number, gy: number, cells: number, mask: number, folding = true, out: [number, number] = [0, 0]): [number, number] {
  const alongX = folding && gx % 2 === 1 && ((gy === 0 && (mask & 1) !== 0) || (gy === cells && (mask & 4) !== 0));
  const alongY = folding && gy % 2 === 1 && ((gx === cells && (mask & 2) !== 0) || (gx === 0 && (mask & 8) !== 0));
  out[0] = alongX ? gx - 1 : gx;
  out[1] = alongY ? gy - 1 : gy;
  return out;
}

/** Cube-lattice integer vector T of face lattice point (U, V). Exactly one component is +-L. */
export function cubeLattice(face: number, u: number, v: number, steps: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const { n, u: au, v: av } = FACE_FRAMES[face];
  const a = 2 * u - steps;
  const b = 2 * v - steps;
  for (let k = 0; k < 3; k++) out[k] = n[k] * steps + au[k] * a + av[k] * b;
  return out;
}

/** Cube coordinate of one component of T, in doubles; exactly +-1 on the face (shared by neighbouring faces). */
export function cubeComponent(t: number, steps: number, warp: CubeWarp): number {
  if (warp === 'none') return t / steps;
  if (Math.abs(t) >= steps) return Math.sign(t);
  return Math.tan(((Math.PI / 4) * t) / steps);
}

/** Per-frame camera anchor; everything the vertex stage needs besides the vertex's own lattice point. */
export interface LatticeAnchor {
  /** Sphere: the anchor's T. Plane: (U, V, 0). */
  t: Vec3;
  /** Sphere: the anchor's cube point as float32 (the shader's value) and the double minus that, per component. */
  cube: Vec3;
  error: Vec3;
  /** Sphere equal-angle: cos(pi/4 t_k / L) per component. */
  cos: Vec3;
  /** Anchor surface point (height 0) minus the camera, domain frame, doubles (the GPU holds float32). */
  rel: Vec3;
}

/** An empty {@link LatticeAnchor}, to be filled by {@link anchorFor}. */
export function newAnchor(): LatticeAnchor {
  return { t: [0, 0, 0], cube: [0, 0, 0], error: [0, 0, 0], cos: [1, 1, 1], rel: [0, 0, 0] };
}

/** The lattice point nearest to the camera (on the face the camera's direction falls on), from doubles. */
export function anchorFor(domain: LodDomain, camera: Vec3, steps: number, out: LatticeAnchor = newAnchor()): LatticeAnchor {
  const clamp = (value: number) => Math.min(steps, Math.max(0, Math.round(value)));
  if (domain.kind === 'plane') {
    const { u, v } = PLANE_FRAME;
    const x = camera[0] * u[0] + camera[1] * u[1] + camera[2] * u[2];
    const y = camera[0] * v[0] + camera[1] * v[1] + camera[2] * v[2];
    const lu = clamp((x / domain.sizeM + 0.5) * steps);
    const lv = clamp((y / domain.sizeM + 0.5) * steps);
    out.t[0] = lu;
    out.t[1] = lv;
    out.t[2] = 0;
    const px = (lu / steps - 0.5) * domain.sizeM;
    const py = (lv / steps - 0.5) * domain.sizeM;
    for (let k = 0; k < 3; k++) {
      out.rel[k] = px * u[k] + py * v[k] - camera[k];
      out.cube[k] = out.error[k] = 0;
      out.cos[k] = 1;
    }
    return out;
  }
  const { face, s, t } = faceOfDirection(camera[0], camera[1], camera[2]);
  const param = (value: number) => (domain.warp === 'none' ? value : (4 / Math.PI) * Math.atan(value));
  const lu = clamp(((param(s) + 1) / 2) * steps);
  const lv = clamp(((param(t) + 1) / 2) * steps);
  cubeLattice(face, lu, lv, steps, out.t);
  let length2 = 0;
  for (let k = 0; k < 3; k++) {
    const exact = cubeComponent(out.t[k], steps, domain.warp);
    out.cube[k] = Math.fround(exact);
    out.error[k] = exact - out.cube[k];
    out.cos[k] = domain.warp === 'none' ? 1 : Math.cos(((Math.PI / 4) * out.t[k]) / steps);
    length2 += out.cube[k] * out.cube[k];
  }
  const scale = domain.sizeM / Math.sqrt(length2);
  for (let k = 0; k < 3; k++) out.rel[k] = out.cube[k] * scale - camera[k];
  return out;
}

const f = Math.fround;

/** The vertex stage's sine polynomial with every operation rounded to float32, valid for |x| up to pi / 2. */
export function smallSinF32(x: number): number {
  const xf = f(x);
  const x2 = f(xf * xf);
  let inner = 1;
  for (let k = SIN_DENOMINATORS.length - 1; k >= 0; k--) inner = f(1 - f(f(x2 / SIN_DENOMINATORS[k]) * inner));
  return f(xf * inner);
}

/**
 * Float32 mirror of the sphere vertex stage up to the height: position of cube-lattice vertex T relative to the camera,
 * from T and the anchor only. `gap` shrinks toward `centre` (the leaf centre's T) as the injected-gap control does.
 */
export function sphereVertexF32(domain: LodDomain, steps: number, t: Vec3, anchor: LatticeAnchor, out: Vec3 = [0, 0, 0], gap = 0, centre?: Vec3): Vec3 {
  const warped = domain.warp !== 'none';
  const dc: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const dT = f(f(t[k] - anchor.t[k]) + (centre ? f(f(centre[k] - t[k]) * f(gap)) : 0));
    if (warped) {
      const angle = f(dT * f(Math.PI / 4 / steps));
      const cosV = f(Math.cos(f(t[k] * f(Math.PI / 4 / steps))));
      dc[k] = f(f(smallSinF32(angle) / f(cosV * f(anchor.cos[k]))) + f(anchor.error[k]));
    } else {
      dc[k] = f(f(dT / steps) + f(anchor.error[k]));
    }
  }
  const cA = anchor.cube;
  const c = [f(cA[0] + dc[0]), f(cA[1] + dc[1]), f(cA[2] + dc[2])];
  const lc = f(Math.sqrt(f(f(f(c[0] * c[0]) + f(c[1] * c[1])) + f(c[2] * c[2]))));
  const lC = f(Math.sqrt(f(f(f(cA[0] * cA[0]) + f(cA[1] * cA[1])) + f(cA[2] * cA[2]))));
  let dot = 0;
  for (let k = 0; k < 3; k++) dot = f(dot + f(dc[k] * f(f(2 * cA[k]) + dc[k])));
  const denominator = f(f(lc * lC) * f(lc + lC));
  const shared = f(dot / denominator);
  for (let k = 0; k < 3; k++) {
    const offset = f(f(f(dc[k] / lc) - f(cA[k] * shared)) * f(domain.sizeM));
    out[k] = f(f(anchor.rel[k]) + offset);
  }
  return out;
}

/** Float32 mirror of the plane vertex stage up to the height. */
export function planeVertexF32(domain: LodDomain, steps: number, u: number, v: number, anchor: LatticeAnchor, out: Vec3 = [0, 0, 0]): Vec3 {
  const { u: au, v: av } = PLANE_FRAME;
  const du = f(u - anchor.t[0]);
  const dv = f(v - anchor.t[1]);
  const unit = f(domain.sizeM / steps);
  for (let k = 0; k < 3; k++) out[k] = f(f(anchor.rel[k]) + f(f(f(au[k] * du) + f(av[k] * dv)) * unit));
  return out;
}
