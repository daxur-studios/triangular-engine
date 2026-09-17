import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BufferGeometry, ClampToEdgeWrapping, DataTexture, Float32BufferAttribute, FloatType, LinearFilter, Mesh, MeshStandardMaterial, PlaneGeometry, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector3 } from 'three';
import { EngineModule, EngineService, RaycastFocusContext, RaycastOrbitControlsComponent } from 'triangular-engine';
import { simplifyIndexedGeometry } from 'triangular-engine/meshoptimizer';
import {
  WORLD_PROFILES,
  IPlanetGraphCore,
  IPlanetEcology,
  IPlanetSurfaceBake,
  IPlanetTectonics,
  WorldProfileKind,
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetSurfaceBake,
  buildPlanetTectonics,
  createPlanetSurfaceSampler,
  deriveIsLand,
} from 'triangular-engine/worldgen';
import {
  MAP_PROJECTIONS,
  MAP_PROJECTION_KINDS,
  MAP_PROJECTION_LABELS,
  MapProjectionKind,
  CellPlanetMapFillMode,
  biomeColor,
  elevationColor,
  lavaOceanColor,
  moistureColor,
  plateColor,
  temperatureColor,
  WORLD_SIZE_TIER_RADIUS_M,
  WorldSizeTier,
  formatDistanceM,
  IPlanarHeightField,
  intersectPlanarHeightField,
} from 'triangular-engine/worldgen/render';
import { evaluateTerrainMaterial, terrainMaterialColorRgb } from 'triangular-engine/terrain';
import {
  createClipmapTerrainScene,
  IClipmapTerrainHeightSource,
  IClipmapTerrainSceneHandle,
} from 'triangular-engine/terrain';
import { CellPlanetQuery, readCellPlanetQuery } from '../cell-planet-view-query';
import { CELL_PLANET_GENERATION_DEFAULTS } from '../cell-planet-generation-config';
import {
  CELL_PLANET_U0_BOOKMARK_IDS,
  CELL_PLANET_U0_FIXTURE,
  CellPlanetU0BookmarkId,
  getCellPlanetU0Bookmark,
} from '../cell-planet-u0-fixture';
import {
  createCellPlanetSelection,
  ICellPlanetSelection,
  ICellPlanetSelectionController,
} from './cell-planet-terrain-selection';
import { CellPlanetSelectionPanelComponent } from './cell-planet-selection-panel.component';
import { getTerrainHeightScaleM } from './cell-planet-terrain-scale';

type TerrainQuality = 'preview' | 'standard' | 'high' | 'ultra';
type TerrainDisplayScale = 'planet' | 'legacy';

interface ITerrainQualityPreset {
  readonly label: string;
  readonly bakeWidth: number;
  readonly bakeHeight: number;
  readonly gridResolution: number;
  readonly levelCount: number;
}

const TERRAIN_QUALITY_PRESETS: Record<TerrainQuality, ITerrainQualityPreset> = {
  preview: { label: 'Preview', bakeWidth: 128, bakeHeight: 64, gridResolution: 16, levelCount: 4 },
  standard: { label: 'Standard', bakeWidth: 256, bakeHeight: 128, gridResolution: 32, levelCount: 5 },
  high: { label: 'High', bakeWidth: 512, bakeHeight: 256, gridResolution: 64, levelCount: 5 },
  ultra: { label: 'Ultra', bakeWidth: 1024, bakeHeight: 512, gridResolution: 128, levelCount: 6 },
};

const TERRAIN_QUALITY_KINDS: TerrainQuality[] = ['preview', 'standard', 'high', 'ultra'];

/** The fixed display rectangle used by the 2.5D page before physical planet units were added. */
const LEGACY_TERRAIN_MAP_BOUNDS = { minX: -128, minZ: -64, maxX: 128, maxZ: 64 } as const;

/**
 * Physical footprint of the full equirectangular unwrap. The map is still a projection (so
 * local scale varies with latitude), but its equatorial horizontal and meridional scales are in
 * metres and agree with the sphere's chosen radius. Keep this adapter here rather than in
 * worldgen/core: the generator remains dimensionless and consumers choose the body size.
 */
function makeTerrainMapBounds(radiusM: number): {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
} {
  const halfWidthM = Math.PI * radiusM;
  const halfHeightM = halfWidthM * 0.5;
  return { minX: -halfWidthM, minZ: -halfHeightM, maxX: halfWidthM, maxZ: halfHeightM };
}

/**
 * The current clipmap shader has sixteen explicitly branched level bounds. Keep enough rings to
 * cover a medium-size planet from the origin while retaining the quality preset's near detail.
 * Larger tiers intentionally remain a local-view preview until the quadtree terrain path owns
 * horizon-scale coverage; silently enlarging the finest tile would destroy close-up detail.
 */
function getClipmapLevelCount(radiusM: number, qualityLevelCount: number): number {
  const mapWidthM = 2 * Math.PI * radiusM;
  const baseTileSizeM = mapWidthM / 16;
  const required = Math.ceil(Math.log2((mapWidthM * 0.5) / (baseTileSizeM * 4))) + 1;
  return Math.min(16, Math.max(qualityLevelCount, required));
}

/**
 * Preserve the old clipmap layout when the dimensionless map is displayed in metres.
 * The legacy map was 256 units wide with 16-unit finest tiles, so its first ring covered
 * half the map and the next ring covered the remaining footprint. Keeping that ratio avoids
 * collapsing the entire physical planet into the coarse outer rings.
 */
function getTerrainBaseTileSizeM(mapWidthM: number): number {
  return mapWidthM / 16;
}

