import { vec3 } from 'three/tsl';
import { PlanetSurfaceMaterial } from './planet-surface-material';
import { SURFACE_LAYER_ORDER } from './planet-surface-layers';

describe('PlanetSurfaceMaterial', () => {
  const layer = (name: string, calls: string[]) => () => {
    calls.push(name);
    return { albedo: vec3(1, 0, 0), roughness: vec3(1).x, metalness: vec3(0).x };
  };

  it('starts with the vertex-colour base layer only', () => {
    const material = new PlanetSurfaceMaterial();
    expect(material.stackKey).toBe('morph:true/false;layers:vertexColor;occluders:;emissives:');
  });

  it('runs surface layers in order, not insertion order', () => {
    const calls: string[] = [];
    const material = new PlanetSurfaceMaterial();
    calls.length = 0;
    material.addSurfaceLayer({ id: 'roads', order: SURFACE_LAYER_ORDER.game, layer: layer('roads', calls) });
    material.addSurfaceLayer({ id: 'macro', order: SURFACE_LAYER_ORDER.macroVariation, layer: layer('macro', calls) });
    calls.length = 0;
    material.removeSurfaceLayer('macro');
    material.addSurfaceLayer({ id: 'macro', order: SURFACE_LAYER_ORDER.macroVariation, layer: layer('macro', calls) });

    expect(calls.slice(-2)).toEqual(['macro', 'roads']);
    expect(material.stackKey).toBe('morph:true/false;layers:vertexColor|macro|roads;occluders:;emissives:');
  });

  it('derives the cache key from layer ids, not from uniform values', () => {
    const a = new PlanetSurfaceMaterial();
    const b = new PlanetSurfaceMaterial();
    const keyBefore = a.customProgramCacheKey();

    a.morph.uMorph.value = 0.75;
    a.morph.uProjectionType.value = 0;
    a.morph.uMapWidth.value = 1234;

    expect(a.customProgramCacheKey()).toBe(keyBefore);
    expect(a.stackKey).toBe(b.stackKey);
    // three's own part of the key is per instance; ours is the stack key and is what must match.
    expect(a.customProgramCacheKey().endsWith(`|planetSurface:${a.stackKey}`)).toBeTrue();
  });

  it('changes the cache key when a layer, occluder or emissive is added or removed', () => {
    const material = new PlanetSurfaceMaterial();
    const base = material.stackKey;

    material.addSurfaceLayer({ id: 'roads', order: 1000, layer: layer('roads', []) });
    const withLayer = material.stackKey;
    expect(withLayer).not.toBe(base);

    material.addSunOcclusion({ id: 'eclipse', occlusion: () => vec3(1).x });
    const withOcclusion = material.stackKey;
    expect(withOcclusion).not.toBe(withLayer);

    material.addEmissive({ id: 'cityLights', emissive: () => vec3(0, 0, 0) });
    const withEmissive = material.stackKey;
    expect(withEmissive).not.toBe(withOcclusion);

    material.removeEmissive('cityLights');
    material.removeSunOcclusion('eclipse');
    material.removeSurfaceLayer('roads');
    expect(material.stackKey).toBe(base);
  });

  it('marks the material for recompilation when a stack changes', () => {
    const material = new PlanetSurfaceMaterial();
    const versionBefore = material.version;
    material.addSurfaceLayer({ id: 'roads', order: 1000, layer: layer('roads', []) });
    expect(material.version).toBeGreaterThan(versionBefore);
  });

  it('rejects duplicate layer ids', () => {
    const material = new PlanetSurfaceMaterial();
    expect(() =>
      material.addSurfaceLayer({ id: 'vertexColor', order: 5, layer: layer('x', []) }),
    ).toThrowError(/already exists/);
  });

  it('stays within the 8 WebGPU vertex buffers with room for uv, colour and the macro factor', () => {
    const material = new PlanetSurfaceMaterial();
    // Stage 1 plus the layers' own: color (base layer), uv, terrainMacroLandFactor.
    const layerAttributes = ['color', 'uv', 'terrainMacroLandFactor'];
    const used = new Set([...material.morphGraph.vertexAttributes, ...layerAttributes]);
    expect(used.size).toBeLessThanOrEqual(8);
  });

  it('only reads the seam-cull and aSphere* attributes when asked to', () => {
    const lean = new PlanetSurfaceMaterial();
    const full = new PlanetSurfaceMaterial({ sphereFromGeometry: false, seamCullAttributes: true });
    expect(lean.morphGraph.vertexAttributes).not.toContain('aOtherDir1');
    expect(lean.morphGraph.vertexAttributes).not.toContain('aSpherePos');
    expect(full.morphGraph.vertexAttributes).toEqual(
      jasmine.arrayContaining(['aSpherePos', 'aSphereNorm', 'aOtherDir1', 'aOtherDir2']),
    );
    expect(full.stackKey).not.toBe(lean.stackKey);
  });

  it('shares one uniform set that a caller can read and drive', () => {
    const material = new PlanetSurfaceMaterial();
    material.morph.uMorph.value = 0.5;
    expect(material.context.uniforms).toBe(material.morph);
    expect(material.context.uniforms.uMorph.value).toBe(0.5);
  });
});
