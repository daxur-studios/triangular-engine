import {
  CONTROL_MIN_ERROR_RAD,
  MAX_PHASE_ERROR_RAD,
  PRECISION_LATE_TIME_S,
  PRECISION_RADIUS_M,
  PROBE_STRIDE,
  anchorPhaseF32,
  anchorPhaseOffset,
  compareProbeOutput,
  emulatedPrecision,
  horizonDistanceM,
  naivePhaseF32,
  phaseDifference,
  precisionAnchor,
  precisionSamples,
  referencePhase,
  sphereWaves,
  waveRangeM,
  wrapAngle,
} from './water-lod-spike-precision';

describe('water LOD spike Q5 precision maths', () => {
  const waves = sphereWaves();
  const samples = precisionSamples();

  it('gives every wave a unit direction and spreads them over the whole sphere', () => {
    expect(waves.length).toBe(64);
    for (const wave of waves) expect(Math.hypot(...wave.dir)).toBeCloseTo(1, 12);
    expect(Math.max(...waves.map((wave) => wave.dir[1]))).toBeGreaterThan(0.95);
    expect(Math.min(...waves.map((wave) => wave.dir[1]))).toBeLessThan(-0.95);
  });

  it('places the samples on the sphere, in rings around the anchor out to the horizon', () => {
    const horizon = horizonDistanceM(PRECISION_RADIUS_M, 2);
    expect(horizon).toBeGreaterThan(1500);
    expect(horizon).toBeLessThan(1600);
    for (const sample of samples) {
      expect(Math.hypot(...sample.global)).toBeCloseTo(PRECISION_RADIUS_M, 6);
      // The chord is shorter than the arc by distance^3 / (24 R^2): under a millimetre at the horizon.
      expect(Math.abs(Math.hypot(...sample.relative) - sample.distanceM)).toBeLessThan(1e-3);
    }
    expect(Math.max(...samples.map((sample) => sample.distanceM))).toBeCloseTo(horizon, 6);
  });

  it('wraps angles into [-pi, pi] and compares phases modulo 2 pi', () => {
    // Odd multiples of pi sit on the seam: either sign is a valid wrap.
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-7)).toBeCloseTo(-7 + 2 * Math.PI, 12);
    expect(phaseDifference(0.1, 0.1 + 2 * Math.PI * 1000)).toBeCloseTo(0, 6);
    expect(phaseDifference(Math.PI - 0.01, -Math.PI + 0.01)).toBeCloseTo(0.02, 12);
  });

  it('splits the reference phase exactly into the anchor offset and the relative part (in doubles)', () => {
    const anchor = precisionAnchor();
    for (const timeS of [0, PRECISION_LATE_TIME_S]) {
      for (const wave of waves) {
        const offset = anchorPhaseOffset(wave, anchor, timeS);
        for (const sample of samples) {
          const relative = wave.k * (sample.relative[0] * wave.dir[0] + sample.relative[1] * wave.dir[1] + sample.relative[2] * wave.dir[2]);
          expect(phaseDifference(offset + relative, referencePhase(wave, sample.global, timeS))).toBeLessThan(1e-8);
        }
      }
    }
  });

  it('sizes each wave range from its wavelength: the shortest wave is evaluated only close by', () => {
    expect(waveRangeM(0.5, 4, 5e-4)).toBeCloseTo(62.5, 9);
    expect(waveRangeM(300, 4, 5e-4)).toBeCloseTo(37_500, 6);
  });

  for (const timeS of [0, PRECISION_LATE_TIME_S]) {
    it(`keeps the anchor path within ${MAX_PHASE_ERROR_RAD} rad and fails the naive control at wave time ${timeS} s (float32 emulation)`, () => {
      const { naive, anchor } = emulatedPrecision(waves, samples, timeS);
      expect(anchor.pairs).toBeGreaterThan(1000);
      expect(naive.pairs).toBe(anchor.pairs);
      expect(anchor.maxRad).toBeLessThan(MAX_PHASE_ERROR_RAD);
      expect(naive.maxRad).toBeGreaterThan(CONTROL_MIN_ERROR_RAD);
    });
  }

  it('reads a kernel output back into the same errors the emulation gives', () => {
    const timeS = PRECISION_LATE_TIME_S;
    const anchor = precisionAnchor();
    const output = new Float32Array(samples.length * waves.length * PROBE_STRIDE);
    samples.forEach((sample, s) =>
      waves.forEach((wave, w) => {
        const o = (s * waves.length + w) * PROBE_STRIDE;
        const anchorPhase = anchorPhaseF32(wave, sample.relative, anchorPhaseOffset(wave, anchor, timeS));
        output[o] = naivePhaseF32(wave, sample.global, timeS);
        output[o + 1] = anchorPhase;
        output[o + 2] = Math.sin(wrapAngle(anchorPhase));
      }),
    );

    const compared = compareProbeOutput(waves, samples, timeS, output);
    const emulated = emulatedPrecision(waves, samples, timeS);

    expect(compared.gpuNaive.maxRad).toBeCloseTo(emulated.naive.maxRad, 9);
    expect(compared.gpuAnchor.maxRad).toBeCloseTo(emulated.anchor.maxRad, 9);
    expect(compared.gpuAnchor.pairs).toBe(emulated.anchor.pairs);
    expect(compared.gpuAnchorSineError).toBeLessThan(MAX_PHASE_ERROR_RAD);
  });

  it('shows the naive path worst on the shortest waves, where one wavelength is a few position steps', () => {
    const { naive } = emulatedPrecision(waves, samples, 0);
    expect(naive.worstWavelengthM).toBeLessThan(5);
  });
});
