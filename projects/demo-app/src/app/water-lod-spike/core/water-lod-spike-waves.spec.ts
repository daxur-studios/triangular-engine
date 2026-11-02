import {
  WATER_LOD_SPIKE_UNIFORMS,
  WATER_LOD_SPIKE_WAVES,
  buildWaterLodSpikeWaveTable,
  createWaterLodSpikeWaves,
  waveFootprintWeight,
  waveSlopeRegularity,
  waveSpacingWeight,
  type IWaterWave,
} from './water-lod-spike-waves';

/** The first W0b table (kept here as the regularity control): 4 bands of 4 near-equal wavelengths, golden-angle directions. */
function evenlyDistributedTable(): readonly IWaterWave[] {
  const wavelengths = [400, 120, 40, 12];
  const amplitudes = [2, 0.9, 0.3, 0.08];
  const waves: IWaterWave[] = [];
  for (let band = 0; band < 4; band++) {
    for (let i = 0; i < 4; i++) {
      const index = band * 4 + i;
      const angle = index * 2.39996322972865332;
      const wavelengthM = wavelengths[band] * (1 + 0.07 * i);
      waves.push({
        dirX: Math.cos(angle), dirZ: Math.sin(angle), wavelengthM, amplitudeM: amplitudes[band], phase: 0.7 * index,
        angularSpeed: Math.sqrt((9.81 * 2 * Math.PI) / wavelengthM),
      });
    }
  }
  return waves;
}

describe('water LOD spike wave spectrum', () => {
  afterEach(() => {
    WATER_LOD_SPIKE_UNIFORMS.time.value = 0;
  });

  it('is the same table on every build (seeded)', () => {
    expect(buildWaterLodSpikeWaveTable()).toEqual(WATER_LOD_SPIKE_WAVES);
  });

  it('gives every wave its own wavelength, at least 0.5% from any other', () => {
    const sorted = WATER_LOD_SPIKE_WAVES.map((wave) => wave.wavelengthM).sort((a, b) => b - a);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1] / sorted[i]).toBeGreaterThan(1.005);
  });

  // The gate for "no grid or ring pattern from the wave table": the slope autocorrelation far from the origin falls to
  // at most 60% of the evenly distributed control's, for all waves and for the waves left at a distance (>= 20 m).
  for (const minWavelengthM of [0, 20]) {
    it(`is less regular than the evenly distributed control (waves >= ${minWavelengthM} m)`, () => {
      const spectrum = waveSlopeRegularity(WATER_LOD_SPIKE_WAVES, minWavelengthM, 100, 1000);
      const control = waveSlopeRegularity(evenlyDistributedTable(), minWavelengthM, 100, 1000);
      expect(spectrum.rms).toBeLessThan(0.6 * control.rms);
    });
  }

  it('keeps a wave in the shading down to about 3 pixels per wavelength and drops it by 1.4', () => {
    expect(waveFootprintWeight(0.7, 1)).toBe(0);
    expect(waveFootprintWeight(1, 1)).toBe(0);
    expect(waveFootprintWeight(0.35, 1)).toBe(1);
    expect(waveFootprintWeight(0.1, 1)).toBe(1);
    const middle = waveFootprintWeight(0.5, 1);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it('drops a wave from the vertex heights at 4 cells per wavelength and keeps it at 8', () => {
    expect(waveSpacingWeight(1, 4)).toBe(0);
    expect(waveSpacingWeight(1, 8)).toBe(1);
    expect(waveSpacingWeight(2, 12)).toBeGreaterThan(0);
    expect(waveSpacingWeight(2, 12)).toBeLessThan(1);
  });

  it('CPU twin is the sum of the waves and moves with time', () => {
    const source = createWaterLodSpikeWaves();
    const [x, z] = [123.4, -56.7];
    const expected = (t: number) => WATER_LOD_SPIKE_WAVES.reduce((sum, wave) => {
      const k = (2 * Math.PI) / wave.wavelengthM;
      return sum + wave.amplitudeM * Math.sin(k * (x * wave.dirX + z * wave.dirZ) + wave.phase - wave.angularSpeed * t);
    }, 0);
    expect(source.heightAt(x, 0, z)).toBeCloseTo(expected(0), 10);
    WATER_LOD_SPIKE_UNIFORMS.time.value = 3;
    expect(source.heightAt(x, 0, z)).toBeCloseTo(expected(3), 10);
    expect(source.heightAt(x, 0, z)).not.toBeCloseTo(expected(0), 3);
  });

  it('bounds the height by the sum of amplitudes', () => {
    const source = createWaterLodSpikeWaves();
    for (let i = 0; i < 200; i++) expect(Math.abs(source.heightAt(i * 37.1, 0, i * -11.3))).toBeLessThanOrEqual(source.boundM);
  });
});
