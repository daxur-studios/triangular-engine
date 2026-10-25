#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFingerprint, loadConfig } from '../projects/triangular-engine/bin/triangular-test-receiver.mjs';
import { inspectDocuments } from './engineering-records.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'projects/demo-app/public/development-map/manifest.json');
const { manifest, errors } = await inspectDocuments(root);
if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exitCode = 1;
} else {
  const config = loadConfig(root);
  const payload = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    currentFingerprint: computeFingerprint(root, config.fingerprintPaths).hash,
    diagnostics: errors,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(root, output)} (${manifest.documents.length} plans)`);
}
