import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  exportGlb, getBounds, getSolids, isValidSolid, mesh, OcctWasmAdapter, registerKernel, withScope,
} from 'brepjs';
import { build } from 'esbuild';
import { OcctKernel } from 'occt-wasm';
import { chromium } from 'playwright';
import buildLeg, { params as legParams } from './probe-leg.brep.ts';
import buildHip, { params as hipParams } from './probe-hip.brep.ts';

const out = resolve('artifacts/brep-space-cat-silhouette');
const fur = { name: 'Cat fur', baseColor: [0.949, 0.78, 0.627, 1], roughness: .72 };

function meshLeg(shape) {
  const bounds = getBounds(shape);
  for (const [tolerance, angularTolerance] of [[1.2, .4], [.5, .25]]) {
    const data = mesh(shape, { tolerance, angularTolerance });
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.vertices.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], data.vertices[i]);
      max[axis] = Math.max(max[axis], data.vertices[i]);
    }
    const covers = ['x', 'y', 'z'].every((axis, index) =>
      Math.abs(bounds[`${axis}Min`] - min[index]) <= 4 && Math.abs(bounds[`${axis}Max`] - max[index]) <= 4);
    if (data.triangles.length > 0 && covers) return data;
  }
  throw new Error(`Leg tessellation lost part of the shape: ${JSON.stringify(bounds)}`);
}

function bake(buildShape, values) {
  return withScope(scope => {
    const shape = scope.register(buildShape({ ...values }));
    const solids = getSolids(shape).map(solid => scope.register(solid));
    if (solids.length !== 1 || !isValidSolid(solids[0])) throw new Error('Invalid probe shape');
    const data = meshLeg(shape);
    const materials = new Map();
    for (const group of data.faceGroups) materials.set(group.faceId, fur);
    const glb = exportGlb({
      vertices: new Float32Array(data.vertices.map(value => value / 1000)),
      normals: new Float32Array(data.normals),
      triangles: new Uint32Array(data.triangles),
      uvs: new Float32Array(),
      faceGroups: data.faceGroups,
    }, { materials });
    return { glb: Buffer.from(glb), triangles: data.triangles.length / 3 };
  });
}

const kernel = await OcctKernel.init();
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));

const varBody = { halfHeight: .34, targetY: -.12, targetZ: .12 };
const cases = [
  { label: 'No bevel', values: { joinFillet: 0 }, buildShape: buildLeg, base: legParams },
  { label: 'Bevel 30 mm', values: { joinFillet: 30 }, buildShape: buildLeg, base: legParams },
  { label: 'Bevel 60 mm', values: { joinFillet: 60 }, buildShape: buildLeg, base: legParams },
  { label: 'Hip · no bevel', values: { joinFillet: 0 }, buildShape: buildHip, base: hipParams, ...varBody },
  { label: 'Hip · 40 mm', values: { joinFillet: 40 }, buildShape: buildHip, base: hipParams, ...varBody },
  { label: 'Hip · 80 mm', values: { joinFillet: 80 }, buildShape: buildHip, base: hipParams, ...varBody },
];
const variants = cases.map(({ label, values, buildShape, base, halfHeight, targetY, targetZ }) => {
  const { glb, triangles } = bake(buildShape, { ...base.values, ...values });
  const bevel = values.joinFillet;
  console.log(`${label} | ${triangles} tris | ${glb.length} bytes`);
  return {
    label,
    caption: bevel === 0 ? 'Sharp join · hard crease ring' : `Filleted as one solid · ${triangles.toLocaleString()} tris`,
    encoded: glb.toString('base64'),
    halfHeight,
    targetY,
    targetZ,
  };
});

const [viewer] = await Promise.all([
  build({
    entryPoints: [resolve('projects/brep-poc/studies/capsule-space-cat-silhouette/probe-leg-view.ts')],
    tsconfig: resolve('projects/demo-app/tsconfig.app.json'),
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    target: 'es2022',
  }),
]);

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Leg and paw bevel probe</title>
<style>
  :root { color-scheme: light; color: #332622; background: #f6efe8; font: 16px/1.4 system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; }
  .legs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  section { background: #ede1d6; border-radius: 10px; overflow: hidden; }
  h2 { font-size: .98rem; margin: 10px 14px 4px; }
  canvas { display: block; width: 100%; height: 420px; }
  .caption { font-size: .86rem; margin: 4px 14px 10px; color: #604740; }
  [role=status] { font-size: .86rem; color: #604740; }
</style>
<div class="legs"></div>
<p role="status">Loading…</p>
<script id="variants" type="application/json">${JSON.stringify(variants)}</script>
<script type="module">${viewer.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>
</html>`;
await writeFile(resolve(out, 'leg-probe.html'), html);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1080 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(pathToFileURL(resolve(out, 'leg-probe.html')).href);
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.startsWith('Loaded'), null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.locator('.legs').screenshot({ path: resolve(out, 'leg-probe.png') });
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  console.log('Captured', resolve(out, 'leg-probe.png'));
} finally {
  await browser.close();
}
