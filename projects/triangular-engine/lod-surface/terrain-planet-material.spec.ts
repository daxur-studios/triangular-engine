import { DirectionalLight, FloatType, NearestFilter, PerspectiveCamera, RGBAFormat, RenderTarget, Scene } from 'three';
import { LodTerrainBody, createHeightSource, type LodTerrainSettings } from 'triangular-engine/lod-surface/core';
import { PlanetSurfaceMaterial, SURFACE_LAYER_ORDER, cellLookupLayer, solidColorLayer } from 'triangular-engine/planet-material';
import { getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { TerrainPlanetMaterial } from './terrain-planet-material';

/* eslint-disable @typescript-eslint/no-explicit-any */

const sphere = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' } as const;

function settings(material: TerrainPlanetMaterial, over: Partial<LodTerrainSettings> = {}): LodTerrainSettings {
  return {
    domain: sphere, heights: createHeightSource('flat', 'sphere'), detailNoise: 0, leafCap: 256, cellPixels: 4, patchCells: 16,
    hysteresis: 0.15, cull: true, material, ...over,
  };
}

/** One colour for every cell id: a 1-cell lookup, so the layer paints the whole sphere in a known colour. */
function uniformLookup(rgb: readonly [number, number, number]) {
  const cells = cellLookupLayer();
  cells.setLookup({
    cellData: new Float32Array([rgb[0], rgb[1], rgb[2], 1]), cellTextureWidth: 1,
    cellIdData: new Uint8Array([0, 0, 0, 255]), cellIdWidth: 1, cellIdHeight: 1,
  });
  return cells;
}

/** Draws the body from a camera above it, with a sun at `sun`, and returns the RGBA of the middle pixel of a 64 x 64 float target. */
async function centrePixel(body: LodTerrainBody, camera: PerspectiveCamera, sun: [number, number, number]): Promise<number[]> {
  const renderer = await getEvalRenderer();
  const scene = new Scene();
  const light = new DirectionalLight(0xffffff, 3);
  light.position.set(...sun);
  scene.add(light, light.target, body.object);
  const target = new RenderTarget(64, 64, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter });
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  const data = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64)) as Float32Array;
  target.dispose();
  scene.remove(body.object);
  const o = (32 * 64 + 32) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

describe('TerrainPlanetMaterial', () => {
  it('replaces the globe-only stage 1 once the terrain mesh binds its nodes', () => {
    const material = new TerrainPlanetMaterial();
    const globeContext = material.context;
    const globeNormal = material.normalNode;
    expect(material.maskNode).toBeNull();
    const body = new LodTerrainBody(settings(material));
    expect(material.positionNode).toBeTruthy();
    expect(material.positionNode).not.toBe(material.morphGraph.positionNode);
    expect(material.context).not.toBe(globeContext);
    expect(material.context.radialDirection).not.toBe(globeContext.radialDirection);
    expect(material.normalNode).not.toBe(globeNormal);
    expect(material.maskNode).toBeNull();
    expect(material.maskShadowNode).toBeNull();
    // The layer stacks are the base class's: ids unchanged, and the program cache key tells it apart from the globe's.
    expect(material.stackKey).toBe('morph:true/false;layers:base;occluders:;emissives:');
    expect(material.customProgramCacheKey().endsWith('|lodTerrain')).toBeTrue();
    expect(body.surface.nodes.up).toBeTruthy();
    body.dispose();
  });

  it('keeps layers working after a rebuild with the same material', () => {
    const material = new TerrainPlanetMaterial();
    const cells = uniformLookup([0.2, 0.6, 0.1]);
    material.addSurfaceLayer({ id: 'cellLookup', order: SURFACE_LAYER_ORDER.cellLookup, layer: cells.layer });
    const first = new LodTerrainBody(settings(material));
    const second = new LodTerrainBody(settings(material, { patchCells: 32 }));
    expect(material.stackKey).toContain('layers:base|cellLookup');
    first.dispose();
    second.dispose();
    cells.dispose();
  });

  it('control: the unadapted globe material draws the terrain black (it reads attributes the mesh lacks)', async () => {
    const material = new PlanetSurfaceMaterial({ base: solidColorLayer({ color: '#33cc1a' }).layer });
    const body = new LodTerrainBody(settings(material as unknown as TerrainPlanetMaterial));
    const camera = new PerspectiveCamera(40, 1, 1, 1e6);
    camera.position.set(0, 0, 12_000);
    camera.updateMatrixWorld();
    body.update(camera, 64);
    const [r, g, b] = await centrePixel(body, camera, [0, 0, 1]);
    expect(Math.max(r, g, b)).toBeLessThan(0.01);
    body.dispose();
    material.dispose();
  });

  it('draws the cell colour, lit by the scene sun, through the WebGL2 backend', async () => {
    const material = new TerrainPlanetMaterial();
    const cells = uniformLookup([0.2, 0.6, 0.1]);
    material.addSurfaceLayer({ id: 'cellLookup', order: SURFACE_LAYER_ORDER.cellLookup, layer: cells.layer });
    const body = new LodTerrainBody(settings(material));
    const camera = new PerspectiveCamera(40, 1, 1, 1e6);
    camera.position.set(0, 0, 12_000);
    camera.updateMatrixWorld();
    body.update(camera, 64);

    const lit = await centrePixel(body, camera, [0, 0, 1]);
    const dark = await centrePixel(body, camera, [0, 0, -1]);
    expect(lit.every(Number.isFinite)).toBeTrue();
    expect(lit[3]).toBeGreaterThan(0.99);
    // The cell colour (green dominant), brightened by a sun at the viewer's back, near black with the sun behind the planet.
    expect(lit[1]).toBeGreaterThan(lit[0]);
    expect(lit[1]).toBeGreaterThan(lit[2]);
    expect(lit[1]).toBeGreaterThan(dark[1] * 3);

    body.dispose();
    cells.dispose();
    material.dispose();
  });
});