function srgbChannelToLinear(channel: number): number {
  const value = Math.max(0, Math.min(1, channel));
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

interface IObjTerrainExport {
  readonly obj: string;
  readonly mtl: string;
}

type CellPlanet25dFillMode = CellPlanetMapFillMode | 'material';

function buildRiverMaterialMask(graph: IPlanetGraphCore, ecology: IPlanetEcology): Uint8Array {
  const mask = new Uint8Array(graph.cells.length);
  const thresholdCos = Math.cos(0.09);
  for (const cell of graph.cells) {
    for (const path of ecology.riverPaths) {
      if (path.some((point) => cell.center.x * point.x + cell.center.y * point.y + cell.center.z * point.z >= thresholdCos)) {
        mask[cell.id] = 1;
        break;
      }
    }
  }
  return mask;
}

function makeOceanMaskTexture(bake: IPlanetSurfaceBake, oceanSubstance: 'water' | 'lava'): DataTexture {
  const rgb = hslToRgb(oceanSubstance === 'lava' ? lavaOceanColor() : 'hsl(205, 65%, 32%)');
  const rgba = new Uint8Array(bake.cellIds.length * 4);
  for (let index = 0; index < bake.cellIds.length; index++) {
    const offset = index * 4;
    rgba[offset] = rgb[0];
    rgba[offset + 1] = rgb[1];
    rgba[offset + 2] = rgb[2];
    // Invalid projection pixels and land are transparent; water cells form the sea surface.
    rgba[offset + 3] = bake.cellIds[index] >= 0 && bake.landMask[index] === 0 ? 255 : 0;
  }
  const texture = new DataTexture(rgba, bake.width, bake.height, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  // Bake row 0 is the minimum world-Z row used by the clipmap's mapUv. Keep the
  // typed-array convention explicit; the plane geometry corrects its own V axis below.
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function getElevationRange(elevations: ArrayLike<number>): { readonly min: number; readonly max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < elevations.length; index++) {
    const elevation = elevations[index] ?? 0;
    min = Math.min(min, elevation);
    max = Math.max(max, elevation);
  }
  return { min, max };
}

function makeObjTerrainExport(
  bake: IPlanetSurfaceBake,
  colorTexture: DataTexture,
  bounds: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number },
  materialFileName: string,
): IObjTerrainExport {
  const colorData = colorTexture.image.data as Uint8Array;
  const materialNames = new Map<string, string>();
  const materials: string[] = [];
  const materialForPixel = (pixel: number): string => {
    const offset = pixel * 4;
    // Quantizing keeps elevation/temperature/moisture exports from creating a
    // separate MTL material for every texel while preserving their gradients.
    const r = Math.round((colorData[offset] ?? 0) / 17) * 17;
    const g = Math.round((colorData[offset + 1] ?? 0) / 17) * 17;
    const b = Math.round((colorData[offset + 2] ?? 0) / 17) * 17;
    const key = `${r},${g},${b}`;
    let name = materialNames.get(key);
    if (!name) {
      name = `terrain_${materialNames.size}`;
      materialNames.set(key, name);
      materials.push(`newmtl ${name}\nKd ${(r / 255).toFixed(4)} ${(g / 255).toFixed(4)} ${(b / 255).toFixed(4)}\nKa 0 0 0\nKs 0 0 0\n\n`);
    }
    return name;
  };

  const vertexIndex = (x: number, y: number): number => y * bake.width + x + 1;
  const vertexHeight = (x: number, y: number): number => bake.elevations[y * bake.width + x] ?? 0;
  const validPixel = (x: number, y: number): boolean => bake.cellIds[y * bake.width + x] >= 0;
  const objLines: string[] = [
    '# Cell planet 2.5D terrain export',
    `mtllib ${materialFileName}`,
    'o cell_planet_terrain',
  ];

  for (let y = 0; y < bake.height; y++) {
    const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * y) / Math.max(1, bake.height - 1);
    for (let x = 0; x < bake.width; x++) {
      const worldX = bounds.minX + ((bounds.maxX - bounds.minX) * x) / Math.max(1, bake.width - 1);
      objLines.push(`v ${worldX.toFixed(5)} ${vertexHeight(x, y).toFixed(5)} ${z.toFixed(5)}`);
    }
  }
  for (let y = 0; y < bake.height; y++) {
    const v = (1 - y / Math.max(1, bake.height - 1)).toFixed(6);
    for (let x = 0; x < bake.width; x++) {
      objLines.push(`vt ${(x / Math.max(1, bake.width - 1)).toFixed(6)} ${v}`);
    }
  }

  for (let y = 0; y < bake.height - 1; y++) {
    for (let x = 0; x < bake.width - 1; x++) {
      if (!validPixel(x, y) || !validPixel(x + 1, y) || !validPixel(x, y + 1) || !validPixel(x + 1, y + 1)) {
        continue;
      }
      const topLeft = vertexIndex(x, y);
      const bottomLeft = vertexIndex(x, y + 1);
      const bottomRight = vertexIndex(x + 1, y + 1);
      const topRight = vertexIndex(x + 1, y);
      const material = materialForPixel(y * bake.width + x);
      objLines.push(`usemtl ${material}`);
      // Counter-clockwise from above, so Blender imports the terrain normals
      // facing upward.
      objLines.push(`f ${topLeft}/${topLeft} ${bottomLeft}/${bottomLeft} ${bottomRight}/${bottomRight} ${topRight}/${topRight}`);
    }
  }

  return {
    obj: `${objLines.join('\n')}\n`,
    mtl: `# Cell planet terrain materials\n${materials.join('')}`,
  };
}

