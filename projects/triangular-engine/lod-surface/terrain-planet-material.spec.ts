import { DirectionalLight, FloatType, NearestFilter, PerspectiveCamera, RGBAFormat, RenderTarget, Scene, Vector3 } from 'three';
import { float, uniform, vec4 } from 'three/tsl';
import { LodTerrainBody, createHeightSource, type LodSurfaceNodes, type LodTerrainSettings } from 'triangular-engine/lod-surface/core';
import { buildCellPlanetWorld } from 'triangular-engine/worldgen';
import {
  PlanetSurfaceMaterial,
  SURFACE_LAYER_ORDER,
  cellLookupLayer,
  createPlanetMorphUniforms,
  setPlanetMapExtent,
  setPlanetProjectionCentre,
  solidColorLayer,
} from 'triangular-engine/planet-material';
import { evaluateOnGpu, getEvalRenderer } from '../planet-material/gpu-eval.testing';
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

/**
 * Stand-ins for the mesh's nodes, as uniforms: a spec sets their values and reads the material's graph on the GPU. `bent` adds
 * `bentUp`, which the mesh builds only with its morph option.
 */
function fakeNodes(bent: boolean) {
  const up = uniform(new Vector3(0, 0, 1));
  const normal = uniform(new Vector3(0, 0, 1));
  const bentUp = uniform(new Vector3(1, 0, 0));
  const nodes = { up, normal, position: float(0), level: float(0), ...(bent ? { bentUp } : {}) } as unknown as LodSurfaceNodes;
  return { nodes, up, normal, bentUp };
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
    expect(material.customProgramCacheKey().endsWith('|stage:lodTerrain')).toBeTrue();
    expect(material.stageOverride?.id).toBe('lodTerrain');
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
  it('builds the ground colours from a cell planet world and owns the layer', () => {
    const world = buildCellPlanetWorld({ cellCount: 120, seed: 5 });
    const material = new TerrainPlanetMaterial({ cellPlanet: world, cellLookup: { atlasWidth: 64 } });
    expect(material.stackKey).toContain('layers:base|cellLookup');
    expect(material.cells).toBeDefined();
    expect(material.cellLookupMs).toBeGreaterThanOrEqual(0);
    const disposeCells = spyOn(material.cells!, 'dispose').and.callThrough();
    material.dispose();
    expect(disposeCells).toHaveBeenCalledTimes(1);
  });

  it('builds the world from the description given to cellPlanetHeights', () => {
    const material = new TerrainPlanetMaterial({ cellPlanet: { seed: 5, cellCount: 80 }, cellLookup: { atlasWidth: 64 } });
    expect(material.cells).toBeDefined();
    material.dispose();
  });

  it('has no cell layer without cellPlanet', () => {
    const material = new TerrainPlanetMaterial();
    expect(material.cells).toBeUndefined();
    expect(material.cellLookupMs).toBeUndefined();
    material.dispose();
  });

  it('keeps the sun direction for a parent: normalised in dayNight, fed by the mesh', () => {
    const material = new TerrainPlanetMaterial();
    material.setSunDirection([0, 3, 4]);
    const sun = material.dayNight.uSunDirection.value;
    expect([sun.x, sun.y, sun.z].map((v) => +v.toFixed(3))).toEqual([0, 0.6, 0.8]);
    const body = new LodTerrainBody(settings(material));
    body.setSun([4, 0, 3]);
    const fed = material.dayNight.uSunDirection.value;
    expect([fed.x, fed.y, fed.z].map((v) => +v.toFixed(3))).toEqual([0.8, 0, 0.6]);
    body.dispose();
    material.dispose();
  });

  it('without morphUniforms the graph is today\'s: morph 0, the lodTerrain stage, no shadow gate, the height-gradient normal', () => {
    const material = new TerrainPlanetMaterial();
    const body = new LodTerrainBody(settings(material));
    expect(material.stageOverride?.id).toBe('lodTerrain');
    expect(material.context.morph).toBe(material.morph.uMorph);
    expect(material.morph.uMorph.value).toBe(0);
    expect(material.receivedShadowNode).toBeNull();
    expect(material.stageOverride?.shadingNormal).toBe(body.surface.nodes.normal);
    body.dispose();
    material.dispose();
  });

  it('with morphUniforms the stage reads the shared morph and the projected longitude', async () => {
    const morph = createPlanetMorphUniforms();
    setPlanetMapExtent(morph, 10_000);
    setPlanetProjectionCentre(morph, { lonDeg: 0, latDeg: 0 });
    const material = new TerrainPlanetMaterial({ morphUniforms: morph });
    expect(material.morph).toBe(morph);
    const { nodes, up } = fakeNodes(true);
    material.bindLodSurfaceNodes(nodes);
    expect(material.stageOverride?.id).toBe('lodTerrainMorph');
    expect(material.context.morph).toBe(morph.uMorph);
    // Forty-five degrees east of the projection centre (lon 0, lat 0): the projected longitude is pi / 4 in the map frame.
    up.value.set(1, 0, 1);
    const projected = async () => (await evaluateOnGpu([[[0, 0, 0, 0]]], () => vec4(material.context.projectedLon, float(0), float(0), float(1))))[0];
    expect(await projected()).toBeCloseTo(Math.PI / 4, 4);
    morph.uProjMode.value = 0;
    expect(await projected()).toBeCloseTo(0, 6);
    material.dispose();
  });

  it('bends the shading normal from the height-gradient normal at morph 0 to the bent up at morph 1', async () => {
    const morph = createPlanetMorphUniforms();
    const material = new TerrainPlanetMaterial({ morphUniforms: morph });
    // Normal (0, 0, 1), bent up (1, 0, 0): a 90 degree turn between the two ends of the blend.
    const { nodes } = fakeNodes(true);
    material.bindLodSurfaceNodes(nodes);
    const shading = material.stageOverride!.shadingNormal;
    const at = async (m: number) => {
      morph.uMorph.value = m;
      return evaluateOnGpu([[[0, 0, 0, 0]]], () => vec4(shading, float(1)));
    };
    const globe = await at(0);
    expect([globe[0], globe[1], globe[2]].map((v) => +v.toFixed(4))).toEqual([0, 0, 1]);
    const half = await at(0.5);
    expect(half[0]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(half[2]).toBeCloseTo(Math.SQRT1_2, 4);
    const flat = await at(1);
    expect(flat[0]).toBeCloseTo(1, 4);
    expect(flat[2]).toBeCloseTo(0, 4);
    material.dispose();
  });

  it('takes the cells from the unbent globe position and the relief from the globe normal when the mesh has its globe fields', async () => {
    const morph = createPlanetMorphUniforms();
    const material = new TerrainPlanetMaterial({ morphUniforms: morph });
    // The globe fields differ from the drawn ones: position (4, 5, 6) bent, globe point (1, 2, 3); normal (0, 1, 0), globe normal (0, 0, 1).
    const { nodes, up, normal, bentUp } = fakeNodes(true);
    const globePosition = uniform(new Vector3(1, 2, 3));
    const globeNormal = uniform(new Vector3(0, 0, 1));
    const position = uniform(new Vector3(4, 5, 6));
    normal.value.set(0, 1, 0);
    up.value.set(0, 0, 1);
    bentUp.value.set(1, 0, 0);
    const globeNodes = { ...nodes, position, globePosition, globeNormal } as unknown as LodSurfaceNodes;
    material.bindLodSurfaceNodes(globeNodes);
    expect(material.context.bodyFixedLocal).toBe(globePosition);
    expect(material.context.morphedPosition).toBe(position);
    expect(material.context.morphedBatchedLocal).toBe(position);
    // The relief fades as the map flattens: the globe normal at morph 0 and the bent up at morph 1 (not the drawn normal).
    const shading = material.stageOverride!.shadingNormal;
    const at = async (m: number) => {
      morph.uMorph.value = m;
      return evaluateOnGpu([[[0, 0, 0, 0]]], () => vec4(shading, float(1)));
    };
    const globe = await at(0);
    expect([globe[0], globe[1], globe[2]].map((v) => +v.toFixed(4))).toEqual([0, 0, 1]);
    const flat = await at(1);
    expect(flat[0]).toBeCloseTo(1, 4);
    expect(flat[2]).toBeCloseTo(0, 4);
    material.dispose();
  });

  it('keeps the position as the body-fixed position without the globe fields (an older mesh)', () => {
    const material = new TerrainPlanetMaterial({ morphUniforms: createPlanetMorphUniforms() });
    const { nodes } = fakeNodes(true);
    material.bindLodSurfaceNodes(nodes);
    expect(material.context.bodyFixedLocal).toBe(nodes.position);
    material.dispose();
  });

  it('uses the position for the body-fixed local without morphUniforms, even when the mesh has its globe fields', () => {
    const material = new TerrainPlanetMaterial();
    const { nodes } = fakeNodes(false);
    const globeNodes = { ...nodes, globePosition: uniform(new Vector3(1, 2, 3)), globeNormal: uniform(new Vector3(0, 0, 1)) } as unknown as LodSurfaceNodes;
    material.bindLodSurfaceNodes(globeNodes);
    expect(material.context.bodyFixedLocal).toBe(nodes.position);
    material.dispose();
  });

  it('keeps the normal when the mesh has no bend (built without its morph option)', () => {
    const material = new TerrainPlanetMaterial({ morphUniforms: createPlanetMorphUniforms() });
    const { nodes, normal } = fakeNodes(false);
    material.bindLodSurfaceNodes(nodes);
    expect(material.stageOverride?.shadingNormal).toBe(normal);
    material.dispose();
  });

  it('turns direct shadows off above morph 0 and leaves them alone at morph 0', async () => {
    const morph = createPlanetMorphUniforms();
    const material = new TerrainPlanetMaterial({ morphUniforms: morph });
    const shadow = material.receivedShadowNode as unknown as (factor: any) => any;
    expect(shadow).toBeTruthy();
    const factorAt = async (m: number) => {
      morph.uMorph.value = m;
      return (await evaluateOnGpu([[[0, 0, 0, 0]]], () => vec4(shadow(float(0.25)), float(0), float(0), float(1))))[0];
    };
    expect(await factorAt(0)).toBeCloseTo(0.25, 5);
    expect(await factorAt(0.5)).toBeCloseTo(1, 5);
    expect(await factorAt(1)).toBeCloseTo(1, 5);
    material.dispose();
  });

  it('compiles and draws the bent terrain with the shared morph uniforms, at morph 0 and 1', async () => {
    const morph = createPlanetMorphUniforms();
    setPlanetMapExtent(morph, 10_000);
    setPlanetProjectionCentre(morph, { lonDeg: 0, latDeg: 0 });
    const material = new TerrainPlanetMaterial({ morphUniforms: morph });
    const cells = uniformLookup([0.2, 0.6, 0.1]);
    material.addSurfaceLayer({ id: 'cellLookup', order: SURFACE_LAYER_ORDER.cellLookup, layer: cells.layer });
    const body = new LodTerrainBody({ ...settings(material), morph: true });
    body.setMorph(morph);
    const camera = new PerspectiveCamera(40, 1, 1, 1e6);
    camera.position.set(0, 0, 12_000);
    camera.updateMatrixWorld();

    body.update(camera, 64);
    const globe = await centrePixel(body, camera, [0, 0, 1]);
    morph.uMorph.value = 1;
    body.update(camera, 64);
    const flat = await centrePixel(body, camera, [0, 0, 1]);

    expect(globe.every(Number.isFinite)).toBeTrue();
    expect(flat.every(Number.isFinite)).toBeTrue();
    expect(globe[3]).toBeGreaterThan(0.99);
    body.dispose();
    cells.dispose();
    material.dispose();
  });

  it('draws the same ground at morph 0 with the morph uniforms as without them (checked within 0.01, not bit for bit)', async () => {
    const camera = new PerspectiveCamera(40, 1, 1, 1e6);
    camera.position.set(0, 0, 12_000);
    camera.updateMatrixWorld();
    const morph = createPlanetMorphUniforms();
    /** Draws the centre pixel; with `shared`, the body is the morph body driven by the shared uniforms (at their morph 0). */
    const draw = async (material: TerrainPlanetMaterial, shared: boolean) => {
      const cells = uniformLookup([0.2, 0.6, 0.1]);
      material.addSurfaceLayer({ id: 'cellLookup', order: SURFACE_LAYER_ORDER.cellLookup, layer: cells.layer });
      const body = new LodTerrainBody({ ...settings(material), morph: shared });
      if (shared) body.setMorph(morph);
      body.update(camera, 64);
      const pixel = await centrePixel(body, camera, [0, 0, 1]);
      body.dispose();
      cells.dispose();
      return pixel;
    };
    const plain = await draw(new TerrainPlanetMaterial(), false);
    const shared = await draw(new TerrainPlanetMaterial({ morphUniforms: morph }), true);
    for (let k = 0; k < 3; k++) expect(Math.abs(shared[k] - plain[k])).toBeLessThan(0.01);
  });
});
