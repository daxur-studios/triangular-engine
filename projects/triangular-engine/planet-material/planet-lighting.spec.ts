import { float, uniform, vec3 } from 'three/tsl';
import {
  createPlanetDayNightUniforms,
  createPlanetMorphLightingUniforms,
  identityAtmosphere,
  simpleDayNightLighting,
  sunVisibilityLighting,
} from './planet-lighting';
import { PlanetSurfaceMaterial } from './planet-surface-material';
import { meshOf, renderRgba, triangleWith } from './render-eval.testing';

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
