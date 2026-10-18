import { Fn, float, vec3, vec4 } from 'three/tsl';
import { evaluateOnGpu, getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { AtmosphereSkyViewLut } from './atmosphere-sky-view';
import { sunDirectionFromAngles } from './atmosphere-backdrop';
import { earthAtmosphereProfile } from './atmosphere-presets';
import { BentAtmosphere } from './bent-atmosphere';
import { bend, bentMapCoords, blendedProjection, equalEarthRow, mapMaskFactor, projectionRowAt, type Vec3 } from './bent-planet';

const SMALL = {
  transmittanceSize: [128, 32],
  multiScatterSize: [32, 16],
  irradianceSize: [32, 8],
  multiScatterDirections: 24,
  irradianceDirections: 16,
} as const;
const STEPS = 24;

interface Ray {
  altitude: number;
  dir: [number, number, number];
}

const unit = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

function setup(profileOverrides = {}) {
  const profile = { ...earthAtmosphereProfile(), ...profileOverrides };
  const model = new AtmosphereGpuModel(profile, SMALL);
  const bent = new BentAtmosphere(model);
  return { model, bent, R: profile.planetRadiusM };
}

async function marchBent(bent: BentAtmosphere, rays: Ray[]): Promise<Float32Array[]> {
  const rows = rays.map((r) => [[r.altitude, ...r.dir]]);
  const run = (pick: 'radiance' | 'transmittance') =>
    evaluateOnGpu(rows, (at) =>
      Fn(() => {
        const a = at(0);
        const m = bent.march({
          altitude: a.x,
          dir: vec3(a.y, a.z, a.w),
          sunDir: bent.uSunLocal,
          maxDistance: 1e30,
          steps: STEPS,
        });
        return vec4(m[pick], 1);
      })(),
    );
  return [await run('radiance'), await run('transmittance')];
}

async function marchGlobe(model: AtmosphereGpuModel, sun: Vec3, rays: Ray[]): Promise<Float32Array[]> {
  const rows = rays.map((r) => [[r.altitude, ...r.dir], [...sun, 0]]);
  const run = (pick: 'radiance' | 'transmittance') =>
    evaluateOnGpu(rows, (at) =>
      Fn(() => {
        const a = at(0);
        const b = at(1);
        const m = model.march({
          altitude: a.x,
          dir: vec3(a.y, a.z, a.w),
          sunDir: vec3(b.x, b.y, b.z),
          maxDistance: 1e30,
          steps: STEPS,
        });
        return vec4(m[pick], 1);
      })(),
    );
  return [await run('radiance'), await run('transmittance')];
}

const RAYS: Ray[] = [
  { altitude: 2, dir: unit([0, 1, 0]) },
  { altitude: 2, dir: unit([0.7, 0.05, 0.7]) },
  { altitude: 2, dir: unit([0, 0.003, 1]) },
  { altitude: 5_000, dir: unit([0.3, -0.02, 1]) },
  { altitude: 40_000, dir: unit([1, -0.25, 0.2]) },
  { altitude: 300_000, dir: unit([0, -0.4, 1]) },
  { altitude: 900_000, dir: unit([0.2, -0.9, 0.3]) },
  { altitude: 3_000_000, dir: unit([0.05, -1, 0.1]) },
];

describe('BentAtmosphere (GPU)', () => {
  it('at morph 0 it is the globe march: same radiance and transmittance as AtmosphereGpuModel.march', async () => {
    const { model, bent, R } = setup();
    const sun = sunDirectionFromAngles(35, 70);
    model.setSunDirection(sun.x, sun.y, sun.z);
    bent.setShape({ morph: 0, planetRadiusM: R });
    bent.setSun(35, 70);
    for (const mask of [0, 1]) {
      bent.uMaskEnabled.value = mask;
      const [bentL, bentT] = await marchBent(bent, RAYS);
      const [globeL, globeT] = await marchGlobe(model, [sun.x, sun.y, sun.z], RAYS);
      RAYS.forEach((_, i) => {
        for (let c = 0; c < 3; c++) {
          const tolL = 0.02 * Math.abs(globeL[i * 4 + c]) + 2e-5;
          expect(Math.abs(bentL[i * 4 + c] - globeL[i * 4 + c]))
            .withContext(`mask ${mask} ray ${i} L${c}: bent ${bentL[i * 4 + c]} vs globe ${globeL[i * 4 + c]}`)
            .toBeLessThan(tolL);
          expect(Math.abs(bentT[i * 4 + c] - globeT[i * 4 + c]))
            .withContext(`mask ${mask} ray ${i} T${c}: bent ${bentT[i * 4 + c]} vs globe ${globeT[i * 4 + c]}`)
            .toBeLessThan(0.01);
        }
      });
    }
    model.dispose();
  });

  it('stays finite from the globe to the flat map, and k = 1e-12 matches k = 0', async () => {
    const { model, bent, R } = setup();
    bent.setSun(50, 90);
    const outputs: Float32Array[][] = [];
    for (const morph of [0.9, 0.99, 0.999, 1 - 1e-12 * R, 1]) {
      bent.setShape({ morph, planetRadiusM: R });
      const [l, t] = await marchBent(bent, RAYS);
      outputs.push([l, t]);
      for (const v of [...l, ...t]) expect(Number.isFinite(v)).withContext(`morph ${morph}`).toBeTrue();
      for (let i = 0; i < RAYS.length; i++) {
        for (let c = 0; c < 3; c++) {
          expect(t[i * 4 + c]).toBeGreaterThanOrEqual(0);
          expect(t[i * 4 + c]).toBeLessThanOrEqual(1.0001);
        }
      }
    }
    const nearZero = outputs[3];
    const zero = outputs[4];
    for (let i = 0; i < RAYS.length * 4; i++) {
      expect(Math.abs(nearZero[0][i] - zero[0][i])).toBeLessThan(0.02 * Math.abs(zero[0][i]) + 1e-5);
      expect(Math.abs(nearZero[1][i] - zero[1][i])).toBeLessThan(0.01);
    }
    model.dispose();
  });

  it('the map mask removes the air beyond the map edge: looking out past the edge sees far less than looking back over the map', async () => {
    const { model, bent, R } = setup();
    bent.setDayNight('alwaysDay');
    // Flat map, camera 500 m from the east edge, low. +x leaves the map at once, -x runs over 40,000 km of it.
    bent.setShape({ morph: 1, planetRadiusM: R, anchorX: Math.PI * R - 500, anchorY: 0 });
    const rays: Ray[] = [
      { altitude: 20, dir: unit([1, 0.02, 0]) },
      { altitude: 20, dir: unit([-1, 0.02, 0]) },
    ];
    bent.uMaskEnabled.value = 1;
    const [l] = await marchBent(bent, rays);
    const out = l[0] + l[1] + l[2];
    const back = l[4] + l[5] + l[6];
    expect(back).toBeGreaterThan(0);
    expect(out).toBeLessThan(0.2 * back);
    bent.uMaskEnabled.value = 0;
    const [open] = await marchBent(bent, rays);
    expect(open[0] + open[1] + open[2]).toBeGreaterThan(3 * out);
    model.dispose();
  });

  it('mapCoords and mapMask agree with the CPU twins', async () => {
    const { model, bent, R } = setup();
    const cases: { morph: number; anchor: [number, number]; p: Vec3 }[] = [
      { morph: 0, anchor: [0, 0], p: [10_000, 3_000, -20_000] },
      { morph: 0.4, anchor: [2e6, 1e6], p: [-3e5, 8_000, 1e5] },
      { morph: 0.95, anchor: [-5e6, -2e6], p: [4e6, 20_000, -3e6] },
      { morph: 1, anchor: [1e6, 0], p: [2e6, 1_000, 5e5] },
    ];
    for (const c of cases) {
      bent.setShape({ morph: c.morph, planetRadiusM: R, anchorX: c.anchor[0], anchorY: c.anchor[1] });
      const k = bent.k;
      const out = await evaluateOnGpu([[[...c.p, 0]]], (at) =>
        Fn(() => {
          const a = at(0);
          const { mx, my } = bent.mapCoords(vec3(a.x, a.y, a.z));
          return vec4(mx, my, bent.mapMask(mx, my), 1);
        })(),
      );
      // The same point on the CPU: the local position through the anchor frame, then the map coordinates.
      const f = bent.anchorFrame;
      const pm: Vec3 = [
        f.origin[0] + f.east[0] * c.p[0] + f.up[0] * c.p[1] - f.north[0] * c.p[2],
        f.origin[1] + f.east[1] * c.p[0] + f.up[1] * c.p[1] - f.north[1] * c.p[2],
        f.origin[2] + f.east[2] * c.p[0] + f.up[2] * c.p[1] - f.north[2] * c.p[2],
      ];
      const [mx, my] = bentMapCoords(pm, k);
      expect(Math.abs(out[0] - mx)).withContext(`morph ${c.morph} mx`).toBeLessThan(3e-4 * Math.abs(mx) + 5);
      expect(Math.abs(out[1] - my)).withContext(`morph ${c.morph} my`).toBeLessThan(3e-4 * Math.abs(my) + 5);
      const mask = mapMaskFactor(mx, my, k, Math.PI * R, 0.5 * Math.PI * R, bent.uSoftness.value);
      expect(Math.abs(out[2] - mask)).withContext(`morph ${c.morph} mask`).toBeLessThan(0.05);
    }
    // Sanity on the twin itself: bend then invert.
    const p = bend(1e6, 5e5, 0.5 / R).position;
    expect(bentMapCoords(p, 0.5 / R)[0]).toBeCloseTo(1e6, 0);
    model.dispose();
  });
});

describe('BentAtmosphere (GPU), the 3a follow-up', () => {
  it("cuts the sun at the horizon of the current curvature: 0 on the flat map, the globe's at morph 0", async () => {
    const { model, bent, R } = setup();
    const alt = 10_000;
    const mus = [-0.08, -0.04, -0.02, 0, 0.02, 0.06];
    const read = (pick: 'bent' | 'baked') =>
      evaluateOnGpu(mus.map((m) => [[m, 0, 0, 0]]), (at) =>
        Fn(() => {
          const a = at(0);
          if (pick === 'bent') return vec4(bent.sunLight(float(alt), a.x), 1);
          const s = alt * (2 * R + alt);
          return vec4(model.sunTransmittance(float(s), float(R + alt), a.x), 1);
        })(),
      );
    // Morph 0: the same as the baked sphere.
    bent.setShape({ morph: 0, planetRadiusM: R });
    const globe = await read('bent');
    const baked = await read('baked');
    mus.forEach((mu, i) => {
      expect(Math.abs(globe[i * 4] - baked[i * 4])).withContext(`morph 0 mu ${mu}`).toBeLessThan(1e-5);
    });
    // Flat: lit above the horizon (mu = 0.02 is 1 degree up), dark below it. The baked planet would still light mu = -0.02 and -0.04.
    bent.setShape({ morph: 1, planetRadiusM: R });
    const flat = await read('bent');
    expect(baked[2 * 4]).withContext('the baked horizon still lights mu = -0.02').toBeGreaterThan(0.05);
    expect(flat[1 * 4]).toBeLessThan(1e-4);
    expect(flat[2 * 4]).toBeLessThan(1e-4);
    expect(flat[4 * 4]).toBeGreaterThan(0.01);
    expect(flat[5 * 4]).toBeGreaterThan(flat[4 * 4]);
    model.dispose();
  });

  it("the local march (the table's) at morph 0 is the globe march, and stays finite to the flat map", async () => {
    const { model, bent, R } = setup();
    const sun = sunDirectionFromAngles(35, 70);
    model.setSunDirection(sun.x, sun.y, sun.z);
    bent.setShape({ morph: 0, planetRadiusM: R });
    bent.setSun(35, 70);
    const run = (pick: 'radiance' | 'transmittance') =>
      evaluateOnGpu(RAYS.map((r) => [[r.altitude, ...r.dir]]), (at) =>
        Fn(() => {
          const a = at(0);
          const m = bent.march({ altitude: a.x, dir: vec3(a.y, a.z, a.w), sunDir: bent.uSunLocal, maxDistance: 1e30, steps: STEPS, local: true });
          return vec4(m[pick], 1);
        })(),
      );
    const [globeL, globeT] = await marchGlobe(model, [sun.x, sun.y, sun.z], RAYS);
    const localL = await run('radiance');
    const localT = await run('transmittance');
    RAYS.forEach((_, i) => {
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(localL[i * 4 + c] - globeL[i * 4 + c])).withContext(`ray ${i} L${c}`).toBeLessThan(0.02 * Math.abs(globeL[i * 4 + c]) + 2e-5);
        expect(Math.abs(localT[i * 4 + c] - globeT[i * 4 + c])).withContext(`ray ${i} T${c}`).toBeLessThan(0.01);
      }
    });
    for (const morph of [0.5, 0.99, 1]) {
      bent.setShape({ morph, planetRadiusM: R });
      for (const v of [...(await run('radiance')), ...(await run('transmittance'))]) expect(Number.isFinite(v)).withContext(`morph ${morph}`).toBeTrue();
    }
    model.dispose();
  });

  it('clamps the march to the map outline plus the falloff, not the map diagonal', async () => {
    const { model, bent, R } = setup();
    bent.setDayNight('alwaysDay');
    bent.setShape({ morph: 1, planetRadiusM: R, anchorX: Math.PI * R - 500, anchorY: 0 });
    const east = unit([1, 0.02, 0]);
    const west = unit([-1, 0.02, 0]);
    const rows = [east, west].map((d) => [[20, ...d]]);
    const trace = () =>
      evaluateOnGpu(rows, (at) =>
        Fn(() => {
          const a = at(0);
          const t = bent.traceRay({ altitude: a.x, dir: vec3(a.y, a.z, a.w), maxDistance: float(1e30) });
          return vec4(t.tStart, t.tEnd, t.span, 1);
        })(),
      );
    const out = await trace();
    // East: (500 + 8000 m of falloff) along x, about 8.5 km, a thousand times shorter than the diagonal.
    expect(out[1]).toBeGreaterThan(8_400 / east[0] - 100);
    expect(out[1]).toBeLessThan(8_600 / east[0] + 100);
    expect(out[0]).toBe(0);
    // West: the air's top ends it first (a slope of 0.02 up to the top), well inside the 40,000 km to the far edge.
    const toTop = (model.uTopAltitude.value - 20) / west[1];
    expect(toTop).toBeLessThan(1e7);
    expect(out[5]).toBeGreaterThan(0.99 * toTop);
    expect(out[5]).toBeLessThan(1.01 * toTop);
    bent.uMaskEnabled.value = 0;
    const open = await trace();
    expect(open[5]).withContext('mask off: the top still ends it').toBeGreaterThan(0.99 * toTop);
    expect(open[1]).withContext('mask off: no clamp to the outline (east)').toBeGreaterThan(0.99 * ((model.uTopAltitude.value - 20) / east[1]));
    model.dispose();
  });

  it("the Equal Earth outline table gives the row's latitude and half-width, and the mask and sun use them", async () => {
    const { model, bent, R } = setup();
    bent.setShape({ morph: 1, planetRadiusM: R, projection: 'equalEarth' });
    bent.setSun(30, 60);
    const cases: [number, number][] = [[0.5, 0.2], [-2, 1.0], [2.5, -0.7], [0, 1.4], [-3, -0.1]];
    const points = cases.map(([lon, lat]) => blendedProjection(lon, lat, 1, R));
    const out = await evaluateOnGpu(points.map(([x, y]) => [[x, y, 0, 0]]), (at) =>
      Fn(() => {
        const a = at(0);
        const row = bent.mapRow(a.y);
        return vec4(row.lat, row.halfWidth, bent.muSunAt(a.x, a.y, row), 1);
      })(),
    );
    const table = bent.projectionTable!;
    const sun = bent.uSunMap.value;
    cases.forEach(([lon, lat], i) => {
      const cpu = projectionRowAt(table, points[i][1]);
      expect(Math.abs(out[i * 4] - lat)).withContext(`case ${i} latitude`).toBeLessThan(2e-3);
      expect(Math.abs(out[i * 4 + 1] - cpu.halfWidth)).withContext(`case ${i} half-width`).toBeLessThan(2e-3 * cpu.halfWidth);
      const mu = Math.cos(lat) * Math.sin(lon) * sun.x + Math.sin(lat) * sun.y + Math.cos(lat) * Math.cos(lon) * sun.z;
      expect(Math.abs(out[i * 4 + 2] - mu)).withContext(`case ${i} sun cosine`).toBeLessThan(4e-3);
    });
    // The mask: inside the row's edge is 1, beyond it is 0 (a row at 60 degrees is narrower than the equator's).
    const lat = (60 * Math.PI) / 180;
    const inside = blendedProjection(0.95 * Math.PI, lat, 1, R);
    const beyond = blendedProjection(1.05 * Math.PI, lat, 1, R);
    expect(equalEarthRow(lat).c).toBeLessThan(equalEarthRow(0).c);
    const mask = await evaluateOnGpu([[[inside[0], inside[1], 0, 0]], [[beyond[0], beyond[1], 0, 0]]], (at) =>
      Fn(() => {
        const a = at(0);
        return vec4(bent.mapMask(a.x, a.y), 0, 0, 1);
      })(),
    );
    expect(mask[0]).toBeCloseTo(1, 3);
    expect(mask[4]).toBeCloseTo(0, 3);
    model.dispose();
  });

  it("the bent sky-view table at morph 0 matches the globe's, and re-renders only when the curvature changes", async () => {
    const renderer = await getEvalRenderer();
    const { model, bent, R } = setup();
    const sunAt = (elevation: number, azimuth: number): [number, number, number] => {
      const v = sunDirectionFromAngles(elevation, azimuth);
      return [v.x, v.y, v.z];
    };
    const sun = sunAt(30, 70);
    model.setSunDirection(...sun);
    bent.setShape({ morph: 0, planetRadiusM: R });
    bent.setSun(30, 70);
    const options = { width: 96, height: 54, steps: STEPS };
    const globeLut = new AtmosphereSkyViewLut(model, options);
    const bentLut = new AtmosphereSkyViewLut(model, { ...options, bent });
    expect(globeLut.update(renderer, 2)).toBeTrue();
    expect(bentLut.update(renderer, 2)).toBeTrue();
    const dirs = [80, 45, 20, 8, -12, -40, -80].flatMap((e) => [70, 95, 180, 250].map((a) => sunAt(e, a)));
    const rows = dirs.map((d) => [[d[0], d[1], d[2], 0]]);
    const read = (lut: AtmosphereSkyViewLut, pick: 'radiance' | 'transmittance') =>
      evaluateOnGpu(rows, (at) =>
        Fn(() => {
          const a = at(0);
          return vec4(lut.lookup(vec3(a.x, a.y, a.z))[pick], 1);
        })(),
      );
    for (const pick of ['radiance', 'transmittance'] as const) {
      const expected = await read(globeLut, pick);
      const actual = await read(bentLut, pick);
      dirs.forEach((d, i) => {
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(actual[i * 4 + c] - expected[i * 4 + c]))
            .withContext(`${pick} dir ${d.map((v) => v.toFixed(2))} channel ${c}: bent ${actual[i * 4 + c]} vs globe ${expected[i * 4 + c]}`)
            .toBeLessThan(0.05 * Math.abs(expected[i * 4 + c]) + 2e-4);
        }
      });
    }
    // Re-renders when the curvature changes, not otherwise.
    expect(bentLut.update(renderer, 2)).toBeFalse();
    bent.setShape({ morph: 0.5, planetRadiusM: R });
    expect(bentLut.update(renderer, 2)).toBeTrue();
    expect(bentLut.update(renderer, 2)).toBeFalse();
    bent.setShape({ morph: 1, planetRadiusM: R });
    expect(bentLut.update(renderer, 2)).toBeTrue();
    for (const v of await read(bentLut, 'radiance')) expect(Number.isFinite(v)).toBeTrue();
    globeLut.dispose();
    bentLut.dispose();
    model.dispose();
  });
});
