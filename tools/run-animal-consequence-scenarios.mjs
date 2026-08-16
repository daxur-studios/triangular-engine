import '@angular/compiler';
import assert from 'node:assert/strict';

const [animals, animalTerrain, terrain] = await Promise.all([
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-terrain.mjs'),
]);
const { queryAnimalGroups, queryEffectiveAnimalGroups } = animals;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;

const fixtures = [
  { name: 'plane', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new PlaneTerrainDomain(100)), query: { x: -1000, y: 0, z: 900 } },
  { name: 'sphere', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new SphereTerrainDomain(100)), query: { x: 100, y: 0, z: 0 } },
  { name: 'cylinder', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new CylinderTerrainDomain({ radiusM: 50, lengthM: 200 })), query: { x: 0, y: 50, z: 0 } },
];
const report = {};
for (const fixture of fixtures) {
  const first = fixture.surface.sample(fixture.query);
  const second = fixture.surface.sample(fixture.surface.moveAlongSurface(first.position, scale(first.tangentU, 12), 1));
  const base = {
    worldSeed: 42,
    region: { worldId: 'world', surfaceId: fixture.name, cellId: 'cell' },
    species: {
      id: 'test-species', populationVersion: 'v1', groupPoolSize: 1, occupancy01: 1,
      memberCount: { min: 5, max: 5 }, allowedHabitatKinds: ['meadow'],
      minimumSuitability01: 0, activityDecisionPeriodSeconds: 1000,
      activities: ['feed'], maximumHabitatCandidates: 4,
    },
    habitats: {
      version: 'v1',
      candidates: [
        { id: 'habitat-a', position: first.position, kind: 'meadow', suitability01: 1, activities: ['feed'] },
        { id: 'habitat-b', position: second.position, kind: 'meadow', suitability01: 0.9, activities: ['feed'] },
      ],
    },
    universalTime: 100,
  };
  const baseline = queryAnimalGroups(base);
  assert.equal(baseline.length, 1);
  const group = baseline[0];
  assert.equal(group.habitatId, 'habitat-a');
  const events = [
    { id: 'loss', kind: 'member-loss', groupId: group.id, effectiveTime: 90, lostMembers: 2 },
    { id: 'move', kind: 'group-displacement', groupId: group.id, effectiveTime: 95, expiresAt: 110, excludedHabitatIds: ['habitat-a'] },
  ];
  const affected = queryEffectiveAnimalGroups({ ...base, consequences: events, maximumConsequences: 8 });
  assert.equal(affected.length, 1);
  assert.equal(affected[0].memberCount, 3);
  assert.equal(affected[0].habitatId, 'habitat-b');
  assert.deepEqual(
    affected,
    queryEffectiveAnimalGroups({ ...base, consequences: [...events].reverse(), maximumConsequences: 8 }),
    `${fixture.name}: event order changed reconstruction`,
  );
  const rewind = queryEffectiveAnimalGroups({ ...base, universalTime: 80, consequences: events, maximumConsequences: 8 });
  assert.equal(rewind[0].memberCount, 5);
  assert.equal(rewind[0].habitatId, 'habitat-a');
  const expired = queryEffectiveAnimalGroups({ ...base, universalTime: 120, consequences: events, maximumConsequences: 8 });
  assert.equal(expired[0].memberCount, 3);
  assert.equal(expired[0].habitatId, 'habitat-a');
  const invalidated = queryEffectiveAnimalGroups({
    ...base,
    consequences: [{ id: 'destroyed', kind: 'habitat-invalidated', habitatId: 'habitat-a', effectiveTime: 90 }],
    maximumConsequences: 8,
  });
  assert.equal(invalidated[0].habitatId, 'habitat-b');
  report[fixture.name] = {
    memberLossReconstructed: true,
    temporaryDisplacementReconstructed: true,
    habitatInvalidationReconstructed: true,
    rewindRestoresBaseline: true,
    eventOrderIndependent: true,
  };
}
console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));

function scale(value, amount) { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
