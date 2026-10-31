/* eslint-disable @typescript-eslint/no-explicit-any */
import { FloatType, FrontSide, NearestFilter, PerspectiveCamera, RGBAFormat, RenderTarget, Scene } from 'three';
import { vec4 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { getEvalRenderer } from '../../planet-material/gpu-eval.testing';
import type { LodDomain, Vec3 } from './lod-domain';
import { createHeightSource } from './lod-height';
import { createMorphMap } from './lod-morph-frame';
import { sceneCameraAt } from './lod-morph.testing';
import { CAP_SLACK, LodSelector } from './lod-selector';
import { createLodSurfaceMesh, type LodSurfaceMesh } from './lod-surface-mesh';

/**
 * Plan 059, step G6e-c: the mesh's globe fields on the GPU (headless WebGL2, the renderer of the other GPU specs). The mesh sits at the
 * camera it is uploaded with, so its nodes are camera-relative; each node is read back by drawing it as a colour, and a covered pixel has
 * alpha 1. Flat height and no detail, so every globe point is on the sphere of `RADIUS`.
 */

const RADIUS = 10_000;
const SPHERE: LodDomain = { kind: 'sphere', sizeM: RADIUS, warp: 'equal-angle' };
const SIZE = 64;
const CAPACITY = 256 + CAP_SLACK + 6;
/** Pixel tolerances in metres (positions) and unit-vector components (normals), for float32 on a 10 km sphere. */
const METRES = 0.5;
const UNIT = 1e-3;
/** The first draw also initialises the renderer and compiles the mesh's shader. */
const GPU_TIMEOUT_MS = 120_000;

function build(): LodSurfaceMesh {
  return createLodSurfaceMesh({
    domain: SPHERE,
    patchCells: 16,
    source: createHeightSource('flat', 'sphere'),
    capacity: CAPACITY,
    morph: true,
    material: new MeshBasicNodeMaterial({ side: FrontSide, toneMapped: false }),
  });
}

function selectorAt(camera: Vec3): LodSelector {
  const selector = new LodSelector({
    domain: SPHERE, patchCells: 16, mode: 'distance', fixedLevel: 5, cellPixels: 4, leafCap: 256, heightBoundM: 0, cull: false, hysteresis: 0.15,
  });
  selector.select({ camera, pixelAngle: (2 * Math.tan(Math.PI / 6)) / 1000, frustum: new Float64Array(12) });
  return selector;
}

/** A camera at the scene origin (where the mesh's positions are measured from) that looks along `direction`. */
function cameraLooking(direction: Vec3): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 1, 1e7);
  camera.position.set(0, 0, 0);
  camera.lookAt(direction[0], direction[1], direction[2]);
  camera.updateMatrixWorld();
  return camera;
}

/** Draws the mesh with `colour` as its colour and reads the SIZE x SIZE float target back (RGBA per pixel, row-major). */
async function draw(mesh: LodSurfaceMesh, colour: any, camera: PerspectiveCamera): Promise<Float32Array> {
  const renderer = await getEvalRenderer();
  const material = mesh.material as unknown as MeshBasicNodeMaterial;
  // fragmentNode, not colorNode: the colour output stage clamps negative values to 0, and camera-relative positions are negative.
  material.colorNode = null;
  material.fragmentNode = colour;
  material.needsUpdate = true;
  const scene = new Scene();
  scene.add(mesh.mesh);
  const target = new RenderTarget(SIZE, SIZE, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter });
  const previous = renderer.getRenderTarget();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  const data = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Float32Array;
  target.dispose();
  scene.remove(mesh.mesh);
  return data;
}

/** The pixels a mesh covers (alpha 1). */
function covered(data: Float32Array): number[] {
  const out: number[] = [];
  for (let k = 0; k < SIZE * SIZE; k++) if (data[k * 4 + 3] > 0.5) out.push(k);
  return out;
}

const component = (data: Float32Array, k: number, c: number): number => data[k * 4 + c];
const diff = (a: Float32Array, b: Float32Array, k: number): number =>
  Math.hypot(component(a, k, 0) - component(b, k, 0), component(a, k, 1) - component(b, k, 1), component(a, k, 2) - component(b, k, 2));

