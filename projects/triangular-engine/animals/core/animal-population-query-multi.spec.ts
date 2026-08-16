import { queryAnimalPopulation, type AnimalGroupSpeciesDefinition } from './animal-population-query';

describe('queryAnimalPopulation', () => {
  const species = (id: string): AnimalGroupSpeciesDefinition => ({
    id, populationVersion: 'v1', groupPoolSize: 4, occupancy01: 1,
    memberCount: { min: 2, max: 5 }, allowedHabitatKinds: ['meadow'],
    minimumSuitability01: 0.5, activityDecisionPeriodSeconds: 60,
    activities: ['feed'], maximumHabitatCandidates: 4,
  });
  const base = {
    worldSeed: 42,
    region: { worldId: 'world', surfaceId: 'plane', cellId: 'cell-a' },
    habitats: { version: 'terrain-v1', candidates: [{
      id: 'meadow-a', position: { x: 1, y: 2, z: 3 }, kind: 'meadow',
      suitability01: 1, activities: ['feed' as const],
    }] },
    universalTime: 123.5,
    maximumGroups: 20,
  };

  it('combines independent species deterministically and sorts by stable ID', () => {
    const first = queryAnimalPopulation({ ...base, species: [species('zebra'), species('deer')] });
    const reordered = queryAnimalPopulation({ ...base, species: [species('deer'), species('zebra')] });
    expect(reordered).toEqual(first);
    expect(first.map(group => group.id)).toEqual(first.map(group => group.id).slice().sort());
    expect(new Set(first.map(group => group.id)).size).toBe(first.length);
    expect(new Set(first.map(group => group.habitatKind))).toEqual(new Set(['meadow']));
  });

  it('bounds aggregate work and rejects duplicate species identities', () => {
    expect(() => queryAnimalPopulation({ ...base, species: [species('deer'), species('deer')] }))
      .toThrowError(/unique/);
    expect(() => queryAnimalPopulation({ ...base, species: [species('deer'), species('zebra')], maximumGroups: 1 }))
      .toThrowError(/bound/);
  });

  it('does not mix regions or mutate inputs', () => {
    const input = { ...base, species: [species('deer')] };
    const before = structuredClone(input);
    const result = queryAnimalPopulation(input);
    expect(input).toEqual(before);
    expect(queryAnimalPopulation({ ...input, region: { ...input.region, cellId: 'cell-b' } }))
      .not.toEqual(result);
  });
});
