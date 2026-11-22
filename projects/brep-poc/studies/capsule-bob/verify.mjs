import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getBounds, getSolids, isValidSolid, OcctWasmAdapter, registerKernel, withScope } from 'brepjs';
import { OcctKernel } from 'occt-wasm';
import buildBob, { expected, params } from '../../src/app/part/capsule-bob.brep.ts';

const part = 'projects/brep-poc/src/app/part/capsule-bob.brep.ts';
const cli = 'node_modules/brepjs-cad/dist/cli/main.js';
const out = 'artifacts/brep-bob';
mkdirSync(out, { recursive: true });

const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));

const { values, defs } = params;
const cases = [values, { ...values, notchDepth: 0 }];
for (const length of [0, 80]) {
  for (const flare of [0, 35]) {
    for (const fringe of [0, 35]) {
      for (const notchDepth of [defs.notchDepth.min, defs.notchDepth.step, defs.notchDepth.max]) {
        cases.push({ length, flare, fringe, notchDepth });
      }
    }
  }
}
for (const variant of cases) {
  const label = Object.entries(variant).map(([key, value]) => `${key}=${value}`).join(' ');
  withScope(scope => {
    const shape = scope.register(buildBob(variant));
    const solids = getSolids(shape).map(solid => scope.register(solid));
    if (solids.length !== 1 || !isValidSolid(solids[0])) throw new Error(`${label}: expected one valid solid`);
    const bounds = getBounds(shape);
    for (const [key, value] of Object.entries(expected(variant).bounds)) {
      if (Math.abs(bounds[key] - value) > 0.01) throw new Error(`${label}: ${key} should be ${value}, got ${bounds[key]}`);
    }
  });
  console.log(label, 'ok');
}

// The CLI also checks the part's types and computes exact mass properties.
const { status, stdout, stderr } = spawnSync(process.execPath, [cli, 'verify', part, '--check'], { encoding: 'utf8' });
if (status !== 0 || !JSON.parse(stdout).topology?.manifold) throw new Error(stderr + stdout);
writeFileSync(`${out}/default.json`, stdout);
console.log('Default CLI report ok');