describe('lod-surface-mesh: the globe fields on the GPU (Plan 059 G6e-c)', () => {
  it('at morph 0 the globe position and normal are the drawn position and normal, and the position is on the sphere', async () => {
    const mesh = build();
    const h = RADIUS + 2_000;
    const bent: Vec3 = [h * Math.cos(0.4) * Math.sin(0.3), h * Math.sin(0.4), h * Math.cos(0.4) * Math.cos(0.3)];
    mesh.upload(selectorAt(bent), bent);
    const camera = cameraLooking([-bent[0], -bent[1], -bent[2]]);
    const position = await draw(mesh, vec4(mesh.nodes.position, 1), camera);
    const globe = await draw(mesh, vec4(mesh.nodes.globePosition, 1), camera);
    const normal = await draw(mesh, vec4(mesh.nodes.normal, 1), camera);
    const globeNormal = await draw(mesh, vec4(mesh.nodes.globeNormal, 1), camera);

    const pixels = covered(position);
    expect(pixels.length).toBeGreaterThan(100);
    expect(covered(globe).length).toBe(pixels.length);
    let worstPosition = 0;
    let worstNormal = 0;
    let worstRadius = 0;
    for (const k of pixels) {
      worstPosition = Math.max(worstPosition, diff(globe, position, k));
      worstNormal = Math.max(worstNormal, diff(globeNormal, normal, k));
      const r = Math.hypot(component(position, k, 0) + bent[0], component(position, k, 1) + bent[1], component(position, k, 2) + bent[2]);
      worstRadius = Math.max(worstRadius, Math.abs(r - RADIUS));
    }
    console.log(`[lod-surface-mesh-globe] morph 0: ${pixels.length} pixels, worst globe-position gap ${worstPosition.toExponential(2)} m, normal gap ${worstNormal.toExponential(2)}, radius error ${worstRadius.toExponential(2)} m`);
    expect(worstPosition).toBeLessThan(1e-3);
    expect(worstNormal).toBeLessThan(1e-4);
    expect(worstRadius).toBeLessThan(METRES);
    (mesh.material as unknown as MeshBasicNodeMaterial).dispose();
    mesh.dispose();
  }, GPU_TIMEOUT_MS);

  it('above morph 0 the globe position is the unbent point, camera-relative like position, and the globe normal is its radial up', async () => {
    const mesh = build();
    const settings = { morph: 1, projection: 'equal-earth' as const, projectionCentre: { lonDeg: 0, latDeg: 0 } };
    mesh.setMorph(settings);
    const map = createMorphMap(settings, RADIUS);
    const bent = sceneCameraAt(map, 0.6, 0.3, 2_000);
    mesh.upload(selectorAt(mesh.unbend(bent)), bent);
    const forward = map.basis.forward;
    // The flat map's normal is the projection's forward axis: the camera looks down on it.
    const camera = cameraLooking([-forward[0], -forward[1], -forward[2]]);
    const position = await draw(mesh, vec4(mesh.nodes.position, 1), camera);
    const globe = await draw(mesh, vec4(mesh.nodes.globePosition, 1), camera);
    const globeNormal = await draw(mesh, vec4(mesh.nodes.globeNormal, 1), camera);
    const bentUp = await draw(mesh, vec4(mesh.nodes.normal, 1), camera);

    const pixels = covered(position);
    expect(pixels.length).toBeGreaterThan(100);
    let worstRadius = 0;
    let worstNormal = 0;
    let largestShift = 0;
    let largestBend = 0;
    const errs: number[][] = [];
    for (const k of pixels) {
      // globe + bent camera is the absolute globe point: it must lie on the sphere (flat height), with its radial up as the globe normal.
      const g = [0, 1, 2].map((c) => component(globe, k, c) + bent[c]);
      const length = Math.hypot(g[0], g[1], g[2]);
      worstRadius = Math.max(worstRadius, Math.abs(length - RADIUS));
      const n = [0, 1, 2].map((c) => component(globeNormal, k, c));
      const radial = [0, 1, 2].map((c) => g[c] / length);
      const e = Math.hypot(n[0] - radial[0], n[1] - radial[1], n[2] - radial[2]);
      errs.push([e, k]);
      worstNormal = Math.max(worstNormal, e);
      largestShift = Math.max(largestShift, diff(globe, position, k));
      largestBend = Math.max(largestBend, 1 - (component(globeNormal, k, 0) * component(bentUp, k, 0) + component(globeNormal, k, 1) * component(bentUp, k, 1) + component(globeNormal, k, 2) * component(bentUp, k, 2)));
    }
    errs.sort((a, b) => b[0] - a[0]);
    const p99 = errs[Math.floor(errs.length * 0.01)][0];
    console.log(`[lod-surface-mesh-globe] morph 1: ${pixels.length} pixels, globe radius error ${worstRadius.toExponential(2)} m, globe normal error p99 ${p99.toExponential(2)} max ${worstNormal.toExponential(2)}, largest globe-position gap ${largestShift.toFixed(1)} m`);
    expect(worstRadius).toBeLessThan(METRES);
    // 16 of 4096 pixels, all on the picture's outer rows and columns, reach ~3e-3 (about 27 m of tangential offset at 10 km); the rest are at 1e-6.
    expect(p99).toBeLessThan(UNIT);
    expect(worstNormal).toBeLessThan(1e-2);
    // The bend moves the drawn point: the globe position differs from the bent one away from the projection centre, and so does the normal.
    expect(largestShift).toBeGreaterThan(100);
    expect(largestBend).toBeGreaterThan(0.01);
    (mesh.material as unknown as MeshBasicNodeMaterial).dispose();
    mesh.dispose();
  }, GPU_TIMEOUT_MS);
});
