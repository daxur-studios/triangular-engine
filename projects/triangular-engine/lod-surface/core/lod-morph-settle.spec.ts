import { frustumNormals } from './lod-view';
import { LodSelector, type SelectorView } from './lod-selector';
import { MorphMapResolver, type LodMorphSettings } from './lod-morph-frame';
import { StretchMetric } from './lod-morph-metric';
import { LodTerrainBody } from './lod-terrain-body';
import { ASPECT, PIXEL_ANGLE, RADIUS_M, VIEWPORT_PX, orbitView, pageHeights, pageTerrainSettings } from './lod-morph-sweep.testing';

/**
 * Plan 059, G6 (the morph sweep's stable view): after a morph animation the selection is the one a fresh selector gets.
 *
 * A body animates the morph `0 -> 1` in 0.01 steps (each step is a node refresh, so the geometry is measured at exactly the morph the
 * step lands on), then holds at morph 1 until the refresh has settled. Its drawn leaves are compared with those of a new selector, with a
 * new stretch metric that measures the whole tree in one pass (`refreshBudget: Infinity`), at morph 1 on the same camera.
 *
 * The claim: the selection does not depend on how the morph was reached. Exact equality is not the bar: the tree keeps last frame's split
 * flags (hysteresis), and both selectors hit the leaf cap, so which nodes fill the last slots can depend on history. The spec asserts the
 * drawn leaf counts agree within 2 %, that the drawn sets differ by at most 5 % of the larger one (symmetric difference), and that the
 * leaf count of each level agrees within 5 % of that total. The measures are logged as `LOD_MORPH_SETTLE` for inspection.
 */
describe('LOD morph settle (stable view, one-pass fresh selection)', () => {
  it('after the morph animation to 1 and its settled refresh, the drawn leaves are those of a fresh selection at morph 1', async () => {
    const heights = await pageHeights();
    const body = new LodTerrainBody(pageTerrainSettings(heights));
    const morph: LodMorphSettings & { morph: number } = { morph: 0, projection: 'equal-earth', projectionCentre: { lonDeg: 0, latDeg: 0 } };
    body.setMorph(morph);
    body.setMorphMetric(true);
    const orbit = orbitView(body);

    // The animation: 100 steps of 0.01, each one a refresh of the node geometry.
    for (let step = 0; step <= 100; step++) {
      morph.morph = step / 100;
      body.update(orbit.camera, VIEWPORT_PX);
    }
    // Hold at morph 1 until the last refresh has settled (its measures are spread over passes), then one more frame to see it stay put.
    let held = 0;
    while (body.selector.stats.geometryStale > 0 && held < 500) {
      body.update(orbit.camera, VIEWPORT_PX);
      held++;
    }
    body.update(orbit.camera, VIEWPORT_PX);
    expect(body.selector.stats.geometryStale).toBe(0);
    const bodyLeaves = drawnKeys(body.selector);

    // The fresh selection: a new selector, one-pass refresh, the same camera (the body's bent camera at morph 1) and frustum.
    const fresh = new LodSelector(body.selector.settings);
    const metric = new StretchMetric(fresh, { radiusM: RADIUS_M, refreshBudget: Infinity });
    const resolver = new MorphMapResolver();
    const map = resolver.resolve(morph, RADIUS_M);
    metric.update({ morph: map.morph, projection: map.projection, radiusM: map.radius, basis: map.basis });
    const bent = metric.placeCamera(orbit.position);
    const frustum = new Float64Array(12);
    frustumNormals(orbit.axes, orbit.frustumFov, ASPECT, frustum);
    const view: SelectorView = { camera: bent, pixelAngle: PIXEL_ANGLE, frustum };
    fresh.select(view);
    expect(fresh.stats.geometryStale).toBe(0);
    const freshLeaves = drawnKeys(fresh);

    const only = (a: Set<string>, b: Set<string>): number => [...a].filter((k) => !b.has(k)).length;
    const onlyBody = only(bodyLeaves, freshLeaves);
    const onlyFresh = only(freshLeaves, bodyLeaves);
    // The set bound: the symmetric difference of the two drawn sets is at most 5 % of the larger one. Per level, the count of leaves
    // differs by at most 5 % of that same larger total. (5 % is the decision: hysteresis and the leaf cap make exact equality impossible.)
    const largerSet = Math.max(bodyLeaves.size, freshLeaves.size);
    const symmetricShare = (onlyBody + onlyFresh) / largerSet;
    const bodyByLevel = drawnLevelCounts(body.selector);
    const freshByLevel = drawnLevelCounts(fresh);
    const levelDiffs = bodyByLevel.map((count, level) => Math.abs(count - freshByLevel[level]!));
    const worstLevel = levelDiffs.indexOf(Math.max(...levelDiffs));
    console.log(
      `LOD_MORPH_SETTLE ${JSON.stringify({
        held, bodyDrawn: bodyLeaves.size, freshDrawn: freshLeaves.size, onlyBody, onlyFresh, symmetricShare, bodyCapHit: body.selector.stats.capHit,
        freshCapHit: fresh.stats.capHit, measuredMorph: metric.measuredMorph, worstLevel, worstLevelShare: levelDiffs[worstLevel]! / largerSet,
      })}`,
    );
    expect(metric.measuredMorph).toBe(1);
    // Within 2 % of the fresh count (see the header for why this is not exact equality).
    expect(Math.abs(bodyLeaves.size - freshLeaves.size) / freshLeaves.size).toBeLessThan(0.02);
    // Same leaves to within hysteresis churn: at most 5 % of the larger drawn set differs. Measured (first run, morph 1, held 7
    // frames until settled): 141 leaves only in the body and 169 only in the fresh selection, 310 of 2997 = 10.3 %, so this assertion FAILS as an
    // expected failure; the bound is not raised. The per-level check below passes (worst level 4: 2.4 %).
    expect(symmetricShare).toBeLessThanOrEqual(0.05);
    // And per level, the leaf counts agree to within 5 % of that total.
    for (let level = 0; level < levelDiffs.length; level++) {
      expect(levelDiffs[level]! / largerSet).withContext(`level ${level}`).toBeLessThanOrEqual(0.05);
    }
    metric.dispose();
    body.dispose();
  }, 120_000);
});

/** The number of drawn leaves at each level of a selector, indexed by level. */
function drawnLevelCounts(selector: LodSelector): number[] {
  const counts = new Array<number>(selector.maxLevel + 1).fill(0);
  const { leaves, level } = selector;
  for (let k = 0; k < selector.stats.drawn; k++) counts[level[leaves[k]!]!]!++;
  return counts;
}

/** The drawn leaves of a selector as `root:level:i:j` keys (node indices differ between selectors). */
function drawnKeys(selector: LodSelector): Set<string> {
  const keys = new Set<string>();
  const { leaves, level, i, j, root } = selector;
  for (let k = 0; k < selector.stats.drawn; k++) {
    const node = leaves[k];
    keys.add(`${root[node]}:${level[node]}:${i[node]}:${j[node]}`);
  }
  return keys;
}
