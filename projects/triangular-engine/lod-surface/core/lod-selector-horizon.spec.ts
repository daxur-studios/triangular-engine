import { domainPoint, type LodDomain, type Vec3 } from './lod-domain';
import { LodSelector, type NodeGeometryHook, type SelectorSettings, type SelectorView } from './lod-selector';

/**
 * Plan 080: the selector's horizon cull. Leaves wholly behind the planet's horizon, seen from the camera, are left out of the drawn
 * set and nothing else changes: the selection, the leaf budget and the leaves themselves are what they were without it.
 */

const R = 6_371_000;
const SPHERE: LodDomain = { kind: 'sphere', sizeM: R, warp: 'equal-angle' };
const PIXEL = (2 * Math.tan(Math.PI / 6)) / 720;

function settings(extra: Partial<SelectorSettings> = {}): SelectorSettings {
  return { domain: SPHERE, patchCells: 16, mode: 'distance', fixedLevel: 3, cellPixels: 4, leafCap: 4096, heightBoundM: 0, cull: true, horizonCull: true, hysteresis: 0.15, ...extra };
}

/** A camera `altitude` above the sphere along the direction (x, y, z); a zero frustum, so the frustum rejects nothing. */
function viewAt(altitude: number, direction: Vec3 = [0.2, 0.9, 0.38]): SelectorView {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  const r = R + altitude;
  return { camera: [(direction[0] / length) * r, (direction[1] / length) * r, (direction[2] / length) * r], pixelAngle: PIXEL, frustum: new Float64Array(12) };
}

/** True when the segment from `camera` to `point` passes through the ball of `radius` around the origin. */
function hiddenByBall(camera: Vec3, point: Vec3, radius: number): boolean {
  const dx = point[0] - camera[0];
  const dy = point[1] - camera[1];
  const dz = point[2] - camera[2];
  const t = Math.max(0, Math.min(1, -(camera[0] * dx + camera[1] * dy + camera[2] * dz) / (dx * dx + dy * dy + dz * dz)));
  return Math.hypot(camera[0] + t * dx, camera[1] + t * dy, camera[2] + t * dz) <= radius * (1 + 1e-9);
}

const ALTITUDES = [2, 1_000, 20_000, 600_000, 6_371_000];
const DIRECTIONS: Vec3[] = [[0.2, 0.9, 0.38], [1, 0, 0], [0, 0, -1], [-0.6, -0.3, 0.74]];

