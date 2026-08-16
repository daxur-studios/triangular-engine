import '@angular/compiler';
import assert from 'node:assert/strict';

const [animals, animalTerrain, terrain] = await Promise.all([
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-terrain.mjs'),
]);
const { allocateAnimalRoosts, sampleAnimalAirFlockCycle, stepAnimalAirFlock } = animals;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;

const fixtures = [
  { name: 'plane', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new PlaneTerrainDomain(100)), query: { x: -120, y: 0, z: 30 } },
  { name: 'sphere', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new SphereTerrainDomain(100)), query: { x: 70, y: 70, z: 0 } },
  { name: 'cylinder', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new CylinderTerrainDomain({ radiusM: 50, lengthM: 200 })), query: { x: 0, y: 49.99, z: -1 } },
];
const report = {};
for (const fixture of fixtures) {
  const origin = fixture.surface.sample(fixture.query);
  const targetGround = fixture.surface.sample(fixture.surface.moveAlongSurface(origin.position, scale(origin.tangentU, 10), 1));
  const target = addScaled(targetGround.position, targetGround.surfaceUp, 8);
  const perchGroundA = fixture.surface.sample(fixture.surface.moveAlongSurface(origin.position, scale(origin.tangentV, 3), 1));
  const perchGroundB = fixture.surface.sample(fixture.surface.moveAlongSurface(origin.position, scale(origin.tangentV, -3), 1));
  const roostSites = [
    { id: 'tree-b', position: addScaled(perchGroundB.position, perchGroundB.surfaceUp, 3), capacity: 3 },
    { id: 'tree-a', position: addScaled(perchGroundA.position, perchGroundA.surfaceUp, 3), capacity: 3 },
  ];
  let members = Array.from({ length: 8 }, (_, index) => {
    const angle = index / 8 * Math.PI * 2;
    const memberGround = fixture.surface.sample(fixture.surface.moveAlongSurface(origin.position, add(
      scale(origin.tangentU, Math.cos(angle) * 2), scale(origin.tangentV, Math.sin(angle) * 2)), 1));
    return { id: `bird-${index}`, position: addScaled(memberGround.position, memberGround.surfaceUp, 8), velocity: { x: 0, y: 0, z: 0 }, mode: 'flight' };
  });
  const definition = {
    surface: fixture.surface, maximumMembers: 16, maximumRoostSites: 4,
    maximumSpeedMps: 7, maximumAccelerationMps2: 8, maximumSubstepDistanceM: 0.5, maximumSubsteps: 8,
    minimumAltitudeM: 2, maximumAltitudeM: 20, preferredAltitudeM: 8,
    separationRadiusM: 1.5, separationWeight: 2, cohesionWeight: 0.7, alignmentWeight: 0.2, targetWeight: 4,
    arrivalRadiusM: 0.5, holdingRadiusM: 6, holdingSpeedMps: 3, roostSlotSpacingM: 0.75,
  };
  const ordered = allocateAnimalRoosts(members.map(member => member.id), roostSites, target, fixture.surface, 4);
  const reordered = allocateAnimalRoosts([...members].reverse().map(member => member.id), [...roostSites].reverse(), target, fixture.surface, 4);
  assert.deepEqual(ordered, reordered, `${fixture.name}: allocation order changed result`);
  assert.equal(ordered.filter(value => value.mode === 'assigned').length, 6);
  assert.equal(ordered.filter(value => value.mode === 'holding').length, 2);

  for (let tick = 0; tick < 40; tick++) {
    const result = stepAnimalAirFlock({ members, intent: 'fly', target, deltaSeconds: 0.05, universalTime: tick * 0.05 }, definition);
    assert.ok(result.constrained.every(value => !value.blocked), `${fixture.name}: flight constrained`);
    members = result.members;
  }
  for (let tick = 0; tick < 500; tick++) {
    const result = stepAnimalAirFlock({ members, intent: 'roost', target, roostSites, deltaSeconds: 0.05, universalTime: 2 + tick * 0.05 }, definition);
    assert.ok(result.constrained.every(value => !value.blocked), `${fixture.name}: roost constrained`);
    members = result.members;
  }
  assert.equal(members.filter(member => member.mode === 'perched').length, 6, `${fixture.name}: assigned birds did not perch`);
  assert.equal(members.filter(member => member.mode === 'holding').length, 2, `${fixture.name}: overflow did not hold`);
  for (const member of members.filter(value => value.mode === 'perched')) {
    assert.equal(magnitude(member.velocity), 0, `${fixture.name}: perched bird moved`);
    assert.ok(roostSites.some(site => site.id === member.perchId));
  }
  const perched = members.filter(value => value.mode === 'perched');
  for (let left = 0; left < perched.length; left++) for (let right = left + 1; right < perched.length; right++) {
    assert.ok(distance(perched[left].position, perched[right].position) > 0.25, `${fixture.name}: perched birds stacked`);
  }
  const departure = stepAnimalAirFlock({ members, intent: 'fly', target, deltaSeconds: 0.05, universalTime: 30 }, definition);
  assert.ok(departure.members.every(member => member.mode === 'flight' && member.perchId === undefined));
  const cycleDefinition = {
    groupId: `${fixture.name}-daily-flock`, memberCount: 8,
    roostSites: roostSites.map(site => ({ ...site, capacity: 4 })), flightTarget: target,
    roostDurationS: 5, flightDurationS: 15, returnDurationS: 30,
    fixedStepSeconds: 0.05, maximumReplaySteps: 1000, policy: definition,
  };
  const direct = sampleAnimalAirFlockCycle(12.5, cycleDefinition);
  const farFuture = sampleAnimalAirFlockCycle(12.5 + 50 * 1_000_000, cycleDefinition);
  const past = sampleAnimalAirFlockCycle(12.5 - 50 * 1_000, cycleDefinition);
  assertCycleClose(direct, farFuture, `${fixture.name}: far future reconstruction`);
  assertCycleClose(direct, past, `${fixture.name}: past reconstruction`);
  assert.ok(direct.replaySteps <= cycleDefinition.maximumReplaySteps);
  const closing = sampleAnimalAirFlockCycle(49.95, cycleDefinition);
  assert.ok(closing.members.every(member => member.mode === 'perched'), `${fixture.name}: cycle did not close at roost`);
  report[fixture.name] = { assignedPerches: 6, overflowHolding: 2, perchedStationary: true, distinctRoostSlots: true, departureUnified: true, deterministicAllocation: true, directUniversalTime: true, boundedCycleReplay: true };
}
console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));

function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(value, amount) { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function addScaled(origin, direction, amount) { return add(origin, scale(direction, amount)); }
function magnitude(value) { return Math.hypot(value.x, value.y, value.z); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function assertCycleClose(left, right, message) {
  assert.equal(left.phase, right.phase, message);
  assert.equal(left.members.length, right.members.length, message);
  for (let index = 0; index < left.members.length; index++) {
    assert.equal(left.members[index].id, right.members[index].id, message);
    assert.ok(distance(left.members[index].position, right.members[index].position) < 1e-5, message);
    assert.ok(distance(left.members[index].velocity, right.members[index].velocity) < 1e-5, message);
  }
}
