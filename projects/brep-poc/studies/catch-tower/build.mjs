import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportGlb, getBounds, isValidSolid, OcctWasmAdapter, registerKernel } from 'brepjs';
import { build } from 'esbuild';
import { OcctKernel } from 'occt-wasm';
import { Color } from 'three';
import { meshBody } from '../mesh-body.mjs';
import { armProfiles, withArmBodies } from './catch-arm.brep.ts';
import { withBoosterBodies } from './booster-proxy.brep.ts';
import { withCarriageBodies } from './carriage.brep.ts';
import { withTowerBodies } from './tower.brep.ts';
import { armPose, armSides, booster, metres, tower } from './dimensions.ts';

const output = resolve('artifacts/brep-catch-tower');
const palette = {
  steel: '#87949d', steelDark: '#475560', edge: '#afb8ba',
  rail: '#c8a252', concrete: '#626871', hardware: '#6a7379',
};
function bake(bodies, railColor = palette.rail) {
  const groups = new Map();
  let vertexCount = 0;
  let indexCount = 0;
  for (const { surface, shape } of bodies) {
    if (!isValidSolid(shape)) throw new Error(`Invalid ${surface} body`);
    const mesh = meshBody(shape);
    const meshes = groups.get(surface) ?? [];
    meshes.push(mesh);
    groups.set(surface, meshes);
    vertexCount += mesh.vertices.length;
    indexCount += mesh.triangles.length;
  }

  const vertices = new Float32Array(vertexCount);
  const normals = new Float32Array(vertexCount);
  const triangles = new Uint32Array(indexCount);
  const materials = new Map();
  const faceGroups = [];
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const [surface, meshes] of groups) {
    const start = indexOffset;
    for (const data of meshes) {
      vertices.set(data.vertices.map(metres), vertexOffset);
      normals.set(data.normals, vertexOffset);
      triangles.set(data.triangles.map(index => index + vertexOffset / 3), indexOffset);
      vertexOffset += data.vertices.length;
      indexOffset += data.triangles.length;
    }
    const faceId = faceGroups.length;
    faceGroups.push({ start, count: indexOffset - start, faceId, origin: 0 });
    const color = new Color(surface === 'rail' ? railColor : palette[surface]);
    materials.set(faceId, { name: surface, baseColor: [...color.toArray(), 1], roughness: .75, metallic: .2 });
  }
  // The exporter supplies the Z-up to Y-up rotation. Only the metres scale is applied above.
  const bytes = Buffer.from(exportGlb({ vertices, normals, triangles, uvs: new Float32Array(), faceGroups }, { materials }));
  return { bytes, solids: bodies.length, triangles: indexCount / 3 };
}

const fitTolerance = 0.01;
function assertNear(actual, expected, label) {
  if (Math.abs(actual - expected) > fitTolerance) throw new Error(`${label}: ${actual} vs ${expected} mm`);
}

