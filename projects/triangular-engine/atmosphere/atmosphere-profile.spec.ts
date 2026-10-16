import { earthAtmosphereProfile, marsAtmosphereProfile, noAtmosphereProfile } from './atmosphere-presets';
import { assertValidAtmosphereProfile, isPhysicalAtmosphereProfile, validateAtmosphereProfile } from './atmosphere-profile';

const clone = <T>(v: T): any => JSON.parse(JSON.stringify(v));

describe('atmosphere profile validation', () => {
  it('accepts the presets', () => {
    expect(validateAtmosphereProfile(earthAtmosphereProfile())).toEqual([]);
    expect(validateAtmosphereProfile(marsAtmosphereProfile())).toEqual([]);
    expect(validateAtmosphereProfile(noAtmosphereProfile())).toEqual([]);
  });

  it('tells physical and none profiles apart', () => {
    expect(isPhysicalAtmosphereProfile(earthAtmosphereProfile())).toBeTrue();
    expect(isPhysicalAtmosphereProfile(noAtmosphereProfile())).toBeFalse();
  });

  it('rejects non-objects and unknown kinds', () => {
    expect(validateAtmosphereProfile(null).length).toBe(1);
    expect(validateAtmosphereProfile(42).length).toBe(1);
    const paths = validateAtmosphereProfile({ version: 1, name: 'x', kind: 'stylized' }).map((i) => i.path);
    expect(paths).toEqual(['kind']);
  });

  const cases: [string, (p: any) => void, string][] = [
    ['wrong version', (p) => (p.version = 2), 'version'],
    ['empty name', (p) => (p.name = ''), 'name'],
    ['zero radius', (p) => (p.planetRadiusM = 0), 'planetRadiusM'],
    ['NaN top altitude', (p) => (p.topAltitudeM = NaN), 'topAltitudeM'],
    ['negative rayleigh coefficient', (p) => (p.rayleigh.scatteringPerM[1] = -1e-6), 'rayleigh.scatteringPerM[1]'],
    ['rayleigh coefficient not rgb', (p) => (p.rayleigh.scatteringPerM = [1, 2]), 'rayleigh.scatteringPerM'],
    ['zero rayleigh scale height', (p) => (p.rayleigh.scaleHeightM = 0), 'rayleigh.scaleHeightM'],
    ['mie g of 1', (p) => (p.mie.phaseG = 1), 'mie.phaseG'],
    ['per-channel mie g out of range', (p) => (p.mie.phaseG = [0.5, -1.2, 0.5]), 'mie.phaseG[1]'],
    ['two-element mie g', (p) => (p.mie.phaseG = [0.5, 0.5]), 'mie.phaseG'],
    ['infinite mie absorption', (p) => (p.mie.absorptionPerM[0] = Infinity), 'mie.absorptionPerM[0]'],
    ['absorbers not an array', (p) => (p.absorbers = {}), 'absorbers'],
    ['tent without width', (p) => (p.absorbers[0].density.halfWidthM = 0), 'absorbers[0].density.halfWidthM'],
    ['unknown density kind', (p) => (p.absorbers[0].density = { kind: 'gauss' }), 'absorbers[0].density.kind'],
    ['albedo above 1', (p) => (p.groundAlbedo[2] = 1.5), 'groundAlbedo[2]'],
    ['negative sun irradiance', (p) => (p.sun.irradiance[0] = -1), 'sun.irradiance[0]'],
    ['zero sun size', (p) => (p.sun.angularRadiusRad = 0), 'sun.angularRadiusRad'],
    ['negative near haze fade', (p) => (p.nearHazeFadeM = -5), 'nearHazeFadeM'],
  ];
  for (const [label, mutate, path] of cases) {
    it(`flags ${label} at ${path}`, () => {
      const p = clone(earthAtmosphereProfile());
      mutate(p);
      expect(validateAtmosphereProfile(p).map((i) => i.path)).toContain(path);
    });
  }

  it('reports every problem at once and throws one error naming them', () => {
    const p = clone(earthAtmosphereProfile());
    p.planetRadiusM = -1;
    p.mie.phaseG = 2;
    expect(validateAtmosphereProfile(p).length).toBe(2);
    expect(() => assertValidAtmosphereProfile(p)).toThrowError(/planetRadiusM.*mie\.phaseG/);
  });
});
