import { Matrix4 } from 'three';
import {
  attribute,
  clamp,
  dot,
  Fn,
  float,
  floor,
  fract,
  max,
  mix,
  modelWorldMatrix,
  select,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import type { IPlanetContext } from './planet-context';
import type { ISurfaceSample, SurfaceLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `fract(sin(dot(p, (127.1, 311.7, 74.7))) * 43758.5453)`: the hash `TERRAIN_MACRO_VARIATION_GLSL` uses. */
export const terrainMacroHash3 = Fn(([p]: [any]) =>
  fract(dot(p, vec3(127.1, 311.7, 74.7)).sin().mul(43758.5453)),
);

/** Trilinear value noise with a smoothstep fade, as `terrainMacroValueNoise3` in the GLSL. */
export const terrainMacroValueNoise3 = Fn(([p]: [any]) => {
  const i = floor(p);
  const f0: any = fract(p);
  const f: any = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
  const h = (x: number, y: number, z: number) => terrainMacroHash3(i.add(vec3(x, y, z)));
  const x00 = mix(h(0, 0, 0), h(1, 0, 0), f.x);
  const x10 = mix(h(0, 1, 0), h(1, 1, 0), f.x);
  const x01 = mix(h(0, 0, 1), h(1, 0, 1), f.x);
  const x11 = mix(h(0, 1, 1), h(1, 1, 1), f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
});

/** One noise sample in display metres: mirrors `sampleTerrainMacroVariation` on the CPU. */
export const terrainMacroVariation3 = Fn(([positionM, scaleM]: [any, any]) => {
  const scale = max(scaleM, 1);
  return terrainMacroValueNoise3(positionM.div(scale).add(vec3(17.3, -9.1, 4.7)));
});

/** Land-only warm/cool tint, sign-symmetric around `variation01 = 0.5`: mirrors `terrainMacroApply`. */
export const terrainMacroApply = Fn(
  ([baseRgb, variation01, strength, landFactor]: [any, any, any, any]) => {
    const signed = clamp(variation01, 0, 1).sub(0.5).mul(2);
    const warm = vec3(1, 1, 1).add(signed.mul(vec3(0.12, 0.09, 0.055)));
    const amount = clamp(strength, 0, 1).mul(clamp(landFactor, 0, 1));
    return mix(baseRgb, baseRgb.mul(warm), amount);
  },
);

export interface IMacroVariationLayerOptions {
  /**
   * Where the noise is sampled:
   * - `'bodyFixed'` (default): the unmorphed position, so the pattern stays welded to geography as the
   *   view morphs. This is the GLSL `'bodyFixedM'`.
   * - `'morphed'`: the morphed position. The GLSL calls this `'viewM'`, but what it samples is the
   *   morphed local position, so the TSL option says that.
   * Both include the batch translation, so recentred `BatchedMesh` patches sample one continuous field.
   */
  readonly positionSpace?: 'bodyFixed' | 'morphed';
  /** Per-vertex land-mask attribute. Default `'terrainMacroLandFactor'`; `null` uses `landFactor` instead. */
  readonly landMaskAttribute?: string | null;
  /** Constant land factor when `landMaskAttribute` is `null` (default 1). */
  readonly landFactor?: number;
  /** Scene -> body frame matrix (e.g. a floating-origin group). Drive `.value`; no recompile. */
  readonly sceneToBody?: Matrix4;
  readonly strength?: number;
  readonly scaleM?: number;
  readonly enabled?: boolean;
}

export interface IMacroVariationLayer {
  readonly layer: SurfaceLayer;
  /** 1 = on. Uniform nodes: change `.value`, nothing recompiles. */
  readonly enabled: any;
  readonly strength: any;
  readonly scaleM: any;
  readonly sceneToBody: any | null;
  /** Vertex attributes the layer reads, counting against WebGPU's limit of 8 vertex buffers. */
  readonly vertexAttributes: readonly string[];
}

/**
 * Surface layer: land-only macro colour breakup. A port of `enableTerrainMacroVariation`, with the same
 * noise, offsets and warm-tint coefficients as the CPU `sampleTerrainMacroVariation`.
 */
export function macroVariationLayer(options: IMacroVariationLayerOptions = {}): IMacroVariationLayer {
  const positionSpace = options.positionSpace ?? 'bodyFixed';
  const maskAttribute =
    options.landMaskAttribute === undefined ? 'terrainMacroLandFactor' : options.landMaskAttribute;
  const enabled = uniform(options.enabled === false ? 0 : 1);
  const strength = uniform(options.strength ?? 0.35);
  const scaleM = uniform(options.scaleM ?? 48);
  const sceneToBody: any = options.sceneToBody ? uniform(options.sceneToBody) : null;
  const vertexAttributes = maskAttribute ? [maskAttribute] : [];

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    const local =
      positionSpace === 'morphed' ? context.morphedBatchedLocal : context.bodyFixedLocal;
    // Lift through the model matrix (and the floating-origin matrix, when given) in the vertex stage.
    let lifted: any = modelWorldMatrix.mul(vec4(local, 1));
    if (sceneToBody) lifted = sceneToBody.mul(lifted);
    const positionM: any = varying(lifted.xyz, 'vMacroPositionM');
    const landFactor: any = maskAttribute
      ? varying(attribute(maskAttribute, 'float' as const), 'vMacroLandFactor')
      : float(options.landFactor ?? 1);

    const variation = terrainMacroVariation3(positionM, scaleM);
    const tinted = terrainMacroApply(below.albedo, variation, strength, landFactor);
    return { ...below, albedo: select(enabled.greaterThan(0.5), tinted, below.albedo) };
  };

  return { layer, enabled, strength, scaleM, sceneToBody, vertexAttributes };
}
