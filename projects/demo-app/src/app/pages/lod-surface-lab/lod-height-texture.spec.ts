import { domainPreset, neighbourCell, type CubeWarp, type DomainKind, type LodDomain, type NeighbourCell } from './lod-domain';
import {
  DEFAULT_BAKE_K, bakeBuffers, bakeHeights, bakeFaces, bakeSide, latticeOfPosition, pyramidRange, texelLattice, texelPoint, textureMegabytes,
  type BakeLayout, type BakedHeights,
} from './lod-height-bake';
import { noiseAmplitudeM, noiseSampler, bakedBumpsSampler, samplerFor, valueNoise3 } from './lod-height-noise';
import { createTextureHeightSource, latticeHeightF32, latticeSlopeF32, lerpF32 } from './lod-height-texture';
import { createLodSurfaceMesh } from './lod-surface-mesh';
import { cubeLattice, foldedGrid, gridLattice, leafLattice, MAX_LATTICE_STEPS } from './lod-lattice';
import { LodSelector } from './lod-selector';

const f = Math.fround;

/** Deterministic pseudo-random numbers in [0, 1), so a failing case can be rerun. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layoutFor(kind: DomainKind, k: number, warp: CubeWarp = 'equal-angle', sizeM = kind === 'plane' ? 100_000 : 10_000): BakeLayout {
  return { kind, warp, sizeM, k };
}

const bakeCache = new Map<string, BakedHeights>();
/** A noise bake, cached across specs (the sampler is deterministic). */
function noiseBake(kind: DomainKind, k: number, warp: CubeWarp = 'equal-angle', sizeM?: number): BakedHeights {
  const layout = layoutFor(kind, k, warp, sizeM);
  const key = JSON.stringify(layout);
  let baked = bakeCache.get(key);
  if (!baked) {
    baked = bakeHeights(layout, noiseSampler(layout));
    bakeCache.set(key, baked);
  }
  return baked;
}

/** Reference bilinear in doubles over the same texels. */
function referenceBilinear(baked: BakedHeights, face: number, u: number, v: number): number {
  const cells = 2 ** baked.layout.k;
  const unit = texelLattice(baked.layout.k);
  const gx = u / unit;
  const gy = v / unit;
  const i = Math.min(Math.floor(gx), cells - 1);
  const j = Math.min(Math.floor(gy), cells - 1);
  const fx = gx - i;
  const fy = gy - j;
  const o = face * baked.side * baked.side + j * baked.side + i;
  const t = baked.texels;
  const row0 = t[o] * (1 - fx) + t[o + 1] * fx;
  const row1 = t[o + baked.side] * (1 - fx) + t[o + baked.side + 1] * fx;
  return row0 * (1 - fy) + row1 * fy;
}

