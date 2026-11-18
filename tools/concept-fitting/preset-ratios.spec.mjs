import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { loadCore } from './load-core.mjs';
import { BASELINE_FILE, drift, ratioTable, sharedFromDna } from './preset-ratios.mjs';

const core = await loadCore();
const table = ratioTable(core);
const accepted = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).presets;

test('the ratio table covers every preset and matches the accepted table', () => {
  assert.equal(Object.keys(table).length, core.ALL_CAPSULE_CHARACTER_PRESETS.length);
  assert.deepEqual(drift(table, accepted), []);
});

test('a moved ratio, a new preset and a removed preset are all reported', () => {
  const moved = structuredClone(table);
  moved['concept-fit-goofy'].eyeSeparation += 0.01;
  moved['brand-new'] = moved['concept-fit-goofy'];
  delete moved['curly-pigtails'];
  const report = drift(moved, accepted).join('\n');
  assert.match(report, /concept-fit-goofy\.eyeSeparation/);
  assert.match(report, /brand-new: not in the accepted table/);
  assert.match(report, /curly-pigtails: in the accepted table but no longer a preset/);
});

test('the three concept-fit presets are in the catalogue and are valid DNA', () => {
  for (const id of ['orange-pigtails', 'goofy', 'variant-c']) {
    const dna = core.ALL_CAPSULE_CHARACTER_PRESETS.find((p) => p.id === `concept-fit-${id}`);
    assert.ok(dna, id);
    assert.ok(dna.eyeSpacing >= 0.22 && dna.eyeSpacing <= 0.55);
    assert.ok(dna.bodyHeight >= 0.55 && dna.bodyHeight <= 1.4);
    assert.ok(Math.abs(dna.gazeAsymmetryYaw) <= 1.2);
  }
});

test('turning a preset back into fit parameters keeps what the DNA says and the fit\'s own mouth width', () => {
  const dna = core.ALL_CAPSULE_CHARACTER_PRESETS.find((p) => p.id === 'concept-fit-goofy');
  const shared = sharedFromDna(dna, { mouthWidth: 0.3, eyeSpacing: 9 });
  assert.equal(shared.eyeSpacing, dna.eyeSpacing);
  assert.equal(shared.mouthWidth, 0.3);
  assert.ok(Math.abs(shared.gazeYawRight - shared.gazeYawLeft - dna.gazeAsymmetryYaw) < 1e-9);
});
