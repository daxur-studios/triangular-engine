import assert from 'node:assert/strict';
import {
  createPlane, getBounds, getSolids, isValidSolid, makePlane, OcctWasmAdapter, registerKernel,
  section, unwrap, vecNormalize, withScope,
} from 'brepjs';
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
    const { crownSweep, backLength } = variant;
    const bounds = hair.map(({ shape }) => getBounds(shape));
    assert.ok(Math.abs(bounds[4].xMax - (151 + crownSweep)) < .3, `${label} has the wrong crown sweep`);
    for (const [index, tipHeight] of [[10, 158], [11, 153]]) {
      assert.ok(Math.abs(bounds[index].zMin - (tipHeight - .8 * backLength)) < .3,
        `${label} has the wrong under-ear lock length`);
    }

    const sectionBounds = (index, plane) => getBounds(scope.register(unwrap(section(hair[index].shape, plane))));
    // Sample the crown, the nape and the rising tail of the main rear lock in side projection.
    const [bulge, nape, flick] = [335, 215 - .65 * backLength, 159 - backLength]
      .map(z => sectionBounds(17, makePlane('XY', [0, 0, z])).yMax);
    assert.ok(bulge > nape + 12 && flick > nape + 10, `${label} lost the S-curve in profile`);
    assert.ok(bounds[17].zMin < 159 - backLength - 6, `${label} lost the lift at the back tip`);
    assert.ok(bounds.slice(12).every(b => b.zMax < 435), `${label} has a rear loft that overshoots its root`);

    // Cut progressively closer to each fringe tip to catch lofts that widen again near the end.
    for (const [index, tip, direction] of [
      [4, [151 + crownSweep, -130, 366], [38, -5, -31]],
      [5, [-4 + .38 * crownSweep, -149, 351], [-4, -5, -16]],
      [6, [-141, -125, 339], [-15, -2, -16]],
    ]) {
      const axis = vecNormalize(direction);
      const [base, middle, end] = [22, 12, 4].map(distance => {
        const origin = tip.map((coordinate, i) => coordinate - distance * axis[i]);
        const b = sectionBounds(index, createPlane(origin, null, axis));
        return Math.hypot(b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin);
      });
      assert.ok(base > middle && middle > end && end > 0, `${label} has a flared fringe tip at lock ${index}`);
    }
    console.log(`${label} ok`);
  }));
}
