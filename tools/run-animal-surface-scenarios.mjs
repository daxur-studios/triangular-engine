import '@angular/compiler';
import assert from 'node:assert/strict';

const [{ TerrainAnimalWorldSurface }, terrain] = await Promise.all([
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-terrain.mjs'),
]);

const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;
const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const magnitude = ({ x, y, z }) => Math.hypot(x, y, z);

const plane = new TerrainAnimalWorldSurface(
  new ConstantTerrainField(7),
  new PlaneTerrainDomain(100),
);
const planeStart = plane.sample({ x: -250.5, y: 90, z: 375.25 });
const planeMoved = plane.moveAlongSurface(planeStart.position, { x: 10, y: 50, z: -20 }, 2);
assert.deepEqual(planeStart.position, { x: -250.5, y: 7, z: 375.25 });
assert.deepEqual(planeMoved, { x: -230.5, y: 7, z: 335.25 });

const sphereRadius = 1_000;
const sphere = new TerrainAnimalWorldSurface(
  new ConstantTerrainField(5),
  new SphereTerrainDomain(sphereRadius),
);
const sphereStart = sphere.sample({ x: sphereRadius, y: 0, z: 0 });
const sphereMoved = sphere.moveAlongSurface(sphereStart.position, { x: 0, y: 30, z: 0 }, 1);
close(magnitude(sphereStart.position), sphereRadius + 5);
close(magnitude(sphereMoved), sphereRadius + 5);
assert.ok(sphereStart.surfaceUp.x > 0.999);

const cylinderRadius = 500;
const cylinder = new TerrainAnimalWorldSurface(
  new ConstantTerrainField(10),
  new CylinderTerrainDomain({ radiusM: cylinderRadius, lengthM: 2_000 }),
);
const seamAngle = Math.PI * 2 - 0.01;
const cylinderStart = cylinder.sample({
  x: 0,
  y: cylinderRadius * Math.cos(seamAngle),
  z: cylinderRadius * Math.sin(seamAngle),
});
const cylinderMoved = cylinder.moveAlongSurface(cylinderStart.position, { x: 0, y: 0, z: 20 }, 1);
close(Math.hypot(cylinderMoved.y, cylinderMoved.z), cylinderRadius - 10);
assert.ok(cylinderStart.surfaceUp.y < -0.999);
assert.ok(cylinderMoved.z > 0, 'Cylinder movement did not cross the periodic angular seam.');

console.log(JSON.stringify({
  passed: true,
  shapes: {
    plane: { infiniteNegativeCoordinates: true, surfaceUp: planeStart.surfaceUp },
    sphere: { radiusM: magnitude(sphereMoved), surfaceUp: sphereStart.surfaceUp },
    cylinder: { radiusM: Math.hypot(cylinderMoved.y, cylinderMoved.z), seamWrapped: true, surfaceUp: cylinderStart.surfaceUp },
  },
}, null, 2));
