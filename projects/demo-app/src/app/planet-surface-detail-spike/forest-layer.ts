import { Vector3 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import {
  Fn,
  If,
  clamp,
  dot,
  float,
  floor,
  instanceIndex,
  int,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  normalize,
  screenUV,
  select,
  smoothstep,
  sqrt,
  storage,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { IPlanetContext, ISurfaceSample, SunOcclusion, SurfaceLayer } from 'triangular-engine/planet-material';
import {
  FOREST_CANOPY_COVER,
  FOREST_CLEARANCE_M,
  FOREST_COAST_M,
  FOREST_EDGE,
  FOREST_OCTAVES,
  FOREST_TREE_HEIGHT_M,
  FOREST_TREELINE_M,
  forestFadeBand,
  forestFieldDensity,
} from './forest-field';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `0` both forms, `1` instances only, `2` layer only, `3` instances on the left half of the screen and the layer on the right. */
export type ForestViewMode = 0 | 1 | 2 | 3;

export interface IForestLayer {
  readonly layer: SurfaceLayer;
  readonly occlusion: SunOcclusion;
  /** Live uniforms: change `.value`, nothing recompiles (the shadow step count is a uniform branch). */
  readonly uniforms: {
    readonly enabled: any;
    readonly mode: any;
    readonly fadeStartM: any;
    readonly fadeEndM: any;
    readonly densityScale: any;
    readonly shadowSteps: any;
    readonly shadowStrength: any;
    /** Unit direction to the sun in the body frame. */
    readonly sunBody: any;
  };
  /** Weight of the layer at a camera distance (node): 0 near, 1 far, honouring `mode`. Instances use `1 - weight`. */
  fadeWeight(distance: any): any;
  /** Forest density at a body-fixed point (node), with the density scale and the runway clearance. */
  density(p: any, heightM: any): any;
  /** 0 on the runway and its apron, 1 beyond the clearance (node). */
  clearance(p: any): any;
  /** Colour of one tree, and so of the canopy. */
  readonly treeAlbedo: any;
  setSite(along: readonly number[], across: readonly number[]): void;
}

const smooth = (edge0: number, edge1: number, x: any): any => smoothstep(float(edge0), float(edge1), x);

/** Body-fixed metres of the fragment, lifted out of the camera-following anchor (see `runway-layer.ts`). */
export const bodyFixed = (context: IPlanetContext): any =>
  modelWorldMatrix.mul(vec4(context.bodyFixedLocal, 1)).xyz.sub(context.uniforms.uBodyCentreScene as any);

/** Layer weight in the split view (mode 3): 0 on the left half of the screen (instances), 1 on the right (layer). */
export const splitLayerWeight = (): any => select(screenUV.x.lessThan(0.5), float(0), float(1));

/** The integer hash of `forestHash`, in TSL: same constants, same wrap-around on 32 bits. */
function hashNode(ix: any, iy: any, iz: any): any {
  let h: any = ix
    .mul(uint(0x8da6b343))
    .bitXor(iy.mul(uint(0xd8163841)))
    .bitXor(iz.mul(uint(0xcb1ab31f)));
  h = h.bitXor(h.shiftRight(uint(13)));
  h = h.mul(uint(0x85ebca6b));
  h = h.bitXor(h.shiftRight(uint(16)));
  return float(h.shiftRight(uint(8))).div(16777216);
}

/** `forestNoise` in TSL. `p` is body-fixed metres. */
export function noiseNode(p: any, cellM: number, octave: number): any {
  const o = octave * 1013.7;
  const q = vec3(p.x.add(o), p.y.add(o * 0.7), p.z.add(o * 1.3)).div(cellM);
  const f = floor(q);
  const t = q.sub(f);
  const s = t.mul(t).mul(vec3(3, 3, 3).sub(t.mul(2)));
  const ix = uint(int(f.x));
  const iy = uint(int(f.y));
  const iz = uint(int(f.z));
  const corner = (dx: number, dy: number, dz: number) => hashNode(ix.add(uint(dx)), iy.add(uint(dy)), iz.add(uint(dz)));
  const lerp = (a: any, b: any, k: any) => mix(a, b, k);
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), s.x), lerp(corner(0, 1, 0), corner(1, 1, 0), s.x), s.y),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), s.x), lerp(corner(0, 1, 1), corner(1, 1, 1), s.x), s.y),
    s.z,
  );
}

