import { earthAtmosphereProfile } from './atmosphere-presets';
import { AtmosphereRgb, AtmosphereVec3, PhysicalAtmosphereProfile } from './atmosphere-profile';
import {
  buildMultiScatteringTable,
  computeMultiScattering,
  groundHitDistance,
  integrateRadiance,
  opticalDepthFromAltitude,
  sampleMultiScatteringTable,
  sunTransmittance,
  transmittanceAlong,
  traceAtmosphere,
} from './atmosphere-reference-integrator';

const earth = earthAtmosphereProfile();
const R = earth.planetRadiusM;
const rad = (deg: number) => (deg * Math.PI) / 180;
const elevation = (deg: number): AtmosphereVec3 => [Math.cos(rad(deg)), Math.sin(rad(deg)), 0];
const groundPoint = (p: PhysicalAtmosphereProfile = earth): AtmosphereVec3 => [0, p.planetRadiusM + 1, 0];

/** Same profile with the given coefficient groups zeroed. */
const rayleighOnly = (p: PhysicalAtmosphereProfile): PhysicalAtmosphereProfile => ({
  ...p,
  mie: { ...p.mie, scatteringPerM: [0, 0, 0], absorptionPerM: [0, 0, 0] },
  absorbers: [],
});
const times = (v: AtmosphereRgb, f: number): AtmosphereRgb => [v[0] * f, v[1] * f, v[2] * f];
const scaled = (p: PhysicalAtmosphereProfile, f: number): PhysicalAtmosphereProfile => ({
  ...p,
  rayleigh: { ...p.rayleigh, scatteringPerM: times(p.rayleigh.scatteringPerM, f) },
  mie: { ...p.mie, scatteringPerM: times(p.mie.scatteringPerM, f), absorptionPerM: times(p.mie.absorptionPerM, f) },
  absorbers: p.absorbers.map((a) => ({ ...a, extinctionPerM: times(a.extinctionPerM, f) })),
});
const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('atmosphere CPU reference integrator', () => {
  describe('geometry', () => {
    it('finds the ground only for rays that go down', () => {
      const surface: AtmosphereVec3 = [0, R, 0];
      expect(groundHitDistance(surface, [0, 1, 0], R)).toBeNull();
      expect(groundHitDistance(surface, [1, 0, 0], R)).toBeNull();
      expect(groundHitDistance(surface, [0, -1, 0], R)).toBe(0);
      expect(groundHitDistance([0, R + 1000, 0], [0, -1, 0], R)).toBeCloseTo(1000, 6);
      expect(groundHitDistance([0, 2 * R, 0], [1, 0, 0], R)).toBeNull();
    });

    it('does not shadow points that rounding put just below the surface (regression)', () => {
      // Ground points computed as R * (cos, sin) sit a few ulps either side of the sphere. An upward
      // sun ray from one of them used to count as "starting inside the planet" at random.
      for (let i = 0; i < 400; i++) {
        const a = i * 0.0157;
        const p: AtmosphereVec3 = [R * Math.sin(a), R * Math.cos(a), 0];
        const sun: AtmosphereVec3 = [Math.sin(a + 0.5), Math.cos(a + 0.5), 0]; // 0.5 rad off the local up
        expect(groundHitDistance(p, sun, R)).withContext(`i=${i}`).toBeNull();
      }
    });

    it('clips a ray to the atmosphere and ends it at the ground', () => {
      const top = R + earth.topAltitudeM;
      const seg = traceAtmosphere(earth, [0, 2 * top, 0], [0, -1, 0])!;
      expect(seg.tStart).toBeCloseTo(2 * top - top, 3);
      expect(seg.tEnd).toBeCloseTo(2 * top - R, 3);
      expect(seg.hitsGround).toBeTrue();
      expect(traceAtmosphere(earth, [0, 2 * top, 0], [1, 0, 0])).toBeNull();
      const up = traceAtmosphere(earth, groundPoint(), [0, 1, 0])!;
      expect(up.tStart).toBe(0);
      expect(up.tEnd).toBeCloseTo(earth.topAltitudeM - 1, 3);
      expect(up.hitsGround).toBeFalse();
    });
  });

  describe('transmittance against published values', () => {
    const rOnly = rayleighOnly(earth);

    it('matches the analytic zenith optical depth of an exponential layer', () => {
      const h = earth.rayleigh.scaleHeightM;
      const exact = earth.rayleigh.scatteringPerM[1] * h * (1 - Math.exp(-earth.topAltitudeM / h));
      expect(relDiff(opticalDepthFromAltitude(rOnly, 0, 1, 256)[1], exact)).toBeLessThan(1e-4);
    });

    it('has a sea-level green Rayleigh zenith depth within 15% of the 0.0973 published for 550 nm (Bodhaine 1999)', () => {
      const od = opticalDepthFromAltitude(rOnly, 0, 1)[1];
      expect(relDiff(od, 0.0973)).toBeLessThan(0.15);
    });

    it('follows the lambda^-4 law: blue/red depth ~ (680/440)^4 = 5.7', () => {
      const od = opticalDepthFromAltitude(rOnly, 0, 1);
      expect(relDiff(od[2] / od[0], Math.pow(680 / 440, 4))).toBeLessThan(0.03);
    });

    it('ozone absorbs mostly green (Chappuis band): green depth rises most', () => {
      const withOzone = opticalDepthFromAltitude({ ...rOnly, absorbers: earth.absorbers }, 0, 1);
      const without = opticalDepthFromAltitude(rOnly, 0, 1);
      const rise = [0, 1, 2].map((c) => withOzone[c] - without[c]);
      expect(rise[1]).toBeGreaterThan(rise[0]);
      expect(rise[1]).toBeGreaterThan(10 * rise[2]);
      // column of a 15 km-half-width tent at peak density 1 is 15 km
      expect(rise[1]).toBeCloseTo(1.881e-6 * 15_000, 4);
    });

    it('follows plane-parallel air mass away from the horizon: depth at 60 deg zenith is 2x zenith', () => {
      const z = opticalDepthFromAltitude(rOnly, 0, 1)[1];
      expect(relDiff(opticalDepthFromAltitude(rOnly, 0, 0.5)[1] / z, 2)).toBeLessThan(0.01);
    });

    it('has the Chapman horizon air mass sqrt(pi R / 2H) ~ 35.4', () => {
      const h = earth.rayleigh.scaleHeightM;
      const chapman = Math.sqrt((Math.PI * R) / (2 * h));
      const horizon = opticalDepthFromAltitude(rOnly, 0, 0)[1];
      const zenith = opticalDepthFromAltitude(rOnly, 0, 1)[1];
      expect(relDiff(horizon / zenith, chapman)).toBeLessThan(0.02);
    });

    it('converges: 64 samples within 0.1% of 4096 on the horizon ray', () => {
      const coarse = opticalDepthFromAltitude(earth, 0, 0, 64);
      const fine = opticalDepthFromAltitude(earth, 0, 0, 4096);
      for (let c = 0; c < 3; c++) expect(relDiff(coarse[c], fine[c])).toBeLessThan(1e-3);
    });

    it('gives a transmittance along a finite stretch that falls with distance', () => {
      const near = transmittanceAlong(earth, groundPoint(), [1, 0, 0], 1_000)[1];
      const far = transmittanceAlong(earth, groundPoint(), [1, 0, 0], 100_000)[1];
      const mid = transmittanceAlong(earth, groundPoint(), [1, 0, 0], 20_000)[1];
      expect(near).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(far);
      // 1 km at sea level: coefficient (13.558 + 3.996 + 0.444 + 1.881*0) per Mm * 1 km = 0.018
      expect(near).toBeCloseTo(Math.exp(-(13.558e-6 + 3.996e-6 + 0.444e-6) * 1000), 3);
    });
  });

  describe('sun light reaching the ground', () => {
    const T = (deg: number) => sunTransmittance(earth, groundPoint(), elevation(deg), 128);

    it('is zero once the sun is below the horizon (planet shadow)', () => {
      expect(T(-2)).toEqual([0, 0, 0]);
      expect(T(-30)).toEqual([0, 0, 0]);
    });

    it('reddens as the sun gets lower: R/B transmittance rises monotonically', () => {
      const ratios = [60, 30, 10, 5, 2, 0].map((d) => T(d)[0] / T(d)[2]);
      for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
    });

    it('is a plausible clear-sky sun: ~0.85 green with the sun overhead, an orange-red disc at 5 deg', () => {
      expect(T(90)[1]).toBeGreaterThan(0.8);
      expect(T(90)[1]).toBeLessThan(0.9);
      const t = T(5);
      expect(t[0]).toBeGreaterThan(0.4);
      expect(t[0] / t[2]).toBeGreaterThan(5);
      expect(t[2]).toBeLessThan(0.1);
    });

    it('is not shadowed at the ground for any local time while the sun is up (regression for the surface tolerance)', () => {
      for (let i = 0; i < 200; i++) {
        const a = i * 0.031;
        const p: AtmosphereVec3 = [R * Math.sin(a), R * Math.cos(a), 0];
        const sun: AtmosphereVec3 = [Math.sin(a + 0.8), Math.cos(a + 0.8), 0];
        expect(sunTransmittance(earth, p, sun, 16)[1]).withContext(`i=${i}`).toBeGreaterThan(0.3);
      }
    });
  });

  describe('single scattering', () => {
    const zenithSky = (sunDeg: number, p = earth, opts = {}) =>
      integrateRadiance(p, groundPoint(p), [0, 1, 0], elevation(sunDeg), { steps: 64, ...opts }).radiance;

    it('makes a blue zenith sky by day (Rayleigh: blue > green > red)', () => {
      const r = zenithSky(45);
      expect(r[2]).toBeGreaterThan(r[1]);
      expect(r[1]).toBeGreaterThan(r[0]);
    });

    it('matches the thin-atmosphere Rayleigh closed form at the zenith', () => {
      // sun at 45 deg, view straight up: scattering angle 45 deg; tau << 1 so L = E tau_R phase(cos45) / 1
      const thin = scaled(rayleighOnly({ ...earth, groundAlbedo: [0, 0, 0] }), 1e-3);
      const L = zenithSky(45, thin)[1];
      const tau = opticalDepthFromAltitude(thin, 0, 1)[1];
      const phase = (3 / (16 * Math.PI)) * (1 + Math.cos(rad(45)) ** 2);
      expect(relDiff(L, tau * phase)).toBeLessThan(0.01);
    });

    it('is linear in the coefficients when the air is thin', () => {
      const base = scaled(earth, 1e-3);
      const a = zenithSky(45, base)[1];
      const b = zenithSky(45, scaled(base, 2))[1];
      expect(relDiff(b / a, 2)).toBeLessThan(0.01);
    });

    it('is dimmer for a lower sun, and zero in the planet shadow', () => {
      const lum = (deg: number) => zenithSky(deg).reduce((a, b) => a + b, 0);
      expect(lum(45)).toBeGreaterThan(lum(10));
      expect(lum(10)).toBeGreaterThan(lum(0));
      expect(lum(0)).toBeGreaterThan(lum(-3));
      // at -10 deg the shadow cone is above the 60 km top of the atmosphere
      expect(zenithSky(-10)).toEqual([0, 0, 0]);
    });

    it('turns red around the sun at sunset while the sky away from it stays blue', () => {
      const sun = elevation(1);
      const view = (deg: number) => integrateRadiance(earth, groundPoint(), elevation(deg), sun, { steps: 96 }).radiance;
      const nearSun = view(5);
      const awayFromSun = view(91);
      expect(nearSun[0]).toBeGreaterThan(nearSun[1]);
      expect(nearSun[1]).toBeGreaterThan(nearSun[2]);
      expect(awayFromSun[2]).toBeGreaterThan(awayFromSun[0]);
      expect(nearSun[0] / nearSun[2]).toBeGreaterThan(5);
    });

    it('keeps a blue zenith in twilight because ozone removes the red/green (Hulburt effect)', () => {
      const bOverR = (p: PhysicalAtmosphereProfile) => {
        const r = zenithSky(-4, p);
        return r[2] / r[0];
      };
      expect(bOverR(earth)).toBeGreaterThan(bOverR({ ...earth, absorbers: [] }));
    });

    describe('limb seen from space (camera 3 R out, view ray grazing the air 3 km up)', () => {
      const phi = Math.asin((R + 3_000) / (3 * R));
      const camera: AtmosphereVec3 = [3 * R, 0, 0];
      const viewAngle = Math.atan2(Math.sin(phi), -Math.cos(phi));
      const view: AtmosphereVec3 = [Math.cos(viewAngle), Math.sin(viewAngle), 0];
      /** Sun direction rotated `deg` from the view ray: negative is away from the planet, positive into its shadow. */
      const sunAt = (deg: number): AtmosphereVec3 => [Math.cos(viewAngle + rad(deg)), Math.sin(viewAngle + rad(deg)), 0];
      const green = (p: PhysicalAtmosphereProfile, sun: AtmosphereVec3) =>
        integrateRadiance(p, camera, view, sun, { steps: 512 }).radiance[1];
      const noMie = { ...earth, mie: { ...earth.mie, scatteringPerM: [0, 0, 0], absorptionPerM: [0, 0, 0] } } as PhysicalAtmosphereProfile;

      it('is lit when the sun is just behind the limb and goes dark inside the planet shadow', () => {
        const lit = green(earth, sunAt(-5));
        expect(lit).toBeGreaterThan(1e-2);
        expect(green(earth, sunAt(+15))).toBeLessThan(lit * 1e-6);
        expect(green(earth, sunAt(+5))).toBeLessThan(lit * 0.01);
      });

      it('gets a forward Mie boost over Rayleigh alone near the ground', () => {
        const boost = green(earth, sunAt(-2)) / green(noMie, sunAt(-2));
        expect(boost).toBeGreaterThan(1.1);
        expect(boost).toBeLessThan(2);
      });

      it('shows a bright rim: sunlight 15 deg behind the limb outshines the overhead-sun view', () => {
        expect(green(earth, sunAt(-15))).toBeGreaterThan(green(earth, [0, 1, 0]));
      });
    });

    it('returns no light and full transmittance for a ray that misses the atmosphere', () => {
      const r = integrateRadiance(earth, [0, 3 * R, 0], [1, 0, 0], elevation(30));
      expect(r.radiance).toEqual([0, 0, 0]);
      expect(r.transmittance).toEqual([1, 1, 1]);
      expect(r.hitsGround).toBeFalse();
    });

    it('adds sunlit ground to rays that hit it, only when asked', () => {
      const origin: AtmosphereVec3 = [0, R + 1_000, 0];
      const withGround = integrateRadiance(earth, origin, [0, -1, 0], elevation(60), { steps: 32 });
      const without = integrateRadiance(earth, origin, [0, -1, 0], elevation(60), { steps: 32, includeGround: false });
      expect(withGround.hitsGround).toBeTrue();
      expect(withGround.radiance[1]).toBeGreaterThan(5 * without.radiance[1]);
      // Lambertian ground: E * albedo * cos(30 deg)... sun at 60 deg elevation => N.L = sin 60
      const expected = (0.3 * Math.sin(rad(60)) * 0.9) / Math.PI;
      expect(relDiff(withGround.radiance[1] - without.radiance[1], expected)).toBeLessThan(0.1);
    });

    it('converges: 128 view samples (the default) within 1% of 2048 on an oblique ray', () => {
      const view: AtmosphereVec3 = [Math.cos(rad(30)), Math.sin(rad(30)), 0];
      const coarse = integrateRadiance(earth, groundPoint(), view, elevation(20), { steps: 128 }).radiance;
      const fine = integrateRadiance(earth, groundPoint(), view, elevation(20), { steps: 2048 }).radiance;
      for (let c = 0; c < 3; c++) expect(relDiff(coarse[c], fine[c])).toBeLessThan(0.01);
    });
  });

  describe('multiple scattering', () => {
    it('has a transfer fraction below 1 and a finite positive term', () => {
      for (const [h, mu] of [[0, 1], [0, 0], [5_000, 0.3], [30_000, -0.2]] as const) {
        const t = computeMultiScattering(earth, h, mu, { directions: 32, steps: 12, sunSteps: 12 });
        for (let c = 0; c < 3; c++) {
          expect(t.fms[c]).toBeGreaterThan(0);
          expect(t.fms[c]).toBeLessThan(1);
          expect(t.psi[c]).toBeGreaterThan(0);
          expect(Number.isFinite(t.psi[c])).toBeTrue();
        }
      }
    });

    it('converges in directions and steps', () => {
      const coarse = computeMultiScattering(earth, 0, 0.5);
      const fine = computeMultiScattering(earth, 0, 0.5, { directions: 256, steps: 96, sunSteps: 96 });
      for (let c = 0; c < 3; c++) expect(relDiff(coarse.psi[c], fine.psi[c])).toBeLessThan(0.01);
    });

    it('adds light on top of single scattering, most in blue, with a plausible size', () => {
      const ss = integrateRadiance(earth, groundPoint(), [0, 1, 0], elevation(45), { steps: 32 }).radiance;
      const ms = integrateRadiance(earth, groundPoint(), [0, 1, 0], elevation(45), {
        steps: 32,
        multipleScattering: true,
      }).radiance;
      const gain = [0, 1, 2].map((c) => ms[c] / ss[c]);
      for (const g of gain) {
        expect(g).toBeGreaterThan(1.05);
        expect(g).toBeLessThan(2.5);
      }
      expect(gain[2]).toBeGreaterThan(gain[0]);
    });

    it('vanishes in the thin limit once there is no ground bounce', () => {
      const thin = scaled({ ...rayleighOnly(earth), groundAlbedo: [0, 0, 0] }, 1e-2);
      const ss = integrateRadiance(thin, groundPoint(thin), [0, 1, 0], elevation(45), { steps: 32 }).radiance;
      const ms = integrateRadiance(thin, groundPoint(thin), [0, 1, 0], elevation(45), {
        steps: 32,
        multipleScattering: true,
      }).radiance;
      expect(ms[1] / ss[1] - 1).toBeGreaterThan(0);
      expect(ms[1] / ss[1] - 1).toBeLessThan(0.03);
    });

    it('lights the sky in deep twilight where single scattering has already faded', () => {
      const sun = elevation(-6);
      const ss = integrateRadiance(earth, groundPoint(), [0, 1, 0], sun, { steps: 32 }).radiance[2];
      const ms = integrateRadiance(earth, groundPoint(), [0, 1, 0], sun, { steps: 32, multipleScattering: true }).radiance[2];
      expect(ms).toBeGreaterThan(ss);
    });

    it('is reproduced by an interpolated 16x16 table within 4% away from the terminator', () => {
      const options = { directions: 48, steps: 16, sunSteps: 16 };
      const table = buildMultiScatteringTable(earth, 16, 16, options);
      for (const [h, mu] of [[3_000, 0.7], [8_000, 0.3], [20_000, 0.4], [45_000, 0.9]] as const) {
        const exact = computeMultiScattering(earth, h, mu, options).psi;
        const looked = sampleMultiScatteringTable(table, h, mu);
        for (let c = 0; c < 3; c++) expect(relDiff(looked[c], exact[c])).withContext(`h=${h} mu=${mu}`).toBeLessThan(0.04);
      }
    });

    it('is far from smooth across the terminator at altitude, which coarse tables cannot follow', () => {
      // At 20 km the sun sets below the local horizon at mu = -sqrt(1 - (R / (R + h))^2) = -0.079, and
      // the term collapses within a couple of percent of mu. Plan 049 Phase 2 needs finer sampling
      // (or a different parameterization) there.
      const opts = { directions: 32, steps: 12, sunSteps: 12 };
      const lit = computeMultiScattering(earth, 20_000, 0.05, opts).psi[1];
      const dark = computeMultiScattering(earth, 20_000, -0.3, opts).psi[1];
      expect(lit).toBeGreaterThan(0);
      expect(dark).toBeLessThan(lit * 0.2);
    });

    it('takes an interpolated table in the radiance integral', () => {
      const options = { directions: 32, steps: 12, sunSteps: 12 };
      const table = buildMultiScatteringTable(earth, 8, 8, options);
      const exact = integrateRadiance(earth, groundPoint(), [0, 1, 0], elevation(30), { steps: 32, multipleScattering: true }).radiance;
      const tabled = integrateRadiance(earth, groundPoint(), [0, 1, 0], elevation(30), { steps: 32, multipleScattering: table }).radiance;
      for (let c = 0; c < 3; c++) expect(relDiff(tabled[c], exact[c])).toBeLessThan(0.1);
    });
  });
});
