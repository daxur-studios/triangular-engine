/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataArrayTexture, FloatType, NearestFilter, RedFormat } from 'three';
import { float, floor, int, ivec2, max, min, select, textureLoad, vec2 } from 'three/tsl';
import { type BakedHeights, latticeOfPosition, pyramidRange, texelLattice } from './lod-height-bake';
import type { HeightSource, HeightSourceId, NodeHeightRanges } from './lod-height';

/**
 * Plan 059 step 2: a height source read from a baked texture, in the vertex stage and on the CPU with the same arithmetic.
 *
 * Layout: one `r32float` layer per face (`DataArrayTexture`, (2^k + 1)^2 texels, nearest, no mipmaps). The vertex stage
 * knows each vertex's face and integer lattice point (U, V), so it reads texel (U, V) / 2^(24 - k) directly: four
 * `textureLoad`s and a hand-written bilinear blend in float32. Hardware filtering is not used (it drops sub-texel bits).
 *
 * Seams: the blend weights are exact fractions of a power of two, so a texel centre returns its texel bit for bit, and
 * the blend itself is orientation-free: `lerpF32(p, q, w)` returns p at w = 0 and q at w = 1, and otherwise interpolates
 * from the smaller to the larger value, so lerp(p, q, w) and lerp(q, p, 1 - w) have the same bits. A vertex on a cube
 * edge therefore gets the same height from either face (their edge texels are canonical, `texelPoint`), whichever way
 * the edge runs in each face, and a folded vertex is just a coarser lattice point: the lookup is a function of (face,
 * U, V) only.
 */

const f = Math.fround;

/** Blend of p and q by w in [0, 1]; exact at the ends and symmetric: lerp(p, q, w) === lerp(q, p, 1 - w). */
export function lerpF32(p: number, q: number, w: number): number {
  if (w <= 0) return p;
  if (w >= 1) return q;
  const lo = Math.min(p, q);
  const hi = Math.max(p, q);
  const t = p <= q ? w : f(1 - w);
  return f(lo + f(f(hi - lo) * t));
}

/** The vertex stage's twin of {@link lerpF32}. */
const lerpNode = (p: any, q: any, w: any): any => {
  const lo = min(p, q);
  const hi = max(p, q);
  const t = select(p.lessThanEqual(q), w, float(1).sub(w));
  const inner = lo.add(hi.sub(lo).mul(t));
  return select(w.lessThanEqual(0), p, select(w.greaterThanEqual(1), q, inner));
};

/** Bilinear height of the baked surface at face lattice point (u, v), all arithmetic rounded to float32. */
export function latticeHeightF32(baked: BakedHeights, face: number, u: number, v: number): number {
  locate(baked, u, v);
  const side = baked.side;
  const t = baked.texels;
  const o = face * side * side + cellJ * side + cellI;
  return lerpF32(lerpF32(t[o], t[o + 1], fracX), lerpF32(t[o + side], t[o + side + 1], fracX), fracY);
}

// Scratch for the CPU twin: the cell and fractions of the last {@link locate} (single-threaded, no allocation per call).
let cellI = 0;
let cellJ = 0;
let fracX = 0;
let fracY = 0;

function locate(baked: BakedHeights, u: number, v: number): void {
  const k = baked.layout.k;
  const unit = texelLattice(k);
  const cells = 2 ** k;
  const gx = f(f(u) / unit);
  const gy = f(f(v) / unit);
  cellI = Math.min(Math.floor(gx), cells - 1);
  cellJ = Math.min(Math.floor(gy), cells - 1);
  fracX = f(gx - cellI);
  fracY = f(gy - cellJ);
}

