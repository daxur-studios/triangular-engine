import { domainPreset } from './lod-domain';
import type { NodeHeightRanges } from './lod-height';
import { LodSelector, type SelectorSettings, type SelectorView } from './lod-selector';

/**
 * Plan 059: the distance criterion measures to each node's split box (ground radius by height range), not to its bounding
 * sphere. The sphere adds half the height range in every direction, so over a tall range (a cliff wall) a camera beside
 * the wall was "inside" nodes whose surface was far off, and they split to the deepest level: a hotspot.
 */

const plane = domainPreset('plane-100km');

/** Every node spans [lo, hi], whatever its size: the worst case of a tall wall under the camera. */
const constantRange = (lo: number, hi: number): NodeHeightRanges => ({ nodeRange: (_root, _level, _i, _j, out) => { out[0] = lo; out[1] = hi; } });

function settingsWith(heightRanges: NodeHeightRanges): SelectorSettings {
  return { domain: plane, patchCells: 16, mode: 'distance', fixedLevel: 3, cellPixels: 4, leafCap: 60_000, heightBoundM: 0, heightRanges, cull: false };
}

/** The plane's normal is +Y; the camera is 3 km off the centre across the ground, `height` metres up. */
function view(height: number): SelectorView {
  return { camera: [3000, height, -2000], pixelAngle: (2 * Math.tan(Math.PI / 6)) / 1440, frustum: new Float64Array(12) };
}

function treeOf(selector: LodSelector): string {
  const keys: string[] = [];
  for (let k = 0; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    keys.push(`${selector.level[node]}:${selector.i[node]}:${selector.j[node]}`);
  }
  return keys.sort().join(' ');
}

function select(ranges: NodeHeightRanges, height: number): LodSelector {
  const selector = new LodSelector(settingsWith(ranges));
  selector.select(view(height));
  return selector;
}

describe('Plan 059 selector split distance', () => {
  it('gives a camera inside a 1 km height range the same tree as flat ground at the camera height', () => {
    const tall = select(constantRange(-500, 500), 0);
    const flat = select(constantRange(0, 0), 0);
    expect(treeOf(tall)).toBe(treeOf(flat));
  });

  it('measures height above the range: 100 m over a range topping at 500 m splits like 100 m over flat ground', () => {
    const tall = select(constantRange(-500, 500), 600);
    const flat = select(constantRange(0, 0), 100);
    expect(treeOf(tall)).toBe(treeOf(flat));
  });

  it('splits far less over a tall range than the bounding-sphere distance would', () => {
    const selector = select(constantRange(-500, 500), 0);
    let sphereDeeper = 0;
    for (let k = 0; k < selector.stats.leaves; k++) {
      const node = selector.leaves[k];
      const c = node * 3;
      const sphere = Math.max(Math.hypot(selector.center[c] - 3000, selector.center[c + 1], selector.center[c + 2] + 2000) - selector.radius[node], 1e-3);
      if (sphere < selector.gap(node, view(0).camera) / 2) sphereDeeper++;
    }
    // Every leaf within about 500 m of the camera reads as "inside" its sphere; the box puts each at its real ground distance.
    expect(sphereDeeper).toBeGreaterThan(0);
  });
});
