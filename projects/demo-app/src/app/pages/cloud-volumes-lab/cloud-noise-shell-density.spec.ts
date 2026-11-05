import {
  CLOUD_SHELL_LAB, CLOUD_SHELL_TEXTURE_RANGE, CLOUD_SHELL_TILE_CELLS, CloudShellGeometry, bakeShellNoise, fractalNoise, shellAlpha, tiledFractal,
} from './cloud-noise-shell-density';
import { shellIntervals } from './cloud-noise-shell-interval';

type Vec3 = [number, number, number];
type AlphaOf = (origin: Vec3, dir: Vec3) => number;

const LAB: CloudShellGeometry = {
  planetRadius: CLOUD_SHELL_LAB.planetRadius,
  innerRadius: CLOUD_SHELL_LAB.planetRadius + CLOUD_SHELL_LAB.baseAltitude,
  outerRadius: CLOUD_SHELL_LAB.planetRadius + CLOUD_SHELL_LAB.baseAltitude + CLOUD_SHELL_LAB.thickness,
};
const labAlpha: AlphaOf = (o, d) => shellAlpha(o, d, LAB);

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/**
 * The shader as it was when the owner reported an empty planet disc and a smooth band at the limb: 1/2600 noise on an
 * unshifted domain, coverage 0.4, extinction 0.04, 1400 m march cap, floor 150 m, 320 m thick. The specs check that it
 * fails, so they would have caught it.
 */
const legacyAlpha: AlphaOf = (o, d) => {
  const { near, far } = shellIntervals(o, d, 2000, 2150, 2470);
  let transmittance = 1;
  for (const s of [near, far]) {
    const length = Math.min(Math.max(s.end - s.start, 0), 1400);
    if (length <= 0) continue;
    const count = Math.min(Math.max(Math.ceil(length / 60), 6), 40);
    const dt = length / count;
    for (let i = 0; i < count && transmittance >= 0.02; i++) {
      const t = s.start + (i + 0.5) * dt;
      const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const h = (Math.hypot(p[0], p[1], p[2]) - 2150) / 320;
      const n = fractalNoise(p[0] / 2600, p[1] / 2600, p[2] / 2600) * 0.5 + 0.5;
      const density = smoothstep(0.55, 0.73, n) * smoothstep(0, 0.18, h) * smoothstep(1, 0.55, h);
      transmittance *= Math.exp(-density * 0.04 * dt);
    }
  }
  return 1 - transmittance;
};

/** Evenly spread unit vectors (Fibonacci sphere). */
const sphere = (n: number): Vec3[] =>
  Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  });
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const spread = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));

/** Straight down from 7 km over the whole planet: what the disc looks like from orbit, point by point. */
function faceOn(alpha: AlphaOf) {
  const samples = sphere(300).map((u) => ({ u, a: alpha([u[0] * 7000, u[1] * 7000, u[2] * 7000], [-u[0], -u[1], -u[2]]) }));
  const a = samples.map((s) => s.a);
  const imbalance = Math.max(
    ...[0, 1, 2].map((k) =>
      Math.abs(mean(samples.filter((s) => s.u[k] > 0).map((s) => s.a)) - mean(samples.filter((s) => s.u[k] <= 0).map((s) => s.a))),
    ),
  );
  return {
    clear: a.filter((x) => x < 0.05).length / a.length,
    partial: a.filter((x) => x >= 0.05 && x <= 0.95).length / a.length,
    spread: spread(a),
    imbalance,
  };
}

/** Rays from 7 km on +Z that pass the planet centre at distance `r0`, at `n` angles around the silhouette. */
const limbRays = (r0: number, n = 90): { o: Vec3; d: Vec3 }[] =>
  Array.from({ length: n }, (_, k) => {
    const phi = (k / n) * 2 * Math.PI;
    const a = Math.asin(r0 / 7000);
    return { o: [0, 0, 7000], d: [Math.sin(a) * Math.cos(phi), Math.sin(a) * Math.sin(phi), -Math.cos(a)] };
  });