function checkFit(bodies, side, values, pin) {
  const rail = getBounds(bodies.find(body => body.surface === 'rail').shape);
  const railMin = side === 1 ? rail.yMin : -rail.yMax;
  const railMax = side === 1 ? rail.yMax : -rail.yMin;
  const closedY = Math.abs(armPose(side, 0, 'slide').y);
  const openY = Math.abs(armPose(side, 1, 'slide').y);
  const travel = openY - closedY;
  const pinStation = booster.centerX - tower.armRootX;
  assertNear((rail.xMin + rail.xMax) / 2, tower.padCenterX - tower.armRootX, 'Pad length datum');
  assertNear((railMin + railMax) / 2, -tower.padInset, 'Pad lateral datum');
  assertNear(rail.zMax, tower.padTop + pin.zMin, 'Pin underside to rail top');
  assertNear(railMax - railMin, values.padWidth, 'Pad width');
  assertNear(rail.xMax - rail.xMin, values.padLength, 'Pad length');
  if (travel > tower.slideLimit || rail.xMin > pinStation + pin.xMin || rail.xMax < pinStation + pin.xMax) {
    throw new Error('Pin footprint or arm travel falls outside the lab interface');
  }
  const pinMin = side === 1 ? pin.yMin : -pin.yMax;
  const pinMax = side === 1 ? pin.yMax : -pin.yMin;
  const padInner = closedY + railMin;
  const padOuter = closedY + railMax;
  const contactWidth = Math.min(padOuter, pinMax) - Math.max(padInner, pinMin);
  const openInner = openY + railMin;
  const hingedInner = closedY + (pinStation + pin.xMin) * Math.tan(tower.hingeTravel) + railMin / Math.cos(tower.hingeTravel);
  if (contactWidth <= 0 || openInner <= pinMax || hingedInner <= pinMax || padInner <= booster.diameter / 2) {
    throw new Error('Insufficient pin support or approach clearance');
  }
  return {
    side, contactWidthM: metres(contactWidth), closedBodyClearancePerSideM: metres(padInner - booster.diameter / 2),
    openPinClearancePerSideM: metres(openInner - pinMax), openHingedPinClearancePerSideM: metres(hingedInner - pinMax),
    railHeightM: metres(tower.nominalRailHeight), slideTravelPerArmM: metres(travel),
    railContactYUpM: [metres(booster.centerX), metres(tower.nominalRailHeight), metres(-side * tower.closedPadCenter)],
  };
}

await mkdir(output, { recursive: true });
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(await OcctKernel.init()));

const embedded = {};
const assets = {};
async function save(name, { bytes, solids, triangles }) {
  const file = `${name}.glb`;
  await writeFile(resolve(output, file), bytes);
  embedded[name] = bytes.toString('base64');
  assets[name] = { file, solids, triangles, bytes: bytes.length };
}

await save('tower', withTowerBodies(bake));
await save('carriage', withCarriageBodies(bake));
const { pins, proxy } = withBoosterBodies(bodies => ({
  pins: bodies.filter(body => body.surface === 'rail').map(({ shape }) => getBounds(shape)),
  proxy: bake(bodies, '#56cbe1'),
}));
await save('booster-proxy', proxy);

const fit = {};
for (const [variant, values] of Object.entries(armProfiles)) {
  fit[variant] = [];
  for (const [hand, side] of Object.entries(armSides)) {
    const name = `${variant}-arm-${hand}`;
    const { model, measured } = withArmBodies(values, side, bodies => ({
      model: bake(bodies), measured: checkFit(bodies, side, values, pins[side === 1 ? 1 : 0]),
    }));
    fit[variant].push(measured);
    await save(name, model);
  }
}

const manifest = {
  units: 'metres', up: 'Y', assets, variants: armProfiles, fit,
  originsAtNominalHeightM: {
    tower: [0, 0, 0], carriage: [metres(tower.carriageX), metres(tower.nominalRailHeight - tower.padTop), 0],
    booster: [metres(booster.centerX), metres(tower.nominalRailHeight), 0],
  },
  armPosesRelativeToCarriageM: Object.fromEntries(['slide', 'hinge'].map(mode => [mode,
    Object.fromEntries([['open', 1], ['closed', 0]].map(([pose, openness]) => [pose,
      Object.entries(armSides).map(([hand, side]) => {
        const { y, yaw } = armPose(side, openness, mode);
        return { side: hand, position: [metres(tower.armRootX - tower.carriageX), 0, metres(-y)], yawRadians: yaw };
      }),
    ])),
  ])),
};
await writeFile(resolve(output, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const [template, bundle] = await Promise.all([
  readFile(new URL('preview.html', import.meta.url), 'utf8'),
  build({ entryPoints: [resolve(import.meta.dirname, 'preview.ts')], bundle: true, minify: true, write: false, format: 'esm', target: 'es2022' }),
]);
const preview = template
  .replace('<!-- ASSETS -->', () => `<script id="assets" type="application/json">${JSON.stringify({ embedded, fit })}</script>`)
  .replace('<!-- PREVIEW -->', () => `<script type="module">${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(resolve(output, 'preview.html'), preview);
console.log(resolve(output, 'preview.html'));
