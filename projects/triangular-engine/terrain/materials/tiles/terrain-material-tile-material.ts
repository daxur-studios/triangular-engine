import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import type { ITerrainMaterialTilePayload } from './terrain-material-tile';

export interface ITerrainMaterialTileUniforms {
  readonly enabled: IUniform<number>;
  readonly texture: IUniform<DataTexture>;
  readonly uvScale: IUniform<[number, number]>;
  readonly uvOffset: IUniform<[number, number]>;
}

export function createTerrainMaterialTileUniforms(): ITerrainMaterialTileUniforms {
  const placeholder = new DataTexture(
    new Uint8Array([0, 0, 0, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  placeholder.minFilter = LinearFilter;
  placeholder.magFilter = LinearFilter;
  placeholder.needsUpdate = true;
  return {
    enabled: { value: 0 },
    texture: { value: placeholder },
    uvScale: { value: [1, 1] },
    uvOffset: { value: [0, 0] },
  };
}

export function updateTerrainMaterialTile(
  uniforms: ITerrainMaterialTileUniforms,
  payload: ITerrainMaterialTilePayload,
): void {
  const oldTexture = uniforms.texture.value;
  uniforms.texture.value = createTerrainMaterialTileTexture(payload);
  uniforms.enabled.value = 1;
  oldTexture.dispose();
}

export function setTerrainMaterialTileEnabled(
  uniforms: ITerrainMaterialTileUniforms,
  enabled: boolean,
): void {
  uniforms.enabled.value = enabled ? 1 : 0;
}

export function createTerrainMaterialTileTexture(
  payload: ITerrainMaterialTilePayload,
): DataTexture {
  const texture = new DataTexture(
    payload.mipData[0],
    payload.width,
    payload.height,
    RGBAFormat,
    UnsignedByteType,
  );
  // The baker contract is linear RGB. Do not apply an sRGB decode to these
  // bytes before MeshStandardMaterial lighting consumes them.
  texture.colorSpace = NoColorSpace;
  texture.mipmaps = payload.mipData.slice(1).map((data, index) => ({
    data,
    width: Math.max(1, payload.width >> (index + 1)),
    height: Math.max(1, payload.height >> (index + 1)),
  }));
  texture.minFilter = payload.mipData.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Adds the single-tile prototype path to an existing material. The production
 * page-table/texture-array path belongs to the later streaming milestone.
 */
export function enableTerrainMaterialTileLookup(
  material: Material,
  uniforms: ITerrainMaterialTileUniforms,
): void {
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);
    shader.uniforms['uTerrainMaterialTileEnabled'] = uniforms.enabled;
    shader.uniforms['uTerrainMaterialTile'] = uniforms.texture;
    shader.uniforms['uTerrainMaterialTileUvScale'] = uniforms.uvScale;
    shader.uniforms['uTerrainMaterialTileUvOffset'] = uniforms.uvOffset;
    if (!shader.vertexShader.includes('vTerrainMaterialTileUv')) {
      // Three.js supplies the uv attribute even without USE_UV; only the
      // fragment varying needs declaring for this custom texture lookup.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
          varying vec2 vTerrainMaterialTileUv;
        `,
      );
      // The planet morph patch replaces <begin_vertex>, so attach this after
      // that patch at the stable projection hook instead.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vTerrainMaterialTileUv = uv;
          #include <project_vertex>
        `,
      );
    }
    if (!shader.fragmentShader.includes('uTerrainMaterialTileEnabled')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
          uniform float uTerrainMaterialTileEnabled;
          uniform sampler2D uTerrainMaterialTile;
          uniform vec2 uTerrainMaterialTileUvScale;
          uniform vec2 uTerrainMaterialTileUvOffset;
          varying vec2 vTerrainMaterialTileUv;
        `,
      );
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
        `#include <color_fragment>
        if (uTerrainMaterialTileEnabled > 0.5) {
          vec2 terrainTileUv = vTerrainMaterialTileUv * uTerrainMaterialTileUvScale + uTerrainMaterialTileUvOffset;
          diffuseColor.rgb = texture2D(uTerrainMaterialTile, terrainTileUv).rgb;
        }
      `,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|terrainMaterialTile`;
  material.needsUpdate = true;
}
