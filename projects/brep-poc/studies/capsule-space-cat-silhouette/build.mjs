import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  exportGlb, getBounds, getSolids, isValidSolid, mesh, OcctWasmAdapter, registerKernel, withScope,
} from 'brepjs';
import { build } from 'esbuild';
import { OcctKernel } from 'occt-wasm';
import { Color } from 'three';
import buildFatCat, { params as fatParams, rigAnchor as fatAnchor } from '../../src/app/part/capsule-space-cat-fat.brep.ts';
import buildCatLeg, { params as legParams, restPose as legRestPose } from '../../src/app/part/capsule-space-cat-leg.brep.ts';
import buildTubeCat, { params as tubeParams, rigAnchor as tubeAnchor } from '../../src/app/part/capsule-space-cat-tube.brep.ts';
import buildRearHip, { params as rearHipParams, restPose as rearHipRestPose } from './rear-hip.brep.ts';
import buildFusedTail, { params as fusedTailParams } from './fused-tail.brep.ts';

const out = resolve('artifacts/brep-space-cat-silhouette');
// The tube's front tip is fixed inside the head, so a length change only moves
// the rump. The Concept Fit's hind legs and tail were fitted to this body, and
// the preview slides them by the same amount.
const referenceBodyLength = 900;
const rearExtension = values => values.bodyLength === undefined
  ? 0
  : (values.bodyLength - referenceBodyLength) / 1000;
