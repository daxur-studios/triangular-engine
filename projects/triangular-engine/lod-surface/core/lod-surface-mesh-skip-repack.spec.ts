import type { BufferAttribute } from 'three';
import type { LodDomain, Vec3 } from './lod-domain';
import { createHeightSource } from './lod-height';
import { createMorphMap, type LodMorphSettings } from './lod-morph-frame';
import { sceneCameraAt } from './lod-morph.testing';
import { CAP_SLACK, LodSelector, type SelectorView } from './lod-selector';
import { createLodSurfaceMesh, type LodSurfaceMesh } from './lod-surface-mesh';

/**
 * Plan 059, G6h and G6i: the surface mesh's `upload` packs the drawn leaves only when they, their masks, the morph map's basis or
 * projection, or the pole flag changed (`packCount` counts the packs). These specs pin when it packs and skips, and that a skip leaves
 * the instance buffers exactly as a full pack of the same set writes them.
 */

const SPHERE: LodDomain = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' };
const CAPACITY = 256 + CAP_SLACK + 6;
const PIXEL_ANGLE = (2 * Math.tan(Math.PI / 6)) / 1000;
const ALTITUDE_M = 20;
const CAMERA: Vec3 = [0, 0, SPHERE.sizeM + ALTITUDE_M];
/** The bent camera of a morph at 0.5 (the same morph the other mesh specs use), 20 m above the map's point at (0.3, 0.2) rad. */
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

/** The drawn leaves of a selector as `root:level:i:j` keys. */
function drawnKeys(selector: LodSelector): Set<string> {
  const keys = new Set<string>();
  const { leaves, level, i, j, root } = selector;
  for (let k = 0; k < selector.stats.drawn; k++) {
    const node = leaves[k]!;
    keys.add(`${root[node]}:${level[node]}:${i[node]}:${j[node]}`);
  }
  return keys;
}

/**
 * The first camera (closer to the surface than the base one, in 0.2 % steps) whose drawn set differs from the base camera's, and how
 * many leaves differ. A single split is not reachable this way: with the leaf cap binding, the nodes near the split threshold cross
 * together, so no step changes exactly one leaf (checked over 2000 steps). Each candidate is checked on fresh selectors, in the same
 * order of calls the spec makes.
 */
function firstChangedAltitude(): { altitude: number; changed: number } {
  const base = makeSelector();
  base.select(view(CAMERA));
  const baseKeys = drawnKeys(base);
  for (let k = 1; k <= 2000; k++) {
    const altitude = ALTITUDE_M / 1.002 ** k;
    const candidate = makeSelector();
    candidate.select(view(CAMERA));
    candidate.select(view([0, 0, SPHERE.sizeM + altitude]));
    const candidateKeys = drawnKeys(candidate);
    const changed = [...baseKeys].filter((key) => !candidateKeys.has(key)).length + [...candidateKeys].filter((key) => !baseKeys.has(key)).length;
    if (changed > 0) return { altitude, changed };
  }
  throw new Error('no camera within 2000 steps changes the drawn set');
}

/** Whether two Float32 arrays hold the same bits; -1 when they do, else the first index that differs. */
function firstBitDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let k = 0; k < ua.length; k++) if (ua[k] !== ub[k]) return k;
  return -1;
}

const instanceCount = (mesh: LodSurfaceMesh): number => (mesh.mesh.geometry as unknown as { instanceCount: number }).instanceCount;
const instanceBuffer = (mesh: LodSurfaceMesh, name: string): Float32Array => (mesh.mesh.geometry.getAttribute(name) as BufferAttribute).array as Float32Array;

