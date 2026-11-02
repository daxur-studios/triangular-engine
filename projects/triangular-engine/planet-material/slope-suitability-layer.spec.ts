import { float, vec3, vec4 } from 'three/tsl';
import type { IPlanetContext } from './planet-context';
import { evaluateOnGpu } from './gpu-eval.testing';
import { slopeSuitabilityLayer } from './slope-suitability-layer';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('slopeSuitabilityLayer on the GPU', () => {
  const radial = [0, 0, 1, 0];
  const rowForSlope = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return [[Math.sin(radians), 0, Math.cos(radians), 0], radial];
  };

  const render = (layer: ReturnType<typeof slopeSuitabilityLayer>, slopes: number[]) =>
    evaluateOnGpu(slopes.map(rowForSlope), (at) => {
      const below = { albedo: vec3(0, 0, 1), roughness: float(0.6), metalness: float(0) };
      const sample = layer.layer(
        { sphereNormal: at(0).xyz, radialDirection: at(1).xyz } as IPlanetContext,
        below,
      );
      return vec4(sample.albedo, 1);
    });

  it('colours a safe slope green and an over-limit slope red', async () => {
    const layer = slopeSuitabilityLayer({
      enabled: true,
      maxSlopeDegrees: 18,
      transitionDegrees: 4,
      opacity: 1,
      safeColor: '#00ff00',
      steepColor: '#ff0000',
    });
    const pixels = await render(layer, [5, 35]);

    expect(pixels[1]).toBeGreaterThan(pixels[0]);
    expect(pixels[4]).toBeGreaterThan(pixels[5]);
  });

  it('changes the grade threshold and visibility with uniforms', async () => {
    const layer = slopeSuitabilityLayer({
      enabled: true,
      maxSlopeDegrees: 10,
      transitionDegrees: 2,
      opacity: 1,
      safeColor: '#00ff00',
      steepColor: '#ff0000',
    });
    const initiallyTooSteep = await render(layer, [25]);
    layer.maxSlopeDegrees.value = 40;
    const suitableForLargerVehicle = await render(layer, [25]);
    layer.enabled.value = 0;
    const hidden = await render(layer, [25]);

    expect(initiallyTooSteep[0]).toBeGreaterThan(initiallyTooSteep[1]);
    expect(suitableForLargerVehicle[1]).toBeGreaterThan(suitableForLargerVehicle[0]);
    expect(hidden[2]).toBeCloseTo(1, 4);
  });

  it('keeps measuring the physical terrain grade when the displayed normal is morphed flat', async () => {
    const radians = (35 * Math.PI) / 180;
    const steepTerrainNormal = [Math.sin(radians), 0, Math.cos(radians), 0];
    const layer = slopeSuitabilityLayer({
      enabled: true,
      maxSlopeDegrees: 18,
      transitionDegrees: 4,
      opacity: 1,
      safeColor: '#00ff00',
      steepColor: '#ff0000',
    });
    const pixels = await evaluateOnGpu(
      [[[0, 0, 1, 0], steepTerrainNormal, radial]],
      (at) => {
        const sample = layer.layer(
          {
            sphereNormal: at(0).xyz,
            terrainNormal: at(1).xyz,
            radialDirection: at(2).xyz,
          } as IPlanetContext,
          { albedo: vec3(0, 0, 1), roughness: float(0.6), metalness: float(0) },
        );
        return vec4(sample.albedo, 1);
      },
    );
    expect(pixels[0]).toBeGreaterThan(pixels[1]);
  });
});
