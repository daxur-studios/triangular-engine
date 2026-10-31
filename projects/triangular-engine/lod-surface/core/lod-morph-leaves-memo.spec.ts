import { latticeSteps } from './lod-lattice';
import type { LodDomain, Vec3 } from './lod-domain';
import { LEAF_STRIDE } from './lod-leaf-pack';
import { computeMorphFrame, createMorphMap, type LodMorphSettings } from './lod-morph-frame';
import { MorphLeafMemo, instanceCapacity, packMorphLeaves, packMorphLeavesMemo, type MorphPack } from './lod-morph-leaves';
import { sceneCameraAt } from './lod-morph.testing';
import { LodSelector, maxLevelFor, type PatchCells } from './lod-selector';

/** Plan 059, step G6i: the memoised pack writes the same instance buffers as the full pack, over a morph sweep. */

const PATCH: PatchCells = 16;
const MAX_LEVEL = maxLevelFor(PATCH);
const STEPS = latticeSteps(PATCH, MAX_LEVEL);
const LEAF_CAP = 4096;
const FRAMES = 160;

/** Whether two Float32 arrays hold the same bits (NaN payloads and signed zeros included); -1 when they do, else the first index that differs. */
function firstBitDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let k = 0; k < ua.length; k++) if (ua[k] !== ub[k]) return k;
  return -1;
}

/** A fingerprint of the drawn leaves (node, level, cell, root, mask), to count the frames whose drawn set changed. */
function drawnFingerprint(selector: LodSelector): number {
  let h = 2166136261;
  const { leaves, level, i, j, root, masks } = selector;
  for (let k = 0; k < selector.stats.drawn; k++) {
    const node = leaves[k];
    for (const v of [node, level[node], i[node], j[node], root[node], masks[k]]) h = Math.imul(h ^ v, 16777619) >>> 0;
  }
  return h;
}

describe('lod-morph-leaves: memoised pack (G6i)', () => {
  const radiusM = 600_000;
  const domain: LodDomain = { kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' };
  const pixelAngle = (2 * Math.tan(Math.PI / 6)) / 576;
  const DEFAULT_CENTRE = { lonDeg: 0, latDeg: 0 };
  const TILTED_CENTRE = { lonDeg: 30, latDeg: 20 };

  it('writes the same buffers as the full pack on every frame of a sweep (morph, camera, projection centre and pole skipping all moving)', () => {
    const selector = new LodSelector({
      domain, patchCells: PATCH, mode: 'distance', fixedLevel: 5, cellPixels: 4, leafCap: LEAF_CAP, heightBoundM: 0, cull: false, hysteresis: 0.15,
    });
    const memo = new MorphLeafMemo();
    const capacity = instanceCapacity(LEAF_CAP);
    const fullLeaf = new Float32Array(capacity * LEAF_STRIDE);
    const fullInfo = new Float32Array(capacity * LEAF_STRIDE);
    const memoLeaf = new Float32Array(capacity * LEAF_STRIDE);
    const memoInfo = new Float32Array(capacity * LEAF_STRIDE);
    let previousDrawn = -1;
    let changedFrames = 0;
    let packedFrames = 0;
    let duplicatedFrames = 0;
    for (let f = 0; f < FRAMES; f++) {
      const s = f / (FRAMES - 1);
      const pingPong = s < 0.5 ? 2 * s : 2 - 2 * s;
      const morph = pingPong * pingPong * (3 - 2 * pingPong);
      // The projection centre moves to a tilted one for the middle of the sweep (a new basis: the memo must start over).
      const centre = f >= FRAMES / 3 && f < (2 * FRAMES) / 3 ? TILTED_CENTRE : DEFAULT_CENTRE;
      const settings: LodMorphSettings = { morph, projection: 'equal-earth', projectionCentre: centre };
      const map = createMorphMap(settings, radiusM);
      // The camera crosses the cut, the poles' neighbourhoods and the range of altitudes; the leaves change from frame to frame.
      const lon = 3.1 * Math.sin(f * 0.13);
      const lat = 1.3 * Math.sin(f * 0.07 + 0.4);
      const t = pingPong;
      const altitude = 2 + 2 * radiusM * t * t * t;
      const camera: Vec3 = sceneCameraAt(map, lon, lat, altitude);
      const frame = computeMorphFrame(map, domain, STEPS, camera);
      selector.select({ camera: frame.selectorCamera, pixelAngle, frustum: new Float64Array(12) });
      const fingerprint = drawnFingerprint(selector);
      if (fingerprint !== previousDrawn) changedFrames++;
      previousDrawn = fingerprint;

      const options = {
        domain, patchCells: PATCH, capacity, basis: map.basis, morph: map.morph, skipPoleLeaves: Math.floor(f / 10) % 2 === 1, duplicate: f % 7 !== 3,
      };
      const full: MorphPack = packMorphLeaves(selector, options, fullLeaf, fullInfo);
      const memoised: MorphPack = packMorphLeavesMemo(memo, selector, options, memoLeaf, memoInfo);

      expect(memoised).toEqual(full);
      expect(firstBitDifference(memoLeaf, fullLeaf)).toBe(-1);
      expect(firstBitDifference(memoInfo, fullInfo)).toBe(-1);
      if (full.instances > 0) packedFrames++;
      if (full.duplicates > 0) duplicatedFrames++;
    }
    // The sweep is a real one: the drawn leaves change on many frames, and the pack has leaves to write and duplicates to check.
    expect(changedFrames).toBeGreaterThan(FRAMES / 4);
    expect(packedFrames).toBe(FRAMES);
    expect(duplicatedFrames).toBeGreaterThan(0);
  });

  it('writes the same buffers when the memo is reused for an unchanged selection', () => {
    const selector = new LodSelector({
      domain, patchCells: PATCH, mode: 'distance', fixedLevel: 5, cellPixels: 4, leafCap: LEAF_CAP, heightBoundM: 0, cull: false, hysteresis: 0.15,
    });
    const map = createMorphMap({ morph: 0.5, projection: 'equal-earth', projectionCentre: DEFAULT_CENTRE }, radiusM);
    const frame = computeMorphFrame(map, domain, STEPS, sceneCameraAt(map, 0.5, 0.4, 200_000));
    selector.select({ camera: frame.selectorCamera, pixelAngle, frustum: new Float64Array(12) });
    const capacity = instanceCapacity(LEAF_CAP);
    const options = { domain, patchCells: PATCH, capacity, basis: map.basis, morph: 0.5 };
    const memo = new MorphLeafMemo();
    const a = [new Float32Array(capacity * LEAF_STRIDE), new Float32Array(capacity * LEAF_STRIDE)];
    const b = [new Float32Array(capacity * LEAF_STRIDE), new Float32Array(capacity * LEAF_STRIDE)];
    const first = packMorphLeavesMemo(memo, selector, options, a[0]!, a[1]!);
    const second = packMorphLeavesMemo(memo, selector, options, b[0]!, b[1]!);
    expect(second).toEqual(first);
    expect(firstBitDifference(b[0]!, a[0]!)).toBe(-1);
    expect(firstBitDifference(b[1]!, a[1]!)).toBe(-1);
    expect(first.leaves).toBeGreaterThan(0);
  });
});
