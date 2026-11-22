import assert from 'node:assert/strict';
import { getBounds, getSolids, isValidSolid, OcctWasmAdapter, registerKernel, withScope } from 'brepjs';
import { OcctKernel } from 'occt-wasm';
import { params, withSweptHairParts } from '../../src/app/part/capsule-swept-hair.brep.ts';

const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));

const { defs, values } = params;
const cases = [values];
for (const crownSweep of [defs.crownSweep.min, defs.crownSweep.max]) {
  for (const backLength of [defs.backLength.min, defs.backLength.max]) {
    cases.push({ crownSweep, backLength });
  }
}

for (const variant of cases) {
  withSweptHairParts(variant, parts => withScope(scope => {
    const label = JSON.stringify(variant);
    const hair = parts.filter(part => part.surface === 'hair');
    const mustache = parts.filter(part => part.surface === 'mustache');
    assert.equal(hair.length, 19);
    assert.equal(mustache.length, 2);
    for (const { shape, surface } of parts) {
      const solids = getSolids(shape).map(solid => scope.register(solid));
      assert.ok(solids.length === 1 && isValidSolid(solids[0]), `${label} has an invalid ${surface} body`);
    }
    const bounds = hair.map(({ shape }) => getBounds(shape));
    const hem = Math.min(...bounds.map(({ zMin }) => zMin));
    const sweepTip = Math.max(...bounds.map(({ xMax }) => xMax));
    assert.ok(Math.abs(hem - (153 - .8 * variant.backLength)) < .3, `${label} has the wrong under-ear lock length`);
    assert.ok(Math.abs(sweepTip - Math.max(170, 148 + variant.crownSweep)) < .3, `${label} has the wrong crown sweep`);
    console.log(`${label} ok`);
  }));
}
