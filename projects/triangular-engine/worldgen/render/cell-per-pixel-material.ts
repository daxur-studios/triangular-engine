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
import { findCellAt, findCellNear, IPlanetGraphCore, IVec3 } from 'triangular-engine/worldgen';

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

export interface ICellPerPixelPaletteEdit {
  readonly cellId: number;
  readonly colour: readonly [number, number, number, number?];
}

/** Default atlas width used by the reusable cell layer adapter. */
const DEFAULT_CELL_ID_WIDTH = 512;

/** Default atlas height used by the reusable cell layer adapter. */
const DEFAULT_CELL_ID_HEIGHT = 256;

export interface ICellPerPixelLookupBuildOptions {
  readonly cellIdWidth?: number;
  readonly cellIdHeight?: number;
}

/**
 * Builds the geographic cell-ID atlas once for a graph.
 *
 * The palette is copied into the resident cell table; subsequent layer changes only
 * update that table and never repeat this atlas work.
 */
export function buildCellPerPixelLookupPayload(
  graph: IPlanetGraphCore,
  cellData: Float32Array,
  options: ICellPerPixelLookupBuildOptions = {},
): ICellPerPixelLookupPayload {
  const cellIdWidth = Math.max(2, Math.floor(options.cellIdWidth ?? DEFAULT_CELL_ID_WIDTH));
  const cellIdHeight = Math.max(2, Math.floor(options.cellIdHeight ?? DEFAULT_CELL_ID_HEIGHT));
  const expectedCellDataLength = graph.cells.length * 4;
  if (cellData.length !== expectedCellDataLength) {
    throw new RangeError('Cell lookup palette length does not match graph cell count.');
  }

  const cellIdData = new Uint8Array(cellIdWidth * cellIdHeight * 4);
  for (let y = 0; y < cellIdHeight; y += 1) {
    const latitude = -Math.PI / 2 + ((y + 0.5) / cellIdHeight) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    const firstDirection: IVec3 = {
      x: cosLatitude * Math.sin(-Math.PI),
      y: Math.sin(latitude),
      z: cosLatitude * Math.cos(-Math.PI),
    };
    let previousCell = findCellAt(graph, firstDirection);
    for (let x = 0; x < cellIdWidth; x += 1) {
      const longitude = -Math.PI + ((x + 0.5) / cellIdWidth) * Math.PI * 2;
      const direction: IVec3 = {
        x: cosLatitude * Math.sin(longitude),
        y: Math.sin(latitude),
        z: cosLatitude * Math.cos(longitude),
      };
      previousCell = findCellNear(graph, direction, previousCell.id);
      const offset = (y * cellIdWidth + x) * 4;
      cellIdData[offset] = previousCell.id & 255;
      cellIdData[offset + 1] = (previousCell.id >> 8) & 255;
      cellIdData[offset + 3] = 255;
    }
  }

  return {
    cellData: new Float32Array(cellData),
    cellTextureWidth: graph.cells.length,
    cellIdData,
    cellIdWidth,
    cellIdHeight,
  };
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

/** Applies a batch of categorical cell edits with one texture invalidation. */
export function updateCellPerPixelPaletteEntries(
  uniforms: ICellPerPixelLookupUniforms,
  edits: readonly ICellPerPixelPaletteEdit[],
): void {
  const data = uniforms.uCellData.value.image.data as Float32Array;
  const cellCount = data.length / 4;
  for (const edit of edits) {
    if (!Number.isInteger(edit.cellId) || edit.cellId < 0 || edit.cellId >= cellCount) {
      throw new RangeError(`Cell palette edit ${edit.cellId} is out of range.`);
    }
    const offset = edit.cellId * 4;
    data[offset] = Math.max(0, Math.min(1, edit.colour[0]));
    data[offset + 1] = Math.max(0, Math.min(1, edit.colour[1]));
    data[offset + 2] = Math.max(0, Math.min(1, edit.colour[2]));
    data[offset + 3] = edit.colour[3] === undefined ? 1 : Math.max(0, Math.min(1, edit.colour[3]));
  }
  if (edits.length > 0) uniforms.uCellData.value.needsUpdate = true;
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

      vec4 cellPerPixelColour(vec3 direction) {
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
        return texture2D(uCellData, vec2(cellX, 0.5));
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
        vec4 cellLayerColour = cellPerPixelColour(normalize(vSphereNorm));
        diffuseColor.rgb = mix(
          diffuseColor.rgb,
          cellLayerColour.rgb,
          cellLayerColour.a * uCellPerPixelOpacity
        );
      }
      `,
    );
  };

  material.customProgramCacheKey = () => `${previousCacheKey()}|cellPerPixelAtlas`;
  material.needsUpdate = true;
}
