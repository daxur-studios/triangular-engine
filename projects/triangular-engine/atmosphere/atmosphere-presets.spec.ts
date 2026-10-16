import { opticalDepthFromAltitude, integrateRadiance } from './atmosphere-reference-integrator';
import {
  ATMOSPHERE_PRESET_IDS,
  createAtmospherePreset,
  earthAtmosphereProfile,
  marsAtmosphereProfile,
  noAtmosphereProfile,
} from './atmosphere-presets';
import { AtmosphereVec3, PhysicalAtmosphereProfile, validateAtmosphereProfile } from './public-api';

const up = (p: PhysicalAtmosphereProfile): AtmosphereVec3 => [0, p.planetRadiusM + 1, 0];
const elevation = (deg: number): AtmosphereVec3 => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];

describe('atmosphere presets', () => {
  it('lists earth, mars and none, and each builds a valid profile', () => {
    expect([...ATMOSPHERE_PRESET_IDS]).toEqual(['earth', 'mars', 'none']);
    for (const id of ATMOSPHERE_PRESET_IDS) {
      const p = createAtmospherePreset(id);
      expect(validateAtmosphereProfile(p)).toEqual([]);
      expect(p.name).toBe(id);
    }
  });

  it('returns independent copies', () => {
    expect(earthAtmosphereProfile()).not.toBe(earthAtmosphereProfile());
    expect(earthAtmosphereProfile()).toEqual(earthAtmosphereProfile());
  });

  it('rejects an unknown id', () => {
    expect(() => createAtmospherePreset('venus' as any)).toThrowError(/Unknown atmosphere preset/);
  });

  it('applies scaling options when given a radius', () => {
    const p = createAtmospherePreset('earth', { radiusM: 100_000 }) as PhysicalAtmosphereProfile;
    expect(p.planetRadiusM).toBe(100_000);
    expect(p.topAltitudeM).toBeCloseTo((60_000 * 100_000) / 6_371_000, 6);
    expect(validateAtmosphereProfile(p)).toEqual([]);
  });

  describe('earth', () => {
    const earth = earthAtmosphereProfile();

    it('has Earth radius and a 60 km top', () => {
      expect(earth.planetRadiusM).toBe(6_371_000);
      expect(earth.topAltitudeM).toBe(60_000);
    });

    it('is blue by day: zenith sky blue > green > red', () => {
      const r = integrateRadiance(earth, up(earth), [0, 1, 0], elevation(45), { steps: 64 }).radiance;
      expect(r[2]).toBeGreaterThan(r[1]);
      expect(r[1]).toBeGreaterThan(r[0]);
    });

    it('glows orange-red around the sun at sunset', () => {
      const sun = elevation(1);
      const nearSun = integrateRadiance(earth, up(earth), elevation(5), sun, { steps: 96 }).radiance;
      expect(nearSun[2] / nearSun[0]).toBeLessThan(0.4);
    });
  });

  describe('mars', () => {
    const mars = marsAtmosphereProfile();
    const earth = earthAtmosphereProfile();

    it('has Mars radius', () => {
      expect(mars.planetRadiusM).toBe(3_389_500);
    });

    it('has a very thin Rayleigh component (zenith optical depth ~0.003, < 5% of Earth)', () => {
      const noDust: PhysicalAtmosphereProfile = {
        ...mars,
        mie: { ...mars.mie, scatteringPerM: [0, 0, 0], absorptionPerM: [0, 0, 0] },
      };
      const marsOd = opticalDepthFromAltitude(noDust, 0, 1)[1];
      const earthOd = opticalDepthFromAltitude(
        { ...earth, mie: { ...earth.mie, scatteringPerM: [0, 0, 0], absorptionPerM: [0, 0, 0] }, absorbers: [] },
        0,
        1,
      )[1];
      expect(marsOd).toBeGreaterThan(0.002);
      expect(marsOd).toBeLessThan(0.005);
      expect(marsOd / earthOd).toBeLessThan(0.05);
    });

    it('is dust dominated: zenith optical depth ~0.5, a little higher in blue', () => {
      const od = opticalDepthFromAltitude(mars, 0, 1);
      expect(od[1]).toBeGreaterThan(0.3);
      expect(od[1]).toBeLessThan(0.7);
      expect(od[2]).toBeGreaterThan(od[0]);
    });

    it('has an ochre day sky: zenith red > green > blue', () => {
      const r = integrateRadiance(mars, up(mars), [0, 1, 0], elevation(45), { steps: 64 }).radiance;
      expect(r[0]).toBeGreaterThan(r[1]);
      expect(r[1]).toBeGreaterThan(r[2]);
    });

    it('has a blue sunset glow around the sun, unlike Earth', () => {
      const sun = elevation(1);
      const near = integrateRadiance(mars, up(mars), elevation(5), sun, { steps: 96 }).radiance;
      const away = integrateRadiance(mars, up(mars), elevation(91), sun, { steps: 96 }).radiance;
      const earthNear = integrateRadiance(earth, up(earth), elevation(5), sun, { steps: 96 }).radiance;
      expect(near[2] / near[0]).toBeGreaterThan(1);
      expect(away[2] / away[0]).toBeLessThan(0.7);
      expect(near[2] / near[0]).toBeGreaterThan(5 * (earthNear[2] / earthNear[0]));
    });
  });

  describe('none', () => {
    it('is a valid profile without any physical fields', () => {
      const none = noAtmosphereProfile();
      expect(none.kind).toBe('none');
      expect(validateAtmosphereProfile(none)).toEqual([]);
      expect(Object.keys(none).sort()).toEqual(['kind', 'name', 'version']);
    });

    it('passes through scaling untouched', () => {
      expect(createAtmospherePreset('none', { radiusM: 6400 }).kind).toBe('none');
    });
  });
});
