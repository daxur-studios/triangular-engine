import { Fn, vec3, vec4 } from 'three/tsl';
import { evaluateOnGpu } from '../planet-material/gpu-eval.testing';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { multiScatteringTableFromLut, sunTransmittanceFromLut } from './atmosphere-luts';
import { earthAtmosphereProfile, marsAtmosphereProfile } from './atmosphere-presets';
import { integrateRadiance, transmittanceAlong } from './atmosphere-reference-integrator';
import { scaleAtmosphereProfile } from './atmosphere-scaling';
import { PhysicalAtmosphereProfile } from './atmosphere-profile';

/** A small table set keeps the bake fast; both sides read the same baked data, so size does not matter here. */
const SMALL = {
  transmittanceSize: [128, 32],
  multiScatterSize: [32, 16],
  irradianceSize: [32, 8],
  multiScatterDirections: 24,
  irradianceDirections: 16,
} as const;

const STEPS = 24;

interface Case {
  altitude: number;
  dir: [number, number, number];
  sun: [number, number, number];
  maxDistance?: number;
}

const unit = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const elevation = (deg: number, azimuthDeg = 0): [number, number, number] => {
  const e = (deg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
};

/** Evaluates `march` on the GPU for each case; returns radiance and transmittance per case. */
async function marchOnGpu(model: AtmosphereGpuModel, cases: Case[]) {
  const rows = cases.map((c) => [
    [c.altitude, ...c.dir],
    [...c.sun, c.maxDistance ?? 1e12],
  ]);
  const run = (pick: 'radiance' | 'transmittance') =>
    evaluateOnGpu(rows, (at) =>
      Fn(() => {
        const a = at(0);
        const b = at(1);
        const result = model.march({
          altitude: a.x,
          dir: vec3(a.y, a.z, a.w),
          sunDir: vec3(b.x, b.y, b.z),
          maxDistance: b.w,
          steps: STEPS,
        });
        return vec4(result[pick], 1);
      })(),
    );
  return { radiance: await run('radiance'), transmittance: await run('transmittance') };
}

function cpuMarch(model: AtmosphereGpuModel, c: Case) {
  const profile = model.profile;
  const luts = model.luts;
  const origin: [number, number, number] = [0, profile.planetRadiusM + c.altitude, 0];
  return integrateRadiance(profile, origin, c.dir, c.sun, {
    steps: STEPS,
    multipleScattering: multiScatteringTableFromLut(luts),
    includeGround: false,
    sunTransmittance: (p, s) => sunTransmittanceFromLut(luts, p, s),
  });
}

function expectClose(actual: ArrayLike<number>, offset: number, expected: readonly number[], label: string) {
  for (let c = 0; c < 3; c++) {
    const tolerance = 0.02 * Math.abs(expected[c]) + 2e-5;
    expect(Math.abs(actual[offset + c] - expected[c]))
      .withContext(`${label} channel ${c}: gpu ${actual[offset + c]} vs cpu ${expected[c]}`)
      .toBeLessThan(tolerance);
  }
}

describe('AtmosphereGpuModel.march vs the CPU reference', () => {
  const scenarios: { name: string; profile: () => PhysicalAtmosphereProfile; cases: Case[] }[] = [
    {
      name: 'Earth',
      profile: earthAtmosphereProfile,
      cases: [
        { altitude: 2, dir: elevation(90), sun: elevation(60) },
        { altitude: 2, dir: elevation(30, 90), sun: elevation(30) },
        { altitude: 2, dir: elevation(5, 0), sun: elevation(4, 0) },
        { altitude: 2, dir: elevation(60, 180), sun: elevation(2, 0) },
        { altitude: 2, dir: elevation(1, 90), sun: elevation(40, 0) },
        { altitude: 10_000, dir: elevation(-3, 0), sun: elevation(40, 0) },
        { altitude: 500_000, dir: elevation(-70, 0), sun: elevation(40, 0) },
        { altitude: 500_000, dir: unit([0.9, -0.43, 0]), sun: elevation(-5, 0) },
        { altitude: 2, dir: elevation(30), sun: elevation(40), maxDistance: 3_000 },
      ],
    },
    {
      name: 'Earth scaled to 100 km',
      profile: () => scaleAtmosphereProfile(earthAtmosphereProfile(), { radiusM: 100_000 }) as PhysicalAtmosphereProfile,
      cases: [
        { altitude: 2, dir: elevation(20, 30), sun: elevation(25, 0) },
        { altitude: 2, dir: elevation(3, 0), sun: elevation(3, 0) },
        { altitude: 8_000, dir: elevation(-20, 0), sun: elevation(50, 0) },
      ],
    },
    {
      name: 'Mars',
      profile: marsAtmosphereProfile,
      cases: [
        { altitude: 2, dir: elevation(2, 0), sun: elevation(2, 0) },
        { altitude: 2, dir: elevation(50, 0), sun: elevation(45, 180) },
      ],
    },
  ];

  for (const scenario of scenarios) {
    it(`matches integrateRadiance (${scenario.name})`, async () => {
      const model = new AtmosphereGpuModel(scenario.profile(), SMALL);
      const gpu = await marchOnGpu(model, scenario.cases);
      scenario.cases.forEach((c, i) => {
        const o = i * 4;
        if (c.maxDistance !== undefined) {
          // The CPU integrator has no distance limit; compare the transmittance of the stretch only.
          const origin: [number, number, number] = [0, model.profile.planetRadiusM + c.altitude, 0];
          const limited = transmittanceAlong(model.profile, origin, c.dir, c.maxDistance, 256);
          expectClose(gpu.transmittance, o, limited, `${scenario.name} case ${i} limited transmittance`);
          return;
        }
        const cpu = cpuMarch(model, c);
        expectClose(gpu.radiance, o, cpu.radiance, `${scenario.name} case ${i} radiance`);
        expectClose(gpu.transmittance, o, cpu.transmittance, `${scenario.name} case ${i} transmittance`);
      });
      model.dispose();
    });
  }
});
