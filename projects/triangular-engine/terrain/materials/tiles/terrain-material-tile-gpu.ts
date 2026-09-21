import {
  DataArrayTexture, DataTexture, FloatType, LinearFilter, Material, NearestFilter,
  NoColorSpace, RGBAFormat, UnsignedByteType,
} from 'three';
import type { ITerrainMaterialTileAddress, ITerrainMaterialTilePayload } from './terrain-material-tile';
import type { ITerrainMaterialResidentPage } from './terrain-material-tile-stream';

const TABLE_SIZE = 32;
const TABLE_FLOATS = TABLE_SIZE * TABLE_SIZE * 4;

/** Sparse two-level mapping: 32² directory, allocated 32² leaves, max LOD 10. */
export function buildTerrainMaterialPageTable(pages: readonly ITerrainMaterialResidentPage[]) {
  const directory = new Float32Array(TABLE_FLOATS);
  const leaves: Float32Array[] = [];
  const root = pages.find(p => p.address.level === 0);
  if (!root) throw new Error('Material page table needs a resident root.');
  for (let i = 0; i < directory.length; i += 4) directory.set([root.slot, 0, 0, 0], i);
  for (const page of [...pages].sort((a, b) => a.address.level - b.address.level)) {
    const { level, x, y } = page.address;
    if (level > 10 || level < 0 || x < 0 || y < 0 || x >= 2 ** level || y >= 2 ** level) {
      throw new RangeError('Material mapping supports unit-square levels 0–10.');
    }
    const entry = [page.slot, level, x, y];
    if (level <= 5) {
      const size = 2 ** (5 - level);
      for (let yy = y * size; yy < (y + 1) * size; yy++) {
        for (let xx = x * size; xx < (x + 1) * size; xx++) directory.set(entry, (yy * TABLE_SIZE + xx) * 4);
      }
    } else {
      const divisor = 2 ** (level - 5);
      const offset = (Math.floor(y / divisor) * TABLE_SIZE + Math.floor(x / divisor)) * 4;
      if (directory[offset] >= 0) {
        const leaf = new Float32Array(TABLE_FLOATS);
        const ancestor = directory.subarray(offset, offset + 4);
        for (let i = 0; i < leaf.length; i += 4) leaf.set(ancestor, i);
        directory.set([-leaves.length - 1, 0, 0, 0], offset);
        leaves.push(leaf);
      }
      const leaf = leaves[-directory[offset] - 1];
      const size = 2 ** (10 - level);
      const startX = (x * size) % TABLE_SIZE;
      const startY = (y * size) % TABLE_SIZE;
      for (let yy = startY; yy < startY + size; yy++) {
        for (let xx = startX; xx < startX + size; xx++) leaf.set(entry, (yy * TABLE_SIZE + xx) * 4);
      }
    }
  }
  return { directory, leaves };
}

/** Shared WebGL2 storage. Colour uploads are one layer, never the entire pool. */
export class TerrainMaterialTileGpu {
  readonly enabled = { value: 0 };
  readonly debug = { value: 0 };
  private desired?: readonly ITerrainMaterialTileAddress[];
  readonly pages: DataArrayTexture;
  readonly directory: DataTexture;
  readonly leaves: DataArrayTexture;
  readonly interiorSize = 128;
  readonly gutterSize = 2;
  readonly pageSize = 132;
  readonly capacity = 128;
  readonly allocatedBytes: number;
  uploadedBytes = 0;

  constructor() {
    this.pages = new DataArrayTexture(new Uint8Array(this.pageSize ** 2 * 4 * this.capacity),
      this.pageSize, this.pageSize, this.capacity);
    this.pages.type = UnsignedByteType;
    this.pages.format = RGBAFormat;
    this.pages.colorSpace = NoColorSpace;
    this.pages.minFilter = this.pages.magFilter = LinearFilter;
    this.pages.generateMipmaps = false;
    this.directory = new DataTexture(new Float32Array(TABLE_FLOATS), TABLE_SIZE, TABLE_SIZE, RGBAFormat, FloatType);
    this.directory.minFilter = this.directory.magFilter = NearestFilter;
    this.directory.generateMipmaps = false;
    this.leaves = new DataArrayTexture(new Float32Array(TABLE_FLOATS * this.capacity), TABLE_SIZE, TABLE_SIZE, this.capacity);
    this.leaves.type = FloatType;
    this.leaves.format = RGBAFormat;
    this.leaves.minFilter = this.leaves.magFilter = NearestFilter;
    this.leaves.generateMipmaps = false;
    // Initialize one otherwise unreferenced layer; never upload all empty layers.
    this.leaves.addLayerUpdate(0);
    this.leaves.needsUpdate = true;
    this.allocatedBytes = this.pageSize ** 2 * 4 * this.capacity + TABLE_FLOATS * 4 * (this.capacity + 1);
  }

