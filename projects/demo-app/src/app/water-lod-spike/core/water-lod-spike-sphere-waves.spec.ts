import { WATER_LOD_SPIKE_UNIFORMS } from './water-lod-spike-waves';
import { anchorPhaseOffset } from './water-lod-spike-precision';
import {
  SPHERE_SLOPE_TENSOR,
  SPHERE_WATER_WAVES,
  sphereTangentBasisAt,
  sphereWaterHeightM,
} from './water-lod-spike-sphere-waves';
import { SPHERE_HOME, WATER_SPHERE_RADIUS_M, sphereDirectionAt } from './water-lod-spike-sphere-land';

type Vec3 = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const R = WATER_SPHERE_RADIUS_M;

/** The directions the basis is checked at: home, its neighbours, the antipode's neighbours and the axes. */
function sampleDirections(): Vec3[] {
  const out: Vec3[] = [SPHERE_HOME.up, sphereDirectionAt(400, -200), sphereDirectionAt(-5000, 7000), [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];
  for (let i = 0; i < 40; i++) {
    const a = i * 2.399963;
    const y = 1 - (2 * (i + 0.5)) / 40;
    const ring = Math.sqrt(1 - y * y);
    out.push([ring * Math.cos(a), y, ring * Math.sin(a)]);
  }
  return out;
}

describe('water-lod-spike sphere waves', () => {
  let saved: { time: number; shore: number };

  beforeEach(() => {
    saved = { time: WATER_LOD_SPIKE_UNIFORMS.time.value as number, shore: WATER_LOD_SPIKE_UNIFORMS.shore.value as number };
    WATER_LOD_SPIKE_UNIFORMS.shore.value = 0;
  });

  afterEach(() => {
    WATER_LOD_SPIKE_UNIFORMS.time.value = saved.time;
    WATER_LOD_SPIKE_UNIFORMS.shore.value = saved.shore;
  });

  it('has 64 waves of unit direction with the plane table amplitudes', () => {
    expect(SPHERE_WATER_WAVES.length).toBe(64);
    for (const wave of SPHERE_WATER_WAVES) {
      expect(Math.hypot(...wave.dir)).toBeCloseTo(1, 12);
      expect(wave.amplitudeM).toBeGreaterThan(0);
      expect(wave.k).toBeCloseTo((2 * Math.PI) / wave.wavelengthM, 12);
    }
  });

  it('sums the waves as sin(k p.d + phase - omega t) with the shore off', () => {
    const p: Vec3 = [R * 0.3, R * 0.5, R * 0.81];
    const t = 3.7;
    let expected = 0;
    for (const w of SPHERE_WATER_WAVES) expected += w.amplitudeM * Math.sin(w.k * dot(p, w.dir) + w.phase - w.angularSpeed * t);
    expect(sphereWaterHeightM(p[0], p[1], p[2], t)).toBeCloseTo(expected, 12);
  });

  it('keeps the swell inside the sum of the amplitudes', () => {
    const bound = SPHERE_WATER_WAVES.reduce((sum, w) => sum + w.amplitudeM, 0);
    for (const d of sampleDirections()) {
      expect(Math.abs(sphereWaterHeightM(d[0] * R, d[1] * R, d[2] * R, 1.5))).toBeLessThanOrEqual(bound);
    }
  });

  it('flattens the swell on dry land when the shore is on', () => {
    // Under the first island's centre the land is above the sea, so the shore weight is 0.
    const dir = sphereDirectionAt(0, 600);
    WATER_LOD_SPIKE_UNIFORMS.shore.value = 1;
    const wet = sphereWaterHeightM(dir[0] * R, dir[1] * R, dir[2] * R, 2);
    WATER_LOD_SPIKE_UNIFORMS.shore.value = 0;
    const open = sphereWaterHeightM(dir[0] * R, dir[1] * R, dir[2] * R, 2);
    expect(Math.abs(wet)).toBeLessThan(Math.abs(open) + 1e-12);
    expect(wet).toBeCloseTo(0, 9);
  });

  it('builds a slope tensor equal to the sum of the waves\' own parts and with the right trace', () => {
    let trace = 0;
    for (const w of SPHERE_WATER_WAVES) {
      const slope = w.amplitudeM * w.k;
      trace += 0.5 * slope * slope;
    }
    expect(SPHERE_SLOPE_TENSOR[0][0] + SPHERE_SLOPE_TENSOR[1][1] + SPHERE_SLOPE_TENSOR[2][2]).toBeCloseTo(trace, 12);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      expect(SPHERE_SLOPE_TENSOR[r][c]).toBeCloseTo(SPHERE_SLOPE_TENSOR[c][r], 14);
    }
    // The contraction with a basis is the sum of the per-wave variances along each basis vector.
    const { t1 } = sphereTangentBasisAt(SPHERE_HOME.up);
    let direct = 0;
    for (const w of SPHERE_WATER_WAVES) direct += 0.5 * (w.amplitudeM * w.k) ** 2 * dot(w.dir, t1) ** 2;
    const row = (r: number): number => SPHERE_SLOPE_TENSOR[r][0] * t1[0] + SPHERE_SLOPE_TENSOR[r][1] * t1[1] + SPHERE_SLOPE_TENSOR[r][2] * t1[2];
    expect(t1[0] * row(0) + t1[1] * row(1) + t1[2] * row(2)).toBeCloseTo(direct, 12);
  });

  it('builds an orthonormal right-handed tangent basis at every sample direction', () => {
    for (const up of sampleDirections()) {
      const unit = (() => { const l = Math.hypot(...up); return [up[0] / l, up[1] / l, up[2] / l] as Vec3; })();
      const { t1, t2 } = sphereTangentBasisAt(unit);
      expect(Math.hypot(...t1)).toBeCloseTo(1, 12);
      expect(Math.hypot(...t2)).toBeCloseTo(1, 12);
      expect(dot(t1, t2)).toBeCloseTo(0, 12);
      expect(dot(t1, unit)).toBeCloseTo(0, 12);
      expect(dot(t2, unit)).toBeCloseTo(0, 12);
      // t1 x t2 = up.
      const cross: Vec3 = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
      expect(dot(cross, unit)).toBeCloseTo(1, 12);
    }
  });

  it('keeps the tangent basis continuous across the home neighbourhood', () => {
    const a = sphereTangentBasisAt(sphereDirectionAt(0, 0));
    const b = sphereTangentBasisAt(sphereDirectionAt(1, 0));
    expect(Math.hypot(a.t1[0] - b.t1[0], a.t1[1] - b.t1[1], a.t1[2] - b.t1[2])).toBeLessThan(1e-5);
    expect(Math.hypot(a.t2[0] - b.t2[0], a.t2[1] - b.t2[1], a.t2[2] - b.t2[2])).toBeLessThan(1e-5);
  });

  it('reproduces the phase to float32 accuracy from the camera-relative form the shading uses', () => {
    const camera: Vec3 = [R * 0.52, R * 0.55, R * 0.65];
    const t = 12.25;
    for (const wave of SPHERE_WATER_WAVES) {
      const offset = anchorPhaseOffset(wave, camera, t);
      // A point 40 m from the camera along a mix of axes.
      const rel: Vec3 = [22, -18, 27];
      const p: Vec3 = [camera[0] + rel[0], camera[1] + rel[1], camera[2] + rel[2]];
      const exact = wave.k * dot(p, wave.dir) + wave.phase - wave.angularSpeed * t;
      const anchored = wave.k * dot(rel, wave.dir) + offset;
      // The two phases agree modulo a whole number of turns.
      const turns = (exact - anchored) / (2 * Math.PI);
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-7);
    }
  });
});
