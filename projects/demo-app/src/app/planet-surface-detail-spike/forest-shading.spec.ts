import { scatterPlanetLattice } from 'triangular-engine/scatter';
import { FOREST_SPACING_M, FOREST_TREE_HEIGHT_M, TREE_SEED, TREE_SIZE_RANGE, TREE_TONE_SALT, cellHash } from './forest-field';
import {
  CROWN_CENTRE_SHARE,
  LOOKUP_RADIUS_M,
  MIN_SUN_TAN,
  TREE_TONE_RANGE,
  crownLight,
  crownShadowOffsetM,
  forestAverage,
  forestAverageParts,
  forestPatternMean,
  patternFadeBand,
  shadowFactor,
  treeTone,
  treesNear,
} from './forest-shading';
import type { Vec3 } from './runway-site';

const RADIUS_M = 600_000;
const norm = (a: readonly number[]): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const deg = (d: number): number => (d * Math.PI) / 180;

describe('forest shading: crown shadows', () => {
  it('falls height / tan(elevation) from the foot, floored at about 2 degrees', () => {
    expect(crownShadowOffsetM(22, Math.tan(deg(45)))).toBeCloseTo(22, 6);
    expect(crownShadowOffsetM(22, Math.tan(deg(10)))).toBeCloseTo(22 / Math.tan(deg(10)), 6);
    expect(crownShadowOffsetM(22, 0.001)).toBeCloseTo(22 / MIN_SUN_TAN, 6);
    // The mean crown's shadow centre at 30 degrees: 0.56 x 22 m / tan 30.
    expect(crownShadowOffsetM(CROWN_CENTRE_SHARE * FOREST_TREE_HEIGHT_M, Math.tan(deg(30)))).toBeCloseTo(21.34, 1);
  });

  it('darkens shaded ground to the sky share, and not at all once the sun is down', () => {
    expect(shadowFactor(1)).toBeCloseTo(0.25, 6);
    expect(shadowFactor(0)).toBe(1);
    expect(shadowFactor(-0.3)).toBe(1);
    expect(shadowFactor(0.5)).toBeLessThan(shadowFactor(0.2));
  });
});

describe('forest shading: per-tree tone and crown light', () => {
  it('spreads tone by about ±12 % around a mean of 1 per channel', () => {
    const sum = [0, 0, 0];
    let lo = Infinity;
    let hi = -Infinity;
    const n = 20_000;
    for (let i = 0; i < n; i += 1) {
      const t = treeTone((i + 0.5) / n);
      t.forEach((c, k) => (sum[k] += c));
      lo = Math.min(lo, ...t);
      hi = Math.max(hi, ...t);
    }
    sum.forEach((s) => expect(s / n).toBeCloseTo(1, 2));
    expect(hi).toBeLessThan(1 + TREE_TONE_RANGE + 0.07);
    expect(lo).toBeGreaterThan(1 - TREE_TONE_RANGE - 0.07);
    expect(hi - lo).toBeGreaterThan(0.2);
  });

  it('lights the sun side of a crown above flat ground and the far side below it', () => {
    const sun = norm([Math.cos(deg(30)), 0, Math.sin(deg(30))]);
    const s = Math.sin(deg(30));
    // Tangent plane at the north pole of this frame: z is up, x points to the sun.
    expect(crownLight([4, 0, 0], 6, sun, s)).toBeGreaterThan(1.05);
    expect(crownLight([-4, 0, 0], 6, sun, s)).toBeLessThan(0.95);
    expect(crownLight([0, 0, 0], 6, sun, s)).toBeGreaterThan(0.9);
    // Sun down: nothing to shade.
    expect(crownLight([4, 0, 0], 6, norm([1, 0, -0.1]), -0.1)).toBe(1);
  });
});