describe('Plan 059 baked height texture: layout and determinism', () => {
  it('sizes the texture (2^k + 1)^2 per face, one layer per cube face and one for the plane', () => {
    expect(bakeSide(DEFAULT_BAKE_K)).toBe(1025);
    expect(bakeSide(11)).toBe(2049);
    expect(bakeFaces('plane')).toBe(1);
    expect(bakeFaces('sphere')).toBe(6);
    const baked = noiseBake('sphere', 4);
    expect(baked.texels.length).toBe(6 * 17 * 17);
    expect(textureMegabytes(baked)).toBeCloseTo((6 * 17 * 17 * 4) / 1e6, 9);
    expect(noiseBake('plane', 4).texels.length).toBe(17 * 17);
    expect(texelLattice(10) * 2 ** 10).toBe(MAX_LATTICE_STEPS);
  });

  it('bakes the same Float32Array and pyramid from the same input', () => {
    for (const kind of ['plane', 'sphere'] as const) {
      const layout = layoutFor(kind, 5);
      const a = bakeHeights(layout, noiseSampler(layout));
      const b = bakeHeights(layout, noiseSampler(layout));
      expect(a.texels.every((value, n) => Object.is(value, b.texels[n]))).toBeTrue();
      a.pyramid.min.forEach((level, l) => expect(level.every((value, n) => Object.is(value, b.pyramid.min[l][n]))).toBeTrue());
      a.pyramid.max.forEach((level, l) => expect(level.every((value, n) => Object.is(value, b.pyramid.max[l][n]))).toBeTrue());
      expect(a.boundM).toBe(b.boundM);
    }
  });

  it('reports a time per face and the buffers a worker transfers', () => {
    let clock = 0;
    const layout = layoutFor('sphere', 3);
    const baked = bakeHeights(layout, () => 1, () => (clock += 2));
    expect(baked.bakeMsPerFace).toEqual([2, 2, 2, 2, 2, 2]);
    expect(baked.pyramidMs).toBe(2);
    expect(bakeBuffers(baked).length).toBe(1 + 2 * (3 + 1));
  });

  it('refuses a texture size outside the supported range and a sampler that returns NaN', () => {
    expect(() => bakeHeights(layoutFor('plane', 1), () => 0)).toThrow();
    expect(() => bakeHeights(layoutFor('plane', 13), () => 0)).toThrow();
    expect(() => bakeHeights(layoutFor('plane', 3), () => NaN)).toThrow();
  });

  it('keeps the noise and baked-bump samplers deterministic and inside their stated amplitude', () => {
    for (const layout of [layoutFor('plane', 8), layoutFor('sphere', 8, 'equal-angle', 600_000), layoutFor('sphere', 8, 'none', 10_000)]) {
      const noise = noiseSampler(layout);
      const bumps = bakedBumpsSampler(layout);
      const random = rng(7);
      let spread = 0;
      for (let n = 0; n < 400; n++) {
        const x = (random() - 0.5) * layout.sizeM;
        const y = layout.kind === 'plane' ? 0 : (random() - 0.5) * layout.sizeM;
        const z = (random() - 0.5) * layout.sizeM;
        const h = noise(x, y, z);
        expect(noise(x, y, z)).toBe(h);
        expect(Math.abs(h)).toBeLessThanOrEqual(noiseAmplitudeM(layout));
        spread = Math.max(spread, Math.abs(h));
        expect(Number.isFinite(bumps(x, y, z))).toBeTrue();
      }
      expect(spread).toBeGreaterThan(0.2 * noiseAmplitudeM(layout));
      expect(samplerFor('noise', layout)(1, 2, 3)).toBe(noise(1, 2, 3));
    }
    expect(valueNoise3(3, 4, 5, 1)).toBe(valueNoise3(3, 4, 5, 1));
  });

  it('maps a base-surface position back to the lattice point of the texel it came from', () => {
    for (const layout of [layoutFor('sphere', 4), layoutFor('sphere', 4, 'none'), layoutFor('plane', 4)]) {
      const unit = texelLattice(layout.k);
      const out = { face: 0, u: 0, v: 0 };
      for (let face = 0; face < bakeFaces(layout.kind); face++) {
        for (const [i, j] of [[0, 0], [3, 5], [8, 8], [16, 2], [11, 16]]) {
          // Texels on a face edge may belong to a neighbouring face: the lattice point then differs but names the same position.
          const p = texelPoint(layout, face, i, j);
          latticeOfPosition(layout, p[0], p[1], p[2], out);
          const back = texelPoint(layout, out.face, Math.round(out.u / unit), Math.round(out.v / unit));
          expect(Math.abs(out.u / unit - Math.round(out.u / unit))).toBeLessThan(1e-6);
          expect(Math.hypot(back[0] - p[0], back[1] - p[1], back[2] - p[2])).toBeLessThan(1e-6 * layout.sizeM);
        }
      }
    }
  });
});

