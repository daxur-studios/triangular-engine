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
const { resolveAnimalDisturbances } = animals;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { TerrainWaterAnimalVolume } = animalWater;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;
const { PlaneWaterDomain, SphereWaterDomain, CylinderWaterDomain } = water;

const flatWater = {
  getHeight: () => 0,
  getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
  getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0, 0, 0),
};
const fixtures = [
  {
    name: 'plane',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new PlaneTerrainDomain(100)),
    waterTerrain: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new PlaneTerrainDomain(100)),
    waterDomain: new PlaneWaterDomain(),
    surfaceQuery: { x: -140, y: 0, z: 60 },
    waterQuery: { x: -140, y: -5, z: 60 },
  },
  {
    name: 'sphere',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new SphereTerrainDomain(100)),
    waterTerrain: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new SphereTerrainDomain(100)),
    waterDomain: new SphereWaterDomain(100),
    surfaceQuery: { x: 100, y: 0, z: 0 },
    waterQuery: { x: 95, y: 0, z: 0 },
  },
  {
    name: 'cylinder',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new CylinderTerrainDomain({ radiusM: 50, lengthM: 200 })),
    waterTerrain: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new CylinderTerrainDomain({ radiusM: 50, lengthM: 200 })),
    waterDomain: new CylinderWaterDomain(50, { axis: new Vector3(1, 0, 0), lengthM: 200 }),
    surfaceQuery: { x: 0, y: 50, z: 0 },
    waterQuery: { x: 0, y: 55, z: 0 },
  },
];

const report = {};
for (const fixture of fixtures) {
  const ground = fixture.surface.sample(fixture.surfaceQuery);
  const surfaceOffset = fixture.surface.moveAlongSurface(ground.position, scale(ground.tangentU, 3), 1);
  const elevated = addScaled(surfaceOffset, fixture.surface.sample(surfaceOffset).surfaceUp, 4);
  const surfaceHits = resolveAnimalDisturbances({
    topology: { kind: 'surface', surface: fixture.surface },
    groups: [{ groupId: 'herd', position: ground.position }],
    disturbances: [source('vehicle', elevated)],
    maximumGroups: 4, maximumDisturbances: 4, maximumHitsPerGroup: 2,
  });
  assert.equal(surfaceHits.length, 1, `${fixture.name}: surface influence missing`);
  assert.ok(Math.abs(surfaceHits[0].distanceM - 5) < 0.01, `${fixture.name}: surface distance was not topology-aware`);
  assert.ok(Math.abs(surfaceHits[0].influence01 - 0.5) < 0.001, `${fixture.name}: surface influence falloff changed`);

  const volume = new TerrainWaterAnimalVolume({
    terrain: fixture.waterTerrain,
    bodies: [{ body: { id: 'sea', domain: fixture.waterDomain, surface: flatWater } }],
  });
  const groupSample = volume.sample(fixture.waterQuery, 30);
  assert.equal(groupSample.containsWater, true, `${fixture.name}: invalid water fixture`);
  const movedSurface = volume.moveAlongSurface(fixture.waterQuery, scale(groupSample.bottom.tangentU, 3), 1, 30);
  assert.ok(movedSurface, `${fixture.name}: water surface movement failed`);
  const shallow = addScaled(movedSurface.position, movedSurface.normal, -1);
  const waterHits = resolveAnimalDisturbances({
    topology: { kind: 'water', water: volume, time: 30 },
    groups: [{ groupId: 'school', position: fixture.waterQuery }],
    disturbances: [source('boat', shallow)],
    maximumGroups: 4, maximumDisturbances: 4, maximumHitsPerGroup: 2,
  });
  assert.equal(waterHits.length, 1, `${fixture.name}: water influence missing`);
  assert.ok(Math.abs(waterHits[0].distanceM - 5) < 0.01, `${fixture.name}: water depth/path distance changed`);
  assert.ok(Math.abs(waterHits[0].influence01 - 0.5) < 0.001, `${fixture.name}: water influence falloff changed`);

  const reordered = resolveAnimalDisturbances({
    topology: { kind: 'surface', surface: fixture.surface },
    groups: [{ groupId: 'z', position: ground.position }, { groupId: 'a', position: ground.position }],
    disturbances: [source('weak', elevated, 0.4), source('strong', elevated, 1)],
    maximumGroups: 4, maximumDisturbances: 4, maximumHitsPerGroup: 1,
  });
  assert.deepEqual(reordered.map(hit => [hit.groupId, hit.disturbanceId]), [['a', 'strong'], ['z', 'strong']]);
  report[fixture.name] = {
    topologyAwareSurfaceDistance: true,
    topologyAwareWaterDepthDistance: true,
    deterministicBoundedSelection: true,
  };
}

console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));

function source(id, position, strength01 = 1) {
  return { id, position, velocity: { x: 0, y: 0, z: 0 }, radiusM: 10, strength01 };
}
function scale(value, amount) { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function addScaled(origin, direction, amount) {
  return { x: origin.x + direction.x * amount, y: origin.y + direction.y * amount, z: origin.z + direction.z * amount };
}
