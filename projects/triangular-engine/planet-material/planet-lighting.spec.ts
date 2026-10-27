import { float, uniform, vec3, vec4 } from 'three/tsl';
import { evaluateOnGpu } from './gpu-eval.testing';
import {
  createPlanetDayNightUniforms,
  createPlanetMorphLightingUniforms,
  identityAtmosphere,
  simpleDayNightLighting,
  sunVisibilityLighting,
  type ISimpleDayNightLightingOptions,
  type LightingStage,
} from './planet-lighting';
import { PlanetSurfaceMaterial } from './planet-surface-material';
import { meshOf, renderRgba, triangleWith } from './render-eval.testing';

/* eslint-disable @typescript-eslint/no-explicit-any */

const VIEW = { left: -3, right: 3, top: 1.5, bottom: -1.5 };
const corners = [[-3, -1.5, 0], [3, -1.5, 0], [0, 1.5, 0]];

/** A triangle whose sphere normal is `sphereNormal` and whose flat normal is +Z (the camera-facing map). */
function tri(sphereNormal: number[]) {
  return triangleWith({
    position: { itemSize: 3, values: corners },
    normal: { itemSize: 3, values: corners.map(() => sphereNormal) },
    aFlatPos: { itemSize: 3, values: corners },
    aFlatNorm: { itemSize: 3, values: corners.map(() => [0, 0, 1]) },
    color: { itemSize: 3, values: corners.map(() => [1, 1, 1]) },
  });
}

async function pixel(material: PlanetSurfaceMaterial, sphereNormal: number[], options: Parameters<typeof renderRgba>[3]) {
  const read = await renderRgba([meshOf(tri(sphereNormal), material)], VIEW, undefined, options);
  return read(64, 32);
}

