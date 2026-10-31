import type { BufferAttribute } from 'three';
import type { LodDomain, Vec3 } from './lod-domain';
import { createHeightSource } from './lod-height';
import { createMorphMap, type LodMorphSettings } from './lod-morph-frame';
import { sceneCameraAt } from './lod-morph.testing';
import { CAP_SLACK, LodSelector, type SelectorView } from './lod-selector';
import { createLodSurfaceMesh, type LodSurfaceMesh } from './lod-surface-mesh';

/**
 * Plan 059, G6m: the surface mesh's tree signature is order-insensitive, so a selection that draws the same leaves in another order does
 * not pack again. These specs pin that: a reorder (reversed, seeded shuffle) packs nothing; a set that differs by one leaf packs; after an
 * order-only skip the instance records are those of a full pack of the reordered set, compared as a multiset of per-leaf records.
 */

const SPHERE: LodDomain = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' };
const CAPACITY = 256 + CAP_SLACK + 6;
const PIXEL_ANGLE = (2 * Math.tan(Math.PI / 6)) / 1000;
const ALTITUDE_M = 20;
const CAMERA: Vec3 = [0, 0, SPHERE.sizeM + ALTITUDE_M];
/** The bent camera of a morph at 0.5, 20 m above the map's point at (0.3, 0.2) rad (as the other mesh specs). */
const MORPH_CAMERA = (settings: LodMorphSettings): Vec3 => sceneCameraAt(createMorphMap(settings, SPHERE.sizeM), 0.3, 0.2, ALTITUDE_M);

/** Morph settings at a projection centre (degrees). */
const at = (morph: number, lonDeg = 0, latDeg = 0): LodMorphSettings => ({ morph, projection: 'equal-earth', projectionCentre: { lonDeg, latDeg } });

function build(morph: boolean): LodSurfaceMesh {
  return createLodSurfaceMesh({ domain: SPHERE, patchCells: 16, source: createHeightSource('flat', 'sphere'), capacity: CAPACITY, morph });
}

function makeSelector(): LodSelector {
  return new LodSelector({
    domain: SPHERE, patchCells: 16, mode: 'distance', fixedLevel: 5, cellPixels: 4, leafCap: 256, heightBoundM: 0, cull: false, hysteresis: 0.15,
  });
}

const view = (camera: Vec3): SelectorView => ({ camera, pixelAngle: PIXEL_ANGLE, frustum: new Float64Array(12) });

/** Selects for the camera the mesh is uploaded with (its unbent camera above morph 0), then uploads. Returns the instance count. */
function step(mesh: LodSurfaceMesh, selector: LodSelector, bent: Vec3): number {
  selector.select(view(mesh.unbend(bent)));
  return mesh.upload(selector, bent);
}

/** The drawn leaves of a selector as node indices, in drawn order. */
const drawnOrder = (selector: LodSelector): number[] => Array.from(selector.leaves.subarray(0, selector.stats.drawn));

/** The drawn leaves' node indices and masks, as copies (the base arrangement that {@link arrange} permutes). */
interface Arrangement { readonly leaves: number[]; readonly masks: number[] }
const arrangementOf = (selector: LodSelector): Arrangement => ({
  leaves: drawnOrder(selector),
  masks: Array.from(selector.masks.subarray(0, selector.stats.drawn)),
});

/**
 * Puts the drawn leaves of `selector` into the order `order` (indices into `base`), as a tree rebuild that drew the same leaves in another
 * order would. Leaves and masks move together. The version moves on, as a rebuild's does, so the next upload looks at the tree.
 */
function arrange(selector: LodSelector, base: Arrangement, order: readonly number[]): void {
  for (let k = 0; k < order.length; k++) {
    selector.leaves[k] = base.leaves[order[k]!]!;
    selector.masks[k] = base.masks[order[k]!]!;
  }
  selector.version++;
}

/** A seeded Fisher-Yates permutation of 0..n-1 (mulberry32), so the shuffle is the same on every run. */
function seededShuffle(n: number, seed: number): number[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, k) => k);
  for (let k = n - 1; k > 0; k--) {
    const r = Math.floor(next() * (k + 1));
    [order[k], order[r]] = [order[r]!, order[k]!];
  }
  return order;
}

/**
 * Tree nodes that are not drawn leaves (internal nodes of the tree). A swap puts one of them into the drawn arrangement: the pack and the
 * signature read only a node's cell (root, level, i, j), so the drawn set then differs by one leaf identity at one position.
 */
function undrawnNodes(selector: LodSelector, count: number): number[] {
  const drawn = new Set(drawnOrder(selector));
  const out: number[] = [];
  for (let node = 0; node < selector.open.length && out.length < count; node++) {
    if (selector.open[node] === 1 && !drawn.has(node)) out.push(node);
  }
  return out;
}

const instanceCount = (mesh: LodSurfaceMesh): number => (mesh.mesh.geometry as unknown as { instanceCount: number }).instanceCount;
const instanceBuffer = (mesh: LodSurfaceMesh, name: string): Float32Array => (mesh.mesh.geometry.getAttribute(name) as BufferAttribute).array as Float32Array;

/**
 * The instance records as a sorted list: one string per instance, the bits of its eight floats (the leaf's four and its info's four).
 * Comparing sorted lists compares the records as a multiset, so the slot an instance sits in does not matter.
 */
