import {
  DataTexture,
  FloatType,
  IUniform,
  Material,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';

export interface ICellPerPixelLookupPayload {
  /** One RGBA float texel per cell; RGB is the linear display colour. */
  readonly cellData: Float32Array;
  readonly cellTextureWidth: number;
  /** RG encodes the cell id as low/high bytes; one texel per atlas pixel. */
  readonly cellIdData: Uint8Array;
  readonly cellIdWidth: number;
  readonly cellIdHeight: number;
}

export interface ICellPerPixelLookupUniforms {
  readonly uCellPerPixelEnabled: IUniform<number>;
  readonly uCellPerPixelOpacity: IUniform<number>;
  readonly uCellData: IUniform<DataTexture>;
  readonly uCellIds: IUniform<DataTexture>;
  readonly uCellTextureWidth: IUniform<number>;
  readonly uCellIdWidth: IUniform<number>;
  readonly uCellIdHeight: IUniform<number>;
}

function makeTexture(
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  type: typeof FloatType | typeof UnsignedByteType,
): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, type);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function makePlaceholderTexture(): DataTexture {
  return makeTexture(new Float32Array([0, 0, 0, 1]), 1, 1, FloatType);
}

function makePlaceholderIds(): DataTexture {
  return makeTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, UnsignedByteType);
}

export function createCellPerPixelLookupUniforms(): ICellPerPixelLookupUniforms {
  return {
    uCellPerPixelEnabled: { value: 0 },
    uCellPerPixelOpacity: { value: 1 },
    uCellData: { value: makePlaceholderTexture() },
    uCellIds: { value: makePlaceholderIds() },
    uCellTextureWidth: { value: 1 },
    uCellIdWidth: { value: 1 },
    uCellIdHeight: { value: 1 },
  };
}

/** Updates only the cell palette texture; the expensive geographic ID atlas stays resident. */
export function updateCellPerPixelPalette(
  uniforms: ICellPerPixelLookupUniforms,
  cellData: Float32Array,
): void {
  const texture = uniforms.uCellData.value;
  const data = texture.image.data as Float32Array;
  if (data.length !== cellData.length) {
    throw new RangeError('Cell palette length does not match the resident cell lookup.');
  }
  data.set(cellData);
  texture.needsUpdate = true;
}

/** Sets the blend amount used when the cell lookup is acting as an overlay. */
export function setCellPerPixelOpacity(
  uniforms: ICellPerPixelLookupUniforms,
  opacity: number,
): void {
  uniforms.uCellPerPixelOpacity.value = Math.max(0, Math.min(1, opacity));
}

/** Uploads a worker-produced lookup and enables the one-fetch shader path. */
export function updateCellPerPixelLookup(
  uniforms: ICellPerPixelLookupUniforms,
  payload: ICellPerPixelLookupPayload,
): void {
  const oldCellData = uniforms.uCellData.value;
  const oldIds = uniforms.uCellIds.value;
  uniforms.uCellData.value = makeTexture(payload.cellData, payload.cellTextureWidth, 1, FloatType);
  uniforms.uCellIds.value = makeTexture(
    payload.cellIdData,
    payload.cellIdWidth,
    payload.cellIdHeight,
    UnsignedByteType,
  );
  uniforms.uCellTextureWidth.value = payload.cellTextureWidth;
  uniforms.uCellIdWidth.value = payload.cellIdWidth;
  uniforms.uCellIdHeight.value = payload.cellIdHeight;
  uniforms.uCellPerPixelEnabled.value = 1;
  oldCellData.dispose();
  oldIds.dispose();
}

/** Enables or disables the cell atlas overlay without rebuilding the material. */
export function setCellPerPixelLookupEnabled(
  uniforms: ICellPerPixelLookupUniforms,
  enabled: boolean,
): void {
  uniforms.uCellPerPixelEnabled.value = enabled ? 1 : 0;
}

/** Replaces coarse vertex colour sampling with one cell-ID atlas lookup per fragment. */
export function enableCellPerPixelLookup(
  material: Material,
  uniforms: ICellPerPixelLookupUniforms,
): void {
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);
    shader.uniforms['uCellPerPixelEnabled'] = uniforms.uCellPerPixelEnabled;
    shader.uniforms['uCellPerPixelOpacity'] = uniforms.uCellPerPixelOpacity;
    shader.uniforms['uCellData'] = uniforms.uCellData;
    shader.uniforms['uCellIds'] = uniforms.uCellIds;
    shader.uniforms['uCellTextureWidth'] = uniforms.uCellTextureWidth;
    shader.uniforms['uCellIdWidth'] = uniforms.uCellIdWidth;
    shader.uniforms['uCellIdHeight'] = uniforms.uCellIdHeight;

    const declarations = `
      uniform float uCellPerPixelEnabled;
      uniform float uCellPerPixelOpacity;
      uniform sampler2D uCellData;
      uniform sampler2D uCellIds;
      uniform float uCellTextureWidth;
      uniform float uCellIdWidth;
      uniform float uCellIdHeight;
      #ifndef V_SPHERE_NORM_DECLARED
      #define V_SPHERE_NORM_DECLARED
      varying vec3 vSphereNorm;
      #endif

      vec3 cellPerPixelColour(vec3 direction) {
        float latitude = asin(clamp(direction.y, -1.0, 1.0));
        float longitude = atan(direction.x, direction.z);
        vec2 atlasUv = vec2(
          (longitude + 3.141592653589793) / 6.283185307179586,
          (latitude + 1.5707963267948966) / 3.141592653589793
        );
        vec4 encoded = texture2D(uCellIds, atlasUv);
        float cellId = floor(encoded.r * 255.0 + 0.5) +
          floor(encoded.g * 255.0 + 0.5) * 256.0;
        float cellX = (cellId + 0.5) / uCellTextureWidth;
        return texture2D(uCellData, vec2(cellX, 0.5)).rgb;
      }
    `;

    if (!shader.fragmentShader.includes('uCellPerPixelEnabled')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\n${declarations}`,
      );
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      if (uCellPerPixelEnabled > 0.5) {
        diffuseColor.rgb = mix(
          diffuseColor.rgb,
          cellPerPixelColour(normalize(vSphereNorm)),
          uCellPerPixelOpacity
        );
      }
      `,
    );
  };

  material.customProgramCacheKey = () => `${previousCacheKey()}|cellPerPixelAtlas`;
  material.needsUpdate = true;
}
