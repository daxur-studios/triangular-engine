// Loads the framework-free probe and projection code from triangular-engine/characters for the
// headless fit tools. The TypeScript is bundled in memory with esbuild, so nothing is written to
// disk and the tools always run the same code the engine ships.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
let cached;

/** Returns the bundled core module: probes, camera projection and the default DNA. */
export function loadCore() {
  cached ??= build({
    entryPoints: [path.join(here, 'core-entry.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  }).then((result) => {
    const source = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  });
  return cached;
}