describe('createLodSurfaceMesh upload: the pack is skipped when the drawn leaves are unchanged (Plan 059 G6h, G6i)', () => {
  it('(a) the same drawn set uploaded again with the camera, morph and projection unchanged packs once and skips the second', () => {
    for (const morph of [false, true]) {
      const mesh = build(morph);
      const selector = makeSelector();
      const bent = morph ? MORPH_CAMERA(at(0.5)) : CAMERA;
      if (morph) mesh.setMorph(at(0.5));
      const count = step(mesh, selector, bent);
      expect(mesh.packCount).toBe(1);
      const version = selector.version;
      // The same view again: the selector does not rebuild its tree, so the upload has nothing new to pack.
      expect(step(mesh, selector, bent)).toBe(count);
      expect(selector.version).toBe(version);
      expect(mesh.upload(selector, bent)).toBe(count);
      expect(mesh.packCount).toBe(1);
      mesh.dispose();
    }
  });

  it('(b) a changed drawn set packs again (the first camera step that changes it; a single split is not reachable, see firstChangedAltitude)', () => {
    const { altitude, changed } = firstChangedAltitude();
    expect(changed).toBeGreaterThan(0);
    const mesh = build(false);
    const selector = makeSelector();
    step(mesh, selector, CAMERA);
    expect(mesh.packCount).toBe(1);
    const count = step(mesh, selector, [0, 0, SPHERE.sizeM + altitude]);
    expect(mesh.packCount).toBe(2);
    expect(count).toBe(selector.stats.drawn);
    expect(instanceCount(mesh)).toBe(count);
    mesh.dispose();
  });

  it('(c) a morph change repacks when it crosses 0 (globe to map and back); a change between two map morphs does not, as the pack reads only that', () => {
    const mesh = build(true);
    const selector = makeSelector();
    selector.select(view(CAMERA));
    // The selection is never re-selected below: only the morph changes, so any repack is the morph's own doing.
    mesh.setMorph(at(0));
    mesh.upload(selector, CAMERA);
    expect(mesh.packCount).toBe(1);
    mesh.setMorph(at(0.5));
    mesh.upload(selector, CAMERA);
    expect(mesh.packCount).toBe(2);
    // The leaves, the basis and the projection are unchanged; the pack reads the morph only as zero or not, so 0.5 to 0.6 writes nothing.
    mesh.setMorph(at(0.6));
    mesh.upload(selector, CAMERA);
    expect(mesh.packCount).toBe(2);
    mesh.setMorph(at(0));
    mesh.upload(selector, CAMERA);
    expect(mesh.packCount).toBe(3);
    mesh.dispose();
  });

  it('(d) a projection-centre change repacks, and the same centre again does not', () => {
    const mesh = build(true);
    const selector = makeSelector();
    mesh.setMorph(at(0.5));
    selector.select(view(mesh.unbend(MORPH_CAMERA(at(0.5)))));
    mesh.upload(selector, MORPH_CAMERA(at(0.5)));
    expect(mesh.packCount).toBe(1);
    // The same selection, a new basis: the key changes, so the pack is made again (the selector is not re-selected).
    mesh.setMorph(at(0.5, 30, 20));
    mesh.upload(selector, MORPH_CAMERA(at(0.5)));
    expect(mesh.packCount).toBe(2);
    mesh.upload(selector, MORPH_CAMERA(at(0.5)));
    expect(mesh.packCount).toBe(2);
    mesh.dispose();
  });

  it('(e) after a skip the instance buffers are bitwise those of a full pack of the same set', () => {
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
      const before = { leaf: instanceBuffer(skipping, 'aLeaf').slice(), info: instanceBuffer(skipping, 'aInfo').slice() };
      // The second upload skips: the buffers must be the ones the first pack wrote, untouched.
      expect(step(skipping, selector, bent)).toBe(count);
      expect(skipping.packCount).toBe(1);
      expect(firstBitDifference(instanceBuffer(skipping, 'aLeaf'), before.leaf)).toBe(-1);
      expect(firstBitDifference(instanceBuffer(skipping, 'aInfo'), before.info)).toBe(-1);
      // A full pack of the same set, from a fresh mesh and selector.
      expect(step(full, fullSelector, bent)).toBe(count);
      expect(full.packCount).toBe(1);
      expect(instanceCount(skipping)).toBe(instanceCount(full));
      expect(firstBitDifference(instanceBuffer(skipping, 'aLeaf'), instanceBuffer(full, 'aLeaf'))).toBe(-1);
      expect(firstBitDifference(instanceBuffer(skipping, 'aInfo'), instanceBuffer(full, 'aInfo'))).toBe(-1);
      skipping.dispose();
      full.dispose();
    }
  });
});
