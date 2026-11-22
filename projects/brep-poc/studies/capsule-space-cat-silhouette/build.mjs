import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  exportGlb, getBounds, getSolids, isValidSolid, mesh, OcctWasmAdapter, registerKernel, withScope,
} from 'brepjs';
import { build } from 'esbuild';
import { OcctKernel } from 'occt-wasm';
import { Color } from 'three';
import buildCatSilhouette, { params, rigAnchor } from '../../src/app/part/capsule-space-cat-silhouette.brep.ts';

const out = resolve('artifacts/brep-space-cat-silhouette');
const presets = [
  { slug: 'revised-subtle', label: 'Revised · subtle rise', values: params.values },
  { slug: 'revised-higher', label: 'Revised · higher head', values: { ...params.values, headRise: 70 } },
];
const millimetersPerMeter = 1000;
const fur = { name: 'Cat fur', baseColor: [...new Color('#f2c7a0').toArray(), 1], roughness: .72 };

function meshBody(shape) {
  const bounds = getBounds(shape);
  // A smooth loft can lose the pole patch when the tessellation misses it.
  // Require the rendered vertices to cover the CAD extents.
  for (const [tolerance, angularTolerance] of [[1.5, .5], [.6, .3]]) {
    const data = mesh(shape, { tolerance, angularTolerance });
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.vertices.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], data.vertices[i]);
      max[axis] = Math.max(max[axis], data.vertices[i]);
    }
    const covers = ['x', 'y', 'z'].every((axis, index) =>
      Math.abs(bounds[`${axis}Min`] - min[index]) <= 6 && Math.abs(bounds[`${axis}Max`] - max[index]) <= 6);
    if (data.triangles.length > 0 && covers) return data;
  }
  throw new Error(`Cat silhouette tessellation lost part of the body: ${JSON.stringify(bounds)}`);
}

// OCCT duplicates the loft's seam vertices, which shows as a shading band.
// Weld coincident vertices and average their normals before export.
function weld(data) {
  const count = data.vertices.length / 3;
  const remap = new Uint32Array(count);
  const lookup = new Map();
  const vertices = [];
  const normals = [];
  for (let i = 0; i < count; i++) {
    const x = data.vertices[3 * i];
    const y = data.vertices[3 * i + 1];
    const z = data.vertices[3 * i + 2];
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    let target = lookup.get(key);
    if (target === undefined) {
      target = vertices.length / 3;
      lookup.set(key, target);
      vertices.push(x, y, z);
      normals.push(data.normals[3 * i], data.normals[3 * i + 1], data.normals[3 * i + 2]);
    } else {
      normals[3 * target] += data.normals[3 * i];
      normals[3 * target + 1] += data.normals[3 * i + 1];
      normals[3 * target + 2] += data.normals[3 * i + 2];
    }
    remap[i] = target;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return {
    vertices,
    normals,
    triangles: Array.from(data.triangles, index => remap[index]),
    faceGroups: data.faceGroups,
  };
}

// Bake millimetres to the engine's metres here, once. The GLB exporter adds
// the Z-up to Y-up rotation, so the preview loads the exact delivered file.
function bake(values) {
  return withScope(scope => {
    const shape = scope.register(buildCatSilhouette(values));
    const solids = getSolids(shape).map(solid => scope.register(solid));
    if (solids.length !== 1 || !isValidSolid(solids[0])) throw new Error('Invalid cat silhouette body');
    const data = weld(meshBody(shape));
    const vertices = new Float32Array(data.vertices.map(value => value / millimetersPerMeter));
    const materials = new Map();
    for (const group of data.faceGroups) materials.set(group.faceId, fur);
    const glb = exportGlb({
      vertices,
      normals: new Float32Array(data.normals),
      triangles: new Uint32Array(data.triangles),
      uvs: new Float32Array(),
      faceGroups: data.faceGroups,
    }, { materials });
    return { glb: Buffer.from(glb), triangles: data.triangles.length / 3 };
  });
}

await mkdir(out, { recursive: true });
const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));
const baked = await Promise.all(presets.map(async ({ slug, label, values }) => {
  const { glb, triangles } = bake(values);
  const file = `space-cat-${slug}.glb`;
  await writeFile(resolve(out, file), glb);
  const anchor = rigAnchor(values);
  const stats = { file, label, values, anchor, triangles, bytes: glb.length };
  console.log(stats);
  return { ...stats, encoded: glb.toString('base64') };
}));

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
  readFile(resolve('artifacts/space-cat-turnaround/concept.jpg')),
]);
const html = template
  .replace('<!-- REFERENCE -->', `<figure><img alt="Concept sheet, five views of the capsule space cat" src="data:image/png;base64,${concept.toString('base64')}"></figure>`)
  .replace('<!-- ASSETS -->', () => `<script id="presets" type="application/json">${JSON.stringify(baked)}</script>`)
  .replace('<!-- PREVIEW -->', () => `<script type="module">${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(resolve(out, 'preview.html'), html);
console.log(resolve(out, 'preview.html'));
