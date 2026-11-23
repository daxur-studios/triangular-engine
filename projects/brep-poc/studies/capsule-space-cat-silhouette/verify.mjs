import { getBounds, getSolids, isValidSolid, OcctWasmAdapter, registerKernel, withScope } from 'brepjs';
import { OcctKernel } from 'occt-wasm';
import buildFatCat, { expected as fatExpected, params as fatParams } from '../../src/app/part/capsule-space-cat-fat.brep.ts';
import buildCatLeg, { expected as legExpected, params as legParams } from '../../src/app/part/capsule-space-cat-leg.brep.ts';
import buildTubeCat, { expected as tubeExpected, params as tubeParams } from '../../src/app/part/capsule-space-cat-tube.brep.ts';

const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));

function casesFor({ values, defs }) {
  const cases = [{ label: 'defaults', values }];
  for (const [key, definition] of Object.entries(defs)) {
    for (const [edge, value] of [['min', definition.min], ['max', definition.max]]) {
      cases.push({ label: `${key}=${edge}`, values: { ...values, [key]: value } });
    }
  }
  const lowest = { ...values };
  const highest = { ...values };
  for (const [key, definition] of Object.entries(defs)) {
    lowest[key] = definition.min;
    highest[key] = definition.max;
  }
  cases.push({ label: 'all min', values: lowest }, { label: 'all max', values: highest });
  return cases;
}

const parts = [
  { name: 'fat cat', build: buildFatCat, expected: fatExpected, params: fatParams },
  { name: 'tube and sphere', build: buildTubeCat, expected: tubeExpected, params: tubeParams },
  { name: 'leg and paw', build: buildCatLeg, expected: legExpected, params: legParams },
];

let failures = 0;
for (const part of parts) {
  for (const { label, values } of casesFor(part.params)) {
    try {
      withScope(scope => {
        const shape = scope.register(part.build(values));
        const solids = getSolids(shape).map(solid => scope.register(solid));
        if (solids.length !== 1 || !isValidSolid(solids[0])) {
          throw new Error('should produce one valid solid');
        }
        const bounds = getBounds(shape);
        const want = part.expected(values).bounds;
        for (const axis of ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax']) {
          const tolerance = Math.abs(want[axis]) * .01 + 1;
          if (Math.abs(bounds[axis] - want[axis]) > tolerance) {
            throw new Error(`${axis}: measured ${bounds[axis]}, expected ${want[axis]}`);
          }
        }
      });
      console.log(`${part.name} · ${label} ok`);
    } catch (error) {
      failures += 1;
      console.error(`${part.name} · ${label} FAILED: ${String(error)}`);
    }
  }
}
if (failures) {
  console.error(`${failures} case(s) failed`);
  process.exitCode = 1;
}
