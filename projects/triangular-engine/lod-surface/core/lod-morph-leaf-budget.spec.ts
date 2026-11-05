import type { LodMorphSettings } from './lod-morph-frame';
import { LodTerrainBody } from './lod-terrain-body';
import { VIEWPORT_PX, orbitView, pageHeights, pageTerrainSettings } from './lod-morph-sweep.testing';

/**
 * The demo's `planet-scene` orbit pose, selected to rest at a fixed morph: how many leaves the morphed surface draws.
 *
 * Near a pole of the projection every leaf maps to a strip as wide as a sizeable part of the map whatever its level, so a metric that
 * counts the strip's long side asks for the deepest level around both poles: at the orbit pose that was about 2,000 of the 4,096
 * leaves (3,079 drawn at morph 1 at the page's 1308 px drawing buffer, against 1,197 at morph 0), and the frame time went with it.
 */

const SETTLE_FRAMES = 60;

describe('morphed surface: the leaves the orbit pose draws', () => {
  const cases: readonly { readonly morph: number; readonly maxDrawn: number }[] = [
    { morph: 0, maxDrawn: 1300 },
    { morph: 0.5, maxDrawn: 2300 },
    { morph: 1, maxDrawn: 2300 },
  ];
  for (const { morph: m, maxDrawn } of cases) {
    it(`morph ${m}: no runaway refinement, at most ${maxDrawn} drawn leaves`, async () => {
      const heights = await pageHeights();
      const body = new LodTerrainBody(pageTerrainSettings(heights));
      const morph: LodMorphSettings & { morph: number } = { morph: m, projection: 'equal-earth', projectionCentre: { lonDeg: 0, latDeg: 0 } };
      body.setMorph(morph);
      const { camera } = orbitView(body);
      body.setMorphMetric(m > 0);
      for (let f = 0; f < SETTLE_FRAMES; f++) body.update(camera, VIEWPORT_PX);
      const stats = body.selector.stats;
      body.dispose();
      expect(stats.geometryStale).toBe(0);
      expect(stats.capHit).toBe(false);
      expect(stats.deepestLevel).toBeLessThanOrEqual(12);
      expect(stats.drawn).toBeLessThanOrEqual(maxDrawn);
    }, 60_000);
  }
});