const tubeValues = (overrides = {}) => ({ ...tubeParams.values, ...overrides });
const presets = [
  {
    slug: 'fat', label: 'Fat cat (kept option)',
    build: buildFatCat, values: fatParams.values, anchor: fatAnchor(fatParams.values),
    caption: 'Fused head and body balls · join 85 mm',
  },
  {
    slug: 'tube-short', label: 'Tube · short',
    build: buildTubeCat, values: tubeValues({ bodyLength: 780 }), anchor: tubeAnchor(tubeValues({ bodyLength: 780 })),
    caption: 'Tube and sphere · body 780 mm · bevel 135 mm',
  },
  {
    slug: 'tube-default', label: 'Tube · default length',
    build: buildTubeCat, values: tubeValues(), anchor: tubeAnchor(tubeValues()),
    caption: 'Tube and sphere · body 900 mm · bevel 135 mm',
  },
  {
    slug: 'tube-long', label: 'Tube · long',
    build: buildTubeCat, values: tubeValues({ bodyLength: 1100 }), anchor: tubeAnchor(tubeValues({ bodyLength: 1100 })),
    caption: 'Tube and sphere · body 1100 mm · bevel 135 mm',
  },
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
function bake(buildCat, values) {
  return withScope(scope => {
    const shape = scope.register(buildCat(values));
    const solids = getSolids(shape).map(solid => scope.register(solid));
    if (solids.length !== 1 || !isValidSolid(solids[0])) throw new Error('Invalid cat body');
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
const baked = await Promise.all(presets.map(async ({ slug, label, build, values, anchor, caption }) => {
  const { glb, triangles } = bake(build, values);
  const file = `space-cat-${slug}.glb`;
  await writeFile(resolve(out, file), glb);
  const rear = rearExtension(values);
  const stats = { file, label, caption, values, anchor, rearExtension: rear, triangles, bytes: glb.length };
  console.log(label, '|', caption, '| rear', rear.toFixed(3), 'm |', triangles, 'tris');
  return { ...stats, encoded: glb.toString('base64') };
}));

const legBake = bake(buildCatLeg, legParams.values);
await writeFile(resolve(out, 'space-cat-leg.glb'), legBake.glb);
const leg = {
  encoded: legBake.glb.toString('base64'),
  triangles: legBake.triangles,
  ...legRestPose(legParams.values),
};
console.log('Leg |', `bevel ${legParams.values.joinFillet} mm`, '|', leg.triangles, 'tris');

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
  .replace('<!-- LEG -->', () => `<script id="leg" type="application/json">${JSON.stringify(leg)}</script>`)
  .replace('<!-- PREVIEW -->', () => `<script type="module">${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(resolve(out, 'preview.html'), html);
console.log(resolve(out, 'preview.html'));

// The walking page: the same default body twice, one with baked legs, one with
// the stock hose. The video recipe drives the gait through `window.__walk`.
const [walkTemplate, walkBundle] = await Promise.all([
  readFile(new URL('walk.html', import.meta.url), 'utf8'),
  build({
    entryPoints: [resolve(import.meta.dirname, 'walk.ts')],
    tsconfig: resolve('projects/demo-app/tsconfig.app.json'),
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    target: 'es2022',
  }),
]);
const walkBody = baked.find(entry => entry.file === 'space-cat-tube-default.glb');
if (!walkBody) throw new Error('The walk page needs the default tube body');
const hipBake = bake(buildRearHip, rearHipParams.values);
await writeFile(resolve(out, 'space-cat-rear-hip.glb'), hipBake.glb);
const rearHip = { encoded: hipBake.glb.toString('base64'), ...rearHipRestPose };
console.log('Fused rear hip |', `${rearHipParams.values.hipFillet} mm fillet |`, hipBake.triangles, 'tris');
const walkHtml = walkTemplate
  .replace('<!-- BODY -->', () => `<script id="body" type="application/json">${JSON.stringify(walkBody)}</script>`)
  .replace('<!-- LEG -->', () => `<script id="leg" type="application/json">${JSON.stringify(leg)}</script>`)
  .replace('<!-- WALK -->', () => `<script type="module">${walkBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(resolve(out, 'walk.html'), walkHtml);
console.log(resolve(out, 'walk.html'));
const hipHtml = walkHtml
  .replace('<title>Capsule space cat legs, walking</title>', '<title>Space Cat rear hip comparison</title>')
  .replace('<!-- REAR_HIP -->', () => `<script id="rear-hip" type="application/json">${JSON.stringify(rearHip)}</script>`);
await writeFile(resolve(out, 'rear-hip.html'), hipHtml);
console.log(resolve(out, 'rear-hip.html'));

const fusedLegsBake = bake(buildRearHip, { ...rearHipParams.values, allLegs: true });
await writeFile(resolve(out, 'space-cat-fused-legs.glb'), fusedLegsBake.glb);
const fusedLegs = { encoded: fusedLegsBake.glb.toString('base64') };
const legsScript = () => `<script id="fused-legs" type="application/json">${JSON.stringify(fusedLegs)}</script>`;
await writeFile(resolve(out, 'fused-legs.html'), hipHtml
  .replace('<title>Space Cat rear hip comparison</title>', '<title>Space Cat fused legs comparison</title>')
  .replace('<!-- FUSED_LEGS -->', legsScript));
console.log('Fused legs |', fusedLegsBake.triangles, 'tris |', resolve(out, 'fused-legs.html'));

const fusedTailBake = bake(buildFusedTail, fusedTailParams.values);
await writeFile(resolve(out, 'space-cat-fused-tail.glb'), fusedTailBake.glb);
const fusedTail = { encoded: fusedTailBake.glb.toString('base64') };
await writeFile(resolve(out, 'fused-tail.html'), walkHtml
  .replace('<title>Capsule space cat legs, walking</title>', '<title>Space Cat fused tail comparison</title>')
  .replace('<!-- FUSED_LEGS -->', legsScript)
  .replace('<!-- FUSED_TAIL -->', () => `<script id="fused-tail" type="application/json">${JSON.stringify(fusedTail)}</script>`));
console.log('Fused tail |', fusedTailBake.triangles, 'tris |', resolve(out, 'fused-tail.html'));

if (process.argv.includes('--experiments')) {
  const { default: buildJoinedCat, params: joinedParams } = await import('./joined-cat.brep.ts');
  const joinedBake = bake(buildJoinedCat, joinedParams.values);
  await writeFile(resolve(out, 'space-cat-joined.glb'), joinedBake.glb);
  const joined = { encoded: joinedBake.glb.toString('base64') };
  console.log('Joined legs and tail |', joinedBake.triangles, 'tris');
  const joinedHtml = hipHtml
    .replace('<title>Space Cat rear hip comparison</title>', '<title>Space Cat joined legs and tail</title>')
    .replace('<!-- JOINED_CAT -->', () => `<script id="joined-cat" type="application/json">${JSON.stringify(joined)}</script>`);
  await writeFile(resolve(out, 'joined-cat.html'), joinedHtml);
  console.log(resolve(out, 'joined-cat.html'));

  const conceptBake = bake(buildJoinedCat, { ...joinedParams.values, compact: true });
  await writeFile(resolve(out, 'space-cat-concept-fit.glb'), conceptBake.glb);
  const conceptFit = { encoded: conceptBake.glb.toString('base64') };
  await writeFile(resolve(out, 'concept-fit.html'), joinedHtml
    .replace('<title>Space Cat joined legs and tail</title>', '<title>Space Cat concept proportions</title>')
    .replace('<!-- CONCEPT_CAT -->', () => `<script id="concept-cat" type="application/json">${JSON.stringify(conceptFit)}</script>`));
  console.log('Concept fit |', conceptBake.triangles, 'tris |', resolve(out, 'concept-fit.html'));
}