function sortedRecords(mesh: LodSurfaceMesh, count: number): string[] {
  const leaf = new Uint32Array(instanceBuffer(mesh, 'aLeaf').buffer, instanceBuffer(mesh, 'aLeaf').byteOffset, count * 4);
  const info = new Uint32Array(instanceBuffer(mesh, 'aInfo').buffer, instanceBuffer(mesh, 'aInfo').byteOffset, count * 4);
  const records: string[] = [];
  for (let k = 0; k < count; k++) {
    const bits = [...leaf.subarray(k * 4, k * 4 + 4), ...info.subarray(k * 4, k * 4 + 4)];
    records.push(bits.join(','));
  }
  return records.sort();
}

describe('createLodSurfaceMesh upload: a reorder of the same drawn leaves does not pack (Plan 059 G6m)', () => {
  it('(a) the same set in reversed and in a seeded shuffled order is uploaded without a new pack', () => {
    for (const morph of [false, true]) {
      const mesh = build(morph);
      const selector = makeSelector();
      const bent = morph ? MORPH_CAMERA(at(0.5)) : CAMERA;
      if (morph) mesh.setMorph(at(0.5));
      const count = step(mesh, selector, bent);
      expect(mesh.packCount).toBe(1);
      const base = arrangementOf(selector);
      const n = base.leaves.length;
      expect(n).toBeGreaterThan(2);

      const reversed = Array.from({ length: n }, (_, k) => n - 1 - k);
      arrange(selector, base, reversed);
      expect(mesh.upload(selector, bent)).toBe(count);
      expect(mesh.packCount).toBe(1);
      expect(drawnOrder(selector)).toEqual(reversed.map((k) => base.leaves[k]));

      const shuffled = seededShuffle(n, 0x5eed);
      expect(shuffled).not.toEqual(Array.from({ length: n }, (_, k) => k));
      arrange(selector, base, shuffled);
      expect(mesh.upload(selector, bent)).toBe(count);
      expect(mesh.packCount).toBe(1);
      expect(drawnOrder(selector)).toEqual(shuffled.map((k) => base.leaves[k]));
      mesh.dispose();
    }
  });

  it('(b) a set that differs by one leaf (one drawn leaf swapped for another, same count) packs', () => {
    for (const morph of [false, true]) {
      const mesh = build(morph);
      const selector = makeSelector();
      const bent = morph ? MORPH_CAMERA(at(0.5)) : CAMERA;
      if (morph) mesh.setMorph(at(0.5));
      const count = step(mesh, selector, bent);
      expect(mesh.packCount).toBe(1);
      const base = arrangementOf(selector);
      const [swap] = undrawnNodes(selector, 1);
      expect(swap).toBeDefined();
      // A reorder first (no pack), then the one-leaf swap in the middle of the order: the set changed, so it packs.
      arrange(selector, base, Array.from({ length: base.leaves.length }, (_, k) => base.leaves.length - 1 - k));
      expect(mesh.upload(selector, bent)).toBe(count);
      expect(mesh.packCount).toBe(1);
      const middle = Math.floor(base.leaves.length / 2);
      const swapped = { leaves: [...base.leaves], masks: [...base.masks] };
      swapped.leaves[middle] = swap!;
      arrange(selector, swapped, swapped.leaves.map((_, k) => k));
      // The instance count may differ from `count` (morph duplicates change with the leaf), so only the pack is checked.
      expect(mesh.upload(selector, bent)).toBeGreaterThan(0);
      expect(mesh.packCount).toBe(2);
      mesh.dispose();
    }
  });

  it('(c) the same count with a different leaf at the first position packs, in any order', () => {
    for (const morph of [false, true]) {
      const mesh = build(morph);
      const selector = makeSelector();
      const bent = morph ? MORPH_CAMERA(at(0.5)) : CAMERA;
      if (morph) mesh.setMorph(at(0.5));
      const count = step(mesh, selector, bent);
      expect(mesh.packCount).toBe(1);
      const base = arrangementOf(selector);
      const [other] = undrawnNodes(selector, 1);
      expect(other).toBeDefined();
      const changed = { leaves: [...base.leaves], masks: [...base.masks] };
      changed.leaves[0] = other!;
      arrange(selector, changed, changed.leaves.map((_, k) => k));
      expect(mesh.upload(selector, bent)).toBeGreaterThan(0);
      expect(mesh.packCount).toBe(2);
      mesh.dispose();
    }
  });

  it('(d) after an order-only skip the instance records are those of a full pack of the reordered set (as a multiset of per-leaf records)', () => {
    for (const morph of [false, true]) {
      const settings = at(0.5);
      const bent = morph ? MORPH_CAMERA(settings) : CAMERA;
      const skipping = build(morph);
      const full = build(morph);
      if (morph) {
        skipping.setMorph(settings);
        full.setMorph(settings);
      }
      const selector = makeSelector();
      const fullSelector = makeSelector();
      const count = step(skipping, selector, bent);
      const base = arrangementOf(selector);
      const n = base.leaves.length;

      const order = seededShuffle(n, 0xc0ffee);
      arrange(selector, base, order);
      expect(skipping.upload(selector, bent)).toBe(count);
      expect(skipping.packCount).toBe(1);

      // A full pack of the reordered set from a fresh mesh: select, arrange to the same order before its first upload, then upload.
      fullSelector.select(view(full.unbend(bent)));
      expect(arrangementOf(fullSelector)).toEqual(base);
      arrange(fullSelector, base, order);
      expect(full.upload(fullSelector, bent)).toBe(count);
      expect(full.packCount).toBe(1);
      expect(instanceCount(skipping)).toBe(instanceCount(full));

      // The reordered set is the same records in other slots: compare them sorted (the leaf's four and the info's four per record).
      expect(sortedRecords(skipping, count)).toEqual(sortedRecords(full, count));
      skipping.dispose();
      full.dispose();
    }
  });
});
