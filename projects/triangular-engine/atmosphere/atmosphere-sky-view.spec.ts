import { Fn, vec3, vec4 } from 'three/tsl';
import { evaluateOnGpu, getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { AtmosphereSkyViewLut } from './atmosphere-sky-view';
import { earthAtmosphereProfile } from './atmosphere-presets';
import { PhysicalAtmosphereProfile } from './atmosphere-profile';
import { scaleAtmosphereProfile } from './atmosphere-scaling';

const SMALL = {
  transmittanceSize: [128, 32],
  multiScatterSize: [32, 16],
  irradianceSize: [32, 8],
  multiScatterDirections: 24,
  irradianceDirections: 16,
} as const;

const STEPS = 24;

const sunFrom = (elevationDeg: number, azimuthDeg: number): [number, number, number] => {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
};

describe('AtmosphereSkyViewLut', () => {
  const scenarios: { name: string; profile: () => PhysicalAtmosphereProfile; altitude: number; sunElevation: number; sunAzimuth: number; size?: [number, number]; steps?: number }[] = [
    { name: 'Earth, ground, noon, default table size and steps', profile: earthAtmosphereProfile, altitude: 2, sunElevation: 60, sunAzimuth: 90, size: [192, 108], steps: 32 },
    { name: 'Earth, ground, high sun', profile: earthAtmosphereProfile, altitude: 2, sunElevation: 40, sunAzimuth: 30 },
    { name: 'Earth, ground, dusk', profile: earthAtmosphereProfile, altitude: 2, sunElevation: 3, sunAzimuth: 200 },
    { name: 'Earth, 8 km up', profile: earthAtmosphereProfile, altitude: 8_000, sunElevation: 25, sunAzimuth: 90 },
    {
      name: 'Earth scaled to 100 km, ground',
      profile: () => scaleAtmosphereProfile(earthAtmosphereProfile(), { radiusM: 100_000 }) as PhysicalAtmosphereProfile,
      altitude: 2,
      sunElevation: 12,
      sunAzimuth: 0,
    },
  ];

  for (const scenario of scenarios) {
    it(`reproduces the per-pixel march (${scenario.name})`, async () => {
      const renderer = await getEvalRenderer();
      const model = new AtmosphereGpuModel(scenario.profile(), SMALL);
      const sun = sunFrom(scenario.sunElevation, scenario.sunAzimuth);
      model.setSunDirection(...sun);
      const lut = new AtmosphereSkyViewLut(model, { width: scenario.size?.[0] ?? 96, height: scenario.size?.[1] ?? 54, steps: scenario.steps ?? STEPS });
      expect(lut.update(renderer, scenario.altitude)).toBeTrue();

      // Directions on a grid of elevation x azimuth, skipping the horizon band where the table is discontinuous.
      const dirs: [number, number, number][] = [];
      for (const elevation of [80, 45, 20, 8, 4, -4, -12, -40, -80]) {
        for (const azimuth of [scenario.sunAzimuth, scenario.sunAzimuth + 25, scenario.sunAzimuth + 110, scenario.sunAzimuth + 180]) {
          dirs.push(sunFrom(elevation, azimuth));
        }
      }
      const rows = dirs.map((d) => [[d[0], d[1], d[2], 0]]);
      const run = (pick: 'radiance' | 'transmittance', useLut: boolean) =>
        evaluateOnGpu(rows, (at) =>
          Fn(() => {
            const a = at(0);
            const dir = vec3(a.x, a.y, a.z);
            if (useLut) return vec4(lut.lookup(dir)[pick], 1);
            const m = model.march({
              altitude: scenario.altitude,
              dir,
              sunDir: vec3(...sun),
              maxDistance: 1e30,
              steps: scenario.steps ?? STEPS,
            });
            return vec4(m[pick], 1);
          })(),
        );
      for (const pick of ['radiance', 'transmittance'] as const) {
        const fromLut = await run(pick, true);
        const direct = await run(pick, false);
        dirs.forEach((d, i) => {
          for (let c = 0; c < 3; c++) {
            const expected = direct[i * 4 + c];
            const actual = fromLut[i * 4 + c];
            expect(Math.abs(actual - expected))
              .withContext(`${scenario.name} ${pick} dir ${d.map((v) => v.toFixed(3))} channel ${c}: lut ${actual} vs march ${expected}`)
              .toBeLessThan(0.06 * Math.abs(expected) + 1e-4);
          }
        });
      }
      lut.dispose();
      model.dispose();
    });
  }

  it('skips re-rendering until the altitude or the sun moves past its tolerance', async () => {
    const renderer = await getEvalRenderer();
    const model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    model.setSunDirection(...sunFrom(30, 0));
    const lut = new AtmosphereSkyViewLut(model, { width: 32, height: 16, steps: 8 });
    expect(lut.update(renderer, 100)).toBeTrue();
    expect(lut.update(renderer, 100)).toBeFalse();
    expect(lut.update(renderer, 100.2)).toBeFalse();
    expect(lut.update(renderer, 120)).toBeTrue();
    model.setSunDirection(...sunFrom(30.01, 10));
    expect(lut.update(renderer, 120)).toBeFalse();
    model.setSunDirection(...sunFrom(31, 10));
    expect(lut.update(renderer, 120)).toBeTrue();
    model.setProfile(earthAtmosphereProfile());
    expect(lut.update(renderer, 120)).toBeTrue();
    expect(lut.renderCount).toBe(4);
    lut.dispose();
    model.dispose();
  });
});