describe('Plan 059 baked height texture: manual bilinear in float32', () => {
  it('returns the texel bit for bit at every texel centre', () => {
    for (const kind of ['plane', 'sphere'] as const) {
      const baked = noiseBake(kind, 5);
      const unit = texelLattice(5);
      for (let face = 0; face < baked.faces; face++) {
        for (let j = 0; j <= 32; j += 3) {
          for (let i = 0; i <= 32; i += 2) {
            expect(latticeHeightF32(baked, face, i * unit, j * unit)).toBe(baked.texels[face * baked.side * baked.side + j * baked.side + i]);
          }
        }
      }
    }
  });

  it('agrees with a reference bilinear in doubles to float32 tolerance, whole and fractional lattice points', () => {
    const random = rng(3);
    for (const kind of ['plane', 'sphere'] as const) {
      const baked = noiseBake(kind, 5);
      let worst = 0;
      for (let n = 0; n < 2000; n++) {
        const face = Math.floor(random() * baked.faces);
        const whole = n % 2 === 0;
        const u = whole ? Math.floor(random() * (MAX_LATTICE_STEPS + 1)) : random() * MAX_LATTICE_STEPS;
        const v = whole ? Math.floor(random() * (MAX_LATTICE_STEPS + 1)) : random() * MAX_LATTICE_STEPS;
        worst = Math.max(worst, Math.abs(latticeHeightF32(baked, face, u, v) - referenceBilinear(baked, face, f(u), f(v))));
      }
      // Heights are up to a few hundred metres: a few float32 steps of that.
      expect(worst).toBeLessThan(2e-4);
    }
  });

  it('is symmetric and exact at the ends: lerp(p, q, w) === lerp(q, p, 1 - w)', () => {
    const random = rng(11);
    for (let n = 0; n < 2000; n++) {
      const p = f((random() - 0.5) * 600);
      const q = n % 7 === 0 ? p : f((random() - 0.5) * 600);
      const w = n % 5 === 0 ? 0 : f(Math.floor(random() * 16384) / 16384);
      expect(lerpF32(p, q, w)).toBe(lerpF32(q, p, f(1 - w)));
    }
    expect(lerpF32(f(3.3), f(-9.1), 0)).toBe(f(3.3));
    expect(lerpF32(f(3.3), f(-9.1), 1)).toBe(f(-9.1));
  });

  it('gives the slope of the bilinear patch: the finite difference inside a texel cell', () => {
    const baked = noiseBake('sphere', 5);
    const unit = texelLattice(5);
    const random = rng(5);
    const slope: [number, number] = [0, 0];
    for (let n = 0; n < 200; n++) {
      const face = Math.floor(random() * 6);
      const u = (Math.floor(random() * 32) + 0.25 + 0.5 * random()) * unit;
      const v = (Math.floor(random() * 32) + 0.25 + 0.5 * random()) * unit;
      latticeSlopeF32(baked, face, u, v, slope);
      const d = 0.1 * unit;
      const du = (referenceBilinear(baked, face, u + d, v) - referenceBilinear(baked, face, u - d, v)) / (2 * d);
      const dv = (referenceBilinear(baked, face, u, v + d) - referenceBilinear(baked, face, u, v - d)) / (2 * d);
      const scale = 1e-3 + Math.abs(du) + Math.abs(dv);
      expect(Math.abs(slope[0] - du)).toBeLessThan(2e-4 * scale);
      expect(Math.abs(slope[1] - dv)).toBeLessThan(2e-4 * scale);
    }
  });

  it('serves the CPU twin by position (cameras, colliders) from the same texels', () => {
    for (const kind of ['plane', 'sphere'] as const) {
      const baked = noiseBake(kind, 5);
      const source = createTextureHeightSource('noise', baked);
      expect(source.lattice).toBeDefined();
      expect(source.boundM).toBe(baked.boundM);
      expect(() => source.heightNode(undefined)).toThrow();
      for (const [face, i, j] of kind === 'plane' ? [[0, 4, 7], [0, 20, 9], [0, 31, 1]] : [[0, 4, 7], [1, 20, 9], [4, 31, 1], [5, 12, 12]]) {
        const p = texelPoint(baked.layout, face, i, j);
        expect(Math.abs(source.heightAt(p[0], p[1], p[2]) - baked.texels[face * baked.side * baked.side + j * baked.side + i])).toBeLessThan(1e-3);
      }
      source.dispose();
    }
  });
});

