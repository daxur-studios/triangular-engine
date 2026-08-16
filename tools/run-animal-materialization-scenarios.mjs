import '@angular/compiler';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

const [animals, animalTerrain, animalWater, terrain, water] = await Promise.all([
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-water.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-water.mjs'),
]);

const { handoffLocalAnimalGroupResidency, materializeLocalAnimalGroup } = animals;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { TerrainWaterAnimalVolume } = animalWater;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;
const { PlaneWaterDomain, SphereWaterDomain, CylinderWaterDomain } = water;
const flatWater = {
  getHeight: () => 0,
  getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
  getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0, 0, 0),
};
const makeWater = (surface, domain) => new TerrainWaterAnimalVolume({
  terrain: surface,
  bodies: [{ body: { id: 'sea', domain, surface: flatWater } }],
});

const fixtures = [
  {
    shape: 'plane',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new PlaneTerrainDomain(100)),
    waterDomain: new PlaneWaterDomain(),
    groundQuery: { x: -125, y: 0, z: 80 },
    waterOrigin: { x: -125, y: -5, z: 80 },
    nearObserver: { x: -120, y: 0, z: 80 },
    farObserver: { x: 0, y: 0, z: 80 },
  },
  {
    shape: 'sphere',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new SphereTerrainDomain(100)),
    waterDomain: new SphereWaterDomain(100),
    groundQuery: { x: 100, y: 0, z: 0 },
    waterOrigin: { x: 95, y: 0, z: 0 },
    nearObserver: { x: 90 * Math.cos(0.05), y: 90 * Math.sin(0.05), z: 0 },
    farObserver: { x: -90, y: 0, z: 0 },
  },
  {
    shape: 'cylinder',
    surface: new TerrainAnimalWorldSurface(
      new ConstantTerrainField(-10),
      new CylinderTerrainDomain({ radiusM: 50, lengthM: 100 }),
    ),
    waterDomain: new CylinderWaterDomain(50, { axis: new Vector3(1, 0, 0), lengthM: 100 }),
    groundQuery: { x: 0, y: 60, z: 0 },
    waterOrigin: { x: 0, y: 55, z: 0 },
    nearObserver: { x: 0, y: 60 * Math.cos(-0.02), z: 60 * Math.sin(-0.02) },
    farObserver: { x: 40, y: 60, z: 0 },
  },
];

const report = {};
for (const fixture of fixtures) {
  const waterVolume = makeWater(fixture.surface, fixture.waterDomain);
  const ground = fixture.surface.projectToSurface(fixture.groundQuery);
  const base = {
    id: `group:${fixture.shape}`,
    seed: 123456,
    time: -25_000.5,
    velocity: { x: 0, y: 0, z: 0 },
    activity: 'rest',
    activityProgress: 0.4,
    destinationId: 'habitat',
    progress: 0,
    memberCount: 8,
  };
  const landGroup = { ...base, position: ground };
  const airGroup = { ...base, id: `${base.id}:air`, position: ground };
  const waterGroup = { ...base, id: `${base.id}:water`, position: fixture.waterOrigin };
  const landDefinition = { domain: 'land', surface: fixture.surface, spreadRadiusM: 6 };
  const airDefinition = {
    domain: 'air', surface: fixture.surface, spreadRadiusM: 6,
    minimumAltitudeM: 5, maximumAltitudeM: 10,
  };
  const waterDefinition = {
    domain: 'water', water: waterVolume, spreadRadiusM: 3,
    minimumSurfaceClearanceM: 1, minimumBottomClearanceM: 1,
  };
  const land = materializeLocalAnimalGroup(landGroup, landDefinition);
  const air = materializeLocalAnimalGroup(airGroup, airDefinition);
  const fish = materializeLocalAnimalGroup(waterGroup, waterDefinition);
  const nearHandoff = handoffLocalAnimalGroupResidency({
    group: landGroup,
    observer: { position: fixture.nearObserver, radius: 0 },
    materialization: { ...landDefinition, maximumMembers: 5 },
    cullDistanceM: 10,
  });
  const farHandoff = handoffLocalAnimalGroupResidency({
    group: landGroup,
    observer: { position: fixture.farObserver, radius: 0 },
    materialization: landDefinition,
    cullDistanceM: 10,
  });
  assert.equal(nearHandoff.mode, 'materialized', `${fixture.shape}: near residency`);
  assert.equal(nearHandoff.sourceMemberCount, 8);
  assert.equal(nearHandoff.individuals.length, 5, `${fixture.shape}: local cap`);
  assert.equal(farHandoff.mode, 'aggregate', `${fixture.shape}: far residency`);
  assert.deepEqual(handoffLocalAnimalGroupResidency({
    group: landGroup,
    observer: { position: fixture.nearObserver, radius: 0 },
    materialization: { ...landDefinition, maximumMembers: 5 },
    cullDistanceM: 10,
  }), nearHandoff, `${fixture.shape}: residency reload`);
  assert.deepEqual(materializeLocalAnimalGroup(landGroup, landDefinition), land, `${fixture.shape}: land revisit`);
  assert.deepEqual(materializeLocalAnimalGroup(airGroup, airDefinition), air, `${fixture.shape}: air revisit`);
  assert.deepEqual(materializeLocalAnimalGroup(waterGroup, waterDefinition), fish, `${fixture.shape}: water revisit`);
  assert.equal(new Set([...land, ...air, ...fish].map((member) => member.id)).size, 24);
  for (const member of land) {
    const projected = fixture.surface.projectToSurface(member.position);
    assert.ok(distance(projected, member.position) < 1e-6, `${fixture.shape}: land member left surface`);
  }
  for (const member of air) {
    const surface = fixture.surface.sample(member.position);
    const clearance = dot(subtract(member.position, surface.position), surface.surfaceUp);
    assert.ok(clearance >= 5 - 1e-6 && clearance <= 10 + 1e-6, `${fixture.shape}: air clearance`);
  }
  for (const member of fish) {
    const sample = waterVolume.sample(member.position, waterGroup.time);
    assert.equal(sample.containsWater, true, `${fixture.shape}: fish outside water`);
    assert.ok(sample.surfaceClearanceM >= 1 - 1e-6, `${fixture.shape}: fish crossed surface`);
    assert.ok(sample.bottomClearanceM >= 1 - 1e-6, `${fixture.shape}: fish crossed bottom`);
    assert.equal(waterVolume.isSegmentValid(waterGroup.position, member.position, waterGroup.time, 0.5), true);
  }
  report[fixture.shape] = {
    landMembers: land.length,
    airMembers: air.length,
    waterMembers: fish.length,
    exactUnloadRevisit: true,
    landOnSurface: true,
    airClearance: true,
    fishVolumeAndSegmentValid: true,
    topologyAwareResidency: true,
    stableResidentCap: true,
  };
}

console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));

function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