describe('cloud noise shell: what a ray sees', () => {
  describe('the planet disc from orbit', () => {
    it('is mostly covered, with partly transparent cloud edges and clear gaps (cumulus structure, not all-or-nothing)', () => {
      const f = faceOn(labAlpha);
      expect(f.partial).toBeGreaterThan(0.35);
      expect(f.clear).toBeGreaterThan(0.08);
      expect(f.clear).toBeLessThan(0.4);
      expect(f.spread).toBeGreaterThan(0.2);
    });

    it('has the same cover on every side of the planet', () => {
      // Gradient noise is zero on lattice points; with the planet centre on one, the lowest octave was a ramp across the
      // planet and one hemisphere stayed clear.
      expect(faceOn(labAlpha).imbalance).toBeLessThan(0.15);
    });

    it('fails both checks with the shader as it was reported (the regression this guards)', () => {
      const f = faceOn(legacyAlpha);
      // About three quarters of the disc was empty and the rest mostly opaque.
      expect(f.clear).toBeGreaterThan(0.6);
      expect(f.partial).toBeLessThan(0.35);
      expect(f.imbalance).toBeGreaterThan(0.15);
    });
  });

  describe('the limb', () => {
    it('does not show the outer sphere as a circle: rays grazing the top of the shell are almost clear', () => {
      const top = limbRays(LAB.outerRadius - 15).map(({ o, d }) => labAlpha(o, d));
      expect(mean(top)).toBeLessThan(0.05);
      const legacyTop = limbRays(2470 - 15).map(({ o, d }) => legacyAlpha(o, d));
      expect(mean(legacyTop)).toBeGreaterThan(0.05);
    });

    it('varies along the silhouette instead of forming a constant band', () => {
      for (const height of [0.4, 0.6]) {
        const r0 = LAB.innerRadius + height * (LAB.outerRadius - LAB.innerRadius);
        const a = limbRays(r0).map(({ o, d }) => labAlpha(o, d));
        expect(spread(a)).toBeGreaterThan(0.1, `tangent height ${height}`);
      }
    });

    it('has almost no gap under the cloud floor to see the far side of the shell through', () => {
      // Rays between the planet's edge and the floor's edge pass under the deck and see the far shell. With a 150 m floor
      // that was a 150 m wide band outside the planet's silhouette: a smooth second arc. Measure the band directly.
      const width = (planet: number, inner: number, outer: number) => {
        let w = 0;
        for (let r0 = planet; r0 <= outer; r0 += 1) {
          const [{ o, d }] = limbRays(r0, 1);
          const far = shellIntervals(o, d, planet, inner, outer).far;
          if (far.end > far.start) w += 1;
        }
        return w;
      };
      expect(width(LAB.planetRadius, LAB.innerRadius, LAB.outerRadius)).toBeLessThanOrEqual(25);
      expect(width(2000, 2150, 2470)).toBeGreaterThan(100);
    });
  });

  describe('the baked noise cube', () => {
    const size = 32;
    const cube = bakeShellNoise(size);
    const voxel = (i: number, j: number, k: number) => cube[((i + size) % size) + ((j + size) % size) * size + ((k + size) % size) * size * size];

    it('holds the noise the twin computes', () => {
      const cell = CLOUD_SHELL_TILE_CELLS / size;
      for (const [i, j, k] of [[0, 0, 0], [5, 17, 30], [31, 2, 9], [12, 12, 12]]) {
        const decoded = (voxel(i, j, k) / 255 - 0.5) * 2 * CLOUD_SHELL_TEXTURE_RANGE;
        const expected = Math.max(-CLOUD_SHELL_TEXTURE_RANGE, Math.min(CLOUD_SHELL_TEXTURE_RANGE, tiledFractal((i + 0.5) * cell, (j + 0.5) * cell, (k + 0.5) * cell)));
        expect(Math.abs(decoded - expected)).toBeLessThan(0.02);
      }
    });

    it('repeats exactly over one tile', () => {
      const period = CLOUD_SHELL_TILE_CELLS;
      for (const [x, y, z] of [[0.3, 1.7, 2.2], [7.9, 0.1, 5.5], [3.3, 6.6, 7.99]]) {
        expect(tiledFractal(x + period, y, z)).toBeCloseTo(tiledFractal(x, y, z), 10);
        expect(tiledFractal(x, y + period, z)).toBeCloseTo(tiledFractal(x, y, z), 10);
        expect(tiledFractal(x, y, z + period)).toBeCloseTo(tiledFractal(x, y, z), 10);
      }
    });

    it('has no seam: neighbours across the wrap differ no more than neighbours inside', () => {
      let inside = 0;
      let across = 0;
      for (let j = 0; j < size; j++) {
        for (let k = 0; k < size; k++) {
          for (let i = 0; i < size - 1; i++) inside = Math.max(inside, Math.abs(voxel(i, j, k) - voxel(i + 1, j, k)));
          across = Math.max(across, Math.abs(voxel(size - 1, j, k) - voxel(0, j, k)));
        }
      }
      expect(across).toBeLessThanOrEqual(inside);
    });

    it('rarely saturates, so clamping does not flatten the clouds', () => {
      const saturated = cube.reduce((count, value) => count + (value === 0 || value === 255 ? 1 : 0), 0);
      expect(saturated / cube.length).toBeLessThan(0.01);
    });
  });

  it('changes smoothly while the camera descends from above the shell to below the clouds', () => {
    // A camera moving through the outer sphere, the cloud layer and the floor must not see the view flip.
    let worst = 0;
    for (const u of sphere(40)) {
      let previous: number | undefined;
      for (let r = LAB.outerRadius + 130; r >= LAB.planetRadius + 10; r -= 5) {
        const a = labAlpha([u[0] * r, u[1] * r, u[2] * r], [-u[0], -u[1], -u[2]]);
        if (previous !== undefined) worst = Math.max(worst, Math.abs(a - previous));
        previous = a;
      }
    }
    expect(worst).toBeLessThan(0.15);
  });
});