/** `forestFieldDensity` in TSL (no runway clearance, no density scale). */
export function fieldDensityNode(p: any, heightM: any): any {
  let n: any = float(0);
  FOREST_OCTAVES.forEach((octave, i) => {
    n = n.add(noiseNode(p, octave.cellM, i).mul(octave.weight));
  });
  const land = smooth(FOREST_COAST_M[0], FOREST_COAST_M[1], heightM).mul(float(1).sub(smooth(FOREST_TREELINE_M[0], FOREST_TREELINE_M[1], heightM)));
  return smooth(FOREST_EDGE[0], FOREST_EDGE[1], n).mul(land);
}

/**
 * Plan 063 spike S1, Q1 and Q3: the forest's far form, evaluated per pixel from the same density field the instances are
 * scattered from. Nothing is baked: a fixed number of hashes per pixel, to the horizon.
 *
 * - Surface layer: canopy albedo = `mix(ground, tree albedo, density * weight)`; `weight` ramps in over the fade band.
 * - Sun occlusion: a short height-field march toward the sun over canopy height (`density * tree height`), 0, 2 or 4
 *   samples. The march starts at the pixel's own canopy top where the layer is showing canopy (far), and at the ground
 *   where instances are (near), so the floor between trees is shaded too.
 *
 * The atmosphere lighting stage reads `sphereNormal` and ignores `normalTS`, so a canopy normal from the density
 * gradient cannot reach the lit colour without changing the library; the march is the only canopy lighting term.
 */
export function forestLayer(radiusM: number): IForestLayer {
  const band = forestFadeBand();
  const enabled: any = uniform(1);
  const mode: any = uniform(0);
  const fadeStartM: any = uniform(band.startM);
  const fadeEndM: any = uniform(band.endM);
  const densityScale: any = uniform(1);
  const shadowSteps: any = uniform(0);
  const shadowStrength: any = uniform(0.85);
  const sunBody: any = uniform(new Vector3(0, 1, 0));
  const alongAxis: any = uniform(new Vector3(1, 0, 0));
  const acrossAxis: any = uniform(new Vector3(0, 0, 1));
  const treeAlbedo: any = uniform(new Vector3(0.035, 0.085, 0.03));
  const shadowFloor = 0.32;

  const clearance = (p: any): any => {
    const a = dot(p, alongAxis);
    const b = dot(p, acrossAxis);
    const q = vec2(a.abs().sub(1000), b.abs().sub(22.5));
    const d = length(max(q, 0)).add(min(max(q.x, q.y), 0));
    return smooth(FOREST_CLEARANCE_M[0], FOREST_CLEARANCE_M[1], d);
  };
  const density = (p: any, heightM: any): any => clamp(fieldDensityNode(p, heightM).mul(densityScale), 0, 1).mul(clearance(p));

  const fadeWeight = (distance: any): any =>
    select(
      mode.equal(1),
      float(0),
      select(mode.equal(2), float(1), select(mode.equal(3), splitLayerWeight(), smoothstep(fadeStartM, fadeEndM, distance))),
    );

  /**
   * How shaded the floor between crowns is at density `dens`, in [0, 1]: the first step of the shadow march below,
   * from the ground, with the density taken as uniform. Under instances the march shades the floor pixel by pixel; the
   * far form shows canopy and floor in one pixel, so it darkens the floor's share of the albedo by the same amount.
   */
  const floorShade = (p: any, dens: any): any => {
    const sunUp = dot(sunBody, normalize(p));
    const horizontalLength = max(sqrt(max(float(1).sub(sunUp.mul(sunUp)), 0)), 1e-4);
    const tanElevation = max(sunUp.div(horizontalLength), 0.02);
    const treeHeight = float(FOREST_TREE_HEIGHT_M);
    const reach = clamp(treeHeight.mul(1.2).div(tanElevation), 20, 500);
    const firstStep = reach.div(max(shadowSteps, 1));
    const shade = clamp(dens.mul(treeHeight).sub(firstStep.mul(tanElevation)).div(treeHeight.mul(0.2)), 0, 1);
    return select(shadowSteps.greaterThan(0), shade, float(0));
  };

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    const p = bodyFixed(context);
    const heightM = length(p).sub(radiusM);
    const weight = fadeWeight(context.cameraDistance);
    const dens = density(p, heightM);
    const cover = dens.mul(weight).mul(FOREST_CANOPY_COVER).mul(enabled);
    const floor = mix(float(1), float(shadowFloor), floorShade(p, dens).mul(shadowStrength).mul(weight).mul(enabled));
    return {
      ...below,
      albedo: mix(below.albedo.mul(floor), vec3(treeAlbedo), cover),
      roughness: mix(below.roughness, float(0.92), cover),
    };
  };

  const occlusion: SunOcclusion = (context: IPlanetContext) =>
    Fn(() => {
      const p: any = bodyFixed(context);
      const up = normalize(p);
      const heightM = length(p).sub(radiusM);
      const sunUp = dot(sunBody, up);
      const horizontal = sunBody.sub(up.mul(sunUp));
      const horizontalLength = max(length(horizontal), 1e-4);
      const toSun = horizontal.div(horizontalLength);
      const tanElevation = max(sunUp.div(horizontalLength), 0.02);
      const treeHeight = float(FOREST_TREE_HEIGHT_M);
      // Where the ray starts: the canopy top the pixel shows (far), the ground (near).
      const start = density(p, heightM).mul(treeHeight).mul(fadeWeight(context.cameraDistance));
      const reach = clamp(treeHeight.mul(1.2).div(tanElevation), 20, 500);
      const steps = max(shadowSteps, 1);
      const shade: any = float(0).toVar();
      for (let k = 1; k <= 4; k += 1) {
        If(shadowSteps.greaterThanEqual(k), () => {
          const d = reach.mul(k).div(steps);
          const occluder = density(p.add(toSun.mul(d)), heightM).mul(treeHeight);
          const excess = occluder.sub(start).sub(d.mul(tanElevation));
          shade.assign(max(shade, clamp(excess.div(treeHeight.mul(0.2)), 0, 1)));
        });
      }
      const layerOn = select(mode.equal(1), float(0), enabled);
      return mix(float(1), float(shadowFloor), shade.mul(shadowStrength).mul(layerOn));
    })();

  return {
    layer,
    occlusion,
    uniforms: { enabled, mode, fadeStartM, fadeEndM, densityScale, shadowSteps, shadowStrength, sunBody },
    fadeWeight,
    density,
    clearance,
    treeAlbedo,
    setSite(along, across) {
      alongAxis.value.set(along[0], along[1], along[2]);
      acrossAxis.value.set(across[0], across[1], across[2]);
    },
  };
}

