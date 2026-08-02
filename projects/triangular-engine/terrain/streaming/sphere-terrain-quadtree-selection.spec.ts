import {
  SphereTerrainDomain,
  sphereTerrainPatchNeighbor,
  type ISphereTerrainPatchAddress,
} from '../domains/sphere-terrain-domain';
import {
  estimateSphereTerrainPatchScreenSpaceErrorPx,
  selectSphereTerrainQuadtreePatches,
  type ISphereTerrainQuadtreeSelectionInput,
} from './sphere-terrain-quadtree-selection';

const input: ISphereTerrainQuadtreeSelectionInput = {
  radiusM: 600_000,
  minElevationM: -1_000,
  maxElevationM: 8_000,
  cameraWorldM: [608_510, 0, 0],
  options: {
    maxLevel: 8,
    patchResolution: 32,
    splitErrorPx: 16,
    mergeErrorPx: 6,
    screenSpaceErrorFactorPx: 700,
  },
};

function containsAddress(
  leaves: readonly ISphereTerrainPatchAddress[],
  target: ISphereTerrainPatchAddress,
): boolean {
  return leaves.some(
    (leaf) =>
      leaf.face === target.face &&
      leaf.level === target.level &&
      leaf.x === target.x &&
      leaf.y === target.y,
  );
}

function findAncestorLevel(
  leafByKey: ReadonlySet<string>,
  address: ISphereTerrainPatchAddress,
): number | null {
  for (let level = address.level; level >= 0; level -= 1) {
    const shift = address.level - level;
    if (
      leafByKey.has(
        `${address.face}:${level}:${address.x >> shift}:${address.y >> shift}`,
      )
    )
      return level;
  }
  return null;
}

describe('selectSphereTerrainQuadtreePatches', () => {
  it('returns exactly six roots when the split threshold is unreachable', () => {
    const leaves = selectSphereTerrainQuadtreePatches({
      ...input,
      options: { ...input.options, splitErrorPx: 1e12, mergeErrorPx: 1e11 },
    });

    expect(leaves).toHaveLength(6);
    expect(leaves.every((leaf) => leaf.level === 0)).toBe(true);
  });

  it('is deterministic for the same input', () => {
    expect(selectSphereTerrainQuadtreePatches(input)).toEqual(
      selectSphereTerrainQuadtreePatches(input),
    );
  });

  it('keeps the hidden hemisphere coarse while refining camera-facing terrain', () => {
    const leaves = selectSphereTerrainQuadtreePatches({
      ...input,
      options: {
        ...input.options,
        maxLevel: 6,
        splitErrorPx: 1,
        mergeErrorPx: 0.5,
      },
    });

    expect(
      containsAddress(leaves, { face: 'negative-x', level: 0, x: 0, y: 0 }),
    ).toBe(true);
    expect(
      leaves.some((leaf) => leaf.face === 'positive-x' && leaf.level > 0),
    ).toBe(true);
  });

  it('never permits an edge-adjacent leaf gap larger than one level', () => {
    const leaves = selectSphereTerrainQuadtreePatches(input);
    const leafByKey = new Set(
      leaves.map((leaf) => `${leaf.face}:${leaf.level}:${leaf.x}:${leaf.y}`),
    );
    const domain = new SphereTerrainDomain(input.radiusM);

    for (const leaf of leaves) {
      for (const edge of ['left', 'right', 'bottom', 'top'] as const) {
        const neighbor = sphereTerrainPatchNeighbor(domain, leaf, edge);
        const level = findAncestorLevel(leafByKey, neighbor);
        if (level !== null) expect(leaf.level - level).toBeLessThanOrEqual(1);
      }
    }
  });

  it('uses the lower merge threshold for a patch that was split last frame', () => {
    const target = { face: 'positive-x' as const, level: 1, x: 0, y: 0 };
    const errorPx = estimateSphereTerrainPatchScreenSpaceErrorPx(
      input,
      target,
      700,
      32,
    );
    const options = {
      ...input.options,
      maxLevel: 2,
      splitErrorPx: errorPx * 1.2,
      mergeErrorPx: errorPx * 0.8,
    };
    const cold = selectSphereTerrainQuadtreePatches({ ...input, options });
    const warm = selectSphereTerrainQuadtreePatches({
      ...input,
      options,
      previousLeaves: [
        { face: 'positive-x', level: 2, x: 0, y: 0 },
        { face: 'positive-x', level: 2, x: 1, y: 0 },
        { face: 'positive-x', level: 2, x: 0, y: 1 },
        { face: 'positive-x', level: 2, x: 1, y: 1 },
      ],
    });

    expect(containsAddress(cold, target)).toBe(true);
    expect(containsAddress(warm, target)).toBe(false);
  });
});
