import { PerspectiveCamera } from 'three';
import { createHeightSource } from './lod-height';
import { createMorphMap } from './lod-morph-frame';
import { sceneCameraAt } from './lod-morph.testing';
import { LodSelector } from './lod-selector';
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
});
