import { Fn, float, vec3, vec4 } from 'three/tsl';
import { evaluateOnGpu } from '../planet-material/gpu-eval.testing';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { multiScatteringTableFromLut, sampleIrradianceLut, sampleMultiScatterLut, sunTransmittanceFromLut } from './atmosphere-luts';
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

  it('reads the sky irradiance and the multi-scatter term at the ground like the CPU tables', async () => {
    const model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    const mus = [-0.3, 0, 0.2, 0.6, 1];
    const rows = mus.map((mu) => [[mu, 0, 0, 0]]);
    const read = (pick: 'irradiance' | 'psi') =>
      evaluateOnGpu(rows, (at) =>
        Fn(() => {
          const a = at(0);
          return vec4(pick === 'irradiance' ? model.skyIrradiance(float(0), a.x) : model.multiScatterAt(float(0), a.x), 1);
        })(),
      );
    const irradiance = await read('irradiance');
    const psi = await read('psi');
    mus.forEach((mu, i) => {
      const cpu = sampleIrradianceLut(model.luts, 0, mu);
      const cpuPsi = sampleMultiScatterLut(model.luts, 0, mu);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(irradiance[i * 4 + c] - cpu[c])).withContext(`irradiance mu ${mu} channel ${c}`).toBeLessThan(0.01 * cpu[c] + 1e-4);
        expect(Math.abs(psi[i * 4 + c] - cpuPsi[c])).withContext(`psi mu ${mu} channel ${c}`).toBeLessThan(0.01 * cpuPsi[c] + 1e-4);
      }
    });
    model.dispose();
  });

  it('traceRay reports the ground hit, its distance and the air span like the sphere geometry', async () => {
    const model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    const R = model.uRadius.value as number;
    const top = model.uTopAltitude.value as number;
    const cases: { altitude: number; dir: [number, number, number]; maxDistance: number }[] = [
      { altitude: 2, dir: unit([0, 1, 0]), maxDistance: 1e30 }, // up: no ground
      { altitude: 2, dir: unit([0.7, -0.3, 0.7]), maxDistance: 1e30 }, // down: ground
      { altitude: 5_000, dir: unit([0.3, -0.02, 1]), maxDistance: 1e30 }, // shallow down: ground far away
      { altitude: 5_000, dir: unit([0.3, 0.02, 1]), maxDistance: 1e30 }, // shallow up: no ground
      { altitude: 40_000, dir: unit([1, -0.25, 0.2]), maxDistance: 1e30 }, // from high up
      { altitude: 2, dir: unit([0.7, -0.3, 0.7]), maxDistance: 3 }, // ground beyond maxDistance
    ];
    const out = await evaluateOnGpu(cases.map((c) => [[c.altitude, ...c.dir], [c.maxDistance, 0, 0, 0]]), (at) =>
      Fn(() => {
        const a = at(0);
        const t = model.traceRay({ altitude: a.x, dir: vec3(a.y, a.z, a.w), maxDistance: at(1).x });
        return vec4(t.hitsGround.select(float(1), float(0)), t.groundDistance as any, t.span as any, t.tStart as any);
      })(),
    );
    cases.forEach((c, i) => {
      const b = (R + c.altitude) * c.dir[1];
      const cGround = c.altitude * (2 * R + c.altitude);
      const disc = b * b - cGround;
      const reaches = disc > 0 && b < 0;
      const tGround = reaches ? -b - Math.sqrt(disc) : Infinity;
      const hits = reaches && tGround < c.maxDistance;
      const label = `case ${i}`;
      expect(out[i * 4]).withContext(`${label} hitsGround`).toBe(hits ? 1 : 0);
      if (reaches) expect(Math.abs(out[i * 4 + 1] - tGround)).withContext(`${label} groundDistance`).toBeLessThan(1e-3 * tGround + 1e-3);
      const cTop = (c.altitude - top) * (c.altitude + top + 2 * R);
      const discTop = b * b - cTop;
      const tEnd = Math.min(reaches ? tGround : -b + Math.sqrt(discTop), c.maxDistance);
      const tStart = Math.max(-b - Math.sqrt(discTop), 0);
      const span = Math.max(tEnd - tStart, 0);
      expect(Math.abs(out[i * 4 + 2] - span)).withContext(`${label} span`).toBeLessThan(2e-3 * span + 1);
    });
    model.dispose();
  });
});
