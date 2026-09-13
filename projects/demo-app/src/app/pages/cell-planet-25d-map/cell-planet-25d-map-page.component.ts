import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BufferGeometry, ClampToEdgeWrapping, DataTexture, Float32BufferAttribute, FloatType, LinearFilter, Mesh, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  WORLD_PROFILES,
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
} from 'triangular-engine/worldgen/render';
import {
  createClipmapTerrainScene,
  IClipmapTerrainHeightSource,
  IClipmapTerrainSceneHandle,
} from 'triangular-engine/terrain';
import { CellPlanetQuery, readCellPlanetQuery } from '../cell-planet-view-query';
import { CELL_PLANET_GENERATION_DEFAULTS } from '../cell-planet-generation-config';

type TerrainQuality = 'preview' | 'standard' | 'high' | 'ultra';

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

interface IObjTerrainExport {
  readonly obj: string;
  readonly mtl: string;
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
        colors[colorOffset] = (colorData[pixelOffset] ?? 0) / 255;
        colors[colorOffset + 1] = (colorData[pixelOffset + 1] ?? 0) / 255;
        colors[colorOffset + 2] = (colorData[pixelOffset + 2] ?? 0) / 255;
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
  tectonics: IPlanetTectonics,
  ecology: IPlanetEcology,
  fillMode: CellPlanetMapFillMode,
  oceanSubstance: 'water' | 'lava',
  elevationMin: number,
  elevationMax: number,
): DataTexture {
  const rgba = new Uint8Array(bake.cellIds.length * 4);
  const waterRgb = hslToRgb(oceanSubstance === 'lava' ? lavaOceanColor() : 'hsl(210, 55%, 22%)');
  for (let i = 0; i < bake.cellIds.length; i++) {
    const cellId = bake.cellIds[i];
    let rgb = waterRgb;
    if (cellId >= 0 && cellId < tectonics.elevation.length) {
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
  imports: [EngineModule, RouterLink],
  template: `
    <scene [showFps]="true">
      <orthographicCamera
        [position]="[0, 110, 110]"
        [lookAt]="[0, 0, 0]"
        [left]="-160"
        [right]="160"
        [top]="100"
        [bottom]="-100"
        [far]="1000"
        [isActive]="!debugOrbitEnabled"
      />
      <!-- Temporary inspection camera. Keep this separate from the future
           Civ-style top-down camera so terrain work can be inspected from
           arbitrary angles without committing to the final map controls. -->
      <orbitControls
        [cameraPosition]="[150, 130, 150]"
        [target]="[0, 0, 0]"
        [near]="0.1"
        [far]="2000"
        [isActive]="debugOrbitEnabled"
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
      </nav>
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
            <option [value]="profile">{{ profile }}</option>
          }
        </select>
      </label>
      <label>
        <span>Map projection</span>
        <select [value]="projectionType()" (change)="onProjectionTypeChange($event)">
          @for (kind of projectionKinds; track kind) {
            <option [value]="kind">{{ projectionLabels[kind] }}</option>
          }
        </select>
      </label>
      <label>
        <span>Data layer</span>
        <select [value]="fillMode()" (change)="onFillModeChange($event)">
          @for (mode of fillModes; track mode) {
            <option [value]="mode">{{ mode }}</option>
          }
        </select>
      </label>
      <label>
        <span>Terrain quality</span>
        <select [value]="terrainQuality()" (change)="onTerrainQualityChange($event)">
          @for (quality of terrainQualityKinds; track quality) {
            <option [value]="quality">{{ terrainQualityPresets[quality].label }}</option>
          }
        </select>
      </label>
      <label>
        <span>Water level: {{ waterLevel() > 0 ? 'Rising +' : waterLevel() < 0 ? 'Falling ' : 'Baseline ' }}{{ waterLevel().toFixed(2) }}</span>
        <input type="range" min="-1" max="1" step="0.05" [value]="waterLevel()" (input)="onWaterLevelInput($event)" />
      </label>
      <label>
        <span>Terrain vertical scale: {{ terrainHeightScale().toFixed(1) }}</span>
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
      <span>Debug orbit view · drag to rotate · wheel to zoom</span>
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
  readonly projectionType = signal<MapProjectionKind>('equirectangular');
  readonly projectionKinds = MAP_PROJECTION_KINDS;
  readonly projectionLabels = MAP_PROJECTION_LABELS;
  readonly fillMode = signal<CellPlanetMapFillMode>('biome');
  readonly fillModes: CellPlanetMapFillMode[] = ['biome', 'elevation', 'plates', 'temperature', 'moisture', 'land'];
  readonly terrainQuality = signal<TerrainQuality>('standard');
  readonly terrainQualityKinds = TERRAIN_QUALITY_KINDS;
  readonly terrainQualityPresets = TERRAIN_QUALITY_PRESETS;
  readonly waterLevel = signal(0);
  /** Display-only relief scale. Canonical planet elevations remain unchanged. */
  readonly terrainHeightScale = signal(4);
  /** Experimental runtime-only vertex removal ratio; canonical terrain is unchanged. */
  readonly runtimeSimplificationRatio = signal(0);
  readonly isRebuilding = signal(false);
  private readonly preservedQueryParams = signal<CellPlanetQuery>({});
  readonly comparisonQueryParams = signal<Record<string, string | number | boolean>>({});

  /**
   * Temporary terrain-inspection camera. The orthographic camera remains in
   * the template as the future Civ-style map camera and can be reactivated
   * when the production pan/zoom controls are implemented.
   */
  readonly debugOrbitEnabled = true;
  readonly hasTerrain = signal(false);
  private terrainReady = false;

  private activeTextures: { height: DataTexture; color: DataTexture } | undefined;
  private simplifiedTerrainMesh: Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
  private colorContext:
    | {
        bake: IPlanetSurfaceBake;
        tectonics: IPlanetTectonics;
        ecology: IPlanetEcology;
        oceanSubstance: 'water' | 'lava';
        elevationMin: number;
        elevationMax: number;
      }
    | undefined;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const query = readCellPlanetQuery(params);
      this.preservedQueryParams.set(query);
      const previousQuality = this.terrainQuality();
      this.restoreQuery(query);
      this.updateComparisonQueryParams();
      if (this.terrainReady) {
        if (previousQuality !== this.terrainQuality()) {
          const previousTerrain = this.terrain;
          this.terrain = this.createTerrainScene();
          previousTerrain.dispose();
        }
        this.rebuildWorld();
      }
    });
    this.terrain = this.createTerrainScene();
    this.terrainReady = true;
    this.rebuildWorld();

    this.destroyRef.onDestroy(() => {
      this.terrain.dispose();
      this.disposeSimplifiedTerrain();
      this.activeTextures?.height.dispose();
      this.activeTextures?.color.dispose();
    });
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

  onProjectionTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as MapProjectionKind;
    if (this.projectionKinds.includes(value) && value !== this.projectionType()) {
      this.projectionType.set(value);
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onFillModeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as CellPlanetMapFillMode;
    if (this.fillModes.includes(value) && value !== this.fillMode()) {
      this.fillMode.set(value);
      this.updateComparisonQueryParams();
      this.rebuildColorTexture();
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

  onWaterLevelInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.waterLevel()) {
      this.waterLevel.set(Math.max(-1, Math.min(1, value)));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
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
      this.rebuildSimplifiedTerrain();
    }
  }

  randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
    this.updateComparisonQueryParams();
    this.rebuildWorld();
  }

  exportTerrainForBlender(): void {
    const context = this.colorContext;
    const active = this.activeTextures;
    if (!context || !active) return;
    const baseName = `cell-planet-${this.seed()}-${this.terrainQuality()}`;
    const materialFileName = `${baseName}.mtl`;
    const exported = makeObjTerrainExport(context.bake, active.color, {
      minX: -128,
      minZ: -64,
      maxX: 128,
      maxZ: 64,
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
      heightScale: this.terrainHeightScale(),
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
      tectonics,
      ecology,
      oceanSubstance: profile.oceanSubstance,
      elevationMin,
      elevationMax,
    };
    const colorTexture = makeColorTexture(
      bake,
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
      bounds: { minX: -128, minZ: -64, maxX: 128, maxZ: 64 },
    };
    const previousTextures = this.activeTextures;
    this.activeTextures = { height: heightTexture, color: colorTexture };
    this.terrain.setHeightSource(source);
    this.rebuildSimplifiedTerrain();
    previousTextures?.height.dispose();
    previousTextures?.color.dispose();
    this.hasTerrain.set(true);
    this.isRebuilding.set(false);
  }

  private rebuildColorTexture(): void {
    const context = this.colorContext;
    const active = this.activeTextures;
    if (!context || !active) return;
    const colorTexture = makeColorTexture(
      context.bake,
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
      bounds: { minX: -128, minZ: -64, maxX: 128, maxZ: 64 },
    });
    active.color.dispose();
    this.rebuildSimplifiedTerrain();
  }

  private rebuildSimplifiedTerrain(): void {
    this.disposeSimplifiedTerrain();
    if (this.runtimeSimplificationRatio() <= 0 || !this.colorContext || !this.activeTextures) {
      this.terrain.setVisible(true);
      return;
    }

    // Simplifying the clipmap's regular tile geometry would break its border
    // morphing and crack-free LOD assumptions. This alternate mesh is therefore
    // intentionally a standalone runtime inspection mode.
    this.terrain.setVisible(false);
    const geometry = makeBakedTerrainGeometry(this.colorContext.bake, {
      minX: -128,
      minZ: -64,
      maxX: 128,
      maxZ: 64,
    }, this.activeTextures.color);
    this.isRebuilding.set(true);
    try {
      const modifier = new SimplifyModifier();
      const positionCount = geometry.getAttribute('position').count;
      const removeCount = Math.floor(positionCount * this.runtimeSimplificationRatio());
      const simplified = modifier.modify(geometry, removeCount);
      geometry.dispose();
      simplified.computeVertexNormals();
      const material = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        metalness: 0,
        flatShading: false,
      });
      const mesh = new Mesh(simplified, material);
      mesh.name = 'cell-planet-runtime-simplified-terrain';
      this.engine.scene.add(mesh);
      this.simplifiedTerrainMesh = mesh;
    } catch (error) {
      geometry.dispose();
      this.terrain.setVisible(true);
      console.error('Runtime terrain simplification failed; restored clipmap.', error);
    } finally {
      this.isRebuilding.set(false);
    }
  }

  private disposeSimplifiedTerrain(): void {
    if (!this.simplifiedTerrainMesh) return;
    this.engine.scene.remove(this.simplifiedTerrainMesh);
    this.simplifiedTerrainMesh.geometry.dispose();
    this.simplifiedTerrainMesh.material.dispose();
    this.simplifiedTerrainMesh = undefined;
  }

  private inputNumber(event: Event): number {
    return (event.target as HTMLInputElement).valueAsNumber;
  }

  private createTerrainScene(): IClipmapTerrainSceneHandle {
    const quality = this.terrainQualityPresets[this.terrainQuality()];
    const terrain = createClipmapTerrainScene(this.engine, (diagnostics) => {
      this.drawCalls.set(diagnostics.drawCalls);
      this.triangles.set(diagnostics.triangles);
      this.instances.set(diagnostics.instanceCountsByLevel.join(' · '));
    }, {
      levelCount: quality.levelCount,
      baseTileSizeM: 16,
      blockRadiusTiles: 4,
      gridResolution: quality.gridResolution,
      heightScaleM: 1,
      lodFocus: { x: 0, z: 0 },
    });
    terrain.setShowLevelTint(false);
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
    if (query.projection && this.projectionKinds.includes(query.projection as MapProjectionKind)) {
      this.projectionType.set(query.projection as MapProjectionKind);
    }
    if (query.terrainQuality && this.terrainQualityKinds.includes(query.terrainQuality as TerrainQuality)) {
      this.terrainQuality.set(query.terrainQuality as TerrainQuality);
    }
    if (query.fillMode && this.fillModes.includes(query.fillMode as CellPlanetMapFillMode)) {
      this.fillMode.set(query.fillMode as CellPlanetMapFillMode);
    }
    const waterLevel = this.numberQuery(query.waterLevel);
    if (waterLevel !== null) this.waterLevel.set(Math.max(-1, Math.min(1, waterLevel)));
    const terrainHeightScale = this.numberQuery(query.terrainHeightScale);
    if (terrainHeightScale !== null) this.terrainHeightScale.set(Math.max(0, Math.min(14, terrainHeightScale)));
    const runtimeSimplificationRatio = this.numberQuery(query.runtimeSimplificationRatio);
    if (runtimeSimplificationRatio !== null) this.runtimeSimplificationRatio.set(Math.max(0, Math.min(0.95, runtimeSimplificationRatio)));
  }

  private updateComparisonQueryParams(): void {
    this.comparisonQueryParams.set({
      ...this.preservedQueryParams(),
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxation: this.relaxationIterations(),
      worldProfile: this.worldProfileKind(),
      projection: this.projectionType(),
      terrainQuality: this.terrainQuality(),
      fillMode: this.fillMode(),
      waterLevel: this.waterLevel(),
      terrainHeightScale: this.terrainHeightScale(),
      runtimeSimplificationRatio: this.runtimeSimplificationRatio(),
    });
  }

  private numberQuery(value: string | undefined): number | null {
    if (value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
}
