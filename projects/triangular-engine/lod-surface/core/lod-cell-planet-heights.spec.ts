import { cellPlanetHeights } from './lod-cell-planet-heights';
import type { BakeClient } from './lod-height-bake-client';
import { runBake } from './lod-height-noise';

/** A bake client that runs inline (as `createBakeClient` does without `Worker`) and records what it was asked. */
function recordingBake() {
  const calls: Parameters<BakeClient>[] = [];
  const bake: BakeClient = (source, layout, planet) => {
    calls.push([source, layout, planet]);
    return Promise.resolve({ ...runBake(source, layout, planet), roundTripMs: 0 });
  };
  return { bake, calls };
}

const SMALL = { seed: 5, cellCount: 120, relaxationIterations: 1, heightScaleM: 80, radius: 10_000, bakeK: 3 } as const;

describe('cellPlanetHeights', () => {
  it('sends the world parameters, the sphere layout and the sea-relative scale in the bake request', async () => {
    const { bake, calls } = recordingBake();
    const heights = await cellPlanetHeights(bake, SMALL);

    expect(calls.length).toBe(1);
    const [source, layout, planet] = calls[0];
    expect(source).toBe('cell-planet');
    expect(layout).toEqual({ kind: 'sphere', warp: 'equal-angle', sizeM: 10_000, k: 3 });
    expect(planet).toEqual({ seed: 5, cellCount: 120, relaxationIterations: 1, heightScaleM: 80 });

    expect(heights.id).toBe('cell-planet');
    expect(heights.baked.layout).toEqual(layout);
    // Relief in metres: a cell planet with sea and land has heights of both signs, bounded by the scale times its elevation span.
    expect(heights.boundM).toBeGreaterThan(0);
    heights.dispose();
  });

  it('survives postMessage, so the worker can rebuild the world from the request', async () => {
    const { bake, calls } = recordingBake();
    (await cellPlanetHeights(bake, SMALL)).dispose();
    const [, layout, planet] = calls[0];
    expect(structuredClone({ layout, planet })).toEqual({ layout, planet });
  });

  it('defaults to two relaxation iterations, the equal-angle warp and the default texture size', async () => {
    const calls: Parameters<BakeClient>[] = [];
    const bake: BakeClient = (source, layout, planet) => {
      calls.push([source, layout, planet]);
      return Promise.resolve({ ...runBake(source, { ...layout, k: 2 }, planet), roundTripMs: 0 });
    };
    (await cellPlanetHeights(bake, { seed: 5, cellCount: 60, heightScaleM: 80, radius: 10_000 })).dispose();
    expect(calls[0][2]?.relaxationIterations).toBe(2);
    expect(calls[0][1]).toEqual({ kind: 'sphere', warp: 'equal-angle', sizeM: 10_000, k: 10 });
  });

  it('passes a chosen warp through', async () => {
    const { bake, calls } = recordingBake();
    (await cellPlanetHeights(bake, { ...SMALL, warp: 'none' })).dispose();
    expect(calls[0][1].warp).toBe('none');
  });

  it('rejects invalid parameters before any bake starts', async () => {
    const { bake, calls } = recordingBake();
    await expectAsync(cellPlanetHeights(bake, { ...SMALL, cellCount: 3 })).toBeRejectedWithError(/cell planet description/);
    await expectAsync(cellPlanetHeights(bake, { ...SMALL, seed: -1 })).toBeRejectedWithError(/cell planet description/);
    await expectAsync(cellPlanetHeights(bake, { ...SMALL, heightScaleM: 0 })).toBeRejectedWithError(/cell planet description/);
    await expectAsync(cellPlanetHeights(bake, { ...SMALL, radius: 0 })).toBeRejectedWithError(/radius/);
    expect(calls.length).toBe(0);
  });
});
