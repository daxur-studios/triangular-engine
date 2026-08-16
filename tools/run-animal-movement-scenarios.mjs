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

const { stepConstrainedAnimalMovement } = animals;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { TerrainWaterAnimalVolume } = animalWater;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;
const { PlaneWaterDomain, SphereWaterDomain, CylinderWaterDomain } = water;
const flatWater = {
  getHeight: () => 0,
  getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
  getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0, 0, 0),
};
const waterVolume = (surface, domain) => new TerrainWaterAnimalVolume({
  terrain: surface,
  bodies: [{ body: { id: 'sea', domain, surface: flatWater } }],
});
const diagonal = 1 / Math.sqrt(2);
const seamAngle = Math.PI * 2 - 0.02;
const fixtures = [
  {
    shape: 'plane',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new PlaneTerrainDomain(100)),
    waterDomain: new PlaneWaterDomain(),
    groundQuery: { x: -150, y: 0, z: 70 },
    waterStart: { x: -150, y: -5, z: 70 },
  },
  {
    shape: 'sphere',
    surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new SphereTerrainDomain(100)),
    waterDomain: new SphereWaterDomain(100),
    groundQuery: { x: 100 * diagonal, y: 100 * diagonal, z: 0 },
    waterStart: { x: 95 * diagonal, y: 95 * diagonal, z: 0 },
  },
  {
    shape: 'cylinder',
    surface: new TerrainAnimalWorldSurface(
      new ConstantTerrainField(-10),
      new CylinderTerrainDomain({ radiusM: 50, lengthM: 100 }),
    ),
    waterDomain: new CylinderWaterDomain(50, { axis: new Vector3(1, 0, 0), lengthM: 100 }),
    groundQuery: { x: 0, y: 60 * Math.cos(seamAngle), z: 60 * Math.sin(seamAngle) },
    waterStart: { x: 0, y: 55 * Math.cos(seamAngle), z: 55 * Math.sin(seamAngle) },
  },
];

const common = {
  maximumSpeedMps: 6,
  maximumAccelerationMps2: 20,
  maximumSubstepDistanceM: 0.5,
  maximumSubsteps: 16,
};
const report = {};
for (const fixture of fixtures) {
  const volume = waterVolume(fixture.surface, fixture.waterDomain);
  const ground = fixture.surface.sample(fixture.groundQuery);
  const tangent = scale(ground.tangentV, 4);
  let land = { position: ground.position, velocity: { x: 0, y: 0, z: 0 } };
  let air = {
    position: addScaled(ground.position, ground.surfaceUp, 7),
    velocity: { x: 0, y: 0, z: 0 },
  };
  const waterFrame = volume.sample(fixture.waterStart, 0).bottom;
  assert.ok(waterFrame);
  const swim = scale(waterFrame.tangentV, 2);
  let fish = { position: fixture.waterStart, velocity: { x: 0, y: 0, z: 0 } };
  for (let step = 0; step < 20; step++) {
    const landInput = land;
    land = stepConstrainedAnimalMovement(landInput, tangent, 0.1, step * 0.1, {
      domain: 'land', surface: fixture.surface, ...common,
    });
    assert.deepEqual(land, stepConstrainedAnimalMovement(landInput, tangent, 0.1, step * 0.1, {
      domain: 'land', surface: fixture.surface, ...common,
    }), `${fixture.shape}: land deterministic`);
    const airInput = air;
    const airTarget = add(tangent, scale(ground.surfaceUp, 0.5));
    air = stepConstrainedAnimalMovement(airInput, airTarget, 0.1, step * 0.1, {
      domain: 'air', surface: fixture.surface, minimumAltitudeM: 5, maximumAltitudeM: 9, ...common,
    });
    assert.deepEqual(air, stepConstrainedAnimalMovement(airInput, airTarget, 0.1, step * 0.1, {
      domain: 'air', surface: fixture.surface, minimumAltitudeM: 5, maximumAltitudeM: 9, ...common,
    }), `${fixture.shape}: air deterministic`);
    const fishInput = fish;
    fish = stepConstrainedAnimalMovement(fishInput, swim, 0.1, step * 0.1, {
      domain: 'water', water: volume, minimumSurfaceClearanceM: 1, minimumBottomClearanceM: 1, ...common,
    });
    assert.deepEqual(fish, stepConstrainedAnimalMovement(fishInput, swim, 0.1, step * 0.1, {
      domain: 'water', water: volume, minimumSurfaceClearanceM: 1, minimumBottomClearanceM: 1, ...common,
    }), `${fixture.shape}: water deterministic`);
    assert.equal(land.blocked, false, `${fixture.shape}: land blocked`);
    assert.equal(air.blocked, false, `${fixture.shape}: air blocked`);
    assert.equal(fish.blocked, false, `${fixture.shape}: fish blocked`);
  }
  const projectedLand = fixture.surface.projectToSurface(land.position);
  assert.ok(distance(projectedLand, land.position) < 1e-6, `${fixture.shape}: land left surface`);
  const airGround = fixture.surface.sample(air.position);
  const airClearance = dot(subtract(air.position, airGround.position), airGround.surfaceUp);
  assert.ok(airClearance >= 5 - 1e-6 && airClearance <= 9 + 1e-6, `${fixture.shape}: air altitude`);
  const fishSample = volume.sample(fish.position, 2);
  assert.equal(fishSample.containsWater, true, `${fixture.shape}: fish left water`);
  assert.ok(fishSample.surfaceClearanceM >= 1 - 1e-6 && fishSample.bottomClearanceM >= 1 - 1e-6);
  assert.ok(volume.surfaceDistance(fixture.waterStart, fish.position) < 8, `${fixture.shape}: fish transport was non-local`);
  const boundedInput = { position: ground.position, velocity: tangent };
  const bounded = stepConstrainedAnimalMovement(boundedInput, tangent, 100, 0, {
    domain: 'land', surface: fixture.surface, ...common, maximumSubsteps: 1,
  });
  assert.equal(bounded.blockReason, 'substep-bound');
  assert.deepEqual(bounded.position, boundedInput.position);
  assert.deepEqual(bounded.velocity, boundedInput.velocity);
  report[fixture.shape] = {
    deterministicSteps: 20,
    landSurfaceConstrained: true,
    airLocalUpConstrained: true,
    fishVolumeConstrained: true,
    deterministicAndBounded: true,
    topologyBoundaryStart: fixture.shape === 'plane' ? 'negative infinite coordinates' : fixture.shape === 'sphere' ? 'cube-face boundary' : 'angular seam',
  };
}
console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));

function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(value, amount) { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function addScaled(origin, direction, amount) { return add(origin, scale(direction, amount)); }
function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
