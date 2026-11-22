import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportGlb, getSolids, isValidSolid, OcctWasmAdapter, registerKernel, withScope } from 'brepjs';
import { build } from 'esbuild';
import { OcctKernel } from 'occt-wasm';
import { Color } from 'three';
import { params, withSweptHairParts } from '../../src/app/part/capsule-swept-hair.brep.ts';
import { meshBody } from '../mesh-body.mjs';

const out = resolve('artifacts/brep-swept-hair');
const presets = [
  { slug: 'concept', label: 'Concept fit', values: params.values },
  { slug: 'long-back', label: 'Shorter sweep, longer back', values: { crownSweep: 0, backLength: 58 } },
];
const headLocalMm = 100;
const palette = {
  hair: { name: 'Chestnut hair', baseColor: [...new Color('#75523b').toArray(), 1], roughness: .8 },
  mustache: { name: 'Chestnut mustache', baseColor: [...new Color('#674731').toArray(), 1], roughness: .78 },
};

function bake(parts, surface) {
  return withScope(scope => {
    const meshes = parts.filter(part => part.surface === surface).map(({ shape }) => {
      const solids = getSolids(shape).map(solid => scope.register(solid));
      if (solids.length !== 1 || !isValidSolid(solids[0])) throw new Error(`Invalid ${surface} body`);
      return meshBody(shape);
    });
    const vertices = new Float32Array(meshes.reduce((sum, body) => sum + body.vertices.length, 0));
    const normals = new Float32Array(vertices.length);
    const triangles = new Uint32Array(meshes.reduce((sum, body) => sum + body.triangles.length, 0));
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const body of meshes) {
      vertices.set(body.vertices.map(value => value / headLocalMm), vertexOffset);
      normals.set(body.normals, vertexOffset);
      triangles.set(body.triangles.map(index => index + vertexOffset / 3), indexOffset);
      vertexOffset += body.vertices.length;
      indexOffset += body.triangles.length;
    }
    const glb = exportGlb({
      vertices, normals, triangles, uvs: new Float32Array(),
      faceGroups: [{ start: 0, count: triangles.length, faceId: 0, origin: 0 }],
    }, { materials: new Map([[0, palette[surface]]]) });
    return { glb: Buffer.from(glb), triangles: triangles.length / 3 };
  });
}

async function save(file, { glb, triangles }) {
  await writeFile(resolve(out, file), glb);
  console.log({ file, triangles, bytes: glb.length });
  return glb.toString('base64');
}

await mkdir(out, { recursive: true });
const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));
const mustache = await save('swept-mustache.glb', withSweptHairParts(params.values, parts => bake(parts, 'mustache')));
const baked = [];
for (const { slug, label, values } of presets) {
  const asset = withSweptHairParts(values, parts => bake(parts, 'hair'));
  baked.push({ label, values, encoded: await save(`swept-hair-${slug}.glb`, asset) });
}

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
    ? `<figure><img alt="Swept hair concept, front, three-quarter and side" src="data:image/png;base64,${concept.toString('base64')}"></figure>`
    : '')
  .replace('<!-- ASSETS -->', () => `<script id="assets" type="application/json">${JSON.stringify({ presets: baked, mustache })}</script>`)
  .replace('<!-- PREVIEW -->', () => `<script type="module">${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(resolve(out, 'preview.html'), html);
