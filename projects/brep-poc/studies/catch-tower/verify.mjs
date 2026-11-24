import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { armProfiles } from './catch-arm.brep.ts';

const packageRoot = new URL('../', import.meta.resolve('brepjs-cad'));
const packageInfo = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
const cli = fileURLToPath(new URL(packageInfo.bin.brep, packageRoot));
const output = resolve('artifacts/brep-catch-tower');
await mkdir(output, { recursive: true });

async function verify(name, file, overrides = {}) {
  const destination = resolve(output, `${name}.json`);
  const path = resolve(import.meta.dirname, file);
  const flags = Object.entries(overrides).flatMap(([key, value]) => ['--param', `${key}=${value}`]);
  const result = spawnSync(process.execPath, [cli, 'verify', path, '--check', '--json', destination, ...flags], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const report = JSON.parse(await readFile(destination, 'utf8'));
  const checks = Array.isArray(report) ? report : [report];
  if (checks.length === 0 || !checks.every(entry => entry.ok)) throw new Error(`CAD verification failed: ${destination}`);
  console.log(`${name}: ${checks.length} passed`);
}

await verify('defaults', '*.brep.ts');
for (const file of ['catch-arm', 'catch-arm-mirrored']) {
  await verify(`${file}-min`, `${file}.brep.ts`, armProfiles.slim);
  await verify(`${file}-max`, `${file}.brep.ts`, armProfiles.deep);
}