describe('planet lighting stages on the GPU', () => {
  const ambient = { ambient: true };

  it('scales by the day/night light modifier: lit towards the sun, night colour away from it, off when disabled', async () => {
    const make = () => {
      const day = createPlanetDayNightUniforms();
      day.uDayNightEnabled.value = 1;
      day.uSunDirection.value.set(0, 0, 1);
      const material = new PlanetSurfaceMaterial({
        lighting: { id: 'dayNight', stage: simpleDayNightLighting(day) },
      });
      return { day, material };
    };
    const baseline = await pixel(new PlanetSurfaceMaterial(), [0, 0, 1], ambient);

    const sunny = make();
    const lit = await pixel(sunny.material, [0, 0, 1], ambient);
    expect(lit[0] / baseline[0]).toBeCloseTo(1, 2);

    // Vary the sun, not the normal: a surface normal facing away from the camera is a different test.
    const night = make();
    night.day.uSunDirection.value.set(0, 0, -1);
    const dark = await pixel(night.material, [0, 0, 1], ambient);
    expect(dark[0]).toBeGreaterThan(0);
    // The night floor is nightColor * nightAmbient per channel (the sunset rim is ~0 that far from the terminator).
    expect(dark[0] / baseline[0]).toBeCloseTo(0.09 * 0.2, 2);
    expect(dark[2] / baseline[2]).toBeCloseTo(0.24 * 0.2, 2);

    const off = make();
    off.day.uDayNightEnabled.value = 0;
    off.day.uSunDirection.value.set(0, 0, -1);
    const same = await pixel(off.material, [0, 0, 1], ambient);
    expect(same[0] / baseline[0]).toBeCloseTo(1, 2);
  });

  it('keeps the same shader when the sun direction changes (uniforms only)', () => {
    const day = createPlanetDayNightUniforms();
    const material = new PlanetSurfaceMaterial({ lighting: { id: 'dayNight', stage: simpleDayNightLighting(day) } });
    const key = material.stackKey;
    const version = material.version;
    day.uSunDirection.value.set(1, 0, 0);
    day.uDayNightEnabled.value = 1;
    expect(material.stackKey).toBe(key);
    expect(material.version).toBe(version);
    expect(key).toContain('lighting:dayNight');
  });

  it('applies the product of the sun occluders: half and half gives a quarter', async () => {
    const material = new PlanetSurfaceMaterial();
    const baseline = await pixel(material, [0, 0, 1], ambient);

    const half = uniform(0.5);
    const occluded = new PlanetSurfaceMaterial();
    occluded.addSunOcclusion({ id: 'a', occlusion: () => half });
    const one = await pixel(occluded, [0, 0, 1], ambient);
    // The default keeps a 0.15 floor: mix(0.15, 1, 0.5) = 0.575.
    expect(one[0] / baseline[0]).toBeCloseTo(0.575, 2);

    occluded.addSunOcclusion({ id: 'b', occlusion: () => half });
    const two = await pixel(occluded, [0, 0, 1], ambient);
    expect(two[0] / baseline[0]).toBeCloseTo(0.15 + 0.85 * 0.25, 2);
  });

  it('lets a replaced lighting stage see the occluder product directly', async () => {
    const material = new PlanetSurfaceMaterial({
      lighting: { id: 'raw', stage: (_context, { color, sunVisibility }) => color.mul(sunVisibility) },
    });
    material.addSunOcclusion({ id: 'half', occlusion: () => float(0.5) });
    const baseline = await pixel(new PlanetSurfaceMaterial(), [0, 0, 1], ambient);
    expect((await pixel(material, [0, 0, 1], ambient))[0] / baseline[0]).toBeCloseTo(0.5, 2);
  });

  it('applies the atmosphere stage last, after the lighting stage', async () => {
    const material = new PlanetSurfaceMaterial({
      lighting: { id: 'half', stage: (_context, { color }) => color.mul(0.5) },
      atmosphere: { id: 'plusOne', stage: (_context, color) => color.add(vec3(1, 1, 1)) },
    });
    const baseline = await pixel(new PlanetSurfaceMaterial(), [0, 0, 1], ambient);
    const out = await pixel(material, [0, 0, 1], ambient);
    expect(out[0]).toBeCloseTo(baseline[0] * 0.5 + 1, 2);
    expect(material.stackKey).toContain(';lighting:half;atmosphere:plusOne');
  });

  it('leaves the output untouched with no stage and no occluder, and the identity atmosphere passes through', async () => {
    const baseline = await pixel(new PlanetSurfaceMaterial(), [0, 0, 1], ambient);
    const identity = await pixel(
      new PlanetSurfaceMaterial({ atmosphere: { id: 'identity', stage: identityAtmosphere } }),
      [0, 0, 1],
      ambient,
    );
    expect(identity[0]).toBeCloseTo(baseline[0], 4);
    expect(new PlanetSurfaceMaterial().stackKey).not.toContain('lighting:');
  });

  it('can swap and remove stages at run time, each a recompile', () => {
    const material = new PlanetSurfaceMaterial();
    const version = material.version;
    material.setLightingStage({ id: 'floor', stage: sunVisibilityLighting({ floor: 0.3 }) });
    expect(material.stackKey).toContain('lighting:floor');
    expect(material.version).toBeGreaterThan(version);
    material.setLightingStage(null);
    expect(material.stackKey).not.toContain('lighting:');
  });

  it('lights a flat map by its sphere normal when given a lighting turn (and by the flat normal without)', async () => {
    const lightFromAbove = { light: [0, 5, 0] as [number, number, number] };
    const flatUniforms = (turn?: boolean) => {
      const material = new PlanetSurfaceMaterial(
        turn ? { lightingTurn: createPlanetMorphLightingUniforms().uMorphLightingTurn } : {},
      );
      material.morph.uMorph.value = 1;
      return material;
    };
    // Sphere normal +Y, flat normal +Z, sun from +Y: the sphere normal is sunlit, the flat one is edge-on.
    const without = await pixel(flatUniforms(false), [0, 1, 0], lightFromAbove);
    const turned = await pixel(flatUniforms(true), [0, 1, 0], lightFromAbove);
    expect(turned[0]).toBeGreaterThan(without[0] + 0.05);
  });

  it('turns the lighting normal by the turn matrix', async () => {
    const uniforms = createPlanetMorphLightingUniforms();
    const material = new PlanetSurfaceMaterial({ lightingTurn: uniforms.uMorphLightingTurn });
    material.morph.uMorph.value = 1;
    const light = { light: [0, 5, 0] as [number, number, number] };
    const lit = await pixel(material, [0, 1, 0], light);
    // Rotate 180 degrees about X: +Y becomes -Y, away from the sun.
    uniforms.uMorphLightingTurn.value.set(1, 0, 0, 0, -1, 0, 0, 0, -1);
    const turnedAway = await pixel(material, [0, 1, 0], light);
    expect(lit[0]).toBeGreaterThan(turnedAway[0] + 0.05);
  });
});

/**
 * The stages called directly on the GPU. Each row is `[sphereNormal], [colour, sunVisibility], [normal, directShadow]`;
 * the test context carries slot 2 so the input callbacks can read it.
 */