function makeBakedTerrainGeometry(
  bake: IPlanetSurfaceBake,
  bounds: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number },
  colorTexture?: DataTexture,
): BufferGeometry {
  const positions = new Float32Array(bake.width * bake.height * 3);
  const uvs = new Float32Array(bake.width * bake.height * 2);
  const colors = colorTexture ? new Float32Array(bake.width * bake.height * 3) : undefined;
  const colorData = colorTexture?.image.data as Uint8Array | undefined;
  const indices: number[] = [];
  const vertexIndex = (x: number, y: number): number => y * bake.width + x;
  for (let y = 0; y < bake.height; y++) {
    const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * y) / Math.max(1, bake.height - 1);
    for (let x = 0; x < bake.width; x++) {
      const vertex = vertexIndex(x, y);
      const positionOffset = vertex * 3;
      const uvOffset = vertex * 2;
      positions[positionOffset] = bounds.minX + ((bounds.maxX - bounds.minX) * x) / Math.max(1, bake.width - 1);
      positions[positionOffset + 1] = bake.elevations[vertex] ?? 0;
      positions[positionOffset + 2] = z;
      uvs[uvOffset] = x / Math.max(1, bake.width - 1);
      uvs[uvOffset + 1] = 1 - y / Math.max(1, bake.height - 1);
      if (colors && colorData) {
        const colorOffset = vertex * 3;
        const pixelOffset = vertex * 4;
        // The clipmap samples an sRGB DataTexture, while Three.js vertex colors
        // are consumed as linear values by MeshStandardMaterial. Decode here so
        // the simplified inspection mesh keeps the same visible tint and does
        // not appear artificially brighter/washed out than the clipmap.
        colors[colorOffset] = srgbChannelToLinear((colorData[pixelOffset] ?? 0) / 255);
        colors[colorOffset + 1] = srgbChannelToLinear((colorData[pixelOffset + 1] ?? 0) / 255);
        colors[colorOffset + 2] = srgbChannelToLinear((colorData[pixelOffset + 2] ?? 0) / 255);
      }
    }
  }
  for (let y = 0; y < bake.height - 1; y++) {
    for (let x = 0; x < bake.width - 1; x++) {
      if (bake.cellIds[y * bake.width + x] < 0 || bake.cellIds[y * bake.width + x + 1] < 0 ||
          bake.cellIds[(y + 1) * bake.width + x] < 0 || bake.cellIds[(y + 1) * bake.width + x + 1] < 0) continue;
      const topLeft = vertexIndex(x, y);
      const bottomLeft = vertexIndex(x, y + 1);
      const bottomRight = vertexIndex(x + 1, y + 1);
      const topRight = vertexIndex(x + 1, y);
      indices.push(topLeft, bottomLeft, bottomRight, topLeft, bottomRight, topRight);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

function makeHeightTexture(values: Float32Array, min: number, max: number, width: number, height: number): DataTexture {
  const range = Math.max(0.000001, max - min);
  const rgba = new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const normalized = (values[i] - min) / range;
    const offset = i * 4;
    rgba[offset] = normalized;
    rgba[offset + 1] = normalized;
    rgba[offset + 2] = normalized;
    rgba[offset + 3] = 1;
  }
  const texture = new DataTexture(rgba, width, height, RGBAFormat, FloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function hslToRgb(value: string): [number, number, number] {
  const match = value.match(/^hsl\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i);
  if (!match) return [136, 136, 136];
  const h = ((Number(match[1]) % 360) + 360) % 360 / 360;
  const s = Math.max(0, Math.min(1, Number(match[2]) / 100));
  const l = Math.max(0, Math.min(1, Number(match[3]) / 100));
  if (s === 0) {
    const channel = Math.round(l * 255);
    return [channel, channel, channel];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    let normalized = t;
    if (normalized < 0) normalized += 1;
    if (normalized > 1) normalized -= 1;
    if (normalized < 1 / 6) return p + (q - p) * 6 * normalized;
    if (normalized < 1 / 2) return q;
    if (normalized < 2 / 3) return p + (q - p) * (2 / 3 - normalized) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ];
}

function makeColorTexture(
  bake: IPlanetSurfaceBake,
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
  ecology: IPlanetEcology,
  fillMode: CellPlanet25dFillMode,
  oceanSubstance: 'water' | 'lava',
  elevationMin: number,
  elevationMax: number,
): DataTexture {
  const rgba = new Uint8Array(bake.cellIds.length * 4);
  const waterRgb = hslToRgb(oceanSubstance === 'lava' ? lavaOceanColor() : 'hsl(210, 55%, 22%)');
  const riverMask = fillMode === 'material' ? buildRiverMaterialMask(graph, ecology) : undefined;
  const ridgeCellSet = fillMode === 'material' ? new Set(tectonics.ridgeCellIds) : undefined;
  let maxSlope = 0;
  if (fillMode === 'material') {
    for (const slope of ecology.slope) maxSlope = Math.max(maxSlope, slope);
  }
  const landRange = Math.max(1, elevationMax - tectonics.seaLevelElevation);
  const materialOptions = {
    snowlineM: tectonics.seaLevelElevation + landRange * 0.68,
    snowlineBlendM: Math.max(0.05, landRange * 0.16),
  };
  for (let i = 0; i < bake.cellIds.length; i++) {
    const cellId = bake.cellIds[i];
    let rgb = waterRgb;
    if (cellId >= 0 && cellId < tectonics.elevation.length) {
      if (fillMode === 'material') {
        const material = evaluateTerrainMaterial(
          {
            elevationM: tectonics.elevation[cellId] ?? tectonics.seaLevelElevation,
            seaLevelM: tectonics.seaLevelElevation,
            minElevationM: elevationMin,
            maxElevationM: elevationMax,
            slope01: maxSlope > 0 ? (ecology.slope[cellId] ?? 0) / maxSlope : 0,
            moisture01: ecology.moisture[cellId],
            temperature01: ((ecology.temperature[cellId] ?? 0) + 1) * 0.5,
            snowIce01:
              ecology.biome[cellId] === 'ice_cap' ? 1 :
              ecology.biome[cellId] === 'glacier' ? 0.9 :
              ecology.biome[cellId] === 'tundra' ? 0.35 : 0,
            arid01:
              ecology.biome[cellId] === 'desert' ? 1 :
              ecology.biome[cellId] === 'steppe' ? 0.45 :
              ecology.biome[cellId] === 'savanna' ? 0.25 : 0,
            ridge01: ridgeCellSet?.has(cellId) ? 1 : 0,
            river01: riverMask?.[cellId] ?? 0,
          },
          materialOptions,
        );
        const color = terrainMaterialColorRgb(material, { oceanSubstance });
        rgb = [
          Math.round(color[0] * 255),
          Math.round(color[1] * 255),
          Math.round(color[2] * 255),
        ];
      } else {
        let color: string;
        if (oceanSubstance === 'lava' && ecology.waterBodyKind[cellId] === 'ocean') {
          color = lavaOceanColor();
        } else if (fillMode === 'plates') {
          color = plateColor(tectonics.plateIdByCell[cellId]);
        } else if (fillMode === 'elevation') {
          color = elevationColor(
            tectonics.elevation[cellId],
            tectonics.seaLevelElevation,
            elevationMin,
            elevationMax,
          );
        } else if (fillMode === 'temperature') {
          color = temperatureColor(ecology.temperature[cellId]);
        } else if (fillMode === 'moisture') {
          color = moistureColor(ecology.moisture[cellId]);
        } else if (fillMode === 'land') {
          color = tectonics.isLand[cellId] ? 'hsl(100, 40%, 38%)' : 'hsl(210, 60%, 22%)';
        } else {
          color = biomeColor(ecology.biome[cellId]);
        }
        rgb = hslToRgb(color);
      }
    }
    const offset = i * 4;
    rgba[offset] = rgb[0];
    rgba[offset + 1] = rgb[1];
    rgba[offset + 2] = rgb[2];
    rgba[offset + 3] = 255;
  }
  const texture = new DataTexture(rgba, bake.width, bake.height, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

@Component({
  selector: 'app-cell-planet-25d-map-page',
  imports: [FormsModule, EngineModule, RouterLink, RaycastOrbitControlsComponent, CellPlanetSelectionPanelComponent],
  template: `
    <scene [showFps]="true" [logarithmicDepthBuffer]="true">
      <orthographicCamera
        [position]="orthographicCameraPosition()"
        [lookAt]="[0, 0, 0]"
        [left]="-mapHalfWidthM()"
        [right]="mapHalfWidthM()"
        [top]="mapHalfHeightM()"
        [bottom]="-mapHalfHeightM()"
        [far]="cameraFarM()"
        [isActive]="!debugOrbitEnabled"
      />
      <!-- Temporary inspection camera. Keep this separate from the future
           Civ-style top-down camera so terrain work can be inspected from
           arbitrary angles without committing to the final map controls. -->
      <raycastOrbitControls
        [cameraPosition]="orbitCameraPosition()"
        [target]="orbitCameraTarget()"
        [near]="0.1"
        [far]="cameraFarM()"
        [isActive]="debugOrbitEnabled"
        [raycastFocusResolver]="terrainRaycastFocus"
        [leftMouseAction]="'rotate'"
      />
    </scene>
    <aside class="readout">
      <strong>Cell planet · 2.5D terrain</strong>
      <nav class="view-switch" aria-label="Map view">
        <a
          [routerLink]="['/cell-planet-map']"
          [queryParams]="comparisonQueryParams()"
        >2D map</a>
        <a
          [routerLink]="['/cell-planet-25d-map']"
          [queryParams]="comparisonQueryParams()"
          class="active"
          aria-current="page"
        >2.5D terrain</a>
        <a
          [routerLink]="['/cell-planet-globe']"
          [queryParams]="comparisonQueryParams()"
        >Globe</a>
        <a
          [routerLink]="['/cell-planet-morph-spike']"
          [queryParams]="comparisonQueryParams()"
        >Morph</a>
      </nav>
      <div class="u0-harness">
        <strong>U0 review fixture</strong>
        <span>{{ u0Fixture.id }} · v{{ u0Fixture.version }}</span>
        <small>Volcano, mesa, ridge, river and shore anchors use this fixture's generated world. Canyon is a U2 placeholder.</small>
        <button type="button" (click)="applyU0Baseline()">Apply U0 baseline</button>
        <label>
          <span>Review bookmark and select its cell</span>
          <select [value]="u0BookmarkId()" (change)="onU0BookmarkChange($event)">
            @for (bookmark of u0Bookmarks; track bookmark.id) {
              <option [value]="bookmark.id" [selected]="u0BookmarkId() === bookmark.id">{{ bookmark.label }} · cell {{ bookmark.cellId }}</option>
            }
          </select>
        </label>
      </div>
      <span>shared planet sampler → baked height source → clipmap</span>
      <label>
        <span>Cell count: {{ cellCount() }}</span>
        <input type="range" min="200" max="6000" step="100" [value]="cellCount()" (input)="onCellCountInput($event)" />
      </label>
      <label>
        <span>Seed: {{ seed() }}</span>
        <input type="number" min="0" max="999999" step="1" [value]="seed()" (input)="onSeedInput($event)" />
      </label>
      <label>
        <span>Relaxation: {{ relaxationIterations() }}</span>
        <input type="range" min="0" max="6" step="1" [value]="relaxationIterations()" (input)="onRelaxationInput($event)" />
      </label>
      <label>
        <span>World profile</span>
        <select [value]="worldProfileKind()" (change)="onWorldProfileChange($event)">
          @for (profile of worldProfileKinds; track profile) {
            <option [value]="profile" [selected]="worldProfileKind() === profile">{{ profile }}</option>
          }
        </select>
      </label>
      <label>
        <span>Planet size: {{ worldSizeTier() }} (radius {{ formatDistanceM(planetRadiusM()) }})</span>
        <select [ngModel]="worldSizeTier()" (ngModelChange)="onWorldSizeValueChange($event)">
          @for (size of worldSizeKinds; track size) {
            <option [value]="size" [selected]="worldSizeTier() === size">{{ size }}</option>
          }
        </select>
      </label>
      <label>
        <span>Display scale</span>
        <select [value]="displayScale()" (change)="onDisplayScaleChange($event)">
          <option value="planet" [selected]="displayScale() === 'planet'">Planet scale (real metres)</option>
          <option value="legacy" [selected]="displayScale() === 'legacy'">Legacy preview (old compact units)</option>
        </select>
      </label>
      @if (displayScale() === 'planet') {
        <span>Map footprint: {{ formatDistanceM(mapWidthM()) }} × {{ formatDistanceM(mapHeightM()) }}</span>
      } @else {
        <span>Legacy footprint: {{ mapWidthM() }} × {{ mapHeightM() }} display units</span>
      }
      <label>
        <span>Map projection</span>
        <select [value]="projectionType()" (change)="onProjectionTypeChange($event)">
          @for (kind of projectionKinds; track kind) {
            <option [value]="kind" [selected]="projectionType() === kind">{{ projectionLabels[kind] }}</option>
          }
        </select>
      </label>
      <label>
        <span>Data layer</span>
        <select [value]="fillMode()" (change)="onFillModeChange($event)">
          @for (mode of fillModes; track mode) {
            <option [value]="mode" [selected]="fillMode() === mode">{{ mode }}</option>
          }
        </select>
      </label>
      @if (fillMode() === 'material') {
        <label class="checkbox-row">
          <input type="checkbox" [checked]="macroVariationEnabled()" (change)="onMacroVariationChange($event)" />
          <span>Macro surface variation</span>
        </label>
        <label>
          <span>Macro strength: {{ macroVariationStrength().toFixed(2) }}</span>
          <input type="range" min="0" max="1" step="0.05" [value]="macroVariationStrength()" (input)="onMacroVariationStrengthInput($event)" />
        </label>
        <label>
          <span>Macro scale: {{ macroVariationScaleM().toFixed(0) }}m</span>
          <input type="range" min="8" max="128" step="4" [value]="macroVariationScaleM()" (input)="onMacroVariationScaleInput($event)" />
        </label>
      }
      <label>
        <span>Terrain quality</span>
        <select [ngModel]="terrainQuality()" (ngModelChange)="onTerrainQualityValueChange($event)">
          @for (quality of terrainQualityKinds; track quality) {
            <option [value]="quality" [selected]="terrainQuality() === quality">{{ terrainQualityPresets[quality].label }}</option>
          }
        </select>
      </label>
      <label>
        <span>Water level: {{ waterLevel() > 0 ? 'Rising +' : waterLevel() < 0 ? 'Falling ' : 'Baseline ' }}{{ waterLevel().toFixed(2) }}</span>
        <input type="range" min="-1" max="1" step="0.05" [value]="waterLevel()" (input)="onWaterLevelInput($event)" />
      </label>
      <label class="checkbox-row">
        <input type="checkbox" [checked]="showOcean()" (change)="onOceanChange($event)" />
        <span>Ocean surface at sea level</span>
      </label>
      <label>
        <span>Terrain relief: {{ terrainHeightScale().toFixed(1) }}
          ({{ displayScale() === 'planet' ? 'proportional to planet size' : 'legacy direct scale' }})</span>
        <input type="range" min="0" max="14" step="0.5" [value]="terrainHeightScale()" (input)="onTerrainHeightScaleInput($event)" />
      </label>
      <label>
        <span>Runtime simplification: {{ (runtimeSimplificationRatio() * 100).toFixed(0) }}%</span>
        <input type="range" min="0" max="0.95" step="0.05" [value]="runtimeSimplificationRatio()" (change)="onRuntimeSimplificationInput($event)" />
      </label>
        <span>Experimental preview: above 0% swaps the clipmap for a simplified baked surface.</span>
      <button type="button" (click)="randomizeSeed()">Randomize seed</button>
      <button type="button" (click)="exportTerrainForBlender()" [disabled]="isRebuilding() || !hasTerrain()">
        Export OBJ for Blender
      </button>
      <span>OBJ export includes an MTL colour file; keep both downloads together.</span>
      @if (isRebuilding()) {
        <span>Rebuilding world…</span>
      }
      <span>draw calls: {{ drawCalls() }} · triangles: {{ triangles().toLocaleString() }}</span>
      <span>LOD instances: {{ instances() }}</span>
      <span>Raycast orbit view · drag to rotate · wheel zooms toward the surface</span>
      <app-cell-planet-selection-panel
        [selection]="selection()"
        (clearSelection)="clearSelection()"
      />
    </aside>
  `,
  styleUrl: './cell-planet-25d-map-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CellPlanet25dMapPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private terrain!: IClipmapTerrainSceneHandle;

  readonly drawCalls = signal(0);
  readonly triangles = signal(0);
  readonly instances = signal('');
  readonly cellCount = signal<number>(CELL_PLANET_GENERATION_DEFAULTS.cellCount);
  readonly seed = signal<number>(CELL_PLANET_GENERATION_DEFAULTS.seed);
  readonly relaxationIterations = signal<number>(CELL_PLANET_GENERATION_DEFAULTS.relaxationIterations);
  readonly worldProfileKind = signal<WorldProfileKind>('terran');
  readonly worldProfileKinds: WorldProfileKind[] = ['terran', 'moon', 'volcanic', 'protoplanet'];
  readonly u0Fixture = CELL_PLANET_U0_FIXTURE;
  readonly u0Bookmarks = CELL_PLANET_U0_FIXTURE.bookmarks;
  readonly u0BookmarkIds = CELL_PLANET_U0_BOOKMARK_IDS;
  readonly u0BookmarkId = signal<CellPlanetU0BookmarkId>('overview');
  readonly u0Bookmark = computed(() => getCellPlanetU0Bookmark(this.u0BookmarkId()));
  /** Shared display-space body size. Worldgen remains direction/elevation based and dimensionless. */
  readonly worldSizeTier = signal<WorldSizeTier>('medium');
  readonly worldSizeKinds: WorldSizeTier[] = ['mini', 'small', 'medium', 'large', 'extra-large'];
  readonly planetRadiusM = computed(() => WORLD_SIZE_TIER_RADIUS_M[this.worldSizeTier()]);
  /** Selectable only for comparing the current physical view with the pre-real-scale POC. */
  readonly displayScale = signal<TerrainDisplayScale>('planet');
  readonly displayScaleKinds: TerrainDisplayScale[] = ['planet', 'legacy'];
  readonly terrainMapBounds = computed(() =>
    this.displayScale() === 'legacy' ? LEGACY_TERRAIN_MAP_BOUNDS : makeTerrainMapBounds(this.planetRadiusM()),
  );
  readonly mapHalfWidthM = computed(() => (this.terrainMapBounds().maxX - this.terrainMapBounds().minX) * 0.5);
  readonly mapHalfHeightM = computed(() => (this.terrainMapBounds().maxZ - this.terrainMapBounds().minZ) * 0.5);
  readonly mapWidthM = computed(() => this.mapHalfWidthM() * 2);
  readonly mapHeightM = computed(() => this.mapHalfHeightM() * 2);
  readonly orbitCameraPosition = computed(() => {
    if (this.displayScale() === 'legacy') return [150, 130, 150] as [number, number, number];
    const bookmark = this.u0Bookmark();
    if (bookmark.id !== 'overview') {
      const target = this.orbitCameraTarget();
      const distance = this.planetRadiusM() * bookmark.cameraRadiusFactor;
      return [
        target[0] + distance * 0.75,
        target[1] + distance,
        target[2] + distance * 0.75,
      ] as [number, number, number];
    }
    const radius = this.planetRadiusM();
    return [radius * 4.8, radius * 4.2, radius * 4.8] as [number, number, number];
  });
  readonly orbitCameraTarget = computed(() => {
    const bookmark = this.u0Bookmark();
    if (bookmark.id === 'overview') return [0, 0, 0] as [number, number, number];
    const bounds = this.terrainMapBounds();
    const selected = this.selection();
    // Use exactly the same projected XYZ as the visible selection marker.
    // River/shore bookmarks can be on an edge rather than at their cell centre.
    if (selected?.cellId === bookmark.cellId) return [...selected.surfacePosition] as [number, number, number];
    return [
      bookmark.mapPosition[0] * (bounds.maxX - bounds.minX) * 0.5,
      0,
      bookmark.mapPosition[1] * (bounds.maxZ - bounds.minZ) * 0.5,
    ] as [number, number, number];
  });
  readonly orthographicCameraPosition = computed(() => {
    if (this.displayScale() === 'legacy') return [0, 110, 110] as [number, number, number];
    const radius = this.planetRadiusM();
    return [0, radius * 4, radius * 4] as [number, number, number];
  });
  readonly cameraFarM = computed(() => this.displayScale() === 'legacy' ? 2_000 : Math.max(2_000, this.planetRadiusM() * 64));
  readonly terrainHeightScaleM = computed(() =>
    this.displayScale() === 'legacy'
      ? this.terrainHeightScale()
      : getTerrainHeightScaleM(this.planetRadiusM(), this.terrainHeightScale()),
  );
  readonly formatDistanceM = formatDistanceM;
  readonly projectionType = signal<MapProjectionKind>('equirectangular');
  readonly projectionKinds = MAP_PROJECTION_KINDS;
  readonly projectionLabels = MAP_PROJECTION_LABELS;
  readonly fillMode = signal<CellPlanet25dFillMode>('biome');
  readonly fillModes: CellPlanet25dFillMode[] = ['biome', 'elevation', 'plates', 'temperature', 'moisture', 'land', 'material'];
  readonly macroVariationEnabled = signal(true);
  readonly macroVariationStrength = signal(0.35);
  readonly macroVariationScaleM = signal(48);
  readonly terrainQuality = signal<TerrainQuality>('standard');
  readonly terrainQualityKinds = TERRAIN_QUALITY_KINDS;
  readonly terrainQualityPresets = TERRAIN_QUALITY_PRESETS;
  readonly waterLevel = signal(0);
  readonly showOcean = signal(true);
  /** Display-only relief scale. Canonical planet elevations remain unchanged. */
  readonly terrainHeightScale = signal(4);
  /** Experimental runtime-only triangle reduction ratio; canonical terrain is unchanged. */
  readonly runtimeSimplificationRatio = signal(0);
  readonly isRebuilding = signal(false);
  private readonly preservedQueryParams = signal<CellPlanetQuery>({});
  readonly comparisonQueryParams = signal<Record<string, string | number | boolean>>({});

  /** Currently selected canonical world cell, preserved across views via the route query. */
  readonly selection = signal<ICellPlanetSelection | null>(null);
  private selectionController: ICellPlanetSelectionController | undefined;
  private pendingSelectedCellId: number | null = null;
  private hasPendingSelection = false;

  /**
   * Temporary terrain-inspection camera. The orthographic camera remains in
   * the template as the future Civ-style map camera and can be reactivated
   * when the production pan/zoom controls are implemented.
   */
  readonly debugOrbitEnabled = true;
  readonly hasTerrain = signal(false);
  private terrainReady = false;
  private activeHeightField: IPlanarHeightField | undefined;

  private activeTextures: { height: DataTexture; color: DataTexture } | undefined;
  private oceanMesh: Mesh<PlaneGeometry, MeshStandardMaterial> | undefined;
  private simplifiedTerrainMesh: Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
  private simplificationRevision = 0;
  private colorContext:
    | {
        bake: IPlanetSurfaceBake;
        graph: IPlanetGraphCore;
        tectonics: IPlanetTectonics;
        ecology: IPlanetEcology;
        oceanSubstance: 'water' | 'lava';
        elevationMin: number;
        elevationMax: number;
      }
    | undefined;

  /**
   * Raycast target used by the debug camera. The clipmap's height displacement happens in the
   * vertex shader, so its Three.js mesh intersection is only the undisplaced lattice. Prefer
   * the same CPU-baked height field used by cell picking, while retaining a scene-mesh fallback
   * for the short period before the first bake is ready.
   */
  readonly terrainRaycastFocus = (context: RaycastFocusContext): Vector3 | null => {
    const field = this.activeHeightField;
    if (field) {
      const hit = intersectPlanarHeightField(field, {
        origin: context.raycaster.ray.origin,
        direction: context.raycaster.ray.direction,
      });
      const oceanHit = this.showOcean() && this.oceanMesh?.visible
        ? context.raycaster.intersectObject(this.oceanMesh, false)[0]
        : undefined;
      if (hit && (!oceanHit || hit.distance <= oceanHit.distance)) {
        return new Vector3(hit.x, hit.y, hit.z);
      }
      if (oceanHit) return oceanHit.point;
    }

    const hits = context.raycaster.intersectObjects(
      context.sceneChildren as unknown as import('three').Object3D[],
      true,
    );
    return hits[0]?.point ?? null;
  };

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const query = readCellPlanetQuery(params);
      this.preservedQueryParams.set(query);
      const previousQuality = this.terrainQuality();
      const previousWorldSize = this.worldSizeTier();
      const previousDisplayScale = this.displayScale();
      this.restoreQuery(query);
      this.updateComparisonQueryParams();
      if (this.terrainReady) {
        if (previousQuality !== this.terrainQuality() ||
            previousWorldSize !== this.worldSizeTier() ||
            previousDisplayScale !== this.displayScale()) {
          const previousTerrain = this.terrain;
          this.terrain = this.createTerrainScene();
          previousTerrain.dispose();
        }
        this.rebuildWorld();
      }
    });
    this.terrain = this.createTerrainScene();
    this.selectionController = createCellPlanetSelection(this.engine, {
      onChange: (selection) => {
        this.selection.set(selection);
        this.updateComparisonQueryParams();
      },
    });
    this.terrainReady = true;
    this.rebuildWorld();

    this.destroyRef.onDestroy(() => {
      this.selectionController?.dispose();
      this.terrain.dispose();
      this.simplificationRevision++;
      this.disposeSimplifiedTerrain();
      this.disposeOceanMesh();
      this.activeTextures?.height.dispose();
      this.activeTextures?.color.dispose();
    });
  }

  clearSelection(): void {
    this.selectionController?.clearSelection();
  }

  onCellCountInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.cellCount()) {
      this.cellCount.set(Math.round(value));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onSeedInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.seed()) {
      this.seed.set(Math.max(0, Math.min(999999, Math.round(value))));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onRelaxationInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.relaxationIterations()) {
      this.relaxationIterations.set(Math.round(value));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onWorldProfileChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as WorldProfileKind;
    if (this.worldProfileKinds.includes(value) && value !== this.worldProfileKind()) {
      this.worldProfileKind.set(value);
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onWorldSizeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as WorldSizeTier;
    if (this.worldSizeKinds.includes(value) && value !== this.worldSizeTier()) {
      this.worldSizeTier.set(value);
      this.updateComparisonQueryParams();
      // The clipmap's level topology depends on the physical footprint, so recreate it along
      // with the baked source when the body size changes. Existing scene input bindings update
      // the camera's numeric framing and logarithmic-depth far range automatically.
      const previousTerrain = this.terrain;
      this.terrain = this.createTerrainScene();
      previousTerrain.dispose();
      this.rebuildWorld();
    }
  }

  onWorldSizeValueChange(value: string): void {
    if (!this.worldSizeKinds.includes(value as WorldSizeTier) || value === this.worldSizeTier()) return;
    this.worldSizeTier.set(value as WorldSizeTier);
    this.updateComparisonQueryParams();
    const previousTerrain = this.terrain;
    this.terrain = this.createTerrainScene();
    previousTerrain.dispose();
    this.rebuildWorld();
  }

  onDisplayScaleChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as TerrainDisplayScale;
    if (this.displayScaleKinds.includes(value) && value !== this.displayScale()) {
      this.displayScale.set(value);
      this.updateComparisonQueryParams();
      // Bounds, camera framing, relief units and clipmap ring topology all change with the
      // display mode. The canonical generated world remains exactly the same.
      const previousTerrain = this.terrain;
      this.terrain = this.createTerrainScene();
      previousTerrain.dispose();
      this.rebuildWorld();
    }
  }

  onProjectionTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as MapProjectionKind;
    if (this.projectionKinds.includes(value) && value !== this.projectionType()) {
      this.projectionType.set(value);
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onFillModeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as CellPlanet25dFillMode;
    if (this.fillModes.includes(value) && value !== this.fillMode()) {
      this.fillMode.set(value);
      this.updateComparisonQueryParams();
      this.rebuildColorTexture();
      this.updateMacroVariation();
    }
  }

  onMacroVariationChange(event: Event): void {
    this.macroVariationEnabled.set((event.target as HTMLInputElement).checked);
    this.updateMacroVariation();
    this.updateComparisonQueryParams();
  }

  onMacroVariationStrengthInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value)) {
      this.macroVariationStrength.set(Math.max(0, Math.min(1, value)));
      this.updateMacroVariation();
      this.updateComparisonQueryParams();
    }
  }

  onMacroVariationScaleInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value)) {
      this.macroVariationScaleM.set(Math.max(8, Math.min(128, value)));
      this.updateMacroVariation();
      this.updateComparisonQueryParams();
    }
  }

  onTerrainQualityChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as TerrainQuality;
    if (this.terrainQualityKinds.includes(value) && value !== this.terrainQuality()) {
      this.terrainQuality.set(value);
      this.updateComparisonQueryParams();
      const previousTerrain = this.terrain;
      this.terrain = this.createTerrainScene();
      previousTerrain.dispose();
      this.rebuildWorld();
    }
  }

  onTerrainQualityValueChange(value: string): void {
    if (!this.terrainQualityKinds.includes(value as TerrainQuality) || value === this.terrainQuality()) return;
    this.terrainQuality.set(value as TerrainQuality);
    this.updateComparisonQueryParams();
    const previousTerrain = this.terrain;
    this.terrain = this.createTerrainScene();
    previousTerrain.dispose();
    this.rebuildWorld();
  }

  onWaterLevelInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.waterLevel()) {
      this.waterLevel.set(Math.max(-1, Math.min(1, value)));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onOceanChange(event: Event): void {
    this.showOcean.set((event.target as HTMLInputElement).checked);
    this.updateOceanSurfaceVisibility();
    this.updateComparisonQueryParams();
  }

  onTerrainHeightScaleInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.terrainHeightScale()) {
      this.terrainHeightScale.set(Math.max(0, Math.min(14, value)));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onRuntimeSimplificationInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.runtimeSimplificationRatio()) {
      this.runtimeSimplificationRatio.set(Math.max(0, Math.min(0.95, value)));
      this.updateComparisonQueryParams();
      void this.rebuildSimplifiedTerrain();
    }
  }

  randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
    this.updateComparisonQueryParams();
    this.rebuildWorld();
  }

  applyU0Baseline(): void {
    this.cellCount.set(this.u0Fixture.cellCount);
    this.seed.set(this.u0Fixture.seed);
    this.relaxationIterations.set(this.u0Fixture.relaxationIterations);
    this.worldProfileKind.set(this.u0Fixture.worldProfile);
    this.worldSizeTier.set(this.u0Fixture.worldSize);
    this.displayScale.set(this.u0Fixture.displayScale);
    this.projectionType.set(this.u0Fixture.projection);
    this.terrainQuality.set(this.u0Fixture.terrainQuality);
    this.terrainHeightScale.set(this.u0Fixture.terrainHeightScale);
    this.waterLevel.set(this.u0Fixture.waterLevel);
    this.showOcean.set(this.u0Fixture.showOcean);
    this.u0BookmarkId.set('overview');
    this.selectionController?.clearSelection();
    this.updateComparisonQueryParams();
    const previousTerrain = this.terrain;
    this.terrain = this.createTerrainScene();
    previousTerrain.dispose();
    this.rebuildWorld();
  }

  onU0BookmarkChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as CellPlanetU0BookmarkId;
    if (!this.u0BookmarkIds.includes(value)) return;
    if (
      this.cellCount() !== this.u0Fixture.cellCount ||
      this.seed() !== this.u0Fixture.seed ||
      this.relaxationIterations() !== this.u0Fixture.relaxationIterations ||
      this.worldProfileKind() !== this.u0Fixture.worldProfile ||
      this.worldSizeTier() !== this.u0Fixture.worldSize ||
      this.displayScale() !== this.u0Fixture.displayScale ||
      this.projectionType() !== this.u0Fixture.projection ||
      this.terrainQuality() !== this.u0Fixture.terrainQuality ||
      this.terrainHeightScale() !== this.u0Fixture.terrainHeightScale ||
      this.waterLevel() !== this.u0Fixture.waterLevel ||
      this.showOcean() !== this.u0Fixture.showOcean
    ) {
      this.applyU0Baseline();
    }
    this.u0BookmarkId.set(value);
    this.selectionController?.selectCell(getCellPlanetU0Bookmark(value).cellId);
    this.updateComparisonQueryParams();
  }

  exportTerrainForBlender(): void {
    const context = this.colorContext;
    const active = this.activeTextures;
    if (!context || !active) return;
    const baseName = `cell-planet-${this.seed()}-${this.terrainQuality()}`;
    const materialFileName = `${baseName}.mtl`;
    const exported = makeObjTerrainExport(context.bake, active.color, {
      ...this.terrainMapBounds(),
    }, materialFileName);
    this.downloadTextFile(`${baseName}.obj`, exported.obj, 'text/plain;charset=utf-8');
    this.downloadTextFile(materialFileName, exported.mtl, 'text/plain;charset=utf-8');
  }

  private rebuildWorld(): void {
    this.isRebuilding.set(true);
    const seed = this.seed();
    const profile = WORLD_PROFILES[this.worldProfileKind()];
    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed,
      relaxationIterations: this.relaxationIterations(),
      jitter: CELL_PLANET_GENERATION_DEFAULTS.jitter,
    });
    const tectonics = buildPlanetTectonics(graph, {
      plateCount: CELL_PLANET_GENERATION_DEFAULTS.plateCount,
      seed,
      ...profile.tectonics,
    });
    const seaLevelElevation = tectonics.seaLevelElevation + this.waterLevel() * 0.3;
    tectonics.seaLevelElevation = seaLevelElevation;
    tectonics.isLand = deriveIsLand(
      graph,
      tectonics.elevation,
      seaLevelElevation,
      profile.tectonics?.minRegionCellFraction,
    );
    const ecology = buildPlanetEcology(graph, tectonics, {
      climate: profile.climate,
      biomes: profile.biomes,
    });
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology);
    const projection = MAP_PROJECTIONS[this.projectionType()];
    const quality = this.terrainQualityPresets[this.terrainQuality()];
    const bake = buildPlanetSurfaceBake(graph, sampler, {
      width: quality.bakeWidth,
      height: quality.bakeHeight,
      heightScale: this.terrainHeightScaleM(),
      projection: {
        directionAt: (x, y, width, height) => {
          const lonLat = projection.unproject(x, y, width, height);
          if (!lonLat) return null;
          const cosLatitude = Math.cos(lonLat.lat);
          return {
            x: cosLatitude * Math.cos(lonLat.lon),
            y: Math.sin(lonLat.lat),
            z: cosLatitude * Math.sin(lonLat.lon),
          };
        },
      },
    });
    const elevationRange = getElevationRange(bake.elevations);
    const minHeightM = elevationRange.min;
    const maxHeightM = elevationRange.max;
    const heightTexture = makeHeightTexture(bake.elevations, minHeightM, maxHeightM, bake.width, bake.height);
    let elevationMin = Infinity;
    let elevationMax = -Infinity;
    for (const elevation of tectonics.elevation) {
      elevationMin = Math.min(elevationMin, elevation);
      elevationMax = Math.max(elevationMax, elevation);
    }
    this.colorContext = {
      bake,
      graph,
      tectonics,
      ecology,
      oceanSubstance: profile.oceanSubstance,
      elevationMin,
      elevationMax,
    };
    this.activeHeightField = {
      width: bake.width,
      height: bake.height,
      elevations: bake.elevations,
      bounds: this.terrainMapBounds(),
      minY: minHeightM,
      maxY: maxHeightM,
    };
    this.updateOceanSurface(bake, seaLevelElevation, profile.oceanSubstance);
    const colorTexture = makeColorTexture(
      bake,
      graph,
      tectonics,
      ecology,
      this.fillMode(),
      profile.oceanSubstance,
      elevationMin,
      elevationMax,
    );
    const source: IClipmapTerrainHeightSource = {
      texture: heightTexture,
      colorTexture,
      minHeightM,
      maxHeightM,
      bounds: this.terrainMapBounds(),
    };
    const previousTextures = this.activeTextures;
    this.activeTextures = { height: heightTexture, color: colorTexture };
    this.terrain.setHeightSource(source);
    void this.rebuildSimplifiedTerrain();
    previousTextures?.height.dispose();
    previousTextures?.color.dispose();

    const generationKey = [
      this.cellCount(),
      this.seed(),
      this.relaxationIterations(),
      this.worldProfileKind(),
    ].join(':');
    this.selectionController?.setContext({
      graph,
      tectonics,
      ecology,
      bake,
      projection,
      bounds: this.terrainMapBounds(),
      minHeightM,
      maxHeightM,
      generationKey,
    });
    if (this.hasPendingSelection) {
      this.hasPendingSelection = false;
      const pendingCellId = this.pendingSelectedCellId;
      this.pendingSelectedCellId = null;
      if (pendingCellId === null) this.selectionController?.clearSelection();
      else this.selectionController?.selectCell(pendingCellId);
    }

    this.hasTerrain.set(true);
    this.isRebuilding.set(false);
  }

  private rebuildColorTexture(): void {
    const context = this.colorContext;
    const active = this.activeTextures;
    if (!context || !active) return;
    const colorTexture = makeColorTexture(
      context.bake,
      context.graph,
      context.tectonics,
      context.ecology,
      this.fillMode(),
      context.oceanSubstance,
      context.elevationMin,
      context.elevationMax,
    );
    const bakeRange = getElevationRange(context.bake.elevations);
    this.activeTextures = { height: active.height, color: colorTexture };
    this.terrain.setHeightSource({
      texture: active.height,
      colorTexture,
      minHeightM: bakeRange.min,
      maxHeightM: bakeRange.max,
      bounds: this.terrainMapBounds(),
    });
    active.color.dispose();
    void this.rebuildSimplifiedTerrain();
  }

  private async rebuildSimplifiedTerrain(): Promise<void> {
    const revision = ++this.simplificationRevision;
    this.disposeSimplifiedTerrain();
    const ratio = this.runtimeSimplificationRatio();
    const context = this.colorContext;
    const active = this.activeTextures;
    if (ratio <= 0 || !context || !active) {
      this.terrain.setVisible(true);
      return;
    }

    // Simplifying the clipmap's regular tile geometry would break its border
    // morphing and crack-free LOD assumptions. This alternate mesh is therefore
    // intentionally a standalone runtime inspection mode.
    this.terrain.setVisible(false);
    const sourceGeometry = makeBakedTerrainGeometry(context.bake, this.terrainMapBounds(), active.color);
    try {
      const result = await simplifyIndexedGeometry(sourceGeometry, {
        ratio,
        targetError: 1,
        flags: ['LockBorder'],
      });
      sourceGeometry.dispose();
      if (revision !== this.simplificationRevision || this.runtimeSimplificationRatio() !== ratio ||
          this.colorContext !== context || this.activeTextures !== active) {
        result.geometry.dispose();
        return;
      }
      result.geometry.computeVertexNormals();
      const material = new MeshStandardMaterial({
        vertexColors: true,
        color: '#ffffff',
        roughness: 1,
        metalness: 0,
        flatShading: false,
        transparent: false,
        opacity: 1,
        depthWrite: true,
      });
      const mesh = new Mesh(result.geometry, material);
      mesh.name = 'cell-planet-runtime-simplified-terrain';
      this.engine.scene.add(mesh);
      this.simplifiedTerrainMesh = mesh;
    } catch (error) {
      sourceGeometry.dispose();
      if (revision === this.simplificationRevision) this.terrain.setVisible(true);
      console.error('Runtime terrain simplification failed; restored clipmap.', error);
    }
  }

  private disposeSimplifiedTerrain(): void {
    if (!this.simplifiedTerrainMesh) return;
    this.engine.scene.remove(this.simplifiedTerrainMesh);
    this.simplifiedTerrainMesh.geometry.dispose();
    this.simplifiedTerrainMesh.material.dispose();
    this.simplifiedTerrainMesh = undefined;
  }

  private updateOceanSurface(
    bake: IPlanetSurfaceBake,
    seaLevelElevation: number,
    oceanSubstance: 'water' | 'lava',
  ): void {
    const maskTexture = makeOceanMaskTexture(bake, oceanSubstance);
    if (!this.oceanMesh) {
      const material = new MeshStandardMaterial({
        color: '#ffffff',
        map: maskTexture,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        roughness: 0.2,
        metalness: 0.05,
      });
      const bounds = this.terrainMapBounds();
      const width = bounds.maxX - bounds.minX;
      const depth = bounds.maxZ - bounds.minZ;
      const geometry = new PlaneGeometry(width, depth);
      const uv = geometry.getAttribute('uv');
      // PlaneGeometry's rotated local +Y points toward world -Z, so its default
      // V axis is opposite to the bake/clipmap world-Z convention.
      for (let index = 0; index < uv.count; index++) uv.setY(index, 1 - uv.getY(index));
      uv.needsUpdate = true;
      this.oceanMesh = new Mesh(geometry, material);
      this.oceanMesh.name = 'cell-planet-25d-ocean';
      this.oceanMesh.rotation.x = -Math.PI / 2;
      this.engine.scene.add(this.oceanMesh);
    } else {
      // The existing water plane must follow changes to the selected planet size.
      const bounds = this.terrainMapBounds();
      const originalWidth = this.oceanMesh.geometry.parameters.width;
      const originalDepth = this.oceanMesh.geometry.parameters.height;
      this.oceanMesh.scale.set(
        (bounds.maxX - bounds.minX) / originalWidth,
        (bounds.maxZ - bounds.minZ) / originalDepth,
        1,
      );
      const material = this.oceanMesh.material;
      const previousMap = material.map;
      material.map = maskTexture;
      material.needsUpdate = true;
      previousMap?.dispose();
    }
    this.oceanMesh.position.set(
      (this.terrainMapBounds().minX + this.terrainMapBounds().maxX) * 0.5,
      seaLevelElevation * bake.heightScale,
      (this.terrainMapBounds().minZ + this.terrainMapBounds().maxZ) * 0.5,
    );
    this.oceanMesh.visible = this.showOcean();
  }

  private updateOceanSurfaceVisibility(): void {
    if (this.oceanMesh) this.oceanMesh.visible = this.showOcean();
  }

  private disposeOceanMesh(): void {
    if (!this.oceanMesh) return;
    this.engine.scene.remove(this.oceanMesh);
    this.oceanMesh.geometry.dispose();
    this.oceanMesh.material.map?.dispose();
    this.oceanMesh.material.dispose();
    this.oceanMesh = undefined;
  }

  private inputNumber(event: Event): number {
    return (event.target as HTMLInputElement).valueAsNumber;
  }

  private createTerrainScene(): IClipmapTerrainSceneHandle {
    const quality = this.terrainQualityPresets[this.terrainQuality()];
    const baseTileSizeM = getTerrainBaseTileSizeM(this.mapWidthM());
    const terrain = createClipmapTerrainScene(this.engine, (diagnostics) => {
      this.drawCalls.set(diagnostics.drawCalls);
      this.triangles.set(diagnostics.triangles);
      this.instances.set(diagnostics.instanceCountsByLevel.join(' · '));
    }, {
      levelCount: this.displayScale() === 'legacy'
        ? quality.levelCount
        : getClipmapLevelCount(this.planetRadiusM(), quality.levelCount),
      baseTileSizeM,
      blockRadiusTiles: 4,
      gridResolution: quality.gridResolution,
      finestSwitchDistanceM: baseTileSizeM * 4,
      heightScaleM: 1,
      lodFocus: { x: 0, z: 0 },
    });
    terrain.setShowLevelTint(false);
    terrain.setMacroVariation(
      this.fillMode() === 'material' && this.macroVariationEnabled(),
      this.macroVariationStrength(),
      this.macroVariationScaleM(),
    );
    return terrain;
  }

  private downloadTextFile(fileName: string, content: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private restoreQuery(query: CellPlanetQuery): void {
    const cellCount = this.numberQuery(query.cellCount);
    if (cellCount !== null) this.cellCount.set(Math.max(200, Math.min(6000, Math.round(cellCount))));
    const seed = this.numberQuery(query.seed);
    if (seed !== null) this.seed.set(Math.max(0, Math.min(999999, Math.round(seed))));
    const relaxation = this.numberQuery(query.relaxation);
    if (relaxation !== null) this.relaxationIterations.set(Math.max(0, Math.min(6, Math.round(relaxation))));
    if (query.worldProfile && this.worldProfileKinds.includes(query.worldProfile as WorldProfileKind)) {
      this.worldProfileKind.set(query.worldProfile as WorldProfileKind);
    }
    if (query.worldSize && this.worldSizeKinds.includes(query.worldSize as WorldSizeTier)) {
      this.worldSizeTier.set(query.worldSize as WorldSizeTier);
    }
    if (query.displayScale && this.displayScaleKinds.includes(query.displayScale as TerrainDisplayScale)) {
      this.displayScale.set(query.displayScale as TerrainDisplayScale);
    }
    if (query.projection && this.projectionKinds.includes(query.projection as MapProjectionKind)) {
      this.projectionType.set(query.projection as MapProjectionKind);
    }
    if (query.terrainQuality && this.terrainQualityKinds.includes(query.terrainQuality as TerrainQuality)) {
      this.terrainQuality.set(query.terrainQuality as TerrainQuality);
    }
    if (query.fillMode && this.fillModes.includes(query.fillMode as CellPlanet25dFillMode)) {
      this.fillMode.set(query.fillMode as CellPlanet25dFillMode);
    }
    const waterLevel = this.numberQuery(query.waterLevel);
    if (waterLevel !== null) this.waterLevel.set(Math.max(-1, Math.min(1, waterLevel)));
    const terrainHeightScale = this.numberQuery(query.terrainHeightScale);
    if (terrainHeightScale !== null) this.terrainHeightScale.set(Math.max(0, Math.min(14, terrainHeightScale)));
    const runtimeSimplificationRatio = this.numberQuery(query.runtimeSimplificationRatio);
    if (runtimeSimplificationRatio !== null) this.runtimeSimplificationRatio.set(Math.max(0, Math.min(0.95, runtimeSimplificationRatio)));
    if (query.macroVariation === 'false' || query.macroVariation === '0') this.macroVariationEnabled.set(false);
    if (query.macroVariation === 'true' || query.macroVariation === '1') this.macroVariationEnabled.set(true);
    const macroVariationStrength = this.numberQuery(query.macroVariationStrength);
    if (macroVariationStrength !== null) this.macroVariationStrength.set(Math.max(0, Math.min(1, macroVariationStrength)));
    const macroVariationScaleM = this.numberQuery(query.macroVariationScaleM);
    if (macroVariationScaleM !== null) this.macroVariationScaleM.set(Math.max(8, Math.min(128, macroVariationScaleM)));
    if (query.showOcean === 'false' || query.showOcean === '0') this.showOcean.set(false);
    if (query.showOcean === 'true' || query.showOcean === '1') this.showOcean.set(true);
    const selectedCell = this.numberQuery(query.selectedCell);
    this.pendingSelectedCellId =
      selectedCell !== null && Number.isInteger(selectedCell) && selectedCell >= 0 ? selectedCell : null;
    this.hasPendingSelection = true;
    if (query.u0Bookmark && this.u0BookmarkIds.includes(query.u0Bookmark as CellPlanetU0BookmarkId)) {
      this.u0BookmarkId.set(query.u0Bookmark as CellPlanetU0BookmarkId);
      if (this.pendingSelectedCellId === null) {
        this.pendingSelectedCellId = getCellPlanetU0Bookmark(query.u0Bookmark as CellPlanetU0BookmarkId).cellId;
      }
    }
  }

  private updateComparisonQueryParams(): void {
    this.comparisonQueryParams.set({
      ...this.preservedQueryParams(),
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxation: this.relaxationIterations(),
      worldProfile: this.worldProfileKind(),
      worldSize: this.worldSizeTier(),
      displayScale: this.displayScale(),
      projection: this.projectionType(),
      terrainQuality: this.terrainQuality(),
      fillMode: this.fillMode(),
      waterLevel: this.waterLevel(),
      terrainHeightScale: this.terrainHeightScale(),
      runtimeSimplificationRatio: this.runtimeSimplificationRatio(),
      macroVariation: this.macroVariationEnabled(),
      macroVariationStrength: this.macroVariationStrength(),
      macroVariationScaleM: this.macroVariationScaleM(),
      showOcean: this.showOcean(),
      selectedCell: this.selection()?.cellId ?? '',
      u0Bookmark: this.u0BookmarkId(),
    });
  }

  private numberQuery(value: string | undefined): number | null {
    if (value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private updateMacroVariation(): void {
    if (!this.terrain) return;
    this.terrain.setMacroVariation(
      this.fillMode() === 'material' && this.macroVariationEnabled(),
      this.macroVariationStrength(),
      this.macroVariationScaleM(),
    );
  }
}