/** Result of {@link forestDensityParity}: the shader's density against `forestFieldDensity` at the same points. */
export interface IDensityParity {
  readonly samples: number;
  readonly maxDifference: number;
  readonly meanDifference: number;
  /** Samples differing by more than 0.02. */
  readonly beyondTolerance: number;
  /** The first few disagreements: point, CPU value, GPU value. */
  readonly worst: readonly { point: readonly number[]; cpu: number; gpu: number }[];
}

/**
 * Evaluates the TSL density (`fieldDensityNode`, the node the layer is built from) on the GPU at `points`
 * (body-fixed metres, height above the datum in the fourth component) and compares it with the CPU function the
 * scatter uses. Needs a WebGPU backend (compute); read the numbers off the page with `__psd.parity()`.
 */
export async function forestDensityParity(renderer: any, points: Float32Array): Promise<IDensityParity> {
  const n = points.length / 4;
  const input = new StorageBufferAttribute(points, 4);
  const output = new StorageBufferAttribute(new Float32Array(n), 1);
  const source: any = storage(input, 'vec4', n);
  const result: any = storage(output, 'float', n);
  const kernel: any = Fn(() => {
    const point = source.element(instanceIndex);
    result.element(instanceIndex).assign(fieldDensityNode(point.xyz, point.w));
  })().compute(n);
  await renderer.computeAsync(kernel);
  const gpu = new Float32Array(await renderer.getArrayBufferAsync(output));
  let max = 0;
  let sum = 0;
  let beyond = 0;
  const worst: { point: number[]; cpu: number; gpu: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const cpu = forestFieldDensity(points[i * 4], points[i * 4 + 1], points[i * 4 + 2], points[i * 4 + 3]);
    const d = Math.abs(cpu - gpu[i]);
    max = Math.max(max, d);
    sum += d;
    if (d > 0.02) {
      beyond += 1;
      if (worst.length < 5) worst.push({ point: Array.from(points.subarray(i * 4, i * 4 + 4)), cpu, gpu: gpu[i] });
    }
  }
  kernel.dispose?.();
  return { samples: n, maxDifference: max, meanDifference: sum / n, beyondTolerance: beyond, worst };
}
