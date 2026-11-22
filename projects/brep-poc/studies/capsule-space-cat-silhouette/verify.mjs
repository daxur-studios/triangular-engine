import { getBounds, getSolids, isValidSolid, OcctWasmAdapter, registerKernel, withScope } from 'brepjs';
import { OcctKernel } from 'occt-wasm';
import buildCatSilhouette, { expected, params } from '../../src/app/part/capsule-space-cat-silhouette.brep.ts';

const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));

const { defs, values } = params;
const limits = definition => [definition.min, definition.max];
const cases = [values];
for (const headRise of limits(defs.headRise)) {
  for (const cheekFullness of limits(defs.cheekFullness)) {
    for (const blendLength of limits(defs.blendLength)) {
      cases.push({ headRise, cheekFullness, blendLength });
    }
  }
}

for (const variant of cases) {
  withScope(scope => {
    const shape = scope.register(buildCatSilhouette(variant));
    const solids = getSolids(shape).map(solid => scope.register(solid));
    const label = JSON.stringify(variant);
    if (solids.length !== 1 || !isValidSolid(solids[0])) {
      throw new Error(`${label} should produce one valid solid`);
    }
    const bounds = getBounds(shape);
    const want = expected(variant).bounds;
    for (const axis of ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax']) {
      const tolerance = Math.abs(want[axis]) * .01 + 1;
      if (Math.abs(bounds[axis] - want[axis]) > tolerance) {
        throw new Error(`${label} ${axis}: measured ${bounds[axis]}, expected ${want[axis]}`);
      }
    }
    console.log(`${label} ok`);
  });
}
