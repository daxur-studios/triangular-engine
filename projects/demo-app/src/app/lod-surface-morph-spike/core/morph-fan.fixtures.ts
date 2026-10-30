import { TERRAIN_DEFAULTS, latticeSteps, maxLevelFor, type LodDomain, type LodSelector } from 'triangular-engine/lod-surface/core';
import { poseOf, projectionBasis, type MorphView } from './morph-frame';
import { poleLattices } from './morph-leaves';

/** Shared pieces of the fan specs: the lattice, a fake selector and the pole leaves of the two projection centres the fan is checked at. */
export const FAN_PATCH = TERRAIN_DEFAULTS.patchCells;
export const FAN_MAX_LEVEL = maxLevelFor(FAN_PATCH);
export const FAN_STEPS = latticeSteps(FAN_PATCH, FAN_MAX_LEVEL);
export const FAN_RADIUS = 6_371_000;

export function fanDomain(radiusM: number): LodDomain {
  return { kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' };
}

export interface FakeLeaf {
  face: number;
  level: number;
  i: number;
  j: number;
  mask?: number;
}

/** Just enough of a selector for the fan builder and the packer: the drawn leaves' arrays. */
export function fakeSelector(leaves: FakeLeaf[]): LodSelector {
  return {
    leaves: Int32Array.from(leaves.map((_, k) => k)),
    masks: Uint8Array.from(leaves.map((l) => l.mask ?? 0)),
    level: Int32Array.from(leaves.map((l) => l.level)),
    i: Int32Array.from(leaves.map((l) => l.i)),
    j: Int32Array.from(leaves.map((l) => l.j)),
    root: Int32Array.from(leaves.map((l) => l.face)),
    stats: { drawn: leaves.length },
    version: 1,
  } as unknown as LodSelector;
}

export function fanView(radiusM: number, centreLonDeg: number, centreLatDeg: number, morph: number, pose: Parameters<typeof poseOf>[0] = 'pole-200m'): MorphView {
  return { radiusM, morph, centreLonDeg, centreLatDeg, pose: poseOf(pose, radiusM, morph), groundHeightM: 0 };
}

/** The face and lattice position of the basis' up pole. */
export function upPoleOf(centreLonDeg: number, centreLatDeg: number): { face: number; u: number; v: number } {
  const basis = projectionBasis(centreLonDeg, centreLatDeg);
  for (let face = 0; face < 6; face++) {
    const found = poleLattices(basis, FAN_STEPS, face, 'equal-angle').find((p) => p.sign === 1);
    if (found) return { face, u: found.u, v: found.v };
  }
  throw new Error('no pole');
}

/** The four leaves of a level that share the pole at a lattice vertex (centre 0, 0). */
export function cornerLeavesOf(level: number): FakeLeaf[] {
  const { face } = upPoleOf(0, 0);
  const half = 2 ** level / 2;
  return [half - 1, half].flatMap((i) => [half - 1, half].map((j) => ({ face, level, i, j })));
}

/** The leaf of a level that holds the pole strictly inside (a tilted centre). */
export function interiorLeafOf(level: number, centreLonDeg: number, centreLatDeg: number): FakeLeaf {
  const { face, u, v } = upPoleOf(centreLonDeg, centreLatDeg);
  const span = (1 << (FAN_MAX_LEVEL - level)) * FAN_PATCH;
  return { face, level, i: Math.floor(u / span), j: Math.floor(v / span) };
}
