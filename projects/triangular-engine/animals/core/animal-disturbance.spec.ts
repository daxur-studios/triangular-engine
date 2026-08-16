import {
  resolveAnimalDisturbances,
  type AnimalInteractionDisturbance,
  type AnimalInteractionTopology,
  type AnimalMaterializedGroupTarget,
  type ResolveAnimalDisturbancesInput,
} from './animal-disturbance';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume, AnimalWaterVolumeSample } from './animal-water-volume';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

describe('resolveAnimalDisturbances', () => {
  it('uses surface topology distance plus signed local height, with order-independent output', () => {
    const groups = [group('near', 1, 6), group('far', 7, 0)];
    const disturbances = [disturbance('engine', 0, 2, 10, 0.8)];
    const input = disturbanceInput({ kind: 'surface', surface: steppedSurface() }, groups, disturbances);

    const forward = resolveAnimalDisturbances(input);
    const reversed = resolveAnimalDisturbances({
      ...input,
      groups: [...groups].reverse(),
      disturbances: [...disturbances].reverse(),
    });

    expect(forward).toEqual(reversed);
    expect(forward).toEqual([
      jasmine.objectContaining({
        groupId: 'near', disturbanceId: 'engine', distanceM: 5,
        influence01: 0.4,
      }),
    ]);
  });

  it('uses water-surface topology distance plus signed depth separation', () => {
    const result = resolveAnimalDisturbances(disturbanceInput(
      { kind: 'water', water: waterVolume(), time: 30 },
      [group('fish-school', 1, -5)],
      [disturbance('boat', 0, -1, 10, 0.6)],
    ));

    // The water adapter reports a 3m lateral surface path. Its signed
    // surface distances are -5m and -1m, giving a 4m vertical separation.
    expect(result).toEqual([
      jasmine.objectContaining({
        groupId: 'fish-school', disturbanceId: 'boat', distanceM: 5,
        influence01: 0.3,
      }),
    ]);
  });

  it('keeps deterministic strongest hits only within the explicit per-group cap', () => {
    const results = resolveAnimalDisturbances(disturbanceInput(
      { kind: 'surface', surface: flatSurface() },
      [group('group-b', 0, 0), group('group-a', 0, 0)],
      [
        disturbance('weak-near', 1, 0, 10, 0.2),
        disturbance('strong-far', 4, 0, 10, 1),
        disturbance('outside', 11, 0, 10, 1),
      ],
      { maximumHitsPerGroup: 1 },
    ));

    expect(results.map(hit => [hit.groupId, hit.disturbanceId])).toEqual([
      ['group-a', 'strong-far'],
      ['group-b', 'strong-far'],
    ]);
    expect(results.every(hit => hit.influence01 >= 0 && hit.influence01 <= 1)).toBeTrue();
  });

  it('rejects duplicate IDs, non-finite vectors, and group/disturbance bound overflow', () => {
    const topology: AnimalInteractionTopology = { kind: 'surface', surface: flatSurface() };
    const normal = disturbanceInput(topology, [group('a', 0, 0)], [disturbance('source', 0, 0, 1, 1)]);

    expect(() => resolveAnimalDisturbances({ ...normal, groups: [group('same', 0, 0), group('same', 1, 0)] }))
      .toThrowError(/unique/i);
    expect(() => resolveAnimalDisturbances({ ...normal, disturbances: [
      disturbance('same', 0, 0, 1, 1), disturbance('same', 1, 0, 1, 1),
    ] })).toThrowError(/unique/i);
    expect(() => resolveAnimalDisturbances({ ...normal, groups: [group('a', 0, 0), group('b', 1, 0)], maximumGroups: 1 }))
      .toThrowError(/group.*bound|bound.*group/i);
    expect(() => resolveAnimalDisturbances({ ...normal, disturbances: [
      disturbance('a', 0, 0, 1, 1), disturbance('b', 1, 0, 1, 1),
    ], maximumDisturbances: 1 })).toThrowError(/disturbance.*bound|bound.*disturbance/i);
    expect(() => resolveAnimalDisturbances({ ...normal, disturbances: [{
      ...disturbance('bad', 0, 0, 1, 1), position: { x: Number.NaN, y: 0, z: 0 },
    }] })).toThrowError(/finite/i);
    expect(() => resolveAnimalDisturbances({ ...normal, maximumHitsPerGroup: -1 })).toThrowError(/hit.*bound|bound.*hit/i);
  });
});

function disturbanceInput(
  topology: AnimalInteractionTopology,
  groups: readonly AnimalMaterializedGroupTarget[],
  disturbances: readonly AnimalInteractionDisturbance[],
  overrides: Partial<ResolveAnimalDisturbancesInput> = {},
): ResolveAnimalDisturbancesInput {
  return {
    topology,
    groups,
    disturbances,
    maximumGroups: 8,
    maximumDisturbances: 8,
    maximumHitsPerGroup: 4,
    ...overrides,
  };
}

function group(groupId: string, x: number, y: number): AnimalMaterializedGroupTarget {
  return { groupId, position: { x, y, z: 0 } };
}

function disturbance(id: string, x: number, y: number, radiusM: number, strength01: number): AnimalInteractionDisturbance {
  return { id, position: { x, y, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, radiusM, strength01 };
}

function flatSurface(): AnimalWorldSurface {
  return {
    kind: 'plane',
    sample: (position) => surfaceSample(position),
    projectToSurface: (position) => ({ x: position.x, y: 0, z: position.z }),
    moveAlongSurface: (position) => ({ x: position.x, y: 0, z: position.z }),
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.z - from.z),
  };
}

/** Deliberately decouples horizontal topology distance from Euclidean X distance. */
function steppedSurface(): AnimalWorldSurface {
  return {
    ...flatSurface(),
    surfaceDistance: () => 3,
  };
}

function surfaceSample(position: AnimalVector3): AnimalWorldSurfaceSample {
  const point = { x: position.x, y: 0, z: position.z };
  return {
    position: point, anchorRelativePosition: point,
    normal: { x: 0, y: 1, z: 0 }, surfaceUp: { x: 0, y: 1, z: 0 },
    tangentU: { x: 1, y: 0, z: 0 }, tangentV: { x: 0, y: 0, z: 1 },
    elevationM: 0, slope01: 0, walkable: true,
  };
}

function waterVolume(): AnimalWaterVolume {
  return {
    sample(position: AnimalVector3, _time: AnimalTime): AnimalWaterVolumeSample {
      const signedSurfaceDistanceM = position.y;
      return {
        location: position.y <= 0 ? 'water' : 'above-surface',
        containsWater: position.y <= 0,
        hasWaterBody: true,
        aboveSurface: position.y > 0,
        belowBottom: false,
        dry: false,
        land: false,
        waterColumnDepthM: 20,
        surfaceClearanceM: Math.max(0, -position.y),
        bottomClearanceM: 20 + position.y,
        signedSurfaceDistanceM,
        surface: {
          bodyId: 'sea', position: { x: position.x, y: 0, z: position.z },
          normal: { x: 0, y: 1, z: 0 }, flow: { x: 0, y: 0, z: 0 },
        },
        bottom: surfaceSample({ x: position.x, y: -20, z: position.z }),
      };
    },
    isSegmentValid: () => true,
    moveAlongSurface: () => undefined,
    surfaceDistance: () => 3,
  };
}
