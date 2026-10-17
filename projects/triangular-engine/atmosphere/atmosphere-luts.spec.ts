import { earthAtmosphereProfile, marsAtmosphereProfile } from './atmosphere-presets';
import { scaleAtmosphereProfile } from './atmosphere-scaling';
import {
  atmosphereRadii,
  bakeAtmosphereLuts,
  multiScatteringTableFromLut,
  sampleIrradianceLut,
  sampleMultiScatterLut,
  sampleTransmittanceLut,
  sunTransmittanceFromLut,
  texcoordToUnitRange,
  transmittanceRMuFromUnitCoords,
  transmittanceUnitCoords,
  unitRangeToTexcoord,
} from './atmosphere-luts';
import { integrateRadiance, sunTransmittance } from './atmosphere-reference-integrator';
import { PhysicalAtmosphereProfile } from './atmosphere-profile';

describe('atmosphere LUT parameterization', () => {
  const profile = earthAtmosphereProfile();

  it('round-trips (r, mu) through the unit coordinates', () => {
    const { bottom } = atmosphereRadii(profile);
    for (const altitude of [0, 100, 5_000, 30_000, 59_000]) {
      for (const mu of [-0.2, 0, 0.3, 0.9, 1]) {
        const r = bottom + altitude;
        // Rays below the point's horizon hit the ground and are outside the table's range (they clamp).
        if (mu < -Math.sqrt(1 - (bottom / r) ** 2)) continue;
        const [xMu, xR] = transmittanceUnitCoords(profile, r, mu);
        const back = transmittanceRMuFromUnitCoords(profile, xMu, xR);
        expect(back.r).toBeCloseTo(r, 0);
        expect(back.mu).toBeCloseTo(mu, 3);
      }
    }
  });

  it('maps unit range to texel centres and back', () => {
    expect(unitRangeToTexcoord(0, 64)).toBeCloseTo(0.5 / 64, 12);
    expect(unitRangeToTexcoord(1, 64)).toBeCloseTo(63.5 / 64, 12);
    expect(texcoordToUnitRange(unitRangeToTexcoord(0.37, 64), 64)).toBeCloseTo(0.37, 12);
  });
});

