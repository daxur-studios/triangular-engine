import { PerspectiveCamera } from 'three';
import { createHeightSource } from './lod-height';
import { createMorphMap } from './lod-morph-frame';
import { StretchMetric } from './lod-morph-metric';
import { sceneCameraAt } from './lod-morph.testing';
import { LodSelector, type NodeGeometryHook } from './lod-selector';
import { LodTerrainBody, type LodTerrainSettings } from './lod-terrain-body';

/** Plan 059, step G6b: the terrain body's morph preview (the setter, frustum culling off above morph 0, the unbent selector camera). */

const sphere = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' } as const;
const morphSettings = { morph: 0.5, projection: 'equal-earth' as const, projectionCentre: { lonDeg: 0, latDeg: 0 } };

function settings(over: Partial<LodTerrainSettings> = {}): LodTerrainSettings {
  return { domain: sphere, heights: createHeightSource('flat', 'sphere'), detailNoise: 0, leafCap: 256, cellPixels: 4, patchCells: 16, hysteresis: 0.15, cull: true, ...over };
}

/** A camera at a bent scene position, looking away from the planet so that a frustum would drop almost every leaf. */
function skyCamera(position: readonly number[]): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 2, 0.1, 1e9);
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(position[0] * 3, position[1] * 3, position[2] * 3 + 1e4);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('LodTerrainBody morph preview', () => {
  it('without the morph setting nothing changes: the frustum culls, the morph state is 0', () => {
    const body = new LodTerrainBody(settings());
    body.update(skyCamera([0, 0, 10_020]), 1000);
    expect(body.surface.morphState.morph).toBe(0);
    expect(body.stats.drawn).toBeLessThan(body.stats.leaves);
    body.dispose();
  });

  it('with the morph setting but morph 0 it still culls (the morph is a preview that costs nothing at the globe)', () => {
    const body = new LodTerrainBody(settings({ morph: true }));
    body.setMorph({ ...morphSettings, morph: 0 });
    body.update(skyCamera([0, 0, 10_020]), 1000);
    expect(body.surface.morphFrame).toBeUndefined();
    expect(body.stats.drawn).toBeLessThan(body.stats.leaves);
    body.dispose();
  });

  it('above morph 0 frustum culling is off by default: every selected leaf is drawn, from the unbent camera', () => {
    const body = new LodTerrainBody(settings({ morph: true }));
    body.setMorph(morphSettings);
    const map = createMorphMap(morphSettings, 10_000);
    const camera = skyCamera(sceneCameraAt(map, 0.3, 0.4, 20));
    body.update(camera, 1000);
    expect(body.stats.drawn).toBe(body.stats.leaves);
    expect(body.surface.morphFrame).toBeDefined();
    expect(body.surface.morphPack?.instances).toBe(body.stats.drawn + (body.surface.morphPack?.duplicates ?? 0));

    // The selector saw the unbent camera: a fresh selector at the frame's unbent camera selects the same tree.
    const fresh = new LodSelector(body.selector.settings);
    fresh.select({ camera: body.surface.morphFrame!.selectorCamera, pixelAngle: (2 * Math.tan(Math.PI / 6)) / 1000, frustum: new Float64Array(12) });
    const keys = (s: LodSelector): string => {
      const out: string[] = [];
      for (let k = 0; k < s.stats.leaves; k++) out.push(`${s.root[s.leaves[k]]}:${s.level[s.leaves[k]]}:${s.i[s.leaves[k]]}:${s.j[s.leaves[k]]}`);
      return out.sort().join(' ');
    };
    expect(keys(body.selector)).toBe(keys(fresh));
    body.dispose();
  });

  it("culling 'bent-bounds' keeps the frustum above morph 0 (for the selector's bent bounds), and 'off' puts it back", () => {
    const body = new LodTerrainBody(settings({ morph: true }));
    body.setMorph(morphSettings);
    const map = createMorphMap(morphSettings, 10_000);
    const camera = skyCamera(sceneCameraAt(map, 0.3, 0.4, 20));
    body.setMorphCulling('bent-bounds');
    body.update(camera, 1000);
    expect(body.stats.drawn).toBeLessThan(body.stats.leaves);
    body.setMorphCulling('off');
    body.update(camera, 1000);
    expect(body.stats.drawn).toBe(body.stats.leaves);
    body.dispose();
  });

  it('keeps the morph across a mesh rebuild', () => {
    const body = new LodTerrainBody(settings({ morph: true }));
    body.setMorph(morphSettings);
    const first = body.surface;
    body.configure(settings({ morph: true, patchCells: 32 }));
    expect(body.surface).not.toBe(first);
    expect(body.surface.morphState.morph).toBe(0.5);
    body.dispose();
  });

  it('ignores the morph on a plane and without the setting', () => {
    const plain = new LodTerrainBody(settings());
    expect(() => plain.setMorph(morphSettings)).not.toThrow();
    plain.update(skyCamera([0, 0, 10_020]), 1000);
    expect(plain.surface.morphState.morph).toBe(0);
    plain.dispose();
    const plane = new LodTerrainBody({ ...settings({ morph: true }), domain: { kind: 'plane', sizeM: 10_000, warp: 'none' }, heights: createHeightSource('flat', 'plane') });
    expect(() => plane.setMorph(morphSettings)).not.toThrow();
    plane.dispose();
  });

  it('setMorphMetric: a stretch hook is installed above morph 0 only, and is remade with each selector', () => {
    const body = new LodTerrainBody(settings({ morph: true }));
    body.setMorph(morphSettings);
    body.setMorphMetric(true);
    const camera = skyCamera(sceneCameraAt(createMorphMap(morphSettings, 10_000), 0.3, 0.4, 20));
    body.update(camera, 1000);
    expect(body.selector.hook).toBeInstanceOf(StretchMetric);
    expect(body.stats.drawn).toBeLessThan(body.stats.leaves);

    body.configure(settings({ morph: true, patchCells: 32 }));
    body.update(camera, 1000);
    expect(body.selector.hook).toBeInstanceOf(StretchMetric);

    body.setMorph({ ...morphSettings, morph: 0 });
    body.update(camera, 1000);
    expect(body.selector.hook).toBeUndefined();
    body.dispose();
  });

  it('setMorphMetric: dispose removes the hook from the selector', () => {
    const body = new LodTerrainBody(settings({ morph: true }));
    body.setMorph(morphSettings);
    body.setMorphMetric(true);
    body.update(skyCamera([0, 0, 10_020]), 1000);
    const selector = body.selector;
    expect(selector.hook).toBeInstanceOf(StretchMetric);
    body.dispose();
    expect(selector.hook).toBeUndefined();
  });

  it('the pole fan is in the scene only above morph 0', () => {
    const body = new LodTerrainBody(settings({ morph: true, poleFan: true }));
    body.setMorph({ ...morphSettings, morph: 0 });
    const camera = skyCamera([0, 0, 10_020]);
    body.update(camera, 1000);
    const fan = body.surface.poleFanMesh!;
    expect(fan).toBeDefined();
    expect(body.object.children).not.toContain(fan);

    body.setMorph(morphSettings);
    body.update(camera, 1000);
    expect(body.object.children).toContain(fan);

    body.setMorph({ ...morphSettings, morph: 0 });
    body.update(camera, 1000);
    expect(body.object.children).not.toContain(fan);
    body.dispose();
  });

  describe('a consumer geometry hook and the stretch metric are exclusive', () => {
    const hook: NodeGeometryHook = { measure: () => undefined };

    it('setGeometryHook(hook) throws while setMorphMetric(true) is on, and installs nothing', () => {
      const body = new LodTerrainBody(settings({ morph: true }));
      body.setMorph(morphSettings);
      body.setMorphMetric(true);
      expect(() => body.setGeometryHook(hook)).toThrowError(/setMorphMetric\(true\) is on/);
      expect(body.selector.hook).not.toBe(hook);
      body.dispose();
    });

    it('setMorphMetric(true) throws while a geometry hook is installed, and the metric stays off', () => {
      const body = new LodTerrainBody(settings({ morph: true }));
      body.setMorph(morphSettings);
      body.setGeometryHook(hook);
      expect(() => body.setMorphMetric(true)).toThrowError(/setGeometryHook\(undefined\)/);
      expect(body.selector.hook).toBe(hook);
      body.setGeometryHook(undefined);
      expect(() => body.setMorphMetric(true)).not.toThrow();
      body.dispose();
    });

    it('setGeometryHook(undefined) with the metric on does not throw and keeps the stretch hook', () => {
      const body = new LodTerrainBody(settings({ morph: true }));
      body.setMorph(morphSettings);
      body.setMorphMetric(true);
      body.update(skyCamera(sceneCameraAt(createMorphMap(morphSettings, 10_000), 0.3, 0.4, 20)), 1000);
      expect(body.selector.hook).toBeInstanceOf(StretchMetric);
      expect(() => body.setGeometryHook(undefined)).not.toThrow();
      expect(body.selector.hook).toBeInstanceOf(StretchMetric);
      body.dispose();
    });
  });

  describe('setMorphCulling is remembered across setMorphMetric', () => {
    /** A camera above morph 0 that a frustum would cut down to a few leaves. */
    const camera = (): PerspectiveCamera => skyCamera(sceneCameraAt(createMorphMap(morphSettings, 10_000), 0.3, 0.4, 20));

    it("'bent-bounds' set before the metric is restored when the metric is turned off", () => {
      const body = new LodTerrainBody(settings({ morph: true }));
      body.setMorph(morphSettings);
      body.setMorphCulling('bent-bounds');
      body.setMorphMetric(true);
      body.setMorphMetric(false);
      body.update(camera(), 1000);
      expect(body.stats.drawn).toBeLessThan(body.stats.leaves);
      body.dispose();
    });

    it('a culling mode set while the metric is on is the one restored when it is turned off', () => {
      const body = new LodTerrainBody(settings({ morph: true }));
      body.setMorph(morphSettings);
      body.setMorphCulling('bent-bounds');
      body.setMorphMetric(true);
      body.setMorphCulling('off');
      body.setMorphMetric(false);
      body.update(camera(), 1000);
      expect(body.stats.drawn).toBe(body.stats.leaves);
      body.dispose();
    });

    it('with nothing set before, turning the metric off gives culling off', () => {
      const body = new LodTerrainBody(settings({ morph: true }));
      body.setMorph(morphSettings);
      body.setMorphMetric(true);
      body.setMorphMetric(false);
      body.update(camera(), 1000);
      expect(body.stats.drawn).toBe(body.stats.leaves);
      body.dispose();
    });

    it('configure keeps the metric, the remembered culling and the exclusion of a consumer hook', () => {
      const hook: NodeGeometryHook = { measure: () => undefined };
      const body = new LodTerrainBody(settings({ morph: true }));
      body.setMorph(morphSettings);
      body.setMorphCulling('bent-bounds');
      body.setMorphMetric(true);
      body.update(camera(), 1000);
      const first = body.selector;
      body.configure(settings({ morph: true, patchCells: 32 }));
      expect(body.selector).not.toBe(first);
      body.update(camera(), 1000);
      expect(body.selector.hook).toBeInstanceOf(StretchMetric);
      expect(() => body.setGeometryHook(hook)).toThrow();
      body.setMorphMetric(false);
      body.update(camera(), 1000);
      expect(body.stats.drawn).toBeLessThan(body.stats.leaves);
      body.dispose();
    });

    it('configure re-applies a consumer hook to the new selector, and the metric still refuses to start', () => {
      const hook: NodeGeometryHook = { measure: () => undefined };
      const body = new LodTerrainBody(settings({ morph: true }));
      body.setGeometryHook(hook);
      body.configure(settings({ morph: true, patchCells: 32 }));
      expect(body.selector.hook).toBe(hook);
      expect(() => body.setMorphMetric(true)).toThrow();
      body.dispose();
    });
  });
});
