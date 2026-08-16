import {
  queryEffectiveAnimalGroups,
  type AnimalGroupConsequence,
  type QueryEffectiveAnimalGroupsOptions,
} from './animal-group-consequences';
import {
  queryAnimalGroups,
  type AnimalHabitatCandidates,
  type AnimalGroupSpeciesDefinition,
  type QueryAnimalGroupsOptions,
} from './animal-population-query';

describe('queryEffectiveAnimalGroups', () => {
  const species: AnimalGroupSpeciesDefinition = {
    id: 'fish',
    populationVersion: 'v1',
    groupPoolSize: 1,
    occupancy01: 1,
    memberCount: { min: 5, max: 5 },
    allowedHabitatKinds: ['reef'],
    minimumSuitability01: 0.5,
    activityDecisionPeriodSeconds: 60,
    activities: ['feed'],
    maximumHabitatCandidates: 3,
  };
  const habitats: AnimalHabitatCandidates = {
    version: 'reef-v1',
    candidates: [
      { id: 'reef-a', position: { x: 0, y: -5, z: 0 }, kind: 'reef', suitability01: 0.9, activities: ['feed'] },
      { id: 'reef-b', position: { x: 8, y: -5, z: 0 }, kind: 'reef', suitability01: 0.9, activities: ['feed'] },
      { id: 'reef-c', position: { x: 16, y: -5, z: 0 }, kind: 'reef', suitability01: 0.8, activities: ['feed'] },
    ],
  };

  const baselineOptions = (universalTime: number): QueryAnimalGroupsOptions => ({
    worldSeed: 19,
    region: { worldId: 'world', surfaceId: 'plane', cellId: 'cell-a' },
    species,
    habitats,
    universalTime,
  });
  const options = (
    universalTime: number,
    consequences: readonly AnimalGroupConsequence[],
    maximumConsequences = 8,
  ): QueryEffectiveAnimalGroupsOptions => ({
    ...baselineOptions(universalTime),
    consequences,
    maximumConsequences,
  });
  const expectedBaseline = (universalTime: number) => queryAnimalGroups(baselineOptions(universalTime)).map(group => ({
    ...group,
    extinct: false,
    appliedConsequenceIds: [],
  }));

  it('ignores future events, sums effective member losses, clamps at zero, and restores baseline on rewind', () => {
    const [baseline] = queryAnimalGroups(baselineOptions(10));
    const losses: readonly AnimalGroupConsequence[] = [
      { id: 'loss-a', kind: 'member-loss', groupId: baseline.id, effectiveTime: 20, lostMembers: 2 },
      { id: 'loss-b', kind: 'member-loss', groupId: baseline.id, effectiveTime: 20, lostMembers: 10 },
    ];

    expect(queryEffectiveAnimalGroups(options(10, losses))).toEqual(expectedBaseline(10));
    expect(queryEffectiveAnimalGroups(options(20, losses))[0].memberCount).toBe(0);
    expect(queryEffectiveAnimalGroups(options(-100, losses))).toEqual(expectedBaseline(-100));
  });

  it('temporarily displaces a group and reselects through normal population-query habitat semantics', () => {
    const [baseline] = queryAnimalGroups(baselineOptions(10));
    const displacement: AnimalGroupConsequence = {
      id: 'vehicle-noise', kind: 'group-displacement', groupId: baseline.id,
      effectiveTime: 10, expiresAt: 30, excludedHabitatIds: [baseline.habitatId],
    };

    const [active] = queryEffectiveAnimalGroups(options(15, [displacement]));
    expect(active.id).toBe(baseline.id);
    expect(active.habitatId).not.toBe(baseline.habitatId);
    expect(active.memberCount).toBe(baseline.memberCount);
    expect(queryEffectiveAnimalGroups(options(30, [displacement]))).toEqual(expectedBaseline(30));
  });

  it('makes a displaced group absent when all otherwise eligible habitats are excluded', () => {
    const [baseline] = queryAnimalGroups(baselineOptions(10));
    const excludedHabitatIds = habitats.candidates.map(candidate => candidate.id);
    const event: AnimalGroupConsequence = {
      id: 'wildfire', kind: 'group-displacement', groupId: baseline.id,
      effectiveTime: 10, expiresAt: 30, excludedHabitatIds,
    };

    expect(queryEffectiveAnimalGroups(options(15, [event]))).toEqual([]);
  });

  it('permanently excludes invalidated habitat without mutating the baseline query or rewind', () => {
    const [baseline] = queryAnimalGroups(baselineOptions(10));
    const invalidation: AnimalGroupConsequence = {
      id: 'reef-destroyed', kind: 'habitat-invalidated', effectiveTime: 10, habitatId: baseline.habitatId,
    };

    const [after] = queryEffectiveAnimalGroups(options(15, [invalidation]));
    expect(after.habitatId).not.toBe(baseline.habitatId);
    expect(queryEffectiveAnimalGroups(options(9, [invalidation]))).toEqual(expectedBaseline(9));
    expect(queryAnimalGroups(baselineOptions(15)).some(group => group.habitatId === baseline.habitatId)).toBeTrue();
  });

  it('is order invariant and rejects duplicate event IDs and bounded-work overflow', () => {
    const [baseline] = queryAnimalGroups(baselineOptions(10));
    const events: readonly AnimalGroupConsequence[] = [
      { id: 'loss', kind: 'member-loss', groupId: baseline.id, effectiveTime: 10, lostMembers: 1 },
      { id: 'move', kind: 'group-displacement', groupId: baseline.id, effectiveTime: 10, expiresAt: 20, excludedHabitatIds: [baseline.habitatId] },
    ];

    expect(queryEffectiveAnimalGroups(options(15, [...events].reverse()))).toEqual(queryEffectiveAnimalGroups(options(15, events)));
    expect(() => queryEffectiveAnimalGroups(options(15, [...events, { ...events[0] }]))).toThrowError(/unique/);
    expect(() => queryEffectiveAnimalGroups(options(15, events, 1))).toThrowError(/bound/);
  });
});
