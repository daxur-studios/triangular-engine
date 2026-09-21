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
  readonly tiledEnabled: IUniform<number>;
  readonly tileGrid: IUniform<[number, number]>;
  readonly tileInteriorSize: IUniform<number>;
  readonly tileGutterSize: IUniform<number>;
  readonly tileAtlasSize: IUniform<number>;
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
    tiledEnabled: { value: 0 },
    tileGrid: { value: [1, 1] },
    tileInteriorSize: { value: 1 },
    tileGutterSize: { value: 0 },
    tileAtlasSize: { value: 1 },
  };
}

export function updateTerrainMaterialTile(
  uniforms: ITerrainMaterialTileUniforms,
  payload: ITerrainMaterialTilePayload,
): void {
  const oldTexture = uniforms.texture.value;
  uniforms.texture.value = createTerrainMaterialTileTexture(payload);
  uniforms.enabled.value = 1;
  uniforms.tiledEnabled.value = 0;
  oldTexture.dispose();
}

function copyTileIntoAtlas(
  destination: Uint8Array,
  destinationWidth: number,
  source: Uint8Array,
  sourceWidth: number,
  tileX: number,
  tileY: number,
): void {
  for (let row = 0; row < sourceWidth; row += 1) {
    const sourceOffset = row * sourceWidth * 4;
    const destinationOffset =
      ((tileY * sourceWidth + row) * destinationWidth + tileX * sourceWidth) * 4;
    destination.set(
      source.subarray(sourceOffset, sourceOffset + sourceWidth * 4),
      destinationOffset,
    );
  }
}

/** Resizes each resident page in its own local coordinates, including gutters. */
function preserveAtlasPages(
  uniforms: ITerrainMaterialTileUniforms,
  destination: Uint8Array,
  payload: ITerrainMaterialTilePayload,
  grid: [number, number],
): void {
  const oldInterior = uniforms.tileInteriorSize.value;
  const oldGutter = uniforms.tileGutterSize.value;
  const oldPageSize = oldInterior + oldGutter * 2;
  const oldImage = uniforms.texture.value.image;
  if (
    uniforms.tileGrid.value[0] !== grid[0] ||
    uniforms.tileGrid.value[1] !== grid[1] ||
    oldImage.width !== oldPageSize * grid[0] ||
    oldImage.height !== oldPageSize * grid[1]
  ) return;

  const source = oldImage.data as Uint8Array;
  const destinationWidth = payload.width * grid[0];
  for (let pageY = 0; pageY < grid[1]; pageY += 1) {
    for (let pageX = 0; pageX < grid[0]; pageX += 1) {
      for (let y = 0; y < payload.height; y += 1) {
        const sy = Math.max(0, Math.min(oldPageSize - 1,
          (y - payload.gutterSize + 0.5) / payload.interiorSize * oldInterior + oldGutter - 0.5));
        const y0 = Math.floor(sy);
        const y1 = Math.min(oldPageSize - 1, y0 + 1);
        const fy = sy - y0;
        for (let x = 0; x < payload.width; x += 1) {
          const sx = Math.max(0, Math.min(oldPageSize - 1,
            (x - payload.gutterSize + 0.5) / payload.interiorSize * oldInterior + oldGutter - 0.5));
          const x0 = Math.floor(sx);
          const x1 = Math.min(oldPageSize - 1, x0 + 1);
          const fx = sx - x0;
          const a = ((pageY * oldPageSize + y0) * oldImage.width + pageX * oldPageSize + x0) * 4;
          const b = ((pageY * oldPageSize + y1) * oldImage.width + pageX * oldPageSize + x0) * 4;
          const dx = (x1 - x0) * 4;
          const target = ((pageY * payload.height + y) * destinationWidth + pageX * payload.width + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            const lower = source[a + channel] * (1 - fx) + source[a + dx + channel] * fx;
            const upper = source[b + channel] * (1 - fx) + source[b + dx + channel] * fx;
            destination[target + channel] = Math.round(lower * (1 - fy) + upper * fy);
          }
        }
      }
    }
  }
}

