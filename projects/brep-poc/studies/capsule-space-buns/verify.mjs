import { getBounds, getSolids, isValidSolid, OcctWasmAdapter, registerKernel, withScope } from 'brepjs';
import { OcctKernel } from 'occt-wasm';
import buildSpaceBuns, { expected, params } from '../../src/app/part/capsule-space-buns.brep.ts';

const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));

const { defs, values } = params;
const limits = definition => [definition.min, definition.max];
const cases = [values];
for (const bunSize of limits(defs.bunSize)) {
  for (const leftLift of limits(defs.leftLift)) {
    for (const rightLift of limits(defs.rightLift)) {
      for (const lockLength of limits(defs.lockLength)) {
        cases.push({ bunSize, leftLift, rightLift, lockLength });
      }
    }
  }
}

for (const variant of cases) {
  withScope(scope => {
    const shape = scope.register(buildSpaceBuns(variant));
    const solids = getSolids(shape).map(solid => scope.register(solid));
    const label = JSON.stringify(variant);
    if (solids.length !== 15 || solids.some(solid => !isValidSolid(solid))) {
      throw new Error(`${label} should produce 15 valid solids`);
    }
    const { xMin, xMax, zMin } = getBounds(shape);
    const hem = expected(variant).bounds.zMin;
    const xShift = .42 * (variant.leftLift - variant.rightLift);
    if (Math.abs(zMin - hem) > .1 || Math.abs(xMin + xMax - xShift) > .1) {
      throw new Error(`${label} has an unexpected hem or bun placement`);
    }
    console.log(`${label} ok`);
  });
}
