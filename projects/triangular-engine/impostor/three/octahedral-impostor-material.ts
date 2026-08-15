import type {
  IUniform,
  Material,
  Matrix4,
  Texture,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';

import {
  IMPOSTOR_MAP_FRAGMENT_GLSL,
  IMPOSTOR_NORMAL_FRAGMENT_BEGIN_GLSL,
  IMPOSTOR_PARAMS_FRAGMENT_GLSL,
  IMPOSTOR_PARAMS_VERTEX_GLSL,
  IMPOSTOR_VERTEX_GLSL,
} from './impostor-shading-glsl';

/** Structural subset of the material properties an impostor's baked textures are assigned to — every renderable material (`MeshStandardMaterial`, `MeshLambertMaterial`, `MeshBasicMaterial`, ...) has these, but `Material` itself doesn't declare them. */
interface IImpostorTexturedMaterial {
  map: Texture | null;
  normalMap: Texture | null;
}

export interface ICreateOctahedralImpostorMaterialOptions<T extends Material> {
  /** Real material type to patch — e.g. `MeshStandardMaterial` so the impostor still receives scene lighting. */
  readonly baseType: new () => T;
  readonly albedo: Texture;
  readonly normalDepth: Texture;
  /** Scale+translate from the reference library's `OctahedralImpostor`: fits the unit billboard plane to the baked target's bounding sphere. See `octahedral-impostor-mesh.ts`. */
  readonly transform: Matrix4;
  /** Must match the atlas this material's textures were baked with. @default 16 */
  readonly spritesPerSide?: number;
  /** Alpha below which a pixel (and, if every blended sprite is below it, the whole fragment) is discarded. @default 0.4 */
  readonly alphaClamp?: number;
  readonly transparent?: boolean;
}

export interface IOctahedralImpostorMaterialHandle<T extends Material> {
  readonly material: T;
  setAlphaClamp(value: number): void;
  /** Flips the `EZ_TRANSPARENT` blending path; recompiles the shader program (`material.needsUpdate = true`) since it's a `#define`, not a uniform. */
  setTransparent(value: boolean): void;
}

/**
 * Patches a real material via `onBeforeCompile` to render as a
 * hemispherical octahedral impostor: pick the 3 baked atlas views nearest
 * the current camera direction and blend them with barycentric weights (see
 * `impostor-shading-glsl.ts`). Port of the reference octahedral-impostor
 * library's `createOctahedralImpostorMaterial`, adapted to this engine's
 * composable-material-patch idiom (see `scatter/three/scatter-billboard-material.ts`
 * and `scatter-wind-material.ts`): chains any existing
 * `onBeforeCompile`/`customProgramCacheKey` instead of overwriting them, and
 * returns a handle instead of stashing state on the material/global `Material`
 * type — the reference's `declare module 'three' { interface Material { ... } }`
 * augmentation isn't used here.
 */
export function createOctahedralImpostorMaterial<T extends Material>(
  options: ICreateOctahedralImpostorMaterialOptions<T>,
): IOctahedralImpostorMaterialHandle<T> {
  const material = new options.baseType();
  material.transparent = options.transparent ?? false;

  const texturedMaterial = material as unknown as IImpostorTexturedMaterial;
  texturedMaterial.map = options.albedo;
  texturedMaterial.normalMap = options.normalDepth;

  const spritesPerSideUniform: IUniform<number> = { value: options.spritesPerSide ?? 16 };
  const alphaClampUniform: IUniform<number> = { value: options.alphaClamp ?? 0.4 };
  const transformUniform: IUniform<Matrix4> = { value: options.transform };
  let transparent = options.transparent ?? false;

  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);

    if (transparent) shader.defines = { ...shader.defines, EZ_TRANSPARENT: true };

    shader.uniforms['spritesPerSide'] = spritesPerSideUniform;
    shader.uniforms['alphaClamp'] = alphaClampUniform;
    shader.uniforms['impostorTransform'] = transformUniform;

    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', IMPOSTOR_PARAMS_VERTEX_GLSL)
      .replace('#include <project_vertex>', IMPOSTOR_VERTEX_GLSL);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `${IMPOSTOR_MAP_FRAGMENT_GLSL}\nvec4 diffuseColor = vec4( diffuse, opacity );`,
      )
      .replace('#include <clipping_planes_pars_fragment>', IMPOSTOR_PARAMS_FRAGMENT_GLSL)
      .replace('#include <normal_fragment_begin>', IMPOSTOR_NORMAL_FRAGMENT_BEGIN_GLSL)
      // The impostor's own blended normal map fully replaces the base
      // material's normal-map handling, which would otherwise re-sample
      // (and fight) it using the wrong (whole-quad) UVs.
      .replace('#include <normal_fragment_maps>', '// #include <normal_fragment_maps>')
      .replace('#include <map_fragment>', 'diffuseColor *= blendedColor;');
  };

  // Three.js's shader program cache keys on customProgramCacheKey(), which
  // defaults to onBeforeCompile.toString() — identical source text on every
  // call to this function. Without a distinct tag, two impostor materials
  // (or an impostor material chained after another patch) collide on the
  // same cache key and share a compiled program that's wrong for one of
  // them — see scatter-wind-material.ts for the same fix applied there.
  material.customProgramCacheKey = () => `${previousCacheKey()}|impostor:${transparent}`;
  material.needsUpdate = true;

  return {
    material,
    setAlphaClamp(value: number) {
      alphaClampUniform.value = value;
    },
    setTransparent(value: boolean) {
      if (transparent === value) return;
      transparent = value;
      material.transparent = value;
      material.needsUpdate = true;
    },
  };
}