  publish(payload: ITerrainMaterialTilePayload, slot: number,
    resident: ReadonlyMap<string, ITerrainMaterialResidentPage>): void {
    if (payload.interiorSize !== this.interiorSize || payload.gutterSize !== this.gutterSize ||
      payload.width !== this.pageSize || payload.height !== this.pageSize ||
      payload.mipData[0].length !== this.pageSize ** 2 * 4 || slot < 0 || slot >= this.capacity) {
      throw new RangeError('Material array requires 128-texel tiles with two gutter texels.');
    }
    const data = this.pages.image.data as Uint8Array;
    data.set(payload.mipData[0], slot * this.pageSize ** 2 * 4);
    this.pages.addLayerUpdate(slot);
    this.pages.needsUpdate = true;
    this.uploadedBytes += payload.mipData[0].byteLength;
    this.updateMapping(resident);
    this.enabled.value = 1;
  }

  /** Keep cached detail, but stop displaying overspecified tiles when zoomed out. */
  setSelection(addresses: readonly ITerrainMaterialTileAddress[],
    resident: ReadonlyMap<string, ITerrainMaterialResidentPage>): void {
    this.desired = addresses;
    if (resident.has('0/0/0')) this.updateMapping(resident);
  }

  private updateMapping(resident: ReadonlyMap<string, ITerrainMaterialResidentPage>): void {
    const visible = [...resident.values()].filter(page => page.address.level === 0 ||
      !this.desired || this.desired.some(a => {
        const scale = 2 ** (a.level - page.address.level);
        return scale >= 1 && Math.floor(a.x / scale) === page.address.x && Math.floor(a.y / scale) === page.address.y;
      }));
    const table = buildTerrainMaterialPageTable(visible);
    if (table.leaves.length > this.capacity) throw new RangeError('Sparse material table budget exceeded.');
    const directoryData = this.directory.image.data as Float32Array;
    if (table.directory.some((v, i) => directoryData[i] !== v) || this.enabled.value === 0) {
      directoryData.set(table.directory);
      this.directory.needsUpdate = true;
      this.uploadedBytes += table.directory.byteLength;
    }
    const leafData = this.leaves.image.data as Float32Array;
    let dirty = false;
    table.leaves.forEach((leaf, index) => {
      const offset = index * TABLE_FLOATS;
      if (leaf.some((v, i) => leafData[offset + i] !== v)) {
        leafData.set(leaf, offset);
        this.leaves.addLayerUpdate(index);
        this.uploadedBytes += leaf.byteLength;
        dirty = true;
      }
    });
    if (dirty) this.leaves.needsUpdate = true;
  }

  dispose(): void {
    this.enabled.value = 0;
    this.pages.dispose(); this.directory.dispose(); this.leaves.dispose();
  }
}

/** Two mapping reads at most, one cached colour read, compatible with batching. */
export function enableStreamedTerrainMaterial(material: Material, gpu: TerrainMaterialTileGpu): void {
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    Object.assign(shader.uniforms, {
      uTerrainStreamEnabled: gpu.enabled,
      uTerrainStreamDebug: gpu.debug,
      uTerrainStreamPages: { value: gpu.pages },
      uTerrainStreamDirectory: { value: gpu.directory },
      uTerrainStreamLeaves: { value: gpu.leaves },
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec2 vTerrainStreamUv;');
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
      'vTerrainStreamUv = uv;\n#include <project_vertex>');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vTerrainStreamUv;
      uniform float uTerrainStreamEnabled;
      uniform float uTerrainStreamDebug;
      uniform highp sampler2DArray uTerrainStreamPages;
      uniform sampler2D uTerrainStreamDirectory;
      uniform highp sampler2DArray uTerrainStreamLeaves;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (uTerrainStreamEnabled > 0.5) {
        vec2 domainUv = vec2(fract(vTerrainStreamUv.x), clamp(vTerrainStreamUv.y, 0.0, 0.9999999));
        vec2 directoryUv = domainUv * 32.0;
        vec4 page = texture2D(uTerrainStreamDirectory, (floor(directoryUv) + 0.5) / 32.0);
        if (page.x < 0.0) {
          page = texture(uTerrainStreamLeaves, vec3((floor(fract(directoryUv) * 32.0) + 0.5) / 32.0, -page.x - 1.0));
        }
        vec2 localUv = domainUv * exp2(page.y) - page.zw;
        // Explicit level zero: array layers do not share atlas gutters or derivatives.
        diffuseColor.rgb = textureLod(uTerrainStreamPages, vec3((localUv * 128.0 + 2.0) / 132.0, page.x), 0.0).rgb;
        if (uTerrainStreamDebug > 0.5) {
          vec3 levelColour = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + page.y * 1.7);
          vec2 edge = min(localUv, 1.0 - localUv);
          float line = 1.0 - smoothstep(0.0, 0.01, min(edge.x, edge.y));
          diffuseColor.rgb = mix(mix(diffuseColor.rgb, levelColour, 0.5), vec3(1.0), line);
        }
      }
    `);
  };
  material.customProgramCacheKey = () => `${previousKey()}|terrainStream-v1`;
  material.needsUpdate = true;
}