describe('forest shading: tree lookup', () => {
  // Every scatter tree within the lookup radius is found, with the same draws, on faces tilted against the lattice.
  for (const direction of [
    [0, 0, 1],
    [0.3, 0.5, 0.81],
    [0.6, 0.55, 0.58],
    [-0.7, 0.1, -0.7],
  ]) {
    it(`finds the scatter's trees around ${direction.join(', ')}`, () => {
      const c = norm(direction);
      const scatter = scatterPlanetLattice(
        { id: 'trees', generatorVersion: 1, seed: TREE_SEED, cellSizeM: FOREST_SPACING_M, sizeRange: TREE_SIZE_RANGE, density: () => 1 },
        { centre: c, radiusM: RADIUS_M, windowRadiusM: 90, heightAt: () => 0 },
      );
      const trees: Vec3[] = [];
      const tones: number[] = [];
      for (let i = 0; i < scatter.scale.length; i += 1) {
        trees.push(norm([0, 1, 2].map((k) => scatter.offsetsM[i * 3 + k] + c[k] * RADIUS_M)));
        tones.push(cellHash(scatter.cells[i * 3], scatter.cells[i * 3 + 1], scatter.cells[i * 3 + 2], TREE_SEED * 8 + TREE_TONE_SALT));
      }
      const east = norm([-c[2], 0.001, c[0]]);
      const north: Vec3 = [c[1] * east[2] - c[2] * east[1], c[2] * east[0] - c[0] * east[2], c[0] * east[1] - c[1] * east[0]];
      let checked = 0;
      let missing = 0;
      for (let s = 0; s < 150; s += 1) {
        const r = 45 * Math.sqrt((s + 0.5) / 150);
        const angle = s * 2.4;
        const p = [0, 1, 2].map((k) => c[k] * (RADIUS_M + 50) + east[k] * r * Math.cos(angle) + north[k] * r * Math.sin(angle)) as unknown as Vec3;
        const pn = norm(p);
        const found = treesNear(p, RADIUS_M, 1).map((f) => ({ at: norm([0, 1, 2].map((k) => pn[k] * RADIUS_M + f.offset[k])), tone: f.toneDraw }));
        trees.forEach((t, i) => {
          const d = Math.hypot(...[0, 1, 2].map((k) => (t[k] - pn[k]) * RADIUS_M));
          if (d >= LOOKUP_RADIUS_M - 0.1) return;
          checked += 1;
          const hit = found.find((f) => Math.hypot(...[0, 1, 2].map((k) => (f.at[k] - t[k]) * RADIUS_M)) < 0.05);
          if (!hit) missing += 1;
          else expect(Math.abs(hit.tone - tones[i])).toBeLessThan(1e-6);
        });
      }
      expect(checked).toBeGreaterThan(100);
      expect(missing).toBe(0);
    });
  }
});

describe('forest shading: average fade', () => {
  it('fades the pattern from 3 px to 2 px a crown', () => {
    const band = patternFadeBand();
    expect(band.startM).toBeCloseTo(4000, 6);
    expect(band.endM).toBeCloseTo(6000, 6);
  });

  it('keeps the average a weighted blend: full cover darkens, no forest leaves the ground', () => {
    expect(forestAverage(0.7, 0)).toEqual({ ground: 1, tree: 0 });
    const solid = forestAverage(0.7, 1);
    expect(solid.ground).toBeLessThan(0.45);
    expect(solid.tree).toBeGreaterThan(0.55);
    // Lower sun, longer shadows: more of the visible ground is shaded (near noon a shadow falls under its own crown).
    // How dark a shadow is runs the other way: at low sun the direct light it removes is small against the sky.
    expect(forestAverageParts(Math.sin(deg(20)), 1).shade).toBeGreaterThan(forestAverageParts(Math.sin(deg(85)), 1).shade);
    expect(shadowFactor(Math.sin(deg(8)))).toBeGreaterThan(shadowFactor(Math.sin(deg(60))));
    // No crowns (instances draw them): the cover term drops out.
    expect(forestAverage(0.7, 1, 0).tree).toBe(0);
  });

  // The fit against the pattern's own mean: what keeps the 4-6 km blend free of a brightness step.
  for (const [elevation, density] of [
    [60, 1],
    [20, 0.6],
    [6, 1],
  ]) {
    it(`matches the pattern's mean at ${elevation} degrees, density ${density}`, () => {
      const mean = forestPatternMean({ radiusM: RADIUS_M, centre: norm([0.3, 0.5, 0.81]), sunElevationDeg: elevation, density, samples: 500, azimuthsDeg: [0, 90, 220] });
      const fitted = forestAverage(Math.sin(deg(elevation)), density);
      const parts = forestAverageParts(Math.sin(deg(elevation)), density);
      expect(Math.abs(parts.cover - mean.cover)).toBeLessThan(0.03);
      expect(Math.abs(fitted.ground - mean.ground)).toBeLessThan(0.03);
      expect(Math.abs(fitted.tree - mean.tree)).toBeLessThan(0.03);
    });
  }
});