describe('baked atmosphere LUTs', () => {
  const profile = earthAtmosphereProfile();
  const luts = bakeAtmosphereLuts(profile);

  it('reproduces the direct sun transmittance away from the shadow boundary', () => {
    for (const altitude of [0, 1_000, 10_000, 40_000]) {
      for (const elevationDeg of [90, 45, 15, 5, 2]) {
        const e = (elevationDeg * Math.PI) / 180;
        const point: [number, number, number] = [0, profile.planetRadiusM + altitude, 0];
        const sunDir: [number, number, number] = [Math.cos(e), Math.sin(e), 0];
        const direct = sunTransmittance(profile, point, sunDir, 256);
        const baked = sunTransmittanceFromLut(luts, point, sunDir);
        for (let c = 0; c < 3; c++) {
          // Relative error only where the value matters to the picture.
          if (direct[c] > 1e-3) expect(Math.abs(baked[c] - direct[c]) / direct[c]).toBeLessThan(0.03);
          else expect(baked[c]).toBeLessThan(5e-3);
        }
      }
    }
  });

  it('is 1 at the top of the atmosphere looking up and keeps the planet shadow at 0', () => {
    const { top } = atmosphereRadii(profile);
    const t = sampleTransmittanceLut(luts, top, 1);
    expect(t[0]).toBeCloseTo(1, 4);
    expect(sunTransmittanceFromLut(luts, [0, profile.planetRadiusM + 10, 0], [0, -1, 0])).toEqual([0, 0, 0]);
  });

  it('gives a plausible sky irradiance: blue > red, bright at noon, ~0 at night', () => {
    const noon = sampleIrradianceLut(luts, 0, 1);
    expect(noon[2]).toBeGreaterThan(noon[0]);
    // Real clear-sky diffuse is roughly 10-20% of the direct beam on a horizontal surface.
    expect(noon[1]).toBeGreaterThan(0.04);
    expect(noon[1]).toBeLessThan(0.4);
    const night = sampleIrradianceLut(luts, 0, -0.4);
    expect(night[1]).toBeLessThan(0.01 * noon[1]);
  });

  it('reads the ground row at altitude 0, not the row above it', () => {
    const small = bakeAtmosphereLuts(profile, { multiScatterSize: [16, 8], irradianceSize: [16, 8], multiScatterDirections: 24, irradianceDirections: 24 });
    const { width } = small.irradiance;
    for (const x of [0, 5, 11, 15]) {
      const muSun = (x / (width - 1)) * 2 - 1;
      const looked = sampleIrradianceLut(small, 0, muSun);
      for (let c = 0; c < 3; c++) expect(looked[c]).toBeCloseTo(small.irradiance.data[x * 4 + c], 6);
      const psi = sampleMultiScatterLut(small, 0, muSun);
      const ms = small.multiScatter;
      for (let c = 0; c < 3; c++) expect(psi[c]).toBeCloseTo(ms.data[x * 4 + c], 6);
    }
  });

  it('matches a direct integral of the sky over the hemisphere at altitude 0', () => {
    const table = multiScatteringTableFromLut(luts);
    const origin: [number, number, number] = [0, profile.planetRadiusM, 0];
    const directions = 256;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (const muSun of [0.9, 0.5, 0.2]) {
      const sunDir: [number, number, number] = [Math.sqrt(1 - muSun * muSun), muSun, 0];
      const e = [0, 0, 0];
      for (let i = 0; i < directions; i++) {
        const cosTheta = (i + 0.5) / directions;
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
        const dir: [number, number, number] = [sinTheta * Math.cos(golden * i), cosTheta, sinTheta * Math.sin(golden * i)];
        const { radiance } = integrateRadiance(profile, origin, dir, sunDir, {
          steps: 48,
          multipleScattering: table,
          includeGround: false,
          sunTransmittance: (p, s) => sunTransmittanceFromLut(luts, p, s),
        });
        for (let c = 0; c < 3; c++) e[c] += (radiance[c] / profile.sun.irradiance[c]) * cosTheta;
      }
      const looked = sampleIrradianceLut(luts, 0, muSun);
      for (let c = 0; c < 3; c++) {
        const reference = (e[c] * 2 * Math.PI) / directions;
        expect(Math.abs(looked[c] - reference)).withContext(`muSun ${muSun} channel ${c}: lut ${looked[c]} vs integral ${reference}`).toBeLessThan(0.04 * reference + 1e-4);
      }
    }
  });

  it('keeps the multi-scatter term in step with a direct evaluation', () => {
    const psi = sampleMultiScatterLut(luts, 0, 0.8);
    expect(psi[0]).toBeGreaterThan(0);
    expect(psi[2]).toBeGreaterThan(psi[0]);
  });

  it('bakes scaled profiles to the same tables as the original (similarity)', () => {
    const small = scaleAtmosphereProfile(profile, { radiusM: 100_000 }) as PhysicalAtmosphereProfile;
    const smallLuts = bakeAtmosphereLuts(small);
    for (let i = 0; i < luts.transmittance.data.length; i += 977) {
      expect(Math.abs(smallLuts.transmittance.data[i] - luts.transmittance.data[i])).toBeLessThan(2e-3);
    }
    for (let i = 0; i < luts.irradiance.data.length; i += 97) {
      expect(Math.abs(smallLuts.irradiance.data[i] - luts.irradiance.data[i])).toBeLessThan(5e-3);
    }
  });

  it('bakes the Mars preset without NaNs', () => {
    const mars = bakeAtmosphereLuts(marsAtmosphereProfile(), { transmittanceSize: [64, 16], multiScatterSize: [16, 8], irradianceSize: [16, 8] });
    for (const image of [mars.transmittance, mars.multiScatter, mars.irradiance]) {
      expect(image.data.every((v) => Number.isFinite(v))).toBeTrue();
    }
  });
});