/** Updates one page in a small atlas while leaving the other pages resident. */
export function updateTerrainMaterialTileAtlasRegion(
  uniforms: ITerrainMaterialTileUniforms,
  payload: ITerrainMaterialTilePayload,
  tileX: number,
  tileY: number,
  grid: [number, number],
): void {
  const [gridX, gridY] = grid;
  if (
    !Number.isInteger(tileX) ||
    !Number.isInteger(tileY) ||
    tileX < 0 ||
    tileY < 0 ||
    tileX >= gridX ||
    tileY >= gridY
  ) {
    throw new RangeError('Terrain material atlas tile coordinates are out of range.');
  }

  const oldTexture = uniforms.texture.value;
  const expectedWidth = payload.width * gridX;
  const expectedHeight = payload.height * gridY;
  const canReuse =
    oldTexture.image.width === expectedWidth &&
    oldTexture.image.height === expectedHeight &&
    oldTexture.mipmaps.length === 0 &&
    oldTexture.generateMipmaps === (payload.mipData.length > 1);

  let texture = oldTexture;
  if (!canReuse) {
    texture = new DataTexture(
      new Uint8Array(expectedWidth * expectedHeight * 4),
      expectedWidth,
      expectedHeight,
      RGBAFormat,
      UnsignedByteType,
    );
    texture.colorSpace = NoColorSpace;
    // Generate mips from the assembled atlas. Packing each page's mips does
    // not give valid atlas dimensions once an odd-sized page is halved:
    // floor(pageWidth / 2) * gridX can differ from floor(atlasWidth / 2).
    // With no explicit mipmaps, Three uploads image.data as level zero.
    // Keep the correct geographic fallback in every region during refinement.
    // On first load the caller assembles coarse coverage before displaying it.
    preserveAtlasPages(uniforms, texture.image.data as Uint8Array, payload, grid);
    texture.minFilter = payload.mipData.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = payload.mipData.length > 1;
    uniforms.texture.value = texture;
    oldTexture.dispose();
  }

  copyTileIntoAtlas(
    texture.image.data as Uint8Array,
    expectedWidth,
    payload.mipData[0],
    payload.width,
    tileX,
    tileY,
  );
  texture.needsUpdate = true;
  uniforms.enabled.value = 1;
  uniforms.tileGrid.value = [gridX, gridY];
  uniforms.tileInteriorSize.value = payload.interiorSize;
  uniforms.tileGutterSize.value = payload.gutterSize;
  uniforms.tileAtlasSize.value = payload.width * gridX;
}

export function setTerrainMaterialTileTiledEnabled(
  uniforms: ITerrainMaterialTileUniforms,
  enabled: boolean,
): void {
  uniforms.tiledEnabled.value = enabled ? 1 : 0;
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
  // DataTexture explicit mipmaps include level zero; Three ignores image.data
  // for upload when this array is nonempty.
  texture.mipmaps = payload.mipData.map((data, index) => ({
    data,
    width: Math.max(1, payload.width >> index),
    height: Math.max(1, payload.height >> index),
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
    shader.uniforms['uTerrainMaterialTileTiledEnabled'] = uniforms.tiledEnabled;
    shader.uniforms['uTerrainMaterialTileGrid'] = uniforms.tileGrid;
    shader.uniforms['uTerrainMaterialTileInteriorSize'] = uniforms.tileInteriorSize;
    shader.uniforms['uTerrainMaterialTileGutterSize'] = uniforms.tileGutterSize;
    shader.uniforms['uTerrainMaterialTileAtlasSize'] = uniforms.tileAtlasSize;
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
          uniform float uTerrainMaterialTileTiledEnabled;
          uniform vec2 uTerrainMaterialTileGrid;
          uniform float uTerrainMaterialTileInteriorSize;
          uniform float uTerrainMaterialTileGutterSize;
          uniform float uTerrainMaterialTileAtlasSize;
          varying vec2 vTerrainMaterialTileUv;
        `,
      );
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
        `#include <color_fragment>
        if (uTerrainMaterialTileEnabled > 0.5) {
          vec2 terrainTileUv;
          if (uTerrainMaterialTileTiledEnabled > 0.5) {
            vec2 boundedUv = clamp(vTerrainMaterialTileUv, vec2(0.0), vec2(0.999999));
            vec2 gridUv = boundedUv * uTerrainMaterialTileGrid;
            vec2 localUv = fract(gridUv);
            vec2 pageOrigin = floor(gridUv) * (uTerrainMaterialTileInteriorSize + 2.0 * uTerrainMaterialTileGutterSize);
            vec2 atlasSize = (uTerrainMaterialTileInteriorSize + 2.0 * uTerrainMaterialTileGutterSize) * uTerrainMaterialTileGrid;
            terrainTileUv = (pageOrigin + vec2(uTerrainMaterialTileGutterSize) + localUv * uTerrainMaterialTileInteriorSize) / atlasSize;
          } else {
            terrainTileUv = vTerrainMaterialTileUv * uTerrainMaterialTileUvScale + uTerrainMaterialTileUvOffset;
          }
          diffuseColor.rgb = texture2D(uTerrainMaterialTile, terrainTileUv).rgb;
        }
      `,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|terrainMaterialTile`;
  material.needsUpdate = true;
}
