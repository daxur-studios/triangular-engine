import { Vector3 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  instanceIndex,
  int,
  ivec3,
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
import type { IPlanetContext, ISurfaceSample, SurfaceLayer } from 'triangular-engine/planet-material';
import {
  FOREST_CLEARANCE_M,
  FOREST_COAST_M,
  FOREST_CROWN_WIDTH_M,
  FOREST_EDGE,
  FOREST_OCTAVES,
  FOREST_SPACING_M,
  FOREST_TREE_HEIGHT_M,
  FOREST_TREELINE_M,
  PIXEL_PER_DISTANCE,
  TREE_SEED,
  forestFadeBand,
  forestFieldDensity,
} from './forest-field';
import {
  COVER_FIT,
  CROWN_CENTRE_SHARE,
  CROWN_LENGTH_SHARE,
  CROWN_LIGHT_FIT,
  CROWN_NORMAL_LEAN,
  FOREST_SKY_SHARE,
  GROUND_SHADE_FIT,
  LOOKUP_CELLS_PER_COLUMN,
  LOOKUP_RADIUS_M,
  MIN_SUN_TAN,
  SHADOW_MAX_M,
  SHADOW_SOFTNESS,
  SHADOW_STRETCH,
  SHADOW_WIDTH_SHARE,
  TREE_HUE_RANGE,
  TREE_SCALE_DRAW,
  TREE_SCALE_RANGE,
  TREE_TONE_DRAW,
  TREE_TONE_RANGE,
  patternFadeBand,
} from './forest-shading';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `0` both forms, `1` instances only, `2` layer only, `3` instances on the left half of the screen and the layer on the right. */
export type ForestViewMode = 0 | 1 | 2 | 3;

export interface IForestLayer {
  readonly layer: SurfaceLayer;
  /** Live uniforms: change `.value`, nothing recompiles. */
  readonly uniforms: {
    readonly enabled: any;
    readonly mode: any;
    readonly fadeStartM: any;
    readonly fadeEndM: any;
    readonly densityScale: any;
    /** The per-tree pattern blends into the average between these camera distances (about 3 px and 2 px a crown). */
    readonly patternStartM: any;
    readonly patternEndM: any;
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
 * `cellHash` of `forest-field.ts` in TSL, on a body-order cell (`ivec3` or `uvec3`): same constants, same wrap-around.
 * Each component is cast with `uint()` on its own: TSL folds swizzles of a `uvec3(ivec3)` back onto the i32 vector,
 * which WGSL rejects as `i32 * u32`.
 */
export function cellHashNode(cell: any, salt: number): any {
  let h: any = uint(cell.x)
    .mul(uint(0x8da6b343))
    .bitXor(uint(cell.y).mul(uint(0xd8163841)))
    .bitXor(uint(cell.z).mul(uint(0xcb1ab31f)))
    .bitXor(uint(Math.imul(salt + 1, 0x27d4eb2f) >>> 0));
  h = h.bitXor(h.shiftRight(uint(15)));
  h = h.mul(uint(0x85ebca6b));
  h = h.bitXor(h.shiftRight(uint(13)));
  h = h.mul(uint(0xc2b2ae35));
  h = h.bitXor(h.shiftRight(uint(16)));
  return float(h.shiftRight(uint(8))).div(16777216);
}

/** `treeTone` in TSL. */
export function treeToneNode(draw: any): any {
  const brightness = float(1).add(draw.sub(0.5).mul(2 * TREE_TONE_RANGE));
  const hue = fract(draw.mul(13.7)).sub(0.5).mul(2);
  return vec3(
    brightness.mul(float(1).add(hue.mul(TREE_HUE_RANGE))),
    brightness.mul(float(1).add(hue.mul(TREE_HUE_RANGE * 0.3))),
    brightness.mul(float(1).sub(hue.mul(TREE_HUE_RANGE))),
  );
}

/** `shadowFactor` in TSL: light on shaded ground relative to lit flat ground (the sky share alone). */
export const shadowFactorNode = (sinElevation: any): any =>
  float(FOREST_SKY_SHARE).div(float(FOREST_SKY_SHARE).add(max(sinElevation, 0).mul(1 - FOREST_SKY_SHARE)));

/** 0 once the sun is down, 1 from 0.05 in `sin(elevation)`, as in the CPU twin: a set sun shades nothing. */
export const sunUpRamp = (sinElevation: any): any => clamp(sinElevation.div(0.05), 0, 1);

/**
 * `treesNear` in TSL: calls `visit(offset, scale, toneDraw)` inside the shader loop for every tree the scatter placed
 * near `point` (body-fixed metres) whose keep draw is under `density`. `offset` is tree base minus `point` in the
 * tangent plane, body frame. The loop runs in the dominant axis's frame (`perm`), so the column logic of the CPU twin
 * holds on every face; cells are hashed in body order. `prefix` keeps two lookups' loop variables apart.
 */
function eachTreeNear(point: any, radiusM: number, density: any, prefix: string, visit: (offset: any, scale: any, toneDraw: any) => void): void {
  const S = FOREST_SPACING_M;
  const seed = TREE_SEED * 8;
  const rho = float(radiusM + S / 2);
  const n: any = normalize(point);
  const a: any = n.abs();
  const kx = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z));
  const ky = kx.not().and(a.y.greaterThanEqual(a.z));
  // (u, v, k) from body order and back: k = x gives (y, z, x), k = y gives (z, x, y).
  const perm = (v: any): any => select(kx, v.yzx, select(ky, v.zxy, v));
  const unperm = (v: any): any => select(kx, v.zxy, select(ky, v.yzx, v));
  const N: any = perm(n).toVar();
  const Q: any = N.mul(rho).toVar();
  // Cells relative to a base cell at the point keep the float32 arithmetic small.
  const base: any = ivec3(int(floor(Q.x.div(S))), int(floor(Q.y.div(S))), int(floor(Q.z.div(S)))).toVar();
  const local: any = Q.sub(vec3(base).mul(S)).toVar();
  const names = { u: `${prefix}u`, v: `${prefix}v`, j: `${prefix}j` };
  // Three nested counters in one call: the typings only know the single-counter form.
  (Loop as any)(
    { start: -1, end: 2, type: 'int', name: names.u },
    { start: -1, end: 2, type: 'int', name: names.v },
    { start: 0, end: LOOKUP_CELLS_PER_COLUMN, type: 'int', name: names.j },
    (vars: any) => {
      const du = local.x.sub(float(vars[names.u]).add(0.5).mul(S));
      const dv = local.y.sub(float(vars[names.v]).add(0.5).mul(S));
      // Where the shell's middle crosses this column, then the cells around it.
      const kColumn = local.z.add(Q.x.mul(du).add(Q.y.mul(dv)).div(Q.z));
      const dk = int(floor(kColumn.div(S).sub(2))).add(vars[names.j]);
      const offsetCells = ivec3(vars[names.u], vars[names.v], dk);
      const cell = unperm(base.add(offsetCells)).toVar();
      const jitter = perm(vec3(cellHashNode(cell, seed), cellHashNode(cell, seed + 1), cellHashNode(cell, seed + 2)));
      const rel = vec3(offsetCells).add(jitter).mul(S).sub(local);
      const up = dot(rel, N);
      const tangent = rel.sub(N.mul(up));
      const radial = up.add(dot(tangent, tangent).div(rho.mul(2)));
      const kept = radial.greaterThanEqual(-S / 2).and(radial.lessThan(S / 2)).and(cellHashNode(cell, seed + 3).lessThan(density));
      If(kept, () => {
        const scale = float(TREE_SCALE_RANGE[0]).add(cellHashNode(cell, seed + TREE_SCALE_DRAW).mul(TREE_SCALE_RANGE[1] - TREE_SCALE_RANGE[0]));
        visit(unperm(tangent), scale, cellHashNode(cell, seed + TREE_TONE_DRAW));
      });
    },
  );
}

/**
 * Plan 063 spike S1: the forest's far form, evaluated per pixel from the same density field and the same cell hash the
 * instances are scattered from. Nothing is baked. The pattern is `forestPattern` of `forest-shading.ts` (the CPU twin,
 * with the reasoning); the layer writes `albedo = ground x below + tree x treeAlbedo`.
 *
 * - Near (under the instances, `fadeWeight` 0): only the trees' ground shadows; the instances are the crowns.
 * - Fade band: the crowns fade in as the instances dissolve; both are the same trees, same tone.
 * - From about 3 px to 2 px a crown (`patternStartM` to `patternEndM`): the pattern blends into `forestAverage`, a
 *   function of the sun's height and the density fitted to the pattern's own mean; beyond, the lookups are skipped.
 *
 * **Temporary:** crown light and shadows are baked into the albedo, because the planet lighting stage reads only the
 * sphere normal and its `sunVisibility` dims the sky light too. Move them to the library's normal and direct-shadow
 * inputs when those land.
 */
export function forestLayer(radiusM: number): IForestLayer {
  const band = forestFadeBand();
  const patternBand = patternFadeBand();
  const enabled: any = uniform(1);
  const mode: any = uniform(0);
  const fadeStartM: any = uniform(band.startM);
  const fadeEndM: any = uniform(band.endM);
  const densityScale: any = uniform(1);
  const patternStartM: any = uniform(patternBand.startM);
  const patternEndM: any = uniform(patternBand.endM);
  const sunBody: any = uniform(new Vector3(0, 1, 0));
  const alongAxis: any = uniform(new Vector3(1, 0, 0));
  const acrossAxis: any = uniform(new Vector3(0, 0, 1));
  const treeAlbedo: any = uniform(new Vector3(0.035, 0.085, 0.03));
  const H = FOREST_TREE_HEIGHT_M;
  const crownRadius = FOREST_CROWN_WIDTH_M / 2;

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

  const withinLookup = (d: any): any => float(1).sub(smooth(LOOKUP_RADIUS_M - 0.5, LOOKUP_RADIUS_M, d));

  /** `crownLight` in TSL. */
  const crownLight = (o: any, rc: any, sinElevation: any): any => {
    const d = length(o);
    const clamped = o.mul(min(rc.div(max(d, 1e-4)), 1));
    const z = sqrt(float(1).sub(min(dot(o, o).div(rc.mul(rc)), 1)));
    const lean = CROWN_NORMAL_LEAN;
    const dome = dot(clamped, sunBody).div(rc).add(z.mul(sinElevation));
    const norm = sqrt(float((1 - lean) ** 2 + lean ** 2).add(z.mul(2 * lean * (1 - lean))));
    const nDotL = sinElevation.mul(1 - lean).add(dome.mul(lean)).div(norm);
    const A = FOREST_SKY_SHARE;
    const relative = float(A).add(max(nDotL, 0).mul(1 - A)).div(float(A).add(max(sinElevation, 0).mul(1 - A)));
    return mix(float(1), relative, sunUpRamp(sinElevation));
  };

  /** `forestAverage` in TSL: `vec4(tree weight, ground weight)`. */
  const average = (sinElevation: any, dens: any, crownWeight: any, tanElevation: any): any => {
    const d = clamp(dens, 0, 1);
    const cover = d.mul(COVER_FIT[0]).add(d.mul(d).mul(COVER_FIT[1])).mul(crownWeight);
    const fitted = float(CROWN_LIGHT_FIT[0]).add(exp(max(sinElevation, 0).negate().div(CROWN_LIGHT_FIT[2])).mul(CROWN_LIGHT_FIT[1]));
    const light = mix(float(1), fitted, sunUpRamp(sinElevation));
    const shade = d.mul(GROUND_SHADE_FIT[0]).mul(smooth(0, GROUND_SHADE_FIT[1], float(CROWN_CENTRE_SHARE * H).div(tanElevation)));
    const ground = float(1).sub(cover).mul(float(1).add(shadowFactorNode(sinElevation).sub(1).mul(shade)));
    return (vec4 as any)(vec3(cover.mul(light)), ground);
  };

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    const p = bodyFixed(context);
    const heightM = length(p).sub(radiusM);
    const distance = context.cameraDistance;
    const weight = fadeWeight(distance);
    const dens = density(p, heightM);
    const n = normalize(p);
    const sinElevation = dot(sunBody, n);
    const horizontal = sunBody.sub(n.mul(sinElevation));
    const cosElevation = length(horizontal);
    const toSun = horizontal.div(max(cosElevation, 1e-6));
    const tanElevation = max(sinElevation.div(max(cosElevation, 1e-4)), MIN_SUN_TAN);
    const pixelM = distance.mul(PIXEL_PER_DISTANCE);
    const toAverage = smoothstep(patternStartM, patternEndM, distance);
    const mean = average(sinElevation, dens, weight, tanElevation);

    const weights: any = Fn(() => {
      const ground: any = float(1).toVar();
      const tree: any = vec3(0).toVar();
      If(toAverage.lessThan(1).and(dens.greaterThan(0)).and(enabled.greaterThan(0)), () => {
        // Ground shadows: the casters stand near the point one shadow offset toward the sun.
        const shade: any = float(0).toVar();
        const sunward = p.add(toSun.mul(float(CROWN_CENTRE_SHARE * H).div(tanElevation)));
        eachTreeNear(sunward, radiusM, dens, 's', (offset, scale) => {
          const r = offset.negate();
          const x = dot(r, toSun);
          const y = sqrt(max(dot(r, r).sub(x.mul(x)), 0));
          const rc = scale.mul(crownRadius);
          const a = min(rc.add(scale.mul(SHADOW_STRETCH * CROWN_LENGTH_SHARE * H).div(tanElevation)), SHADOW_MAX_M);
          const b = rc.mul(SHADOW_WIDTH_SHARE);
          const e = length(vec2(x.div(a), y.div(b)));
          const s = float(1).sub(smoothstep(float(1 - SHADOW_SOFTNESS), float(1).add(pixelM.div(b)), e)).mul(withinLookup(length(r)));
          shade.assign(max(shade, s));
        });
        ground.assign(mix(float(1), shadowFactorNode(sinElevation), shade));
        // Crowns over the ground, in the lookup's order (the CPU twin's order).
        const edge = max(pixelM.mul(0.5), 0.3);
        eachTreeNear(p, radiusM, dens, 'c', (offset, scale, toneDraw) => {
          const o = offset.negate();
          const rc = scale.mul(crownRadius);
          const d = length(o);
          const c = float(1).sub(smoothstep(rc.sub(edge), rc.add(edge), d)).mul(withinLookup(d)).mul(weight);
          const colour = treeToneNode(toneDraw).mul(crownLight(o, rc, sinElevation));
          ground.assign(ground.mul(float(1).sub(c)));
          tree.assign(mix(tree, colour, c));
        });
      });
      return (vec4 as any)(mix(tree, mean.xyz, toAverage), mix(ground, mean.w, toAverage));
    })();

    const albedo = below.albedo.mul(weights.w).add(vec3(treeAlbedo).mul(weights.xyz));
    const cover = clamp(float(1).sub(weights.w), 0, 1).mul(enabled);
    return {
      ...below,
      albedo: mix(below.albedo, albedo, enabled),
      roughness: mix(below.roughness, float(0.92), cover),
    };
  };

  return {
    layer,
    uniforms: { enabled, mode, fadeStartM, fadeEndM, densityScale, patternStartM, patternEndM, sunBody },
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