/** dh/dU and dh/dV, metres per lattice step, of the bilinear patch containing (u, v), float32 arithmetic. */
export function latticeSlopeF32(baked: BakedHeights, face: number, u: number, v: number, out: [number, number]): void {
  locate(baked, u, v);
  const side = baked.side;
  const t = baked.texels;
  const o = face * side * side + cellJ * side + cellI;
  const a = t[o];
  const b = t[o + 1];
  const c = t[o + side];
  const d = t[o + side + 1];
  const unit = texelLattice(baked.layout.k);
  out[0] = f(f(f(f(1 - fracY) * f(b - a)) + f(fracY * f(d - c))) / unit);
  out[1] = f(f(f(f(1 - fracX) * f(c - a)) + f(fracX * f(d - b))) / unit);
}

/** A height source read from a baked texture: the vertex stage reads it by lattice point, and the CPU twin reads the same texels with the same float32 arithmetic. Dispose it to free the GPU texture. */
export interface TextureHeightSource extends HeightSource {
  readonly baked: BakedHeights;
  readonly texture: DataArrayTexture;
  nodeRange: NodeHeightRanges['nodeRange'];
  dispose(): void;
  /** CPU twin by face and lattice point (what the vertex stage reads). */
  heightAtLattice(face: number, u: number, v: number): number;
  slopeAtLattice(face: number, u: number, v: number, out: [number, number]): void;
}

const position = { face: 0, u: 0, v: 0 };

/** Wraps a bake as a height source. The texture is made here and uploaded by the renderer on first use. */
export function createTextureHeightSource(id: HeightSourceId, baked: BakedHeights): TextureHeightSource {
  const { k, kind } = baked.layout;
  const unit = texelLattice(k);
  const cells = 2 ** k;
  const texture = new DataArrayTexture(baked.texels, baked.side, baked.side, baked.faces);
  texture.format = RedFormat;
  texture.type = FloatType;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  /** The four texels around lattice point `lattice` of `face` and the blend fractions, as nodes. */
  const fetch = (face: any, lattice: any) => {
    const gx = lattice.x.mul(1 / unit);
    const gy = lattice.y.mul(1 / unit);
    const i0 = min(floor(gx), cells - 1);
    const j0 = min(floor(gy), cells - 1);
    const ix = i0.toInt();
    const iy = j0.toInt();
    const layer = kind === 'plane' ? int(0) : face;
    const at = (dx: number, dy: number) => textureLoad(texture, ivec2(ix.add(dx), iy.add(dy))).depth(layer).x;
    return { a: at(0, 0), b: at(1, 0), c: at(0, 1), d: at(1, 1), fx: gx.sub(i0), fy: gy.sub(j0) };
  };

  const throwPosition = (): never => {
    throw new Error(`Height source ${id} is baked: the vertex stage reads it by lattice point`);
  };

  return {
    id,
    baked,
    texture,
    boundM: baked.boundM,
    heightAt(x, y, z) {
      latticeOfPosition(baked.layout, x, y, z, position);
      return latticeHeightF32(baked, position.face, position.u, position.v);
    },
    heightAtLattice: (face, u, v) => latticeHeightF32(baked, face, u, v),
    slopeAtLattice: (face, u, v, out) => latticeSlopeF32(baked, face, u, v, out),
    nodeRange: (root, level, i, j, out) => pyramidRange(baked.pyramid, k, root, level, i, j, out),
    heightNode: throwPosition,
    gradientNode: throwPosition,
    lattice: {
      heightNode(face, lattice) {
        const { a, b, c, d, fx, fy } = fetch(face, lattice);
        return lerpNode(lerpNode(a, b, fx), lerpNode(c, d, fx), fy);
      },
      slopeNode(face, lattice) {
        const { a, b, c, d, fx, fy } = fetch(face, lattice);
        const hu = float(1).sub(fy).mul(b.sub(a)).add(fy.mul(d.sub(c))).mul(1 / unit);
        const hv = float(1).sub(fx).mul(c.sub(a)).add(fx.mul(d.sub(b))).mul(1 / unit);
        return vec2(hu, hv);
      },
    },
    dispose: () => texture.dispose(),
  };
}
