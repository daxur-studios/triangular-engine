import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportGlb, getSolids, isValidSolid, OcctWasmAdapter, registerKernel, withScope } from 'brepjs';
import { build } from 'esbuild';
import { OcctKernel } from 'occt-wasm';
import { Color } from 'three';
import { params, withSpaceBunParts } from '../../src/app/part/capsule-space-buns.brep.ts';
import { meshBody } from '../mesh-body.mjs';

const out = resolve('artifacts/brep-space-buns');
const presets = [
  { slug: 'classic', label: 'Classic', values: params.values },
  { slug: 'full', label: 'Full buns, long locks', values: { bunSize: 118, rightLift: -14, leftLift: -5, lockLength: 238 } },
];
const palette = new Map([
  ['hair', { name: 'Rose hair', baseColor: [...new Color('#b27671').toArray(), 1], roughness: .78 }],
  ['tie', { name: 'Hair ties', baseColor: [...new Color('#695044').toArray(), 1], roughness: .89 }],
]);
const headLocalMm = 100;

// Combine already valid BRep bodies into one indexed GLB with two material
// primitives. The exporter adds the Z-up to Y-up rotation and we bake the
// millimetres-to-head-local scale here, once for every consumer.
function bake(values) {
  return withSpaceBunParts(values, parts => withScope(scope => {
    const meshes = parts.map(({ shape, surface }) => {
      const solids = getSolids(shape).map(solid => scope.register(solid));
      if (solids.length !== 1 || !isValidSolid(solids[0])) throw new Error('Invalid space-bun body');
      return { surface, ...meshBody(shape) };
    });
    const vertexValues = meshes.reduce((sum, body) => sum + body.vertices.length, 0);
    const indexCount = meshes.reduce((sum, body) => sum + body.triangles.length, 0);
    const vertices = new Float32Array(vertexValues);
    const normals = new Float32Array(vertexValues);
    const triangles = new Uint32Array(indexCount);
    const faceGroups = [];
    const materials = new Map();
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const [surface, material] of palette) {
      const start = indexOffset;
      for (const body of meshes.filter(body => body.surface === surface)) {
        vertices.set(body.vertices.map(value => value / headLocalMm), vertexOffset);
        normals.set(body.normals, vertexOffset);
        triangles.set(body.triangles.map(index => index + vertexOffset / 3), indexOffset);
        vertexOffset += body.vertices.length;
        indexOffset += body.triangles.length;
      }
      const faceId = faceGroups.length;
      faceGroups.push({ start, count: indexOffset - start, faceId, origin: 0 });
      materials.set(faceId, material);
    }
    const glb = exportGlb({ vertices, normals, triangles, uvs: new Float32Array(), faceGroups }, { materials });
    return { glb: Buffer.from(glb), triangles: indexCount / 3, solids: parts.length };
  }));
}

await mkdir(out, { recursive: true });
const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));
const baked = await Promise.all(presets.map(async ({ slug, label, values }) => {
  const { glb, triangles, solids } = bake(values);
  const file = `space-buns-${slug}.glb`;
  await writeFile(resolve(out, file), glb);
  const stats = { file, label, values, solids, triangles, bytes: glb.length };
  console.log(stats);
  return { ...stats, encoded: glb.toString('base64') };
}));

const reference = process.argv[2];
const [template, result, concept] = await Promise.all([
  readFile(new URL('preview.html', import.meta.url), 'utf8'),
  build({
    entryPoints: [resolve(import.meta.dirname, 'preview.ts')],
    tsconfig: resolve('projects/demo-app/tsconfig.app.json'),
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    target: 'es2022',
  }),
  reference ? readFile(reference) : null,
]);
const html = template
  .replace('<!-- REFERENCE -->', concept
    ? `<figure><img alt="Space buns concept, front, side and back" src="data:image/png;base64,${concept.toString('base64')}"></figure>`
    : '')
  .replace('<!-- ASSETS -->', () => `<script id="presets" type="application/json">${JSON.stringify(baked)}</script>`)
  .replace('<!-- PREVIEW -->', () => `<script type="module">${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(resolve(out, 'preview.html'), html);
console.log(resolve(out, 'preview.html'));
