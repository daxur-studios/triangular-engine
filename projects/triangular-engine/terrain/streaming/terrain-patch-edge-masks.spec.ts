import { PlaneTerrainDomain } from '../domains/plane-terrain-domain';
import { SphereTerrainDomain } from '../domains/sphere-terrain-domain';
import {
  calculateTerrainPatchEdgeRefinementMasks,
  TERRAIN_PATCH_EDGE_EAST,
  TERRAIN_PATCH_EDGE_SOUTH,
} from './terrain-patch-edge-masks';

describe('calculateTerrainPatchEdgeRefinementMasks', () => {
  const domain = new PlaneTerrainDomain(100);

  it('marks a coarse patch edge beside finer children and reports the level delta', () => {
    const coarse = { level: 0, x: 0, z: 0 };
    const fineEast = { level: 2, x: 4, z: 0 };
    const fineSouth = { level: 1, x: 0, z: 2 };

    const result = calculateTerrainPatchEdgeRefinementMasks(
      domain,
      [coarse, fineEast, fineSouth],
      (address) => address.level,
    );

    expect(result[0]).toEqual({
      mask: TERRAIN_PATCH_EDGE_EAST | TERRAIN_PATCH_EDGE_SOUTH,
      levelDelta: 2,
      edgeLevelDeltas: [0, 2, 1, 0],
      edgeSegments: [
        [],
        [{ start: 0, end: 0.25, levelDelta: 2 }],
        [{ start: 0, end: 0.5, levelDelta: 1 }],
        [],
      ],
    });
  });

  it('does not mark same-level neighbours', () => {
    const result = calculateTerrainPatchEdgeRefinementMasks(
      domain,
      [
        { level: 1, x: 0, z: 0 },
        { level: 1, x: 1, z: 0 },
      ],
      (address) => address.level,
    );

    expect(result).toEqual([
      {
        mask: 0,
        levelDelta: 0,
        edgeLevelDeltas: [0, 0, 0, 0],
        edgeSegments: [[], [], [], []],
      },
      {
        mask: 0,
        levelDelta: 0,
        edgeLevelDeltas: [0, 0, 0, 0],
        edgeSegments: [[], [], [], []],
      },
    ]);
  });

  it('uses sphere topology across cube-face seams', () => {
    const sphere = new SphereTerrainDomain(100);
    const coarse = { face: 'positive-x' as const, level: 0, x: 0, y: 0 };
    const neighbour = sphere.getPatchNeighbor(coarse, 'right');
    const fine = sphere.getChildren(neighbour)[0];

    const result = calculateTerrainPatchEdgeRefinementMasks(
      sphere,
      [coarse, fine],
      (address) => address.level,
    );

    expect(result[0].mask).toBe(TERRAIN_PATCH_EDGE_EAST);
    expect(result[0].edgeLevelDeltas).toEqual([0, 1, 0, 0]);
    expect(result[0].edgeSegments[1]).toEqual([
      { start: 0, end: 1, levelDelta: 1 },
    ]);
  });
});
