import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';

/**
 * Patches a material so the per-instance opacity written to the
 * `instanceDitherAlpha` attribute (by `buildScatterInstancedMesh`, from a
 * bucket's `alpha01ByInstanceId`) drives a screen-space Bayer dither
 * discard instead of alpha blending. Discard-based cross-fade needs no
 * transparency sort order and stays compatible with shadow casting,
 * unlike `transparent: true` — the standard technique for LOD pop
 * cross-fades. Call once per material instance; the patch is baked into
 * the compiled shader program via `onBeforeCompile`.
 */
export function enableScatterDitherFade(material: Material): void {
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float instanceDitherAlpha;\nvarying float vScatterDitherAlpha;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvScatterDitherAlpha = instanceDitherAlpha;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vScatterDitherAlpha;
float scatterBayerDither(vec2 fragCoord) {
  vec2 p = mod(floor(fragCoord), 4.0);
  int idx = int(p.x) + int(p.y) * 4;
  float bayer[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  return (bayer[idx] + 0.5) / 16.0;
}`,
      )
      .replace(
        'void main() {',
        'void main() {\n  if (vScatterDitherAlpha < scatterBayerDither(gl_FragCoord.xy)) discard;',
      );
  };
  // See scatter-wind-material.ts for why this is required: `customProgramCacheKey()`
  // defaults to `onBeforeCompile.toString()`, which is identical source text on
  // every call — without a distinct tag here, materials patched with only this
  // function collide with any other single-purpose patch's cache key.
  material.customProgramCacheKey = () => `${previousCacheKey()}|scatterDither`;
  material.needsUpdate = true;
}
