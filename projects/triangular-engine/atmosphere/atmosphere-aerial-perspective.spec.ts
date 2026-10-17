import { Matrix3, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { Fn, vec2, vec3, vec4 } from 'three/tsl';
import { evaluateOnGpu, getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { AtmosphereAerialPerspectiveLut } from './atmosphere-aerial-perspective';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { earthAtmosphereProfile } from './atmosphere-presets';
import type { PhysicalAtmosphereProfile } from './atmosphere-profile';
import { scaleAtmosphereProfile } from './atmosphere-scaling';

const SMALL = {
  transmittanceSize: [128, 32],
  multiScatterSize: [32, 16],
  irradianceSize: [32, 8],
  multiScatterDirections: 24,
  irradianceDirections: 16,
} as const;

const STEPS = 24;

const sunFrom = (elevationDeg: number, azimuthDeg: number): Vector3 => {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return new Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
};

/** The local frame has y up. Looking horizontally, the view frame is the local frame; looking down, view -z is local -y. */
const HORIZONTAL = new Matrix3().identity();
const DOWN = new Matrix3().set(1, 0, 0, 0, 0, 1, 0, -1, 0);

describe('AtmosphereAerialPerspectiveLut', () => {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1e9);
  camera.updateProjectionMatrix();
  const projectionInverse: Matrix4 = camera.projectionMatrixInverse;

  const scenarios: {
    name: string;
    profile: () => PhysicalAtmosphereProfile;
    altitude: number;
    looking: Matrix3;
    sunElevation: number;
    sunAzimuth: number;
    distances: (hit: number | undefined) => number[];
    ndc: [number, number][];
  }[] = [
    {
      name: 'Earth, ground, looking at the horizon',
      profile: earthAtmosphereProfile,
      altitude: 2,
      looking: HORIZONTAL,
      sunElevation: 35,
      sunAzimuth: 20,
      distances: () => [30, 400, 3_000, 20_000, 120_000],
      ndc: [[0, 0], [0.5, 0.2], [-0.7, -0.1]],
    },
    {
      name: 'Earth, 8 km up, looking at the horizon, low sun',
      profile: earthAtmosphereProfile,
      altitude: 8_000,
      looking: HORIZONTAL,
      sunElevation: 6,
      sunAzimuth: 160,
      distances: () => [1_000, 15_000, 60_000, 200_000],
      ndc: [[0, 0], [-0.4, 0.1]],
    },
    {
      name: 'Earth, 40 km up at dusk, looking down into the planet shadow',
      profile: earthAtmosphereProfile,
      altitude: 40_000,
      looking: HORIZONTAL,
      sunElevation: -3,
      sunAzimuth: 0,
      distances: () => [20_000, 60_000, 90_000, 110_000, 130_000],
      ndc: [[0, -0.5], [0.3, -0.4]],
    },
    {
      name: 'planet scaled to 100 km, from space, looking down at the ground',
      profile: () => scaleAtmosphereProfile(earthAtmosphereProfile(), { radiusM: 100_000 }) as PhysicalAtmosphereProfile,
      altitude: 220_000,
      looking: DOWN,
      sunElevation: 50,
      sunAzimuth: 70,
      distances: (hit) => (hit === undefined ? [] : [hit, hit * 0.995]),
      // Not within a texel of the planet's limb (18 degrees off the nadir here): the table cannot resolve the last texel of the disc.
      ndc: [[0, 0], [0.2, 0.15], [-0.25, -0.1], [0.1, 0.35]],
    },
  ];

  for (const scenario of scenarios) {
    it(`reproduces the per-ray march (${scenario.name})`, async () => {
      const renderer = await getEvalRenderer();
      const model = new AtmosphereGpuModel(scenario.profile(), SMALL);
      const sun = sunFrom(scenario.sunElevation, scenario.sunAzimuth);
      model.setSunDirection(sun.x, sun.y, sun.z);
      const lut = new AtmosphereAerialPerspectiveLut(model, { steps: STEPS });
      expect(lut.update(renderer, { altitude: scenario.altitude, projectionInverse, viewToLocal: scenario.looking, sunLocal: sun })).toBeTrue();

      const R = model.profile.planetRadiusM;
      const h = scenario.altitude;
      const samples: { ndc: [number, number]; distance: number; dir: Vector3; dirView: Vector3 }[] = [];
      for (const ndc of scenario.ndc) {
        const far = new Vector3(ndc[0], ndc[1], 0).applyMatrix4(projectionInverse);
        const dirView = far.normalize().clone();
        const dir = far.clone().applyMatrix3(scenario.looking).normalize();
        const b = (R + h) * dir.y;
        const c = h * (2 * R + h);
        const disc = b * b - c;
        const hit = disc > 0 && b < 0 ? c / (-b + Math.sqrt(disc)) : undefined;
        for (const distance of scenario.distances(hit)) samples.push({ ndc, distance, dir: dir.clone(), dirView });
      }
      expect(samples.length).toBeGreaterThan(0);

      const rows = samples.map((s) => [[s.ndc[0], s.ndc[1], s.distance, 0], [s.dir.x, s.dir.y, s.dir.z, 0], [s.dirView.x, s.dirView.y, s.dirView.z, 0]]);
      const run = (pick: 'radiance' | 'transmittance', useLut: boolean) =>
        evaluateOnGpu(rows, (at) =>
          Fn(() => {
            const a = at(0);
            const b = at(1);
            const c = at(2);
            if (useLut) return vec4(lut.lookup(vec2(a.x, a.y), a.z, vec3(c.x, c.y, c.z))[pick], 1);
            const m = model.march({ altitude: h, dir: vec3(b.x, b.y, b.z), sunDir: vec3(sun.x, sun.y, sun.z), maxDistance: a.z, steps: STEPS, ignoreGround: true });
            return vec4(m[pick], 1);
          })(),
        );

      for (const pick of ['radiance', 'transmittance'] as const) {
        const fromLut = await run(pick, true);
        const direct = await run(pick, false);
        samples.forEach((s, i) => {
          for (let ch = 0; ch < 3; ch++) {
            const expected = direct[i * 4 + ch];
            const actual = fromLut[i * 4 + ch];
            expect(Math.abs(actual - expected))
              .withContext(`${scenario.name} ${pick} ndc ${s.ndc} d ${s.distance.toFixed(0)} channel ${ch}: table ${actual} vs march ${expected}`)
              .toBeLessThan(0.08 * Math.abs(expected) + 2e-3);
          }
        });
      }
      lut.dispose();
      model.dispose();
    });
  }

  it('re-renders only when the camera, the sun or the profile moved', async () => {
    const renderer = await getEvalRenderer();
    const model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    const lut = new AtmosphereAerialPerspectiveLut(model, { width: 8, height: 8, slices: 4, steps: 4 });
    const sun = sunFrom(30, 0);
    const view = { altitude: 100, projectionInverse, viewToLocal: new Matrix3().identity(), sunLocal: sun.clone() };
    expect(lut.update(renderer, view)).toBeTrue();
    expect(lut.update(renderer, view)).toBeFalse();
    expect(lut.update(renderer, { ...view, altitude: 100.1 })).toBeFalse();
    expect(lut.update(renderer, { ...view, altitude: 400 })).toBeTrue();
    expect(lut.update(renderer, { ...view, altitude: 400, sunLocal: sunFrom(40, 0) })).toBeTrue();
    expect(lut.update(renderer, { ...view, altitude: 400, sunLocal: sunFrom(40, 0), viewToLocal: DOWN })).toBeTrue();
    model.setProfile(earthAtmosphereProfile());
    expect(lut.update(renderer, { ...view, altitude: 400, sunLocal: sunFrom(40, 0), viewToLocal: DOWN })).toBeTrue();
    expect(lut.renderCount).toBe(5);
    lut.dispose();
    model.dispose();
  });
});