describe('planet lighting inputs (normal and direct shadow) on the GPU', () => {
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  /** The day/night light modifier on the red channel, for the default uniforms. */
  const dayNightRed = (dayFactor: number, rim: number) => {
    const night = 0.09 * 0.2;
    return night + (1 - night) * dayFactor + rim * (1 - dayFactor * 0.6);
  };
  const rimAt = (sunDot: number) => Math.exp(-((sunDot / (0.12 * 1.5)) ** 2)) * 0.5;
  const normal = (context: any) => context.testNormal;
  const directShadow = (context: any) => context.testShadow;

  const evaluate = async (stage: LightingStage, rows: number[][][]) => {
    const out = await evaluateOnGpu(rows, (at) => {
      const context = { sphereNormal: at(0).xyz, testNormal: at(2).xyz, testShadow: at(2).w } as any;
      const input = { color: at(1).xyz, sunVisibility: at(1).w, surface: { albedo: at(1).xyz } as any, emissive: null };
      return vec4(stage(context, input), 1);
    });
    return rows.map((_, i) => out[i * 4]);
  };
  const dayNight = (options?: ISimpleDayNightLightingOptions) => {
    const day = createPlanetDayNightUniforms();
    day.uDayNightEnabled.value = 1;
    day.uSunDirection.value.set(0, 0, 1);
    return simpleDayNightLighting(day, options);
  };

  // Sphere normals at sun angles 1 (noon), 0.05 (inside the twilight band) and 0.7.
  const spheres = [[0, 0, 1], [Math.sqrt(1 - 0.05 ** 2), 0, 0.05], [Math.sqrt(1 - 0.49), 0, 0.7]];

  it('gives the same output as before without inputs, and with neutral inputs (the sphere normal, no shadow)', async () => {
    const rows = spheres.map((s) => [s, [1, 1, 1, 1], [...s, 1]]);
    const plain = await evaluate(dayNight(), rows);
    spheres.forEach((s, i) => {
      expect(plain[i]).withContext(`sphere ${s}`).toBeCloseTo(dayNightRed(smooth(-0.12, 0.12, s[2]), rimAt(s[2])), 4);
    });
    const neutral = await evaluate(dayNight({ normal, directShadow }), rows);
    neutral.forEach((v, i) => expect(v).toBeCloseTo(plain[i], 5));
  });

  it('a tilted normal changes only the direct share: the sky share stays on the sphere normal', async () => {
    // Normals turned from the sun (N.L = -0.5), edge-on (0) and part-way (0.05); the sphere is at noon.
    const tilts = [[Math.sqrt(0.75), 0, -0.5], [1, 0, 0], [Math.sqrt(1 - 0.05 ** 2), 0, 0.05]];
    const out = await evaluate(dayNight({ normal }), tilts.map((n) => [[0, 0, 1], [1, 1, 1, 1], [...n, 1]]));
    tilts.forEach((n, i) => {
      const day = 0.35 + 0.65 * smooth(-0.12, 0.12, n[2]);
      expect(out[i]).withContext(`normal ${n}`).toBeCloseTo(dayNightRed(day, rimAt(1)), 4);
    });
    // Turned fully away, the pixel keeps the sky share of the day light, far above the night floor.
    expect(out[0]).toBeGreaterThan(0.3);
  });

  it('a direct shadow of 0 keeps the sky share of the day light, and skyShare sets that share', async () => {
    const shadows = [0, 0.5, 1];
    const rows = shadows.map((shadow) => [[0, 0, 1], [1, 1, 1, 1], [0, 0, 1, shadow]]);
    const out = await evaluate(dayNight({ directShadow }), rows);
    shadows.forEach((shadow, i) => {
      expect(out[i]).withContext(`shadow ${shadow}`).toBeCloseTo(dayNightRed(0.35 + 0.65 * shadow, rimAt(1)), 4);
    });
    const half = await evaluate(dayNight({ directShadow, skyShare: 0.5 }), rows.slice(0, 1));
    expect(half[0]).toBeCloseTo(dayNightRed(0.5, rimAt(1)), 4);
  });

  it('sunVisibilityLighting: a direct shadow scales towards the floor, and nothing changes without it', async () => {
    const shadows = [0, 0.5, 1];
    const rows = shadows.map((shadow) => [[0, 0, 1], [1, 1, 1, 0.8], [0, 0, 1, shadow]]);
    const plain = await evaluate(sunVisibilityLighting(), rows);
    plain.forEach((v) => expect(v).toBeCloseTo(0.15 + 0.85 * 0.8, 5));
    const shadowed = await evaluate(sunVisibilityLighting({ directShadow }), rows);
    shadows.forEach((shadow, i) => expect(shadowed[i]).toBeCloseTo(0.15 + 0.85 * 0.8 * shadow, 5));
  });
});
