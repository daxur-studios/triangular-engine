import { PerspectiveCamera } from 'three';
import { createHeightSource } from './lod-height';
import { DEFAULT_BAKE_K } from './lod-height-bake';
import { runBake } from './lod-height-noise';
import { createTextureHeightSource } from './lod-height-texture';
import { LodTerrainBody, TERRAIN_DEFAULTS, type LodTerrainSettings } from './lod-terrain-body';

const sphere = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' } as const;

function settings(over: Partial<LodTerrainSettings> = {}): LodTerrainSettings {
  return { domain: sphere, heights: createHeightSource('flat', 'sphere'), detailNoise: 0, leafCap: 256, cellPixels: 4, patchCells: 16, hysteresis: 0.15, cull: true, ...over };
}

describe('LodTerrainBody', () => {
  it('defaults match the lab defaults of 2026-10-29', () => {
    expect(TERRAIN_DEFAULTS).toEqual({ patchCells: 16, cellPixels: 4, leafCap: 4096, hysteresis: 0.15, detailNoise: 0.04 });
  });

  it('refuses baked heights made for another domain, and accepts matching ones', () => {
    const layout = { kind: 'sphere', warp: 'equal-angle', sizeM: 10_000, k: 4 } as const;
    const { baked } = runBake('noise', layout);
    const heights = createTextureHeightSource('noise', baked);
    expect(() => new LodTerrainBody(settings({ heights, domain: { ...sphere, sizeM: 600_000 } }))).toThrowError(/baked for a sphere of 10000 m/);
    expect(() => new LodTerrainBody(settings({ heights, domain: { ...sphere, warp: 'none' } }))).toThrowError(/warp/);
    const body = new LodTerrainBody(settings({ heights }));
    expect(body.selector.settings.heightBoundM).toBe(baked.boundM);
    expect(body.selector.settings.heightRanges).toBeDefined();
    body.dispose();
    heights.dispose();
  });

  it('sizes detail noise by the baked texture, else by the default bake size', () => {
    const analytic = new LodTerrainBody(settings({ detailNoise: 0.04 }));
    const layout = { kind: 'sphere', warp: 'equal-angle', sizeM: 10_000, k: 4 } as const;
    const heights = createTextureHeightSource('noise', runBake('noise', layout).baked);
    const baked = new LodTerrainBody(settings({ heights, detailNoise: 0.04 }));
    // Texel of a 2^k texture across a face of the 10 km sphere: the coarser the texture, the larger the noise bound.
    const bound = (body: LodTerrainBody) => body.source.boundM - body.settings.heights.boundM;
    expect(bound(analytic)).toBeGreaterThan(0);
    expect(bound(baked)).toBeCloseTo(bound(analytic) * 2 ** (DEFAULT_BAKE_K - 4), 6);
    analytic.dispose();
    baked.dispose();
    heights.dispose();
  });

  it('selects from a perspective camera and parents the mesh at the camera', () => {
    const body = new LodTerrainBody(settings());
    const camera = new PerspectiveCamera(60, 2, 1, 1e9);
    camera.position.set(10, 20, 10_200);
    body.update(camera, 1000);
    expect(body.stats.leaves).toBeGreaterThan(6);
    expect(body.object.position.toArray()).toEqual([10, 20, 10_200]);
    expect(body.selectionMs).toBeGreaterThanOrEqual(0);
    const leaves = body.stats.leaves;

    // A taller viewport means finer pixels: more cells per pixel angle, so a deeper tree.
    camera.position.set(10, 20, 10_020);
    body.update(camera, 4000);
    expect(body.stats.leaves).toBeGreaterThanOrEqual(leaves);
    body.dispose();
    expect(body.object.parent).toBeNull();
  });

  it('keeps debug switches across a mesh rebuild', () => {
    const body = new LodTerrainBody(settings());
    body.setView('shaded');
    body.setWireframe(true);
    const first = body.surface.mesh;
    body.configure(settings({ patchCells: 32 }));
    expect(body.surface.mesh).not.toBe(first);
    expect((body.surface.material as unknown as { wireframe: boolean }).wireframe).toBeTrue();
    body.dispose();
  });
});
