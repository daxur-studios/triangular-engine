import {
  AnimalHabitatCandidates,
  AnimalGroupSpeciesDefinition,
  queryAnimalGroups,
} from './animal-population-query';
import { applyAnimalGroupEvents } from './animal-group-events';

describe('queryAnimalGroups', () => {
  const species: AnimalGroupSpeciesDefinition = {
    id: 'birds',
    populationVersion: 'v1',
    groupPoolSize: 8,
    occupancy01: 1,
    memberCount: { min: 4, max: 12 },
    allowedHabitatKinds: ['tree', 'meadow'],
    minimumSuitability01: 0.5,
    activityDecisionPeriodSeconds: 60,
    activities: ['feed', 'rest'],
    maximumHabitatCandidates: 8,
  };

  const habitats: AnimalHabitatCandidates = {
    version: 'habitat-a',
    candidates: [
      {
        id: 'tree-2',
        position: { x: 20, y: 8, z: 0 },
        kind: 'tree',
        suitability01: 0.8,
        activities: ['rest'],
      },
      {
        id: 'meadow-1',
        position: { x: 0, y: 0, z: 0 },
        kind: 'meadow',
        suitability01: 0.9,
        activities: ['feed'],
      },
      {
        id: 'tree-1',
        position: { x: 10, y: 7, z: 0 },
        kind: 'tree',
        suitability01: 0.8,
        activities: ['rest'],
      },
    ],
  };

  const options = (universalTime: number) => ({
    worldSeed: 12345,
    region: { worldId: 'world', surfaceId: 'plane', cellId: 'cell-0' },
    species,
    habitats,
    universalTime,
  });

  it('is deterministic and independent of candidate input order', () => {
    const first = queryAnimalGroups(options(125));
    const reordered = queryAnimalGroups({
      ...options(125),
      habitats: { ...habitats, candidates: [...habitats.candidates].reverse() },
    });

    expect(reordered).toEqual(first);
    expect(first.map((group) => group.id)).toEqual(
      first.map((group) => group.id).slice().sort(),
    );
  });

  it('supports arbitrary positive and negative Universal Time without consuming state', () => {
    const input = structuredClone(options(-123456.75));
    const before = structuredClone(input);
    const result = queryAnimalGroups(input);

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((group) => group.time === -123456.75)).toBeTrue();
    expect(result.every((group) => (group.activityProgress ?? -1) >= 0 && (group.activityProgress ?? 2) < 1)).toBeTrue();
    expect(input).toEqual(before);
    expect(queryAnimalGroups(options(-123456.75))).toEqual(result);
    expect(queryAnimalGroups(options(1_000_000_000_000.25)).length).toBeGreaterThan(0);
  });

  it('keeps candidates bounded and filters by species habitat and activity', () => {
    expect(() => queryAnimalGroups({
      ...options(10),
      species: { ...species, maximumHabitatCandidates: 3 },
      habitats: {
        ...habitats,
        candidates: [...habitats.candidates, {
          id: 'extra', position: { x: 1, y: 1, z: 1 }, kind: 'tree',
          suitability01: 1, activities: ['feed', 'rest'],
        }],
      },
    })).toThrowError(/bound/);

    const filtered = queryAnimalGroups({
      ...options(10),
      habitats: {
        version: habitats.version,
        candidates: [{
          id: 'bad-water', position: { x: 0, y: -10, z: 0 }, kind: 'water',
          suitability01: 1, activities: ['feed', 'rest'],
        }],
      },
    });
    expect(filtered).toEqual([]);
  });

  it('produces stable group member counts and IDs across time queries', () => {
    const atStart = queryAnimalGroups(options(0));
    const later = queryAnimalGroups(options(60 * 17 + 0.25));
    expect(later.map((group) => group.id)).toEqual(atStart.map((group) => group.id));
    expect(later.map((group) => group.memberCount)).toEqual(atStart.map((group) => group.memberCount));
    expect(new Set(atStart.map((group) => group.id)).size).toBe(atStart.length);
    expect(atStart.every((group) => group.memberCount >= 4 && group.memberCount <= 12)).toBeTrue();
  });

  it('regenerates population identity when habitat version changes', () => {
    const original = queryAnimalGroups(options(10));
    const regenerated = queryAnimalGroups({
      ...options(10),
      habitats: { ...habitats, version: 'habitat-b' },
    });
    expect(regenerated.map((group) => group.id)).not.toEqual(original.map((group) => group.id));
    expect(regenerated.every((group) => group.habitatVersion === 'habitat-b')).toBeTrue();
  });

  it('returns reconstructable snapshots compatible with authoritative events', () => {
    const [group] = queryAnimalGroups(options(100));
    const event = {
      id: 'loss-1', type: 'member-loss' as const, targetGroupId: group.id,
      effectiveTime: group.time, memberCountLoss: 2,
    };
    const applied = applyAnimalGroupEvents(group, [event]);
    expect(applied.memberCount).toBe(Math.max(0, group.memberCount - 2));
    expect(applied.id).toBe(group.id);
    expect(applied.position).toEqual(group.position);
  });
});
