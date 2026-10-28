import { asin, atan, vec2, vec3, vec4 } from 'three/tsl';
import {
  FlatFeaturePageWindow,
  FlatFeatureSet,
  flatFeatureFrame,
  flatFeatureOffset,
  type FlatFeature,
  type FlatFeatureVec3,
} from 'triangular-engine/worldgen/render/core';
import { evaluateOnGpu } from './gpu-eval.testing';
import { flatFeatureLayer } from './flat-feature-layer';

/* eslint-disable @typescript-eslint/no-explicit-any */

const R = 600_000;
const site: FlatFeatureVec3 = flatFeatureOffset([0, 0, 1], flatFeatureFrame([0, 0, 1], 0), 3_300, 2_100, R);
const frame = flatFeatureFrame(site, 0.4);
const at = (a: number, b: number) => flatFeatureOffset(site, frame, a, b, R);
const BELOW = 0.9;
const ASPHALT = 0.045;
const PAINT = 0.62;

const runway = (priority: number): FlatFeature => ({
  kind: 'rectangle',
  centre: site,
  headingRad: 0.4,
  lengthM: 2000,
  widthM: 45,
  priority,
  markings: 'runway',
});
/** A taxiway across the runway at 40 m along it: its yellow centreline runs through `at(40, b)`. */
const taxiway = (priority: number): FlatFeature => ({
  kind: 'segment',
  start: at(40, -600),
  end: at(40, 600),
  widthM: 20,
  priority,
  markings: 'taxiway',
});

/**
 * Albedo of the layer at each direction. Each sample takes two neighbouring pixels `footprintM` apart across the
 * frame, so `dFdx` of the position gives that footprint (the eval target is one row, so `dFdy` is 0). The default
 * is below float32 resolution of a unit direction, so the footprint clamps to the layer's 1 cm floor: crisp.
 */
async function albedoAt(window: FlatFeaturePageWindow, directions: FlatFeatureVec3[], enabled = 1, footprintM = 0.02): Promise<number[][]> {
  const flat = flatFeatureLayer(window);
  flat.enabled.value = enabled;
  const rows = directions.flatMap((d) => {
    const step = footprintM / R;
    const e: FlatFeatureVec3 = [d[0] + frame.across[0] * step, d[1] + frame.across[1] * step, d[2] + frame.across[2] * step];
    return [[[...d, 0]], [[...e, 0]]];
  });
  const out = await evaluateOnGpu(rows, (input) => {
    const dir = input(0).xyz;
    const sample = flat.layer(
      { radialDirection: dir, latLon: vec2(asin(dir.y), atan(dir.x, dir.z)) } as any,
      { albedo: vec3(BELOW, BELOW, BELOW), roughness: 1, metalness: 0 } as any,
    );
    return vec4(sample.albedo, 1);
  });
  return directions.map((_, i) => [out[i * 8], out[i * 8 + 1], out[i * 8 + 2]]);
}

function placed(features: FlatFeature[]): FlatFeaturePageWindow {
  const window = new FlatFeaturePageWindow(new FlatFeatureSet(features, R));
  window.update(site, 300);
  return window;
}

describe('flatFeatureLayer on the GPU', () => {
  it('paints asphalt and markings on the feature and leaves the ground around it', async () => {
    const window = placed([runway(10)]);
    const [dash, gap, edgeLine, outside] = await albedoAt(window, [at(10, 0), at(40, 5), at(0, 21), at(0, 60)]);
    expect(dash[0]).toBeCloseTo(PAINT, 2); // centreline dash (first 30 m of each 50 m)
    expect(gap[0]).toBeCloseTo(ASPHALT, 2);
    expect(edgeLine[0]).toBeCloseTo(PAINT, 2); // edge line 1.5 m inside the 22.5 m half width
    expect(outside[0]).toBeCloseTo(BELOW, 4);
    window.dispose();
  });

  it('draws the higher priority markings where features cross', async () => {
    const yellowAt = async (runwayPriority: number, taxiwayPriority: number) => {
      const window = placed([runway(runwayPriority), taxiway(taxiwayPriority)]);
      // Crossing, in a runway centreline gap, on the taxiway centreline; then the taxiway alone.
      const [crossing, beyond] = await albedoAt(window, [at(40, 5), at(40, 200)]);
      window.dispose();
      return { crossing, beyond };
    };
    const runwayWins = await yellowAt(10, 5);
    expect(runwayWins.crossing[0]).toBeCloseTo(ASPHALT, 2);
    expect(runwayWins.beyond[0]).toBeCloseTo(0.6, 2); // yellow
    expect(runwayWins.beyond[2]).toBeCloseTo(0.05, 2);
    const taxiwayWins = await yellowAt(5, 10);
    expect(taxiwayWins.crossing[0]).toBeCloseTo(0.6, 2);
    expect(taxiwayWins.crossing[2]).toBeCloseTo(0.05, 2);
  });

  it('draws nothing outside the window, with no features, or when disabled', async () => {
    const window = placed([runway(10)]);
    const [far] = await albedoAt(window, [[0, 0, -1]]);
    expect(far[0]).toBeCloseTo(BELOW, 4);
    const [off] = await albedoAt(window, [at(40, 5)], 0);
    expect(off[0]).toBeCloseTo(BELOW, 4);
    window.setFeatures(null);
    const [cleared] = await albedoAt(window, [at(40, 5)]);
    expect(cleared[0]).toBeCloseTo(BELOW, 4);
    window.dispose();
  });

  it('spreads a sub-pixel feature over the footprint at its area weight instead of dropping or widening it', async () => {
    const road: FlatFeature = { kind: 'segment', start: at(-3000, 0), end: at(3000, 0), widthM: 4, markings: 'none' };
    const window = placed([road]);
    // 50 m footprint, 4 m road: coverage = clamp(0.5 + 2 / 50) * (4 / 50) = 0.0432 at the centreline.
    const [wide] = await albedoAt(window, [at(0, 0)], 1, 50);
    const weight = (BELOW - wide[0]) / (BELOW - ASPHALT);
    expect(weight).toBeGreaterThan(0.03);
    expect(weight).toBeLessThan(0.06);
    const [sharp] = await albedoAt(window, [at(0, 0)]);
    expect(sharp[0]).toBeCloseTo(ASPHALT, 3);
    window.dispose();
  });
});