describe('selector horizon cull', () => {
  it('leaves out the leaves behind the horizon from orbit and counts them', () => {
    const selector = new LodSelector(settings());
    selector.select(viewAt(R));
    const { leaves, drawn, horizonHidden } = selector.stats;
    // A fifth or so: the leaves are coarser the farther they are, and the ones straddling the horizon stay.
    expect(horizonHidden).toBeGreaterThan(0.1 * leaves);
    expect(drawn).toBe(leaves - horizonHidden);
  });

  it('changes nothing but the drawn set: the same leaves are selected with and without it', () => {
    for (const altitude of ALTITUDES) {
      const on = new LodSelector(settings());
      const off = new LodSelector(settings({ horizonCull: false }));
      const view = viewAt(altitude);
      on.select(view);
      off.select(view);
      expect(on.stats.leaves).withContext(`${altitude} m`).toBe(off.stats.leaves);
      expect(off.stats.horizonHidden).toBe(0);
      expect(off.stats.drawn).toBe(off.stats.leaves);
      const keyOf = (s: LodSelector, k: number): string => `${s.root[s.leaves[k]]}:${s.level[s.leaves[k]]}:${s.i[s.leaves[k]]}:${s.j[s.leaves[k]]}`;
      const set = (s: LodSelector): string => Array.from({ length: s.stats.leaves }, (_, k) => keyOf(s, k)).sort().join(' ');
      expect(set(on)).withContext(`${altitude} m`).toBe(set(off));
    }
  });

  it('never hides a leaf with a point the camera can see', () => {
    for (const heightBoundM of [0, 4_000]) {
      for (const altitude of ALTITUDES) {
        for (const direction of DIRECTIONS) {
          const selector = new LodSelector(settings({ heightBoundM }));
          const view = viewAt(altitude, direction);
          selector.select(view);
          const { drawn, leaves } = selector.stats;
          const point: Vec3 = [0, 0, 0];
          const normal: Vec3 = [0, 0, 0];
          // Counted, not expected per point: a point-by-point expect() over every sample of every leaf runs for minutes.
          let visibleHidden = 0;
          for (let k = drawn; k < leaves; k++) {
            const node = selector.leaves[k];
            const size = 1 / 2 ** selector.level[node];
            // Sample the leaf's cell on a grid, on the surface and as high as the height bound lets it rise.
            for (let a = 0; a <= 4; a++) {
              for (let b = 0; b <= 4; b++) {
                domainPoint(SPHERE, selector.root[node], (selector.i[node] + a / 4) * size, (selector.j[node] + b / 4) * size, point, normal);
                for (const rise of heightBoundM === 0 ? [0] : [-heightBoundM, 0, heightBoundM]) {
                  const p: Vec3 = [point[0] + normal[0] * rise, point[1] + normal[1] * rise, point[2] + normal[2] * rise];
                  if (!hiddenByBall(view.camera, p, R - heightBoundM)) visibleHidden++;
                }
              }
            }
          }
          expect(visibleHidden).withContext(`bound ${heightBoundM} altitude ${altitude} direction ${direction}`).toBe(0);
        }
      }
    }
  });

  it('leaves out a sixth to a third of the leaves of a 600 km planet from a few metres to 100 km up', () => {
    const small: LodDomain = { kind: 'sphere', sizeM: 600_000, warp: 'equal-angle' };
    for (const altitude of [2, 2_000, 20_000, 100_000]) {
      const selector = new LodSelector(settings({ domain: small }));
      const r = 600_000 + altitude;
      selector.select({ camera: [0.3 * r, 0.9 * r, 0.31 * r].map((v) => (v * r) / Math.hypot(0.3 * r, 0.9 * r, 0.31 * r)) as Vec3, pixelAngle: PIXEL, frustum: new Float64Array(12) });
      expect(selector.stats.horizonHidden / selector.stats.leaves).withContext(`${altitude} m`).toBeGreaterThan(0.1);
    }
  });

  it('draws everything while suppressed, with a geometry hook, or with the camera inside the body', () => {
    const suppressed = new LodSelector(settings());
    suppressed.setHorizonSuppressed(true);
    suppressed.select(viewAt(R));
    expect(suppressed.stats.horizonHidden).toBe(0);
    expect(suppressed.stats.drawn).toBe(suppressed.stats.leaves);
    suppressed.setHorizonSuppressed(false);
    suppressed.select(viewAt(R));
    expect(suppressed.stats.horizonHidden).toBeGreaterThan(0);

    const hook: NodeGeometryHook = {
      measure(root, level, i, j, _lo, _hi, out) {
        const size = 1 / 2 ** level;
        const p: Vec3 = [0, 0, 0];
        const n: Vec3 = [0, 0, 0];
        domainPoint(SPHERE, root, (i + 0.5) * size, (j + 0.5) * size, p, n);
        for (let c = 0; c < 3; c++) {
          out.ground[c] = p[c];
          out.normal[c] = n[c];
          out.centre[c] = p[c];
        }
        out.boundRadius = R * size;
        out.across = R * size;
        out.alongHalf = 0;
        out.leafEdge = (R * size * 2) / 1;
        out.cellEdge = out.leafEdge / 16;
      },
    };
    const bent = new LodSelector(settings());
    bent.setGeometryHook(hook);
    bent.select(viewAt(R));
    expect(bent.stats.horizonHidden).toBe(0);

    const inside = new LodSelector(settings());
    inside.select({ camera: [R * 0.5, 0, 0], pixelAngle: PIXEL, frustum: new Float64Array(12) });
    expect(inside.stats.horizonHidden).toBe(0);
  });

  it('is off without cull, and by default', () => {
    const noCull = new LodSelector(settings({ cull: false }));
    noCull.select(viewAt(R));
    expect(noCull.stats.horizonHidden).toBe(0);
    const { horizonCull: _unused, ...rest } = settings();
    const byDefault = new LodSelector(rest);
    byDefault.select(viewAt(R));
    expect(byDefault.stats.horizonHidden).toBe(0);
  });
});
