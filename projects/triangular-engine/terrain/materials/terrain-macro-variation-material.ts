import {
  IUniform,
  Material,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';

/**
 * Shared, material-agnostic close-range macro/micro colour breakup for terrain.
 *
 * This is the GPU half of the deterministic CPU signal in
 * `terrain-material.ts` (`sampleTerrainMacroVariation` /
 * `applyTerrainMacroVariation`). Keep the two byte-consistent: the noise,
 * coordinate offsets and warm-variation coefficients below are the shader
 * mirror of those functions, and `terrain-macro-variation-material.spec.ts`
 * pins that contract.
 *
 * The chunk is deliberately free of any uniform or attribute declaration so it
 * can be dropped into a `ShaderMaterial` (e.g. the clipmap) as well as the
 * composable patch applied by `enableTerrainMacroVariation`. Callers pass the
 * scale in; the composable patch reads it from `uTerrainMacroScaleM`.
 */
export const TERRAIN_MACRO_VARIATION_GLSL = `
  float terrainMacroHash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float terrainMacroValueNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float x00 = mix(terrainMacroHash3(i), terrainMacroHash3(i + vec3(1.0, 0.0, 0.0)), f.x);
    float x10 = mix(terrainMacroHash3(i + vec3(0.0, 1.0, 0.0)), terrainMacroHash3(i + vec3(1.0, 1.0, 0.0)), f.x);
    float x01 = mix(terrainMacroHash3(i + vec3(0.0, 0.0, 1.0)), terrainMacroHash3(i + vec3(1.0, 0.0, 1.0)), f.x);
    float x11 = mix(terrainMacroHash3(i + vec3(0.0, 1.0, 1.0)), terrainMacroHash3(i + vec3(1.0, 1.0, 1.0)), f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
  }

  // Planet-safe macro breakup in display metres. The second sample uses a
  // rotated coordinate basis so the two scales do not form an obvious grid.
  float terrainMacroVariation3(vec3 positionM, float scaleM) {
    float scale = max(scaleM, 1.0);
    vec3 broad = positionM / scale + vec3(17.3, -9.1, 4.7);
    vec3 breakup = vec3(
      (0.8 * positionM.x - 0.6 * positionM.z) / (scale * 1.73) - 23.1,
      positionM.y / (scale * 1.73) + 5.7,
      (0.6 * positionM.x + 0.8 * positionM.z) / (scale * 1.73) + 11.9
    );
    return terrainMacroValueNoise3(broad) * 0.65 + terrainMacroValueNoise3(breakup) * 0.35;
  }

  // Mirror of applyTerrainMacroVariation(): land-only, sign-symmetric warm/cool
  // tint. landFactor is 1 on bare land and 0 where snow/water must stay clean.
  vec3 terrainMacroApply(vec3 baseRgb, float variation01, float strength, float landFactor) {
    float signedVariation = (clamp(variation01, 0.0, 1.0) - 0.5) * 2.0;
    vec3 warmVariation = vec3(1.0) + signedVariation * vec3(0.12, 0.09, 0.055);
    float amount = clamp(strength, 0.0, 1.0) * clamp(landFactor, 0.0, 1.0);
    return mix(baseRgb, baseRgb * warmVariation, amount);
  }
`;

export interface ITerrainMacroVariationUniforms {
  uTerrainMacroEnabled: IUniform<number>;
  uTerrainMacroStrength: IUniform<number>;
  uTerrainMacroScaleM: IUniform<number>;
}

export function createDefaultTerrainMacroVariationUniforms(
  holder?: Partial<ITerrainMacroVariationUniforms>,
): ITerrainMacroVariationUniforms {
  return {
    uTerrainMacroEnabled: holder?.uTerrainMacroEnabled ?? { value: 1 },
    uTerrainMacroStrength: holder?.uTerrainMacroStrength ?? { value: 0.35 },
    uTerrainMacroScaleM: holder?.uTerrainMacroScaleM ?? { value: 48 },
  };
}

export interface ITerrainMacroVariationOptions {
  /**
   * Per-vertex land mask attribute name, or `null` to use `landMaskUniform`
   * instead. Defaults to `'terrainMacroLandFactor'`, the attribute emitted by
   * the cell-planet meshers. A custom mesher must provide it, or pass `null`.
   */
  landMaskAttribute?: string | null;
  /** Land mask used when `landMaskAttribute` is `null`. */
  landMaskUniform?: IUniform<number>;
  /**
   * Space the macro is sampled in raw:
   * - `'bodyFixedM'` (default): the mesh's own `position` attribute, which is
   *   independent of any morph/view reprojection, so the pattern stays welded
   *   to geography instead of swimming as the view morphs.
   * - `'viewM'`: the post-displacement `transformed` value, for callers whose
   *   `position` is already the final view space.
   * Both are then lifted through the batching/instancing/model matrices, so a
   * `BatchedMesh` patch with a non-zero instance translation (a recentred
   * planet) still samples a single continuous field.
   */
  positionSpace?: 'bodyFixedM' | 'viewM';
}

/**
 * Patches any Three.js material via `onBeforeCompile` to add land-only macro/micro
 * colour breakup, using the shared `TERRAIN_MACRO_VARIATION_GLSL` noise.
 *
 * Conforms to triangular-engine's composable-material-patch idiom: chains any
 * previous `onBeforeCompile` and appends to `customProgramCacheKey` without
 * overwriting prior patches. The hook is attached to `project_vertex`, which no
 * other terrain patch consumes, so it composes in either order with
 * `enablePlanetMorphProjection`.
 *
 * The base material's own colour is preserved; `vertexColors` is neither
 * required nor forced. Pair it with the CPU sampler to keep CPU/GPU consistent.
 */
export function enableTerrainMacroVariation(
  material: Material,
  uniforms: ITerrainMacroVariationUniforms,
  options: ITerrainMacroVariationOptions = {},
): void {
  const landMaskAttribute =
    options.landMaskAttribute === undefined
      ? 'terrainMacroLandFactor'
      : options.landMaskAttribute;
  const usesAttributeMask = landMaskAttribute !== null && landMaskAttribute !== '';
  const positionSpace = options.positionSpace ?? 'bodyFixedM';

  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);

    shader.uniforms['uTerrainMacroEnabled'] = uniforms.uTerrainMacroEnabled;
    shader.uniforms['uTerrainMacroStrength'] = uniforms.uTerrainMacroStrength;
    shader.uniforms['uTerrainMacroScaleM'] = uniforms.uTerrainMacroScaleM;
    if (!usesAttributeMask && options.landMaskUniform) {
      shader.uniforms['uTerrainMacroLandFactor'] = options.landMaskUniform;
    }

    const vertexDeclarations = `
      ${usesAttributeMask ? `attribute float ${landMaskAttribute};` : 'uniform float uTerrainMacroLandFactor;'}
      #ifndef V_TERRAIN_MACRO_DECLARED
      #define V_TERRAIN_MACRO_DECLARED
      varying vec3 vTerrainMacroPositionM;
      varying float vTerrainMacroLandFactor;
      #endif
    `;
    const fragmentDeclarations = `
      uniform float uTerrainMacroEnabled;
      uniform float uTerrainMacroStrength;
      uniform float uTerrainMacroScaleM;
      ${usesAttributeMask ? '' : 'uniform float uTerrainMacroLandFactor;'}
      #ifndef V_TERRAIN_MACRO_DECLARED
      #define V_TERRAIN_MACRO_DECLARED
      varying vec3 vTerrainMacroPositionM;
      varying float vTerrainMacroLandFactor;
      #endif
      ${TERRAIN_MACRO_VARIATION_GLSL}
    `;

    if (!shader.vertexShader.includes('vTerrainMacroPositionM')) {
      shader.vertexShader = shader.vertexShader.includes('#include <common>')
        ? shader.vertexShader.replace(
            '#include <common>',
            `#include <common>\n${vertexDeclarations}`,
          )
        : vertexDeclarations + shader.vertexShader;
    }

    if (!shader.fragmentShader.includes('uTerrainMacroEnabled')) {
      shader.fragmentShader = shader.fragmentShader.includes(
        '#include <common>',
      )
        ? shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>\n${fragmentDeclarations}`,
          )
        : fragmentDeclarations + shader.fragmentShader;
    }

    const positionExpression =
      positionSpace === 'viewM' ? 'transformed' : 'position';
    const maskExpression = usesAttributeMask
      ? landMaskAttribute
      : 'uTerrainMacroLandFactor';

    // Attach to project_vertex (never consumed by the morph-projection patch) so
    // the sample point is resolved in a stable, morph-independent way and the
    // batching/instancing translation is included for recentred batched patches.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 terrainMacroLocal = vec4(${positionExpression}, 1.0);
      #ifdef USE_BATCHING
        terrainMacroLocal = batchingMatrix * terrainMacroLocal;
      #endif
      #ifdef USE_INSTANCING
        terrainMacroLocal = instanceMatrix * terrainMacroLocal;
      #endif
      vTerrainMacroPositionM = (modelMatrix * terrainMacroLocal).xyz;
      vTerrainMacroLandFactor = ${maskExpression};
      #include <project_vertex>
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      if (uTerrainMacroEnabled > 0.5) {
        float terrainMacroVariation = terrainMacroVariation3(vTerrainMacroPositionM, uTerrainMacroScaleM);
        diffuseColor.rgb = terrainMacroApply(diffuseColor.rgb, terrainMacroVariation, uTerrainMacroStrength, vTerrainMacroLandFactor);
      }
      `,
    );
  };

  material.customProgramCacheKey = () =>
    `${previousCacheKey()}|terrainMacroVariation`;
  material.needsUpdate = true;
}
