import { earthAtmosphereProfile, noAtmosphereProfile } from './atmosphere-presets';
import { AtmosphereVec3, PhysicalAtmosphereProfile, validateAtmosphereProfile } from './atmosphere-profile';
import { integrateRadiance, opticalDepthFromAltitude, transmittanceToTop } from './atmosphere-reference-integrator';
import { scaleAtmosphereProfile, similarityScaleAtmosphere } from './atmosphere-scaling';

const earth = earthAtmosphereProfile();
const SIZES_M = [64_000, 100_000, 600_000, 6_371_000];
const rad = (deg: number) => (deg * Math.PI) / 180;
const elevation = (deg: number): AtmosphereVec3 => [Math.cos(rad(deg)), Math.sin(rad(deg)), 0];
const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const scale = (radiusM: number, extra = {}) => scaleAtmosphereProfile(earth, { radiusM, ...extra }) as PhysicalAtmosphereProfile;

describe('atmosphere similarity scaling', () => {
  it('multiplies lengths by k = R / Rref and divides coefficients by k', () => {
    const p = scale(100_000);
    const k = 100_000 / 6_371_000;
    expect(p.planetRadiusM).toBe(100_000);
    expect(p.topAltitudeM).toBeCloseTo(60_000 * k, 9);
    expect(p.rayleigh.scaleHeightM).toBeCloseTo(8_000 * k, 9);
    expect(p.mie.scaleHeightM).toBeCloseTo(1_200 * k, 9);
    expect(p.rayleigh.scatteringPerM[1]).toBeCloseTo(13.558e-6 / k, 12);
    expect(p.mie.absorptionPerM[0]).toBeCloseTo(0.444e-6 / k, 12);
    const density = p.absorbers[0].density;
    expect(density.kind === 'tent' && density.centerAltitudeM).toBeCloseTo(25_000 * k, 9);
    expect(density.kind === 'tent' && density.halfWidthM).toBeCloseTo(15_000 * k, 9);
    expect(p.absorbers[0].extinctionPerM[1]).toBeCloseTo(1.881e-6 / k, 12);
    expect(validateAtmosphereProfile(p)).toEqual([]);
  });

  it('leaves dimensionless parameters alone', () => {
    const p = scale(100_000);
    expect(p.mie.phaseG).toBe(earth.mie.phaseG);
    expect(p.groundAlbedo).toEqual(earth.groundAlbedo);
    expect(p.sun).toEqual(earth.sun);
  });

  it('does not mutate its input and is the identity at the reference radius', () => {
    const before = JSON.stringify(earth);
    scale(100_000);
    expect(JSON.stringify(earth)).toBe(before);
    expect(similarityScaleAtmosphere(earth, earth.planetRadiusM)).toEqual(earth);
  });

  it('round-trips through another radius', () => {
    const back = similarityScaleAtmosphere(scale(64_000), earth.planetRadiusM) as PhysicalAtmosphereProfile;
    expect(back.planetRadiusM).toBeCloseTo(earth.planetRadiusM, 6);
    expect(back.rayleigh.scatteringPerM[2]).toBeCloseTo(earth.rayleigh.scatteringPerM[2], 15);
    expect(back.topAltitudeM).toBeCloseTo(earth.topAltitudeM, 6);
  });

  it('keeps every optical depth: zenith and horizon match Earth at 64 km, 100 km, 600 km and 6371 km', () => {
    for (const radius of SIZES_M) {
      const p = scale(radius);
      for (const cosZenith of [1, 0.5, 0]) {
        const a = opticalDepthFromAltitude(p, 0, cosZenith);
        const b = opticalDepthFromAltitude(earth, 0, cosZenith);
        for (let c = 0; c < 3; c++) expect(relDiff(a[c], b[c])).withContext(`R=${radius} cos=${cosZenith}`).toBeLessThan(1e-9);
      }
    }
  });

  describe('keeps the look across planet sizes (equivalent viewpoints give the same radiance)', () => {
    // [altitude on Earth, view elevation, sun elevation]. Altitudes scale with the planet.
    const views: { name: string; altitudeM: number; viewDeg: number; sunDeg: number }[] = [
      { name: 'ground, zenith, noon-ish', altitudeM: 1, viewDeg: 90, sunDeg: 45 },
      { name: 'ground, towards a setting sun', altitudeM: 1, viewDeg: 4, sunDeg: 1 },
      { name: 'ground, away from a setting sun', altitudeM: 1, viewDeg: 100, sunDeg: 1 },
      { name: 'ground, twilight zenith', altitudeM: 1, viewDeg: 90, sunDeg: -4 },
      { name: 'low altitude, looking down at the horizon', altitudeM: 10_000, viewDeg: -3, sunDeg: 30 },
    ];
    for (const v of views) {
      it(v.name, () => {
        const reference = integrateRadiance(earth, [0, R(earth, v.altitudeM), 0], elevation(v.viewDeg), elevation(v.sunDeg), { steps: 64 });
        for (const radius of SIZES_M) {
          const p = scale(radius);
          const k = radius / earth.planetRadiusM;
          const r = integrateRadiance(p, [0, R(p, v.altitudeM * k), 0], elevation(v.viewDeg), elevation(v.sunDeg), { steps: 64 });
          for (let c = 0; c < 3; c++) {
            expect(relDiff(r.radiance[c], reference.radiance[c])).withContext(`R=${radius} c=${c}`).toBeLessThan(1e-6);
            expect(relDiff(r.transmittance[c], reference.transmittance[c])).toBeLessThan(1e-6);
          }
        }
      });
    }

    it('also holds with multiple scattering on a 64 km planet', () => {
      const opts = { steps: 24, multipleScattering: true } as const;
      const a = integrateRadiance(earth, [0, R(earth, 1), 0], [0, 1, 0], elevation(30), opts).radiance;
      const p = scale(64_000);
      const b = integrateRadiance(p, [0, R(p, 1 * (64_000 / 6_371_000)), 0], [0, 1, 0], elevation(30), opts).radiance;
      for (let c = 0; c < 3; c++) expect(relDiff(b[c], a[c])).toBeLessThan(1e-3);
    });

    it('limb view from orbit looks the same too (camera at 1.25 R, tangent altitude 8 km x k, sun 5 deg off the limb)', () => {
      const limb = (p: PhysicalAtmosphereProfile) => {
        const k = p.planetRadiusM / earth.planetRadiusM;
        const phi = Math.asin((p.planetRadiusM + 8_000 * k) / (1.25 * p.planetRadiusM));
        const angle = Math.atan2(Math.sin(phi), -Math.cos(phi));
        const view: AtmosphereVec3 = [Math.cos(angle), Math.sin(angle), 0];
        const sun: AtmosphereVec3 = [Math.cos(angle - rad(5)), Math.sin(angle - rad(5)), 0];
        return integrateRadiance(p, [1.25 * p.planetRadiusM, 0, 0], view, sun, { steps: 128 }).radiance;
      };
      const ref = limb(earth);
      expect(ref[1]).toBeGreaterThan(0);
      for (const radius of SIZES_M) {
        const r = limb(scale(radius));
        for (let c = 0; c < 3; c++) expect(relDiff(r[c], ref[c])).toBeLessThan(1e-6);
      }
    });
  });

  it('shows why: Earth coefficients on a 100 km planet leave the horizon almost clear, scaling does not', () => {
    const k = 100_000 / earth.planetRadiusM;
    const naive: PhysicalAtmosphereProfile = {
      ...earth,
      planetRadiusM: 100_000,
      topAltitudeM: earth.topAltitudeM * k,
      rayleigh: { ...earth.rayleigh, scaleHeightM: earth.rayleigh.scaleHeightM * k },
      mie: { ...earth.mie, scaleHeightM: earth.mie.scaleHeightM * k },
      absorbers: earth.absorbers.map((a) => ({
        ...a,
        density: a.density.kind === 'tent' ? { ...a.density, centerAltitudeM: a.density.centerAltitudeM * k, halfWidthM: a.density.halfWidthM * k } : a.density,
      })),
    };
    const tangent = (p: PhysicalAtmosphereProfile) => transmittanceToTop(p, [0, p.planetRadiusM, 0], [1, 0, 0], 256)[1];
    expect(tangent(naive)).toBeGreaterThan(0.9);
    expect(tangent(scale(100_000))).toBeLessThan(0.02);
    expect(tangent(scale(100_000))).toBeCloseTo(tangent(earth), 6);
  });

  describe('art knobs', () => {
    it('thickness sets height / radius and keeps the zenith optical depth', () => {
      const p = scale(600_000, { thickness: 0.12 });
      expect(p.topAltitudeM / p.planetRadiusM).toBeCloseTo(0.12, 12);
      expect(p.planetRadiusM).toBe(600_000);
      const a = opticalDepthFromAltitude(p, 0, 1);
      const b = opticalDepthFromAltitude(earth, 0, 1);
      for (let c = 0; c < 3; c++) expect(relDiff(a[c], b[c])).toBeLessThan(1e-6);
      const density = p.absorbers[0].density;
      expect(density.kind === 'tent' && density.halfWidthM).toBeCloseTo(15_000 * (p.topAltitudeM / earth.topAltitudeM), 3);
      expect(validateAtmosphereProfile(p)).toEqual([]);
    });

    it('reliefFit raises the air to clear the terrain, and never lowers it', () => {
      const tall = scale(600_000, { reliefFit: { maxReliefM: 59_000 } });
      expect(tall.topAltitudeM).toBeCloseTo(59_000 * 1.25, 6);
      expect(relDiff(opticalDepthFromAltitude(tall, 0, 1)[1], opticalDepthFromAltitude(earth, 0, 1)[1])).toBeLessThan(1e-6);
      const margin = scale(600_000, { reliefFit: { maxReliefM: 59_000, margin: 2 } });
      expect(margin.topAltitudeM).toBeCloseTo(118_000, 6);
      const base = scale(600_000);
      const low = scale(600_000, { reliefFit: { maxReliefM: 1_000 } });
      expect(low.topAltitudeM).toBe(base.topAltitudeM);
    });

    it('hazeAtHorizon hits the target green transmittance on the grazing ray at every size', () => {
      for (const radius of SIZES_M) {
        for (const target of [0.05, 0.3, 0.8]) {
          const p = scale(radius, { hazeAtHorizon: target });
          const t = transmittanceToTop(p, [0, p.planetRadiusM, 0], [1, 0, 0], 512)[1];
          expect(Math.abs(t - target)).withContext(`R=${radius} target=${target}`).toBeLessThan(1e-9);
        }
      }
    });

    it('hazeAtHorizon keeps the colour balance (it multiplies every coefficient)', () => {
      const p = scale(100_000, { hazeAtHorizon: 0.3 });
      const base = scale(100_000);
      const m = p.rayleigh.scatteringPerM[0] / base.rayleigh.scatteringPerM[0];
      expect(p.rayleigh.scatteringPerM[2] / base.rayleigh.scatteringPerM[2]).toBeCloseTo(m, 12);
      expect(p.absorbers[0].extinctionPerM[1] / base.absorbers[0].extinctionPerM[1]).toBeCloseTo(m, 12);
    });

    it('nearHazeFadeM is a world distance: stored as given, never scaled', () => {
      expect(scale(100_000, { nearHazeFadeM: 150 }).nearHazeFadeM).toBe(150);
      expect(scale(6_371_000, { nearHazeFadeM: 150 }).nearHazeFadeM).toBe(150);
      expect(scale(100_000).nearHazeFadeM).toBeUndefined();
    });

    it('applies thickness, then reliefFit, then hazeAtHorizon', () => {
      const p = scale(600_000, { thickness: 0.01, reliefFit: { maxReliefM: 59_000 }, hazeAtHorizon: 0.1 });
      expect(p.topAltitudeM).toBeCloseTo(73_750, 6); // 0.01 * 600 km = 6 km, raised by the relief
      const t = transmittanceToTop(p, [0, p.planetRadiusM, 0], [1, 0, 0], 512)[1];
      expect(t).toBeCloseTo(0.1, 8);
    });
  });

  it('passes none through unchanged', () => {
    const none = noAtmosphereProfile();
    expect(scaleAtmosphereProfile(none, { radiusM: 1000, hazeAtHorizon: 0.5 })).toBe(none);
    expect(similarityScaleAtmosphere(none, 1000)).toBe(none);
  });

  it('rejects bad input', () => {
    expect(() => scaleAtmosphereProfile(earth, { radiusM: 0 })).toThrowError(/radiusM/);
    expect(() => scaleAtmosphereProfile(earth, { radiusM: NaN })).toThrowError(/radiusM/);
    expect(() => scaleAtmosphereProfile(earth, { radiusM: 1e5, thickness: -1 })).toThrowError(/thickness/);
    expect(() => scaleAtmosphereProfile(earth, { radiusM: 1e5, hazeAtHorizon: 1 })).toThrowError(/hazeAtHorizon/);
    expect(() => scaleAtmosphereProfile(earth, { radiusM: 1e5, hazeAtHorizon: 0 })).toThrowError(/hazeAtHorizon/);
    expect(() => scaleAtmosphereProfile(earth, { radiusM: 1e5, reliefFit: { maxReliefM: -1 } })).toThrowError(/maxReliefM/);
    expect(() => scaleAtmosphereProfile(earth, { radiusM: 1e5, nearHazeFadeM: -1 })).toThrowError(/nearHazeFadeM/);
    expect(() => scaleAtmosphereProfile({ ...earth, planetRadiusM: -1 }, { radiusM: 1e5 })).toThrowError(/Invalid atmosphere profile/);
  });
});

/** Distance from the planet centre for a viewer at an altitude. */
function R(p: PhysicalAtmosphereProfile, altitudeM: number): number {
  return p.planetRadiusM + altitudeM;
}
