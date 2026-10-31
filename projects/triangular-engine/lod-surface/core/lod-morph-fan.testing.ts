import type { LodDomain } from './lod-domain';
import { latticeSteps } from './lod-lattice';
import { projectionBasis } from './lod-morph-frame';
import { poleLattices } from './lod-morph-leaves';
import { maxLevelFor, type LodSelector, type PatchCells } from './lod-selector';

/**
 * Test fixtures of the pole fan (Plan 059 G6d): the lattice of the default grid, a fake selector that holds given leaves, and the pole
 * leaves of the two projection centres the fan is checked at. Not shipped: nothing in the public API imports this.
 */

export const FAN_PATCH: PatchCells = 16;
export const FAN_MAX_LEVEL = maxLevelFor(FAN_PATCH);
export const FAN_STEPS = latticeSteps(FAN_PATCH, FAN_MAX_LEVEL);
export const FAN_RADIUS = 6_371_000;
export const FAN_DOMAIN: LodDomain = { kind: 'sphere', sizeM: FAN_RADIUS, warp: 'equal-angle' };

/** A drawn leaf of a fake selector: its face, level and index on that level. */
export interface FakeLeaf {
  readonly face: number;
  readonly level: number;
  readonly i: number;
  readonly j: number;
  readonly mask?: number;
}

/** Just enough of a selector for the fan and the packer: the drawn leaves' arrays. */
export function fakeSelector(leaves: readonly FakeLeaf[], version = 1): LodSelector {
  return {
    leaves: Int32Array.from(leaves.map((_, k) => k)),
    masks: Uint8Array.from(leaves.map((l) => l.mask ?? 0)),
    level: Int32Array.from(leaves.map((l) => l.level)),
    i: Int32Array.from(leaves.map((l) => l.i)),
    j: Int32Array.from(leaves.map((l) => l.j)),
    root: Int32Array.from(leaves.map((l) => l.face)),
    stats: { drawn: leaves.length },
    version,
  } as unknown as LodSelector;
}

/** The face and lattice position of the basis' up pole for a projection centre. */
export function upPoleOf(centreLonDeg: number, centreLatDeg: number): { face: number; u: number; v: number } {
  const basis = projectionBasis(centreLonDeg, centreLatDeg);
  for (let face = 0; face < 6; face++) {
    const found = poleLattices(basis, FAN_STEPS, face, 'equal-angle').find((p) => p.sign === 1);
    if (found) return { face, u: found.u, v: found.v };
  }
  throw new Error('no pole');
}

/** The four leaves of a level that share the up pole at a lattice vertex (the default projection centre). */
export function cornerLeavesOf(level: number, centreLonDeg = 0, centreLatDeg = 0): FakeLeaf[] {
  const { face } = upPoleOf(centreLonDeg, centreLatDeg);
  const half = 2 ** level / 2;
  return [half - 1, half].flatMap((i) => [half - 1, half].map((j) => ({ face, level, i, j })));
}

/** The leaf of a level that holds the up pole strictly inside (a tilted centre). */
export function interiorLeafOf(level: number, centreLonDeg: number, centreLatDeg: number): FakeLeaf {
  const { face, u, v } = upPoleOf(centreLonDeg, centreLatDeg);
  const span = (1 << (FAN_MAX_LEVEL - level)) * FAN_PATCH;
  return { face, level, i: Math.floor(u / span), j: Math.floor(v / span) };
}
