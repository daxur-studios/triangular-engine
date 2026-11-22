import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const here = import.meta.dirname;
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const out = resolve(root, 'artifacts/brep-bob');
const reference = process.argv[2];

const { outputFiles: [script] } = await build({
  entryPoints: [resolve(here, 'preview.ts')],
  tsconfig: resolve(root, 'projects/demo-app/tsconfig.app.json'),
  absWorkingDir: root,
  bundle: true,
  minify: true,
  write: false,
  format: 'esm',
  target: 'es2022',
  external: ['node:*', 'fs', 'path', 'module'],
});

const [template, wasm, concept] = await Promise.all([
  readFile(resolve(here, 'preview.html'), 'utf8'),
  readFile(require.resolve('occt-wasm/dist/occt-wasm.wasm')),
  reference ? readFile(reference) : null,
]);
const html = template
  .replace('<!-- REFERENCE -->', concept
    ? `<figure><img alt="Supplied bob turnaround, front, side and back" src="data:image/png;base64,${concept.toString('base64')}"></figure>`
    : '')
  .replace('<!-- WASM -->', () => `<script id="kernel" type="application/octet-stream">${wasm.toString('base64')}</script>`)
  .replace('<!-- PREVIEW -->', () => `<script type="module">${script.text.replace(/<\/script/gi, '<\\/script')}</script>`);
await mkdir(out, { recursive: true });
const file = resolve(out, 'preview.html');
await writeFile(file, html);
console.log(file);