describe('Plan 059 baked height texture: canonical edges', () => {
  for (const warp of ['equal-angle', 'none'] as const) {
    it(`gives the 12 cube edges and 8 corners one value from every face that has them (${warp})`, () => {
      const k = 5;
      const baked = noiseBake('sphere', k, warp);
      const side = baked.side;
      const groups = new Map<string, number[]>();
      for (let face = 0; face < 6; face++) {
        for (let j = 0; j < side; j++) {
          for (let i = 0; i < side; i++) {
            if (i > 0 && i < side - 1 && j > 0 && j < side - 1) continue;
            const p = texelPoint(baked.layout, face, i, j);
            // Positions must agree to the bit, not merely be close: they are keyed exactly.
            const key = `${p[0]}|${p[1]}|${p[2]}`;
            const list = groups.get(key) ?? [];
            list.push(baked.texels[face * side * side + j * side + i]);
            groups.set(key, list);
          }
        }
      }
      const sizes = [...groups.values()].map((values) => values.length);
      expect(sizes.filter((n) => n === 2).length).toBe(12 * (2 ** k - 1));
      expect(sizes.filter((n) => n === 3).length).toBe(8);
      expect(sizes.every((n) => n === 2 || n === 3)).toBeTrue();
      for (const values of groups.values()) expect(values.every((value) => value === values[0])).toBeTrue();
    });
  }

  it('reads the same height from both faces along a whole shared edge, at fractional lattice points too', () => {
    const baked = noiseBake('sphere', 5);
    const L = MAX_LATTICE_STEPS;
    const random = rng(21);
    const faceAt = (face: number, u: number, v: number) => latticeHeightF32(baked, face, u, v);
    // Face 4 (+Z) north edge (v = L) is the south edge (v = 0) of face 2 (+Y) with u shared (both have u = +X).
    for (let n = 0; n < 500; n++) {
      const u = n % 3 === 0 ? Math.floor(random() * 32) * texelLattice(5) : Math.floor(random() * (L + 1));
      expect(faceAt(4, u, L)).toBe(faceAt(2, u, 0));
    }
    // Every vertex of every face's four edges, found again on the other faces that have it by its cube-lattice vector.
    const n = 2 ** 5;
    const toLattice = (s: number) => (s * L) / n;
    let checked = 0;
    for (let a = 0; a < 6; a++) {
      for (const [u, v] of edgePoints(5)) {
        const t = cubeLattice(a, toLattice(u), toLattice(v), L).join(',');
        for (let b = 0; b < 6; b++) {
          if (b === a) continue;
          for (const [bu, bv] of edgePoints(5)) {
            if (cubeLattice(b, toLattice(bu), toLattice(bv), L).join(',') !== t) continue;
            expect(faceAt(b, toLattice(bu), toLattice(bv))).toBe(faceAt(a, toLattice(u), toLattice(v)));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2 * 12 * 31);
  });
});

function edgePoints(k: number): [number, number][] {
  const n = 2 ** k;
  const out: [number, number][] = [];
  for (let s = 0; s <= n; s++) out.push([s, 0], [s, n], [0, s], [n, s]);
  return out;
}

describe('Plan 059 baked height seams: neighbouring leaves get the same bits', () => {
  const PATCH = 16;
  const MAX_LEVEL = 20;

  function vertexKey(domain: LodDomain, root: number, u: number, v: number): string {
    return domain.kind === 'plane' ? `${u},${v}` : cubeLattice(root, u, v, MAX_LATTICE_STEPS).join(',');
  }

  /** Every boundary vertex of a leaf, keyed by the point it names, with its height from (face, lattice). */
  function boundary(baked: BakedHeights, domain: LodDomain, root: number, level: number, i: number, j: number): Map<string, number> {
    const leaf = leafLattice(root, level, i, j, PATCH, MAX_LEVEL);
    const out = new Map<string, number>();
    for (let g = 0; g <= PATCH; g++) {
      for (const [gx, gy] of [[g, 0], [g, PATCH], [0, g], [PATCH, g]]) {
        const [u, v] = gridLattice(leaf, gx, gy);
        out.set(vertexKey(domain, root, u, v), latticeHeightF32(baked, root, u, v));
      }
    }
    return out;
  }

  const cases: [string, DomainKind, string][] = [['plane', 'plane', 'plane-100km'], ['sphere', 'sphere', 'sphere-10km']];
  for (const [name, kind, preset] of cases) {
    const domain = domainPreset(preset as 'plane-100km' | 'sphere-10km');
    const baked = noiseBake(kind, 6, 'equal-angle', domain.sizeM);

    it(`${name}: same-level neighbours (across cube faces too) agree on every shared edge vertex`, () => {
      const random = rng(31);
      const cell: NeighbourCell = { root: 0, i: 0, j: 0 };
      let shared = 0;
      for (let n = 0; n < 150; n++) {
        const root = Math.floor(random() * (kind === 'plane' ? 1 : 6));
        const level = 1 + Math.floor(random() * 8);
        const cells = 2 ** level;
        // Bias toward cells on a face border, where the cube edges are.
        const i = n % 3 === 0 ? 0 : n % 3 === 1 ? cells - 1 : Math.floor(random() * cells);
        const j = Math.floor(random() * cells);
        const own = boundary(baked, domain, root, level, i, j);
        for (let edge = 0; edge < 4; edge++) {
          if (!neighbourCell(domain, root, level, i, j, edge, cell)) continue;
          const other = boundary(baked, domain, cell.root, level, cell.i, cell.j);
          for (const [key, height] of own) {
            const found = other.get(key);
            if (found === undefined) continue;
            expect(found).toBe(height);
            shared++;
          }
        }
      }
      expect(shared).toBeGreaterThan(150 * 4 * PATCH / 2);
    });

    it(`${name}: a folded fine edge vertex gets the coarse neighbour's height (2:1)`, () => {
      const random = rng(41);
      const cell: NeighbourCell = { root: 0, i: 0, j: 0 };
      let checked = 0;
      for (let n = 0; n < 150; n++) {
        const root = Math.floor(random() * (kind === 'plane' ? 1 : 6));
        const level = 1 + Math.floor(random() * 8);
        const cells = 2 ** level;
        // Fine leaf A at `level`, its coarse neighbour B at level - 1 across edge e: the parent's neighbour.
        const i = n % 3 === 0 ? 0 : n % 3 === 1 ? cells - 1 : Math.floor(random() * cells);
        const j = Math.floor(random() * cells);
        for (let edge = 0; edge < 4; edge++) {
          if (!neighbourCell(domain, root, level - 1, i >> 1, j >> 1, edge, cell)) continue;
          const coarse = boundary(baked, domain, cell.root, level - 1, cell.i, cell.j);
          const fineLeaf = leafLattice(root, level, i, j, PATCH, MAX_LEVEL);
          // Only fine edges that lie on the parent's edge `edge` touch the coarse leaf.
          const onParentEdge = (edge === 0 && (j & 1) === 0) || (edge === 2 && (j & 1) === 1) || (edge === 1 && (i & 1) === 1) || (edge === 3 && (i & 1) === 0);
          if (!onParentEdge) continue;
          for (let g = 0; g <= PATCH; g++) {
            const [gx, gy] = edge === 0 ? [g, 0] : edge === 2 ? [g, PATCH] : edge === 3 ? [0, g] : [PATCH, g];
            const [fx, fy] = foldedGrid(gx, gy, PATCH, 1 << edge);
            const [u, v] = gridLattice(fineLeaf, fx, fy);
            const found = coarse.get(vertexKey(domain, root, u, v));
            if (found === undefined) continue;
            expect(latticeHeightF32(baked, root, u, v)).toBe(found);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(300);
    });
  }
});

describe('Plan 059 baked height pyramid', () => {
  it('matches a brute-force min and max over the texels a node covers (within the rounding pad)', () => {
    const random = rng(51);
    for (const kind of ['plane', 'sphere'] as const) {
      const k = 6;
      const baked = noiseBake(kind, k);
      const out: [number, number] = [0, 0];
      for (let n = 0; n < 300; n++) {
        const root = Math.floor(random() * baked.faces);
        const level = Math.floor(random() * (k + 1));
        const span = 2 ** (k - level);
        const i = Math.floor(random() * 2 ** level);
        const j = Math.floor(random() * 2 ** level);
        let lo = Infinity;
        let hi = -Infinity;
        for (let y = j * span; y <= (j + 1) * span; y++) {
          for (let x = i * span; x <= (i + 1) * span; x++) {
            const h = baked.texels[root * baked.side * baked.side + y * baked.side + x];
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        pyramidRange(baked.pyramid, k, root, level, i, j, out);
        expect(out[0]).toBeLessThanOrEqual(lo);
        expect(out[1]).toBeGreaterThanOrEqual(hi);
        expect(lo - out[0]).toBeLessThan(1e-5 * (1 + Math.abs(lo)));
        expect(out[1] - hi).toBeLessThan(1e-5 * (1 + Math.abs(hi)));
      }
    }
  });

  it('uses the containing texel cell for nodes smaller than a texel, and the whole face for the root', () => {
    const k = 4;
    const baked = noiseBake('sphere', k);
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 0];
    pyramidRange(baked.pyramid, k, 2, k, 5, 9, a);
    pyramidRange(baked.pyramid, k, 2, k + 3, 5 * 8 + 3, 9 * 8 + 7, b);
    expect(b).toEqual(a);
    const faceTexels = baked.texels.subarray(3 * baked.side * baked.side, 4 * baked.side * baked.side);
    pyramidRange(baked.pyramid, k, 3, 0, 0, 0, a);
    expect(a[0]).toBeLessThanOrEqual(faceTexels.reduce((lo, h) => Math.min(lo, h), Infinity));
    expect(a[1]).toBeGreaterThanOrEqual(faceTexels.reduce((hi, h) => Math.max(hi, h), -Infinity));
    expect(baked.boundM).toBeGreaterThanOrEqual(Math.max(Math.abs(baked.minM), Math.abs(baked.maxM)));
  });

  it('contains every vertex height of a node\'s leaf grid, at levels above and below the texel size', () => {
    const random = rng(61);
    const PATCH = 16;
    const MAX_LEVEL = 20;
    for (const kind of ['plane', 'sphere'] as const) {
      const k = 5;
      const baked = noiseBake(kind, k);
      const out: [number, number] = [0, 0];
      let vertices = 0;
      for (let n = 0; n < 120; n++) {
        const root = Math.floor(random() * baked.faces);
        const level = Math.floor(random() * 12);
        const i = Math.floor(random() * 2 ** level);
        const j = Math.floor(random() * 2 ** level);
        pyramidRange(baked.pyramid, k, root, level, i, j, out);
        const leaf = leafLattice(root, level, i, j, PATCH, MAX_LEVEL);
        for (let gy = 0; gy <= PATCH; gy++) {
          for (let gx = 0; gx <= PATCH; gx++) {
            const [u, v] = gridLattice(leaf, gx, gy);
            const h = latticeHeightF32(baked, root, u, v);
            if (h < out[0] || h > out[1]) fail(`node ${root}/${level}/${i}/${j} vertex ${gx},${gy}: ${h} outside [${out[0]}, ${out[1]}]`);
            vertices++;
          }
        }
      }
      expect(vertices).toBe(120 * (PATCH + 1) ** 2);
    }
  });
});

describe('Plan 059 baked height source in the surface mesh and the selector', () => {
  it('builds the vertex graph for a texture source on the plane and the sphere', () => {
    for (const preset of ['plane-100km', 'sphere-10km', 'sphere-600km'] as const) {
      const domain = domainPreset(preset);
      const source = createTextureHeightSource('noise', noiseBake(domain.kind, 4, domain.warp, domain.sizeM));
      const selector = new LodSelector({
        domain, patchCells: 32, mode: 'fixed', fixedLevel: 2, cellPixels: 4, leafCap: 1024, heightBoundM: source.boundM, heightRanges: source, cull: false,
      });
      selector.select({ camera: [0, domain.sizeM * 2, 0], pixelAngle: 0.001, frustum: new Float64Array(12) });
      const surface = createLodSurfaceMesh({ domain, patchCells: 32, source, capacity: 2048 });
      expect(surface.upload(selector, [0, domain.sizeM * 2, 0])).toBe(selector.stats.drawn);
      surface.dispose();
      source.dispose();
    }
  });
});
