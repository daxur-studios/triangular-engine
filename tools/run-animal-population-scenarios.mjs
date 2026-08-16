import '@angular/compiler';
import assert from 'node:assert/strict';

const [animals, animalTerrain, terrain] = await Promise.all([
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-terrain.mjs'),
]);

const { queryAnimalGroups } = animals;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;

const species = {
  id: 'grazing-herbivore',
  populationVersion: '1',
  groupPoolSize: 4,
  occupancy01: 1,
  memberCount: { min: 6, max: 12 },
  allowedHabitatKinds: ['grassland'],
  minimumSuitability01: 0.4,
  activityDecisionPeriodSeconds: 60,
  activities: ['feed', 'rest'],
  maximumHabitatCandidates: 16,
};

const fixtures = [
  {
    shape: 'plane',
    surfaceId: 'infinite-plane',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(3), new PlaneTerrainDomain(100)),
    queries: [{ x: -150, y: 0, z: 40 }, { x: 25, y: 0, z: -75 }, { x: 240, y: 0, z: 120 }],
  },
  {
    shape: 'sphere',
    surfaceId: 'planet-sphere',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(3), new SphereTerrainDomain(1_000)),
    queries: [{ x: 1_000, y: 0, z: 0 }, { x: 0, y: 1_000, z: 0 }, { x: 0, y: 0, z: 1_000 }],
  },
  {
    shape: 'cylinder',
    surfaceId: 'inside-cylinder',
    surface: new TerrainAnimalWorldSurface(
      new ConstantTerrainField(3),
      new CylinderTerrainDomain({ radiusM: 500, lengthM: 2_000 }),
    ),
    queries: [{ x: -500, y: 500, z: 0 }, { x: 0, y: 0, z: 500 }, { x: 500, y: -500, z: 0 }],
  },
];

const report = {};
for (const fixture of fixtures) {
  const candidates = fixture.queries.map((position, index) => ({
    id: `${fixture.shape}-habitat-${index}`,
    position: fixture.surface.projectToSurface(position),
    kind: 'grassland',
    suitability01: 0.8,
    activities: ['feed', 'rest'],
  }));
  const options = {
    worldSeed: 90210,
    region: { worldId: 'scenario-world', surfaceId: fixture.surfaceId, cellId: `${fixture.shape}:cell:0` },
    species,
    habitats: { version: 'terrain-v1', candidates },
    universalTime: 123_456.75,
  };
  const first = queryAnimalGroups(options);
  const reordered = queryAnimalGroups({
    ...options,
    habitats: { ...options.habitats, candidates: [...candidates].reverse() },
  });
  const revisited = queryAnimalGroups({ ...options, universalTime: -50_000 });
  const revisitedAgain = queryAnimalGroups({ ...options, universalTime: -50_000 });
  assert.deepEqual(reordered, first, `${fixture.shape}: candidate input order changed output`);
  assert.deepEqual(revisitedAgain, revisited, `${fixture.shape}: revisit changed output`);
  assert.equal(first.length, species.groupPoolSize, `${fixture.shape}: stable group pool`);
  for (const group of first) {
    const projected = fixture.surface.projectToSurface(group.position);
    assert.ok(Math.hypot(
      projected.x - group.position.x,
      projected.y - group.position.y,
      projected.z - group.position.z,
    ) < 1e-6, `${fixture.shape}: habitat is not on its surface`);
    assert.ok(group.memberCount >= species.memberCount.min && group.memberCount <= species.memberCount.max);
  }
  assert.deepEqual(queryAnimalGroups({
    ...options,
    habitats: { version: 'terrain-v1', candidates: [] },
  }), [], `${fixture.shape}: groups existed without viable habitat`);
  report[fixture.shape] = {
    groups: first.length,
    orderInvariant: true,
    negativeTimeRevisitStable: true,
    habitatPositionsOnSurface: true,
    noViableHabitatMeansNoGroups: true,
  };
}

console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));
